import { describe, it, expect, vi } from 'vitest'
import type { ChatCompletionMessageParam } from 'openai/resources'
import type { ChatMessage, AppSettings, PageContext } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { HAS_KNOWLEDGE_BASE } from '../config'
import { runAgent, isVisionUnsupportedError } from './agent'
import { sanitizeToken, truncateToolResult, checkDestructiveConfirmation, assertApiCallAllowed, isFileLevelDelete, describeDestructiveOp, isDestructiveApiCall } from './agent-security'
import { buildApiHistory, attachmentToMetaData } from './agent-history'
import { buildSystemPrompt } from './agent-prompt'
import { toolsForContext } from './agent-context'
import { rewriteFeishuOrigins, resolveImageInsertIndex } from './agent-executor'

describe('toolsForContext — exposes only the current resource\'s tools (+ core)', () => {
  const names = (kind: string | undefined) => toolsForContext(kind).map((t) => (t as { function: { name: string } }).function.name)
  it('sheet page: core + sheet tools; no bitable/doc-specific tools', () => {
    const n = names('sheet')
    expect(n).toEqual(expect.arrayContaining(['read_range', 'delete_dimension', 'feishu_api_call']))
    expect(n).not.toContain('batch_delete_records') // bitable
    expect(n).not.toContain('list_blocks')          // doc
    expect(n.length).toBeLessThan(25)               // was 55 before scoping
  })
  it('doc page: core + doc tools; not sheet/bitable manipulation', () => {
    const n = names('doc')
    expect(n).toEqual(expect.arrayContaining(['add_document_content', 'delete_document_blocks']))
    expect(n).not.toContain('read_range')
    expect(n).not.toContain('batch_delete_records')
  })
  it('base page: bitable tools; not sheet/doc manipulation', () => {
    const n = names('base')
    expect(n).toEqual(expect.arrayContaining(['batch_delete_records', 'search_records']))
    expect(n).not.toContain('delete_dimension')
    expect(n).not.toContain('delete_document_blocks')
  })
  it('unknown/unresolved page: core + creators only (small set)', () => {
    const n = names(undefined)
    expect(n).toEqual(expect.arrayContaining(['feishu_api_call', 'create_spreadsheet', 'create_document']))
    expect(n).not.toContain('read_range')
    expect(n).not.toContain('batch_delete_records')
    expect(n.length).toBeLessThan(10)
  })
})

describe('buildSystemPrompt — static prefix is cache-stable across pages', () => {
  // Latency: DeepSeek/OpenAI prefix-cache the longest byte-stable prompt prefix. All STATIC
  // rules must sit before the dynamic「当前上下文」block so that chunk caches across turns.
  const s = { openaiBaseUrl: '', openaiApiKey: '', openaiModel: '', feishuAccessToken: '', feishuOwnerOpenId: '' } as AppSettings
  const baseCtx = (over: Partial<PageContext['feishu']>): PageContext => ({
    url: 'https://acme.feishu.cn/base/AppAAA', title: 't', selectedText: '',
    feishu: { isBase: true, appToken: 'AppAAA', tableId: 'tblAAA', ...over },
  })

  it('the rules prefix is byte-identical for a Base page vs a Doc page vs a selection', () => {
    const a = buildSystemPrompt(baseCtx({ kind: 'base' }), s)
    const b = buildSystemPrompt({ url: 'https://acme.feishu.cn/docx/DocBBB', title: 't', selectedText: '', feishu: { isBase: false, kind: 'doc', documentId: 'DocBBB' } }, s)
    const c = buildSystemPrompt({ url: 'https://acme.feishu.cn/docx/DocCCC', title: 't', selectedText: '用户选中的一段文字', feishu: { isBase: false, kind: 'doc', documentId: 'DocCCC' } }, s)
    const marker = '# 当前上下文'
    const prefix = (p: string) => p.slice(0, p.indexOf(marker))
    expect(a.indexOf(marker)).toBeGreaterThan(0) // marker exists
    // The whole static rules section is identical regardless of page kind / app_token / selection.
    expect(prefix(a)).toBe(prefix(b))
    expect(prefix(a)).toBe(prefix(c))
  })

  it('the dynamic block DOES vary with the page (so we\'re not accidentally caching everything as one blob)', () => {
    const a = buildSystemPrompt(baseCtx({ kind: 'base', appToken: 'AppAAA' }), s)
    const b = buildSystemPrompt(baseCtx({ kind: 'base', appToken: 'AppZZZ' }), s)
    expect(a).not.toBe(b) // app_token differs → the trailing dynamic block differs
  })

  it('no `${}` interpolation leaked into the static section (would break the stable prefix)', () => {
    const p = buildSystemPrompt(baseCtx({ kind: 'base' }), s)
    const marker = '# 当前上下文'
    const staticPart = p.slice(0, p.indexOf(marker))
    // A leftover template placeholder means the prefix isn't actually stable.
    expect(staticPart).not.toMatch(/\$\{|\bundefined\b/)
  })
})

describe('rewriteFeishuOrigins — clip/report links always keep the tenant prefix (no recurrence)', () => {
  const T = 'https://acme.feishu.cn' // tenant origin (tests run with base domain = feishu.cn)
  it('rewrites a tenant-less / wrong-subdomain Feishu link to the tenant origin', () => {
    expect(rewriteFeishuOrigins('打开 [文档](https://feishu.cn/docx/doxABC123) 看看', T))
      .toBe('打开 [文档](https://acme.feishu.cn/docx/doxABC123) 看看')
    expect(rewriteFeishuOrigins('https://other.feishu.cn/base/bascXYZ', T)).toBe('https://acme.feishu.cn/base/bascXYZ')
    expect(rewriteFeishuOrigins('https://x.feishu.cn/sheets/shtA https://y.feishu.cn/wiki/wkB', T))
      .toBe('https://acme.feishu.cn/sheets/shtA https://acme.feishu.cn/wiki/wkB')
  })
  it('leaves non-Feishu URLs untouched', () => {
    expect(rewriteFeishuOrigins('see https://example.com/docx/abc and https://evil.cn/base/x', T))
      .toBe('see https://example.com/docx/abc and https://evil.cn/base/x')
  })
  it('is a no-op on empty / link-free text', () => {
    expect(rewriteFeishuOrigins('', T)).toBe('')
    expect(rewriteFeishuOrigins('没有链接的普通文字', T)).toBe('没有链接的普通文字')
  })
  it('does NOT rewrite when no tenant is known (null) — must not downgrade a correct link', () => {
    // A correct tenant link must survive untouched when we have no tenant origin to apply.
    expect(rewriteFeishuOrigins('打开 https://acme.feishu.cn/docx/doxX', null)).toBe('打开 https://acme.feishu.cn/docx/doxX')
  })
})
import type { AgentCallbacks } from './agent'

describe('sanitizeToken', () => {
  it('passes through a valid Feishu token', () => {
    expect(sanitizeToken('tblAbC123_-x')).toBe('tblAbC123_-x')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeToken('  bascn123  ')).toBe('bascn123')
  })

  it('returns undefined for empty / undefined input', () => {
    expect(sanitizeToken(undefined)).toBeUndefined()
    expect(sanitizeToken('')).toBeUndefined()
  })

  it('rejects injection characters', () => {
    expect(() => sanitizeToken('abc/../../etc')).toThrow(/无效 ID 格式/)
    expect(() => sanitizeToken('abc def')).toThrow(/无效 ID 格式/)
    expect(() => sanitizeToken('abc?x=1')).toThrow(/无效 ID 格式/)
  })
})

describe('truncateToolResult', () => {
  it('returns short input unchanged', () => {
    const small = JSON.stringify({ a: 1 })
    expect(truncateToolResult(small)).toBe(small)
  })

  it('truncates oversized input and appends a notice', () => {
    const big = JSON.stringify(
      Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `name-${i}` })),
      null,
      2
    )
    const out = truncateToolResult(big)
    expect(out.length).toBeLessThan(big.length)
    expect(out).toMatch(/结果已截断/)
  })
})

describe('checkDestructiveConfirmation', () => {
  const userMsg = (content: string): ChatCompletionMessageParam => ({ role: 'user', content })

  it('confirms on an explicit affirmative', () => {
    expect(checkDestructiveConfirmation([], [userMsg('确认')])).toBe(true)
    expect(checkDestructiveConfirmation([], [userMsg('yes')])).toBe(true)
    expect(checkDestructiveConfirmation([], [userMsg('删除')])).toBe(true)
  })

  it('rejects vague / passive replies', () => {
    expect(checkDestructiveConfirmation([], [userMsg('你决定吧')])).toBe(false)
    expect(checkDestructiveConfirmation([], [userMsg('随便')])).toBe(false)
  })

  it('rejects when the affirmative is buried in a longer sentence (exact-match only)', () => {
    expect(checkDestructiveConfirmation([], [userMsg('我觉得可以确认一下')])).toBe(false)
  })

  it('rejects when there is no user message at all', () => {
    expect(checkDestructiveConfirmation([], [])).toBe(false)
  })
})

describe('buildApiHistory', () => {
  const msg = (m: Partial<ChatMessage>): ChatMessage =>
    ({ id: m.id ?? Math.random().toString(), role: 'user', content: '', createdAt: 0, ...m } as ChatMessage)

  it('drops placeholder tool_calls that have no matching tool response', () => {
    // Mirrors ChatPanel's UI log: real assistant(tool_calls) + synthetic "tool started"
    // indicator (tmp id, no response) + the real tool result + a follow-up user turn.
    const history: ChatMessage[] = [
      msg({ role: 'user', content: '建一个项目管理表' }),
      msg({
        role: 'assistant', content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'create_table', arguments: '{}' } }],
      }),
      msg({
        role: 'assistant', content: null, // synthetic onToolStart indicator
        tool_calls: [{ id: 'tmp-create_table', type: 'function', function: { name: 'create_table', arguments: '{}' } }],
      }),
      msg({ role: 'tool', content: '{"table_id":"tbl1"}', tool_call_id: 'call_1' }),
      msg({ role: 'assistant', content: '建好了' }),
      msg({ role: 'user', content: '修改第一列为问题描述' }),
    ]

    const out = buildApiHistory(history)

    // Every assistant message with tool_calls must be immediately followed by a tool
    // message for each of its tool_call_ids (the exact rule DeepSeek enforces).
    for (let i = 0; i < out.length; i++) {
      const m = out[i] as ChatCompletionMessageParam & { tool_calls?: Array<{ id: string }> }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const following = out.slice(i + 1, i + 1 + m.tool_calls.length)
        expect(following.every((f) => f.role === 'tool')).toBe(true)
        const ids = new Set(following.map((f) => (f as { tool_call_id: string }).tool_call_id))
        for (const tc of m.tool_calls) expect(ids.has(tc.id)).toBe(true)
      }
    }

    // The tmp placeholder must not survive as an assistant-with-tool_calls.
    const toolCallIds = out.flatMap((m) =>
      (m as { tool_calls?: Array<{ id: string }> }).tool_calls?.map((t) => t.id) ?? []
    )
    expect(toolCallIds).toEqual(['call_1'])

    // No orphan tool messages.
    const respondedIds = new Set(
      out.filter((m) => m.role === 'tool').map((m) => (m as { tool_call_id: string }).tool_call_id)
    )
    expect([...respondedIds]).toEqual(['call_1'])
  })

  it('passes through a plain user/assistant conversation unchanged', () => {
    const out = buildApiHistory([
      msg({ role: 'user', content: 'hi' }),
      msg({ role: 'assistant', content: 'hello' }),
    ])
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('最新一条带图片的 user 消息 → 多模态 content（text + image_url parts），且保留 attachment_id', () => {
    const out = buildApiHistory([
      msg({ role: 'user', content: '看下这张图', attachments: [
        { id: 'att1', type: 'image', name: 'a.png', mimeType: 'image/png', size: 0, dataUrl: 'data:image/png;base64,xxx' },
      ] }),
    ])
    expect(out).toHaveLength(1)
    const u = out[0] as { role: string; content: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> }
    expect(u.role).toBe('user')
    expect(Array.isArray(u.content)).toBe(true)
    expect(u.content).toHaveLength(3)
    // 第一个 part：文本（用户输入）
    expect(u.content[0].type).toBe('text')
    expect(u.content[0].text).toBe('看下这张图')
    // 第二个 part：文本元数据（attachment_id）—— LLM 据此调 insert_image
    expect(u.content[1].type).toBe('text')
    expect(u.content[1].text).toBe('【附件：图片 a.png（attachment_id: att1）】')
    // 第三个 part：image_url（让 vision 模型看图）
    expect(u.content[2].type).toBe('image_url')
    expect(u.content[2].image_url?.url).toBe('data:image/png;base64,xxx')
  })

  it('最新一条带图片的 user 消息 → text + meta + image_url（用户输入 + 元数据 + 图片三段式）', () => {
    const out = buildApiHistory([
      msg({ role: 'user', content: '插入这张图', attachments: [
        { id: 'att9', type: 'image', name: 's.png', mimeType: 'image/png', size: 0, dataUrl: 'data:image/png;base64,zzz' },
      ] }),
    ])
    const u = out[0] as { content: Array<{ type: string }> }
    expect(u.content.map((p) => p.type)).toEqual(['text', 'text', 'image_url'])
  })

  it('历史里的图片 user 消息 → 纯文本元数据（不嵌 image_url，避免历史回放 token 爆炸 + 非 vision 模型拒绝）', () => {
    const out = buildApiHistory([
      msg({ role: 'user', content: 'u1', attachments: [
        { id: 'old', type: 'image', name: 'old.png', mimeType: 'image/png', size: 0, dataUrl: 'data:image/png;base64,old' },
      ] }),
      msg({ role: 'assistant', content: 'a1' }),
      msg({ role: 'user', content: '最新消息无图' }),
    ])
    // 历史图片消息（第 1 条）走纯文本元数据
    const u1 = out[0] as { role: string; content: string }
    expect(u1.role).toBe('user')
    expect(typeof u1.content).toBe('string')
    expect(u1.content).toContain('attachment_id: old')
    expect(u1.content).not.toContain('image_url')
  })

  it('最新一条带图片的 user 消息是唯一的 image_url 编码目标（多条图片历史时只编码最后一条）', () => {
    const out = buildApiHistory([
      msg({ role: 'user', content: 'u1', attachments: [
        { id: 'old', type: 'image', name: 'old.png', mimeType: 'image/png', size: 0, dataUrl: 'data:image/png;base64,old' },
      ] }),
      msg({ role: 'assistant', content: 'a1' }),
      msg({ role: 'user', content: 'u2', attachments: [
        { id: 'new', type: 'image', name: 'new.png', mimeType: 'image/png', size: 0, dataUrl: 'data:image/png;base64,new' },
      ] }),
    ])
    const u1 = out[0] as { content: string }
    const u2 = out[2] as { content: Array<{ type: string }> }
    // 历史图片：纯文本
    expect(typeof u1.content).toBe('string')
    // 最新图片：多模态
    expect(Array.isArray(u2.content)).toBe(true)
    expect(u2.content.some((p) => p.type === 'image_url')).toBe(true)
  })

  it('无图片的附件消息 → 纯文本元数据（保持原行为）', () => {
    const out = buildApiHistory([
      msg({ role: 'user', content: 'u1', attachments: [
        { id: 'f1', type: 'file', name: 'd.csv', mimeType: 'text/csv', size: 3, content: 'x,y\n1,2' },
      ] }),
    ])
    const u = out[0] as { content: string }
    expect(typeof u.content).toBe('string')
    expect(u.content).toContain('附件：d.csv')
    expect(u.content).toContain('x,y')
  })

  it('visionEnabled=false（降级模式）→ 最新图片 user 消息也走纯文本，但保留 attachment_id（insert_image 仍可用）', () => {
    const out = buildApiHistory([
      msg({ role: 'user', content: '插入这张图到文档末尾', attachments: [
        { id: 'att1', type: 'image', name: 'a.png', mimeType: 'image/png', size: 0, dataUrl: 'data:image/png;base64,xxx' },
      ] }),
    ], false)
    const u = out[0] as { role: string; content: string }
    expect(u.role).toBe('user')
    // 降级模式：content 是字符串，不是多模态数组
    expect(typeof u.content).toBe('string')
    // attachment_id 仍保留——LLM 能据此调 insert_image
    expect(u.content).toContain('attachment_id: att1')
    // 没有 image_url part
    expect(u.content).not.toContain('image_url')
  })
})

describe('assertApiCallAllowed — feishu_api_call security gate', () => {
  it('allows business namespaces (bitable/sheets/docx/drive files/wiki)', () => {
    expect(() => assertApiCallAllowed('/bitable/v1/apps/x/tables')).not.toThrow()
    expect(() => assertApiCallAllowed('/sheets/v3/spreadsheets/x')).not.toThrow()
    expect(() => assertApiCallAllowed('/docx/v1/documents/x/blocks/x/children')).not.toThrow()
    expect(() => assertApiCallAllowed('/drive/v1/files/x/comments')).not.toThrow()
    expect(() => assertApiCallAllowed('/wiki/v2/spaces/get_node')).not.toThrow()
  })

  it('blocks messaging / contacts / admin / permissions / ownership transfer', () => {
    expect(() => assertApiCallAllowed('/im/v1/messages')).toThrow(/安全/)
    expect(() => assertApiCallAllowed('/contact/v3/users')).toThrow(/安全/)
    expect(() => assertApiCallAllowed('/drive/v1/permissions/x/members/transfer_owner')).toThrow(/安全/)
    expect(() => assertApiCallAllowed('/admin/v1/x')).toThrow(/安全/)
  })

  it('default-denies anything outside the allowlist', () => {
    expect(() => assertApiCallAllowed('/approval/v4/instances')).toThrow(/白名单/)
    expect(() => assertApiCallAllowed('/calendar/v4/calendars')).toThrow(/白名单/)
  })

  it('rejects path traversal / injection characters', () => {
    expect(() => assertApiCallAllowed('/bitable/../im/v1/messages')).toThrow()
    expect(() => assertApiCallAllowed('/bitable//evil')).toThrow()
    expect(() => assertApiCallAllowed('bitable/no-slash')).toThrow(/必须以/)
  })
})

describe('isDestructiveApiCall — raw-API deletes still hit the confirm gate', () => {
  it('flags destructive POSTs deny-by-default: batch_delete, move_to_trash, Sheets deleteDimension, DELETE', () => {
    expect(isDestructiveApiCall('feishu_api_call', { method: 'POST', path: '/bitable/v1/apps/a/tables/t/records/batch_delete' })).toBe(true)
    expect(isDestructiveApiCall('feishu_api_call', { method: 'POST', path: '/drive/v1/files/f/move_to_trash' })).toBe(true) // drive trash — previously slipped through
    expect(isDestructiveApiCall('feishu_api_call', { method: 'POST', path: '/sheets/v2/spreadsheets/s/sheets_batch_update', body: { requests: [{ deleteDimension: { dimension: { majorDimension: 'ROWS' } } }] } })).toBe(true)
    expect(isDestructiveApiCall('feishu_api_call', { method: 'DELETE', path: '/x' })).toBe(true)
  })
  it('does NOT flag normal creates/reads (no over-prompting)', () => {
    expect(isDestructiveApiCall('feishu_api_call', { method: 'POST', path: '/bitable/v1/apps/a/tables/t/records/batch_create' })).toBe(false)
    expect(isDestructiveApiCall('feishu_api_call', { method: 'POST', path: '/sheets/v2/spreadsheets/s/sheets_batch_update', body: { requests: [{ insertDimension: {} }] } })).toBe(false)
    expect(isDestructiveApiCall('feishu_api_call', { method: 'POST', path: '/bitable/v1/apps/a/tables/t/records/batch_get' })).toBe(false)
    expect(isDestructiveApiCall('feishu_api_call', { method: 'GET', path: '/x' })).toBe(false)
    expect(isDestructiveApiCall('list_records', {})).toBe(false)
  })
})

describe('isFileLevelDelete — assistant never deletes whole files (principle 2)', () => {
  it('blocks whole-container tools (delete_table / delete_sheet)', () => {
    expect(isFileLevelDelete('delete_table', {})).toBe(true)
    expect(isFileLevelDelete('delete_sheet', {})).toBe(true)
  })

  it('blocks every DELETE through the generic API', () => {
    expect(isFileLevelDelete('feishu_api_call', { method: 'DELETE', path: '/drive/v1/files/x' })).toBe(true)
    expect(isFileLevelDelete('feishu_api_call', { method: 'delete', path: '/docx/v1/documents/x' })).toBe(true)
  })

  it('blocks POST move_to_trash through the generic API (file-level destroy)', () => {
    expect(isFileLevelDelete('feishu_api_call', { method: 'POST', path: '/drive/v1/files/x/move_to_trash' })).toBe(true)
  })

  it('allows content-level deletion (rows / fields / blocks / dedupe) — gated by confirm, not blocked', () => {
    expect(isFileLevelDelete('delete_record', {})).toBe(false)
    expect(isFileLevelDelete('batch_delete_records', {})).toBe(false)
    expect(isFileLevelDelete('delete_field', {})).toBe(false)
    expect(isFileLevelDelete('delete_document_blocks', {})).toBe(false)
    expect(isFileLevelDelete('dedupe_records', {})).toBe(false)
  })

  it('does not block generic-API modifications (PUT/PATCH/GET)', () => {
    expect(isFileLevelDelete('feishu_api_call', { method: 'PATCH' })).toBe(false)
    expect(isFileLevelDelete('feishu_api_call', { method: 'PUT' })).toBe(false)
    expect(isFileLevelDelete('feishu_api_call', { method: 'GET' })).toBe(false)
  })
})

describe('describeDestructiveOp — confirm-card summary (button confirm)', () => {
  it('summarizes each content-delete tool readably', () => {
    expect(describeDestructiveOp('delete_record', {})).toMatch(/删除 1 条记录/)
    expect(describeDestructiveOp('batch_delete_records', { record_ids: ['a', 'b', 'c'] })).toMatch(/批量删除 3 条/)
    expect(describeDestructiveOp('delete_field', { field_name: '工时' })).toMatch(/工时/)
    // The tool deletes the half-open range [start_index, end_index) — count = end - start.
    expect(describeDestructiveOp('delete_document_blocks', { start_index: 2, end_index: 4 })).toMatch(/2 个内容块/)
    expect(describeDestructiveOp('dedupe_records', {})).toMatch(/去重/)
    // delete_dimension shows the EXACT 1-based range so the user catches a wrong delete (e.g. header)
    expect(describeDestructiveOp('delete_dimension', { dimension: 'ROWS', start_index: 0, count: 2 })).toBe('删除电子表格第 1–2 行（共 2 行）')
    expect(describeDestructiveOp('delete_dimension', { dimension: 'COLUMNS', start_index: 3, count: 1 })).toBe('删除电子表格第 4–4 列（共 1 列）')
  })
  it('describes a generic write API call with its method + path', () => {
    expect(describeDestructiveOp('feishu_api_call', { method: 'PATCH', path: '/docx/v1/x' })).toMatch(/PATCH.*\/docx\/v1\/x/)
  })
  it('falls back gracefully for unknown counts / tools', () => {
    expect(describeDestructiveOp('batch_delete_records', {})).toMatch(/若干/)
    expect(describeDestructiveOp('mystery_tool', {})).toMatch(/mystery_tool/)
  })
})

describe('runAgent — cancellation (H3)', () => {
  it('an already-aborted signal bails before any model/network call', async () => {
    const ac = new AbortController()
    ac.abort()
    let chunks = 0
    const callbacks: AgentCallbacks = {
      onChunk: () => { chunks++ },
      onToolStart: () => {},
      onToolEnd: () => {},
      onAssistantMessage: () => {},
      onToolMessage: () => {},
    }
    const history: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi', createdAt: 0 }]
    const settings = { openaiBaseUrl: 'https://api.invalid/v1', openaiApiKey: 'sk-x', openaiModel: 'm' } as AppSettings
    const context = { url: 'https://example.com' } as PageContext

    await expect(
      runAgent(history, settings, context, callbacks, undefined, ac.signal),
    ).rejects.toThrow(/abort/i)
    expect(chunks).toBe(0) // never reached the model
  })
})

describe('resolveImageInsertIndex — insert_image anchor → root-child index', () => {
  // rootChildren shape mirrors listBlocks: { block_id, parent_id, index, block_type,
  //   heading1|heading2|heading3 | text : { elements:[{text_run:{content}}] } }
  const img = (i: number) => ({ block_id: `img${i}`, parent_id: 'doc', index: i, block_type: 27, image: {} })
  const txt = (i: number, content: string) => ({
    block_id: `t${i}`, parent_id: 'doc', index: i, block_type: 2,
    text: { elements: [{ text_run: { content } }] },
  })
  // level 1/2/3 → block_type 3/4/5, key heading1/2/3
  const h = (i: number, level: number, content: string) => ({
    block_id: `h${i}`, parent_id: 'doc', index: i, block_type: 2 + level,
    [`heading${level}`]: { elements: [{ text_run: { content } }] },
  })

  it('top → 0 even when an image already sits at index 0 (the reported regression)', () => {
    // Before the fix there was no `top` anchor, so the LLM matched the first text ('封面说明')
    // and inserted AFTER it (index 2) — dropping the new image below the first text line.
    const kids = [img(0), txt(1, '封面说明'), txt(2, '正文')]
    expect(resolveImageInsertIndex({ type: 'top' }, kids)).toBe(0)
  })
  it('top → 0 on an empty doc', () => {
    expect(resolveImageInsertIndex({ type: 'top' }, [])).toBe(0)
  })
  it('end → append (length)', () => {
    expect(resolveImageInsertIndex({ type: 'end' }, [txt(0, 'a'), txt(1, 'b')])).toBe(2)
  })
  it('heading → immediately AFTER the matched heading', () => {
    const kids = [h(0, 1, '报告'), img(1), txt(2, '正文')]
    expect(resolveImageInsertIndex({ type: 'heading', value: '报告' }, kids)).toBe(1)
  })
  it('text → immediately AFTER the matched paragraph', () => {
    const kids = [img(0), txt(1, '封面说明'), txt(2, '正文')]
    expect(resolveImageInsertIndex({ type: 'text', value: '封面说明' }, kids)).toBe(2)
  })
  it('section_end → just before the next same-or-higher-level heading', () => {
    const kids = [h(0, 1, '一'), h(1, 2, '1.1'), txt(2, 'x'), h(3, 2, '1.2'), txt(4, 'y')]
    // section "1.1" (level 2) ends right before "1.2" (also level 2) → index 3
    expect(resolveImageInsertIndex({ type: 'section_end', value: '1.1' }, kids)).toBe(3)
  })
  it('section_end → doc end when no later same-or-higher heading follows', () => {
    const kids = [h(0, 1, '一'), txt(1, 'x'), txt(2, 'y')]
    expect(resolveImageInsertIndex({ type: 'section_end', value: '一' }, kids)).toBe(3)
  })
  it('heading/text match is case-insensitive and substring-based', () => {
    expect(resolveImageInsertIndex({ type: 'text', value: 'hello' }, [txt(0, 'Hello World')])).toBe(1)
  })
  it('throws when the matched heading/text is not found', () => {
    expect(() => resolveImageInsertIndex({ type: 'heading', value: '不存在' }, [txt(0, 'a')])).toThrow(/找不到/)
  })
  it('throws on an unsupported anchor type', () => {
    expect(() => resolveImageInsertIndex({ type: 'cursor' }, [txt(0, 'a')])).toThrow(/不支持的锚点类型/)
  })
})

describe('attachmentToMetaData — 附件 → 文本元数据（喂给 LLM）', () => {
  it('image：原样输出图片占位串', () => {
    const a = { id: 'att1', type: 'image', name: 'a.png', mimeType: 'image/png', size: 0, dataUrl: 'data:image/png;base64,xxx' }
    expect(attachmentToMetaData(a as any)).toBe(`【附件：图片 a.png（attachment_id: att1）】`)
  })
  it('file：原样输出文件占位串（含前导换行）', () => {
    const a = { id: 'f1', type: 'file', name: 'd.csv', mimeType: 'text/csv', size: 3, content: 'x,y\n1,2' }
    expect(attachmentToMetaData(a as any)).toBe(`\n\n【附件：d.csv】\nx,y\n1,2`)
  })
  it('selection（带标题+段落）：输出引用文档片段块', () => {
    const a = { id: 's1', type: 'selection', name: '我的文档', mimeType: 'text/x-feishu-selection', size: 0,
      selection: { kind: 'doc', docToken: 'D1', docTitle: '我的文档', url: 'u', selectedText: '选中内容', paragraphText: '整段文字', headingText: '标题A' } }
    expect(attachmentToMetaData(a as any)).toBe(
      `【引用文档片段｜文档：我的文档｜标题：标题A】\n所在段落：整段文字\n选中的内容：\n选中内容`,
    )
  })
  it('selection（无标题/段落）：省略对应字段', () => {
    const a = { id: 's2', type: 'selection', name: '文档片段', mimeType: 'text/x-feishu-selection', size: 0,
      selection: { kind: 'doc', docToken: 'D1', docTitle: '', url: 'u', selectedText: '选中内容' } }
    expect(attachmentToMetaData(a as any)).toBe(
      `【引用文档片段｜文档：当前文档】\n选中的内容：\n选中内容`,
    )
  })
  it('未知/缺数据 → null', () => {
    expect(attachmentToMetaData({ id: 'x', type: 'image', name: 'a', mimeType: '', size: 0 } as any)).toBe(null) // 无 dataUrl
  })
})

describe('知识库只读工具', () => {
  it('toolsForContext：默认（不传 / true）带 KB 工具；显式 false 才关', () => {
    const def = toolsForContext('doc').map((t) => t.function.name)
    const on = toolsForContext('doc', { kbEnabled: true }).map((t) => t.function.name)
    const off = toolsForContext('doc', { kbEnabled: false }).map((t) => t.function.name)
    if (HAS_KNOWLEDGE_BASE) {
      // 默认开：undefined 不再被当成关（修 App.tsx `=== true` 把 undefined 当关的回归）
      expect(def).toContain('search_knowledge_base')
      expect(def).toContain('list_knowledge_notes')
      expect(def).toContain('read_knowledge_note')
      expect(on).toContain('search_knowledge_base')
      expect(off).not.toContain('search_knowledge_base') // 仅显式 false 关闭
    } else {
      expect(def).not.toContain('search_knowledge_base') // 商店构建关
      expect(on).not.toContain('search_knowledge_base')
    }
  })

  it('executeTool search_knowledge_base → 调 searchVault，返回结构化数组（非预序列化串）', async () => {
    // agent.ts 静态 import '../obsidian/api' 已在文件加载时绑定真实模块；
    // 需 resetModules + doMock 后动态 import，才能让 agent 内部解析到 mock。
    vi.resetModules()
    const mockSearch = vi.fn().mockResolvedValue([{ path: 'a.md', score: 1 }])
    vi.doMock('../obsidian/api', () => ({ searchVault: mockSearch, readNote: vi.fn(), recentNotes: vi.fn() }))
    const { executeTool } = await import('./agent-executor')
    const out = await executeTool('search_knowledge_base', { query: 'kw' }, 'tok', {} as never, { ...DEFAULT_SETTINGS })
    expect(mockSearch).toHaveBeenCalled()
    // 返回的是数组本身（由 loop 统一序列化）；不能是双重转义的 JSON 字符串
    expect(Array.isArray(out)).toBe(true)
    expect(JSON.stringify(out)).toContain('a.md')
    expect(JSON.stringify(out)).not.toContain('\\"path\\"') // 不是被再包一层转义的串
  })

  it('executeTool list_knowledge_notes → 调 recentNotes', async () => {
    vi.resetModules()
    const mockRecent = vi.fn().mockResolvedValue([{ path: 'Inbox/x.md', mtime: 1 }])
    vi.doMock('../obsidian/api', () => ({ searchVault: vi.fn(), readNote: vi.fn(), recentNotes: mockRecent }))
    const { executeTool } = await import('./agent-executor')
    const out = await executeTool('list_knowledge_notes', {}, 'tok', {} as never, { ...DEFAULT_SETTINGS })
    expect(mockRecent).toHaveBeenCalled()
    expect(Array.isArray(out)).toBe(true)
    expect(JSON.stringify(out)).toContain('Inbox/x.md')
  })

  it('buildSystemPrompt：默认 / true 含知识库段；显式 false 不含', () => {
    const pDef = buildSystemPrompt({} as never, { ...DEFAULT_SETTINGS } as AppSettings, undefined)
    const pOff = buildSystemPrompt({} as never, { ...DEFAULT_SETTINGS } as AppSettings, undefined, false)
    if (HAS_KNOWLEDGE_BASE) {
      // 用 list_knowledge_notes 作块标记——静态前缀里的"拒绝例外"也会提到 search_knowledge_base /
      // "知识库"，但不会提到 list_knowledge_notes（它只出现在动态 KB 块里）。
      expect(pDef).toContain('list_knowledge_notes')
      expect(pOff).not.toContain('list_knowledge_notes')
    }
  })
})

describe('记录读取与字段缓存', () => {
  it('executeTool list_records：重排为分页把手前置（has_more/next_page_token 在 items 前），透传 page_token', async () => {
    vi.resetModules()
    const mockListRecords = vi.fn().mockResolvedValue({
      items: [{ record_id: 'r1' }, { record_id: 'r2' }],
      has_more: true, page_token: 'NEXT', total: 50,
    })
    vi.doMock('../feishu/api', () => ({ listRecords: mockListRecords }))
    const { executeTool } = await import('./agent-executor')
    const out = await executeTool(
      'list_records', { app_token: 'a', table_id: 't', page_token: 'CUR' },
      'tok', {} as never, { ...DEFAULT_SETTINGS },
    ) as Record<string, unknown>
    // 透传上一页游标
    expect(mockListRecords).toHaveBeenCalledWith('tok', 'a', 't', 20, 'CUR')
    const keys = Object.keys(out)
    // 导航字段排在 items 之前 → 截断也不丢"下一页"把手
    expect(keys.indexOf('has_more')).toBeLessThan(keys.indexOf('items'))
    expect(keys.indexOf('next_page_token')).toBeLessThan(keys.indexOf('items'))
    expect(out.has_more).toBe(true)
    expect(out.next_page_token).toBe('NEXT')
    expect(out.total).toBe(50)
    expect(out.count).toBe(2)
  })

  it('executeTool update_field：同表多次调用共享一次 list_fields（turnCache）', async () => {
    vi.resetModules()
    const mockListFields = vi.fn().mockResolvedValue({
      items: [{ field_id: 'fld1', field_name: '原名', type: 1 }],
    })
    const mockUpdateField = vi.fn().mockResolvedValue({ field_id: 'fld1' })
    vi.doMock('../feishu/api', () => ({ listFields: mockListFields, updateField: mockUpdateField }))
    const { executeTool } = await import('./agent-executor')
    const cache = new Map<string, unknown>()
    const call = (name: string) => executeTool(
      'update_field', { app_token: 'a', table_id: 't', field_id: 'fld1', field_name: name },
      'tok', {} as never, { ...DEFAULT_SETTINGS }, undefined, cache,
    )
    await call('新名')
    await call('又改名')
    // 两次改名只读一次字段表（N×2 → N+1）；写仍然各一次
    expect(mockListFields).toHaveBeenCalledTimes(1)
    expect(mockUpdateField).toHaveBeenCalledTimes(2)
  })

  it('executeTool create_field 使同表 update_field 的字段缓存失效', async () => {
    vi.resetModules()
    const mockListFields = vi.fn().mockResolvedValue({ items: [{ field_id: 'fld1', field_name: 'n', type: 1 }] })
    const mockCreateField = vi.fn().mockResolvedValue({ field_id: 'fld2' })
    const mockUpdateField = vi.fn().mockResolvedValue({ field_id: 'fld1' })
    vi.doMock('../feishu/api', () => ({ listFields: mockListFields, createField: mockCreateField, updateField: mockUpdateField }))
    const { executeTool } = await import('./agent-executor')
    const cache = new Map<string, unknown>()
    await executeTool('update_field', { app_token: 'a', table_id: 't', field_id: 'fld1', field_name: 'x' }, 'tok', {} as never, { ...DEFAULT_SETTINGS }, undefined, cache)
    await executeTool('create_field', { app_token: 'a', table_id: 't', field_name: '新列', type: 1 }, 'tok', {} as never, { ...DEFAULT_SETTINGS }, undefined, cache)
    await executeTool('update_field', { app_token: 'a', table_id: 't', field_id: 'fld1', field_name: 'y' }, 'tok', {} as never, { ...DEFAULT_SETTINGS }, undefined, cache)
    // 结构变化后缓存被清 → list_fields 再读一次
    expect(mockListFields).toHaveBeenCalledTimes(2)
  })
})

describe('isVisionUnsupportedError — 非 vision 模型拒绝 image_url 的错误检测', () => {
  it('matches provider image-rejection errors', () => {
    expect(isVisionUnsupportedError('This model does not support image input')).toBe(true)
    expect(isVisionUnsupportedError('400 invalid content type for messages')).toBe(true)
    expect(isVisionUnsupportedError('multimodal not enabled')).toBe(true)
  })
  it('does not match unrelated errors', () => {
    expect(isVisionUnsupportedError('network timeout')).toBe(false)
  })
})
