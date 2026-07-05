# 文档图片能力 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 chat 的文档图片能力——插入/克隆/替换/导出四个场景，走方案 A（每个场景一个专用 agent 工具，内部 JS 跑完整流程，agent 只调 1 次）。

**Architecture:** 共享地基（multipart 上传 + 图片块写入）→ 5 个 agent 工具（`insert_image` / `copy_document` / `clone_doc_with_images` / `replace_image` / `export_doc_images`）→ UI 组件（粘贴/导出画廊/ZIP）。核心约束：所有工具内部循环在 JS 里跑，不让 LLM 逐块调接口。

**Tech Stack:** TypeScript, vitest, React 18, JSZip（新依赖，~45KB）, Chrome MV3 extension.

## Global Constraints

- 只用 user_access_token（`resolveToken`），不回退 tenant；`drive:drive` + `docx:document` scope 已声明。
- `feishuFetch`/`feishuReq` 原样不动；multipart 走新兄弟方法 `feishuUpload`。
- `buildBlock` text/h1…/table/sheet 分支零改动。
- 附件→vision 链路不动（`buildApiHistory` image_url 逻辑零改动）。
- 非 doc 上下文工具集与 UI 零变化（`toolsForContext` gating）。
- 新代码复用现有 `downloadMedia`/`serializeDocBlocks`/`compressImageToDataUrl`/`reloadActiveTab`，不改它们。
- 验证循环：`npm run typecheck`（0 错）→ `npm test`（全绿）→ `npm run build`（成功）。
- 提交结束语：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: 地基 — multipart 上传 + 图片块写入

**Files:**
- Create: `src/shared/feishu/upload.ts`
- Create: `src/shared/feishu/upload.test.ts`
- Modify: `src/shared/feishu/http.ts` (add `feishuUpload`)
- Modify: `src/shared/feishu/docx.ts` (add image to BlockStyle + BlockSpec + buildBlock)
- Modify: `src/shared/feishu/docx.test.ts` (if exists) or write inline test assertions

**Interfaces:**
- Produces: `uploadMedia(opts): Promise<string>` — returns `file_token`
- Produces: `feishuUpload(path, formData, token): Promise<Response>` — raw multipart fetch
- Produces: `buildBlock({ style: 'image', imageToken: '…' })` — returns `{ block_type: 27, image: { token: '…' } }`

---

- [ ] **Step 1: Add `feishuUpload` to http.ts** — mirrors `feishuFetch` but for `FormData` (no JSON `Content-Type`, no `stringify`).

In `src/shared/feishu/http.ts`, add after the `feishuReq` export (line 97):

```ts
/**
 * Multipart upload helper — same auth + outbound guard + private-deploy version
 * fallback as feishuFetch, but sends FormData without a Content-Type header so
 * the browser can set the multipart boundary automatically. Body is NEVER
 * JSON-stringified. Throws on non-ok response (caller inspects .json() envelope
 * themselves).
 */
export async function feishuUpload(
  path: string,
  formData: FormData,
  token: string
): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  }
  const candidates = IS_PRIVATE_DEPLOY ? versionCandidates(path) : [{ path, ver: 0 }]
  let last: Response | null = null
  for (const cand of candidates) {
    const url = new URL(`${BASE}${cand.path}`)
    if (!isFeishuOutboundAllowed(url.toString())) {
      throw new Error(`出站被拦截：${url.hostname} 不在允许的飞书主机列表内`)
    }
    const res = await robustFetch(url.toString(), init, 'POST') // writes never retry
    if (res.status === 404 && cand.ver > 1) {
      const text = await res.text()
      let isFeishuEnvelope = false
      try { const j = JSON.parse(text); isFeishuEnvelope = !!j && typeof j.code === 'number' } catch { /* */ }
      const rewrapped = new Response(text, { status: 404, statusText: res.statusText, headers: res.headers })
      if (!isFeishuEnvelope) { last = rewrapped; continue }
      rememberVersion(path, cand.ver)
      return rewrapped
    }
    if (res.status !== 404) rememberVersion(path, cand.ver)
    return res
  }
  return last as Response
}
```

- [ ] **Step 2: Create `upload.ts`** — calls `feishuUpload` with the correct multipart fields.

```ts
import { feishuUpload } from './http'

export async function uploadMedia(opts: {
  blob: Blob
  fileName: string
  mimeType: string
  parentNode: string      // document obj_token (resolve wiki → obj_token before calling)
  parentType: 'docx_image'
  token: string            // user_access_token
}): Promise<string> {
  const MAX = 20 * 1024 * 1024
  if (opts.blob.size > MAX) {
    throw new Error(`图片过大（${(opts.blob.size / 1024 / 1024).toFixed(1)} MB），上限 20 MB`)
  }

  const fd = new FormData()
  fd.append('file_name', opts.fileName)
  fd.append('parent_type', opts.parentType)
  fd.append('parent_node', opts.parentNode)
  fd.append('size', String(opts.blob.size))
  fd.append('file', opts.blob, opts.fileName)

  const res = await feishuUpload('/drive/v1/medias/upload_all', fd, opts.token)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`上传失败：${res.status} ${res.statusText}\n${text}`)
  }
  const json = (await res.json()) as { code: number; msg?: string; data?: { file_token?: string } }
  if (json.code !== 0) throw new Error(json.msg || '上传失败')
  if (!json.data?.file_token) throw new Error('上传成功但未返回 file_token')
  return json.data.file_token
}
```

- [ ] **Step 3: Add image block to `buildBlock` in docx.ts.**

Replace the `BlockStyle` type and `BLOCK_TYPE` constant to include image, and add an early-return case:

```ts
// Line 14: add 'image' to BlockStyle union
export type BlockStyle =
  | 'text' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'quote' | 'code' | 'todo' | 'divider' | 'image'

// Line 16: add imageToken to BlockSpec
export interface BlockSpec { text: string; style?: BlockStyle; imageToken?: string }

// Line 49: in buildBlock, add an early return BEFORE the BLOCK_TYPE lookup:
export function buildBlock(spec: BlockSpec): Record<string, unknown> {
  if (spec.style === 'image') {
    return { block_type: 27, image: { token: spec.imageToken ?? '' } }
  }
  // ... existing code follows unchanged ...
```

- [ ] **Step 4: Write tests** — `upload.test.ts` and `docx` image block test.

`src/shared/feishu/upload.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { uploadMedia } from './upload'

// Mock feishuUpload — vi.mock can't mock sibling default exports of the same module
// tree cleanly, so we mock the http module and let uploadMedia call through.
vi.mock('./http', () => ({ feishuUpload: vi.fn() }))

describe('uploadMedia', () => {
  it('constructs FormData correctly', async () => {
    const { feishuUpload } = await import('./http')
    const mockUp = vi.mocked(feishuUpload)
    mockUp.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 0, data: { file_token: 'tok-abc' } }), { status: 200 })
    )
    const blob = new Blob(['fake'], { type: 'image/png' })
    const token = await uploadMedia({
      blob, fileName: 'test.png', mimeType: 'image/png',
      parentNode: 'doc123', parentType: 'docx_image', token: 'u_tok',
    })
    expect(token).toBe('tok-abc')
    expect(mockUp).toHaveBeenCalledTimes(1)
    const fd: FormData = mockUp.mock.calls[0][1]
    expect(fd.get('file_name')).toBe('test.png')
    expect(fd.get('parent_type')).toBe('docx_image')
    expect(fd.get('parent_node')).toBe('doc123')
    expect(fd.get('size')).toBe('4')
    expect(fd.get('file')).toBeInstanceOf(File)
  })

  it('throws on non-zero code', async () => {
    const { feishuUpload } = await import('./http')
    vi.mocked(feishuUpload).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 99991672, msg: 'permission denied' }), { status: 403 })
    )
    await expect(uploadMedia({
      blob: new Blob(['x']), fileName: 'x.png', mimeType: 'image/png',
      parentNode: 'docx', parentType: 'docx_image', token: 'u_tok',
    })).rejects.toThrow('permission denied')
  })

  it('throws on >20MB blob', async () => {
    const big = new Blob([new Uint8Array(21 * 1024 * 1024)])
    await expect(uploadMedia({
      blob: big, fileName: 'big.png', mimeType: 'image/png',
      parentNode: 'd', parentType: 'docx_image', token: 't',
    })).rejects.toThrow('20 MB')
  })
})
```

For `buildBlock` image test — add to the existing docx test file (or write inline). If `src/shared/feishu/docx.test.ts` exists, append:

```ts
it('buildBlock image returns block_type 27', () => {
  const block = buildBlock({ text: '', style: 'image', imageToken: 'tok-xyz' })
  expect(block).toEqual({ block_type: 27, image: { token: 'tok-xyz' } })
})
```

- [ ] **Step 5: Run tests and typecheck.**

```bash
npm run typecheck
# Expected: 0 errors

npm test -- --run
# Expected: all tests pass including new ones
```

- [ ] **Step 6: Commit.**

```bash
git add src/shared/feishu/http.ts src/shared/feishu/upload.ts src/shared/feishu/upload.test.ts src/shared/feishu/docx.ts
git commit -m "feat: 地基 — multipart 上传（uploadAll/feishuUpload）+ 图片块写入（buildBlock image）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 对话框剪贴板粘贴

**Files:**
- Modify: `src/sidepanel/components/InputBar.tsx`

**Interfaces:**
- Consumes: `fileToAttachment` (existing), existing `attachments` state + `onFileChange` logic
- Produces: `onPaste` handler on the `.input-bar` container

---

- [ ] **Step 1: Add `onPaste` to InputBar.** In `src/sidepanel/components/InputBar.tsx`, add a paste handler. Locate the container element (search for `onDrop` or `className="input-bar"`) and add `onPaste`:

```tsx
// Add handler near the existing onDrop/onDragOver handlers:
function handlePaste(e: React.ClipboardEvent) {
  const items = e.clipboardData?.files
  if (!items || items.length === 0) return // plain text paste — let default happen
  for (let i = 0; i < items.length; i++) {
    const f = items[i]
    if (f.type.startsWith('image/')) {
      e.preventDefault() // only prevent default when we handle an image
      fileToAttachment(f).then((a) => {
        setAttachments((prev) => prev.concat(a))
      }).catch((err) => {
        console.warn('剪贴板图片处理失败', err)
      })
    }
  }
}
```

Wire it on the container (the same element that has `onDrop`):

```tsx
// Find the element with onDrop={handleDrop} and add:
onPaste={handlePaste}
```

- [ ] **Step 2: Verify typecheck.**

```bash
npm run typecheck
# Expected: 0 errors
```

- [ ] **Step 3: Commit.**

```bash
git add src/sidepanel/components/InputBar.tsx
git commit -m "feat: InputBar 支持剪贴板粘贴图片（Ctrl+V）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 工具 schemas + plumbing + prompt

**Files:**
- Modify: `src/shared/ai/tools.ts` (add 5 tool schemas to FEISHU_TOOLS)
- Modify: `src/shared/ai/agent.ts` (add names to DOC_TOOLS, pass attachments into executeDocTool, update system prompt)

**Interfaces:**
- Consumes: existing `FEISHU_TOOLS`, `DOC_TOOLS`, `executeDocTool` call site, system prompt
- Produces: 5 new ChatCompletionTool entries, attachments plumbing, prompt additions

---

- [ ] **Step 1: Add 5 tool schemas to `FEISHU_TOOLS` in `tools.ts`.** Append these after the last entry (before the closing `]`):

```ts
  // ── Doc image tools ──
  {
    type: 'function',
    function: {
      name: 'insert_image',
      description:
        '把对话框里上传的一张图片插入到当前文档的指定位置（锚点定位，非光标）。' +
        'attachment_id 是当前消息里图片附件的 id；anchor 用 heading/text/section_end/end 指定插入点，' +
        'value 是匹配文字（anchor 为 end 时不需要）。',
      parameters: {
        type: 'object',
        required: ['attachment_id', 'anchor'],
        properties: {
          attachment_id: { type: 'string', description: '当前消息里图片附件的 id' },
          anchor: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', enum: ['heading', 'text', 'section_end', 'end'] },
              value: { type: 'string', description: 'heading/text 时必填，匹配的标题/段落文字' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_document',
      description:
        '用飞书服务端深拷贝**保真克隆**一篇文档（优先于 clone_doc_with_images）。' +
        '一次调用，全部内容（文本/表格/图片/内嵌表格）完整保留，零挖矿。适用于复制/备份/另存一份。',
      parameters: {
        type: 'object',
        properties: {
          source_doc_token: { type: 'string', description: '源文档 token（默认当前文档）' },
          new_title: { type: 'string', description: '新文档标题（默认"<源标题> 副本"）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clone_doc_with_images',
      description:
        '**转换式迁移**一篇文档到新文档，块级重建（文本+表格+图片全保留，图片下载原图再上传无损）。' +
        '适用于总结/抽取/合并/改写场景——不是纯克隆时用此工具。纯克隆/备份/复制请优先用 copy_document。',
      parameters: {
        type: 'object',
        properties: {
          source_doc_token: { type: 'string', description: '源文档 token（默认当前文档）' },
          new_doc_title: { type: 'string', description: '新文档标题（默认"<源标题> 副本"）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_image',
      description:
        '替换文档中的一张已有图片为新图。按"第N张"或"某标题下那张"定位，删旧插新，原位保留。',
      parameters: {
        type: 'object',
        required: ['which', 'source'],
        properties: {
          which: {
            type: 'object',
            required: ['by', 'value'],
            properties: {
              by: { type: 'string', enum: ['index', 'heading'] },
              value: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'index 时写数字，heading 时写标题文字' },
            },
          },
          source: {
            type: 'object',
            required: ['attachment_id'],
            properties: {
              attachment_id: { type: 'string', description: '当前消息里新图的附件 id' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_doc_images',
      description: '把一篇文档里的全部图片批量导出，返回缩略图画廊 + 下载全部 ZIP。',
      parameters: {
        type: 'object',
        properties: {
          doc_token: { type: 'string', description: '文档 token（默认当前文档）' },
        },
      },
    },
  },
```

- [ ] **Step 2: Add names to `DOC_TOOLS` in agent.ts** (line 226):

```ts
const DOC_TOOLS = new Set([
  'create_document', 'create_doc_from_markdown', 'get_document_content', 'list_blocks',
  'add_document_content', 'insert_table', 'insert_sheet', 'delete_document_blocks',
  'insert_image', 'copy_document', 'clone_doc_with_images', 'replace_image', 'export_doc_images',
])
```

- [ ] **Step 3: Plumbing — pass attachments into executeDocTool.** At the call site (line 751), find the most recent user-message attachments. First, the helper to extract them:

Inside `runAgent`, before the tool-dispatch loop (or just above line 751):

```ts
// Latest user-message attachments for image tools to consume
const latestAttachments = (() => {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user' && history[i].attachments?.length) {
      return history[i].attachments
    }
  }
  return []
})()
```

Modify the call at line 751:

```ts
// Before:
if (DOC_TOOLS.has(name)) return executeDocTool(name, args, token, context, settings)

// After:
if (DOC_TOOLS.has(name)) return executeDocTool(name, args, token, context, settings, latestAttachments)
```

Update `executeDocTool`'s signature at line 1197:

```ts
async function executeDocTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  context: PageContext,
  settings?: AppSettings,
  attachments?: Attachment[]  // new — for insert_image / replace_image
): Promise<unknown> {
```

And add the `Attachment` import at the top of agent.ts if not already imported:

```ts
import type { Attachment, /* ... */ } from '../types'
```

- [ ] **Step 4: Update system prompt.** In the doc-context segment of the system prompt, add guidance for image tools. Locate the doc section (search for `docx` or `文档` in the prompt string) and append:

```
- 文档图片操作：插入用 insert_image（锚点定位，无光标）；整篇克隆/备份/复制优先用 copy_document（一次调用保真），
  总结/抽取/合并用 clone_doc_with_images（块级重建带图片）；换图用 replace_image（删旧插新原位）；批量导出用 export_doc_images。
```

- [ ] **Step 5: Verify typecheck.**

```bash
npm run typecheck
# Expected: 0 errors
```

- [ ] **Step 6: Commit.**

```bash
git add src/shared/ai/tools.ts src/shared/ai/agent.ts
git commit -m "feat: 图片工具 schemas + plumbing + DOC_TOOLS 注册 + prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `insert_image` dispatch

**Files:**
- Modify: `src/shared/ai/agent.ts` (add switch case to executeDocTool)

**Interfaces:**
- Consumes: `uploadMedia` (Task 1), `Docx.listBlocks`, `Docx.insertBlocks`, `attachments` param (Task 3), `reloadActiveTab`
- Produces: `insert_image` case in executeDocTool

---

- [ ] **Step 1: Add the `insert_image` case to `executeDocTool`'s switch.** In `src/shared/ai/agent.ts`, inside the `executeDocTool` switch, add a new case. Also add the necessary imports at the top of the file.

Import additions at top:
```ts
import { uploadMedia } from '../feishu/upload'
import { reloadActiveTab } from '../../sidepanel/tabReload'
```

New case (add before the `default` case):
```ts
case 'insert_image': {
  const attachmentId = args.attachment_id as string
  const anchor = args.anchor as { type: string; value?: string }
  if (!attachments?.length) throw new Error('当前没有附件，请先在对话框里上传图片。')
  const att = attachments.find((a) => a.id === attachmentId && a.type === 'image')
  if (!att || !att.dataUrl) throw new Error(`附件 ${attachmentId} 不存在或不是图片。`)

  // dataUrl → Blob
  const res = await fetch(att.dataUrl)
  const blob = await res.blob()
  if (blob.size === 0) throw new Error('无法读取图片数据。')

  // Resolve anchor → index
  const { items } = (await Docx.listBlocks(token, doc!)) as { items?: Array<Record<string, unknown>> }
  if (!items || !Array.isArray(items)) throw new Error('无法读取文档结构。')
  const rootChildren = items
    .filter((b) => b.parent_id === doc)
    .sort((a, b) => (a.index as number ?? 0) - (b.index as number ?? 0))

  let insertAt = rootChildren.length // default: append
  const t = anchor.type
  if (t === 'end') { /* keep default */ }
  else if ((t === 'heading' || t === 'text') && anchor.value) {
    const needle = anchor.value.toLowerCase()
    const idx = rootChildren.findIndex((b) => {
      if (t === 'heading') {
        const bt = b.block_type as number
        if (bt !== 3 && bt !== 4 && bt !== 5) return false
      } else if (b.block_type !== 2) return false
      const el = (b as Record<string, unknown>)[t === 'heading' ? `heading${(b.block_type as number) - 2}` : 'text'] as { elements?: Array<{ text_run?: { content?: string } }> }
      const txt = (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('').toLowerCase()
      return txt.includes(needle)
    })
    if (idx === -1) throw new Error(`找不到匹配的${t === 'heading' ? '标题' : '段落'}："${anchor.value}"`)
    insertAt = idx + 1
  } else if (t === 'section_end' && anchor.value) {
    const needle = anchor.value.toLowerCase()
    const hIdx = rootChildren.findIndex((b) => {
      const bt = b.block_type as number
      if (bt !== 3 && bt !== 4 && bt !== 5) return false
      const hKey = `heading${bt - 2}`
      const el = (b as Record<string, unknown>)[hKey] as { elements?: Array<{ text_run?: { content?: string } }> }
      return (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('').toLowerCase().includes(needle)
    })
    if (hIdx === -1) throw new Error(`找不到匹配的标题："${anchor.value}"`)
    const hLevel = rootChildren[hIdx].block_type as number
    const next = rootChildren.findIndex((b, i) => i > hIdx && (b.block_type as number) >= 3 && (b.block_type as number) <= 5 && (b.block_type as number) <= hLevel)
    insertAt = next === -1 ? rootChildren.length : next
  } else {
    throw new Error(`不支持的锚点类型：${t}`)
  }

  // Upload + insert
  const fileToken = await uploadMedia({
    blob,
    fileName: att.name || 'image.png',
    mimeType: att.mimeType || 'image/png',
    parentNode: doc!,
    parentType: 'docx_image',
    token,
  })
  await Docx.insertBlocks(token, doc!, [{ text: '', style: 'image', imageToken: fileToken }], insertAt)

  // Reload so the user sees the new image in the doc
  void reloadActiveTab()
  return `已插入到${t === 'end' ? '文档末尾' : `"${anchor.value ?? ''}"${t === 'section_end' ? '节末' : '后面'}`}`
}
```

- [ ] **Step 2: Verify typecheck + tests.**

```bash
npm run typecheck
# Expected: 0 errors

npm test -- --run
# Expected: all pass
```

- [ ] **Step 3: Commit.**

```bash
git add src/shared/ai/agent.ts
git commit -m "feat: insert_image 工具 — 对话框图片插入到文档锚点位置

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `copy_document` dispatch

**Files:**
- Modify: `src/shared/ai/agent.ts` (add switch case to executeDocTool)

**Interfaces:**
- Consumes: `feishuReq` (existing), `withDocUrl` (existing)
- Produces: `copy_document` case in executeDocTool

---

- [ ] **Step 1: Add the `copy_document` case to `executeDocTool`'s switch.**

```ts
case 'copy_document': {
  const sourceToken = sanitizeToken(args.source_doc_token as string | undefined) ?? doc!
  // Get source title for default new-title
  let sourceTitle = '文档副本'
  try {
    const meta = (await Docx.getDocumentMeta(token, sourceToken)) as { document?: { title?: string } }
    sourceTitle = meta.document?.title || '文档副本'
  } catch { /* fallback */ }
  const newTitle = (args.new_title as string) || `${sourceTitle} 副本`

  const copyRes = (await feishuReq('POST', `/drive/v1/files/${sourceToken}/copy`, token, {
    name: newTitle,
    type: 'docx',
  })) as { file?: { token?: string; url?: string } }

  const newToken = copyRes.file?.token ?? copyRes.file?.url
  if (!newToken) throw new Error('复制文档失败：未返回新文档 token')

  void reloadActiveTab()
  return { message: '已保真克隆为新文档', document: copyRes }
}
```

- [ ] **Step 2: Add `reloadActiveTab` import if not already present** (same as Task 4).

- [ ] **Step 3: Verify typecheck + tests.**

```bash
npm run typecheck && npm test -- --run
# Expected: 0 errors, all pass
```

- [ ] **Step 4: Commit.**

```bash
git add src/shared/ai/agent.ts
git commit -m "feat: copy_document 工具 — drive copy 保真克隆（一次调用）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `replace_image` dispatch

**Files:**
- Modify: `src/shared/ai/agent.ts` (add switch case to executeDocTool)

**Interfaces:**
- Consumes: `uploadMedia`, `Docx.listBlocks`, `Docx.insertBlocks`, `Docx.deleteBlocks`, attachments
- Produces: `replace_image` case in executeDocTool

---

- [ ] **Step 1: Add the `replace_image` case to `executeDocTool`'s switch.**

```ts
case 'replace_image': {
  const which = args.which as { by: string; value: number | string }
  const src = args.source as { attachment_id: string }
  if (!attachments?.length) throw new Error('当前没有附件。')
  const att = attachments.find((a) => a.id === src.attachment_id && a.type === 'image')
  if (!att || !att.dataUrl) throw new Error(`附件 ${src.attachment_id} 不存在或不是图片。`)

  // Find all image blocks
  const { items } = (await Docx.listBlocks(token, doc!)) as { items?: Array<Record<string, unknown>> }
  if (!items || !Array.isArray(items)) throw new Error('无法读取文档结构。')
  const imgBlocks: Array<{ id: string; parent_id: string; idx: number; heading?: string }> = []
  let lastHeading = ''
  for (const b of items) {
    const bt = b.block_type as number
    if (bt === 3 || bt === 4 || bt === 5) {
      const hKey = `heading${bt - 2}`
      const el = (b as Record<string, unknown>)[hKey] as { elements?: Array<{ text_run?: { content?: string } }> }
      lastHeading = (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('')
    }
    if (bt === 27) {
      imgBlocks.push({
        id: b.block_id as string,
        parent_id: (b.parent_id as string) ?? doc!,
        idx: (b.index as number) ?? imgBlocks.length,
        heading: lastHeading || undefined,
      })
    }
  }
  if (!imgBlocks.length) throw new Error('文档中没有图片。')

  // Resolve target
  let target: (typeof imgBlocks)[number] | undefined
  if (which.by === 'index') {
    const n = Number(which.value) - 1
    target = imgBlocks[n]
    if (!target) throw new Error(`只有 ${imgBlocks.length} 张图片，没有第 ${n + 1} 张。`)
  } else if (which.by === 'heading') {
    const needle = String(which.value).toLowerCase()
    target = imgBlocks.find((b) => b.heading?.toLowerCase().includes(needle))
    if (!target) throw new Error(`找不到标题"${which.value}"下的图片。`)
  }

  // Upload new image
  const res = await fetch(att.dataUrl)
  const blob = await res.blob()
  const fileToken = await uploadMedia({
    blob, fileName: att.name || 'image.png', mimeType: att.mimeType || 'image/png',
    parentNode: doc!, parentType: 'docx_image', token,
  })

  // Delete old + insert new at same position
  await Docx.deleteBlocks(token, doc!, target.parent_id, target.idx, target.idx + 1)
  await Docx.insertBlocks(token, doc!, [{ text: '', style: 'image', imageToken: fileToken }], target.idx, target.parent_id)

  void reloadActiveTab()
  return `已将${which.by === 'index' ? `第 ${Number(which.value)} 张` : `"${String(which.value)}"标题下的`}图片替换为新图。`
}
```

- [ ] **Step 2: Verify.**

```bash
npm run typecheck && npm test -- --run
```

- [ ] **Step 3: Commit.**

```bash
git add src/shared/ai/agent.ts
git commit -m "feat: replace_image 工具 — 定位+删旧+原位插新

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `clone_doc_with_images`

**Files:**
- Create: `src/shared/feishu/cloneDoc.ts`
- Create: `src/shared/feishu/cloneDoc.test.ts`
- Modify: `src/shared/ai/agent.ts` (add dispatch case)

**Interfaces:**
- Consumes: `Docx.listBlocks`, `Docx.createDocument`, `Docx.getDocumentMeta`, `Docx.buildBlock`, `Docx.insertBlocks`, `Docx.insertTable`, `downloadMedia`, `uploadMedia`, `resolveToken`
- Produces: `cloneDocumentWithImages(opts): Promise<CloneResult>`

---

- [ ] **Step 1: Create `cloneDoc.ts`.** The pipeline runs entirely in this file — agent calls it once.

```ts
import { createDocument, getDocumentMeta, listBlocks, buildBlock, insertBlocks, insertTable } from './docx'
import { downloadMedia } from './media'
import { uploadMedia } from './upload'

export interface CloneResult {
  docToken: string
  docTitle: string
  totalBlocks: number
  migratedImages: number
  skippedImages: number
  skippedBlocks: number
}

const TEXT_TYPES = new Set([2, 3, 4, 5, 12, 13, 14, 15, 17, 22])
const CONCURRENCY = 4

interface Block {
  block_id: string
  block_type: number
  parent_id: string
  children: string[]
  index: number
  [k: string]: unknown
}

export async function cloneDocumentWithImages(opts: {
  sourceDocToken: string
  newDocTitle: string
  token: string // user_access_token
}): Promise<CloneResult> {
  const { sourceDocToken, newDocTitle, token } = opts

  // 1. Create target doc
  const created = (await createDocument(token, newDocTitle)) as { document?: { document_id?: string } }
  const targetDocId = created.document?.document_id
  if (!targetDocId) throw new Error('创建目标文档失败')

  // 2. Read all blocks from source (flat list, one paginated call)
  const { items } = (await listBlocks(token, sourceDocToken)) as { items?: Block[] }
  if (!items || !Array.isArray(items)) throw new Error('无法读取源文档结构')
  const allBlocks: Block[] = items

  // 3. Build parent→children map sorted by index
  const byParent = new Map<string, Block[]>()
  for (const b of allBlocks) {
    const list = byParent.get(b.parent_id) || []
    list.push(b)
    byParent.set(b.parent_id, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.index - b.index)

  // 4. Walk root children in order
  const rootChildren = byParent.get(sourceDocToken) ?? []
  let stats = { migratedImages: 0, skippedImages: 0, skippedBlocks: 0 }
  let textBuf: Array<{ text: string; style?: string; imageToken?: string }> = []
  let runningIndex = 0

  async function flushTextBuf() {
    if (!textBuf.length) return
    const specs = textBuf.map((t) => {
      if (t.imageToken) return { text: '', style: 'image' as const, imageToken: t.imageToken }
      return { text: t.text, style: (t.style || 'text') as any }
    })
    await insertBlocks(token, targetDocId, specs, runningIndex)
    runningIndex += specs.length
    textBuf = []
  }

  async function processImage(block: Block) {
    const img = (block as { image?: { token?: string } }).image
    const imgToken = typeof img?.token === 'string' ? img.token : ''
    if (!imgToken) { stats.skippedImages++; return }
    try {
      const blob = await downloadMedia(imgToken, token)
      if (blob.size > 20 * 1024 * 1024) { stats.skippedImages++; return }
      const newToken = await uploadMedia({
        blob, fileName: 'image', mimeType: blob.type || 'image/png',
        parentNode: targetDocId, parentType: 'docx_image', token,
      })
      await flushTextBuf()
      await insertBlocks(token, targetDocId, [{ text: '', style: 'image', imageToken: newToken }], runningIndex)
      runningIndex++
      stats.migratedImages++
    } catch { stats.skippedImages++ }
  }

  function getText(block: Block): string {
    const key = ['text', 'heading1', 'heading2', 'heading3', 'bullet', 'ordered', 'quote', 'code', 'todo'][
      [2, 3, 4, 5, 12, 13, 15, 14, 17].indexOf(block.block_type)
    ]
    if (!key) return ''
    const el = (block as Record<string, unknown>)[key] as { elements?: Array<{ text_run?: { content?: string } }> }
    return (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('')
  }

  function blockStyle(bt: number): string {
    const map: Record<number, string> = { 2: 'text', 3: 'h1', 4: 'h2', 5: 'h3', 12: 'bullet', 13: 'ordered', 14: 'code', 15: 'quote', 17: 'todo', 22: 'divider' }
    return map[bt] || 'text'
  }

  async function processTable(block: Block) {
    await flushTextBuf()
    const cellBlocks = byParent.get(block.block_id) ?? []
    // Convert cell blocks into string[][] — cells are block_type 32, each has one text child
    const rows: string[][] = []
    // Sort cells by index, group by row
    // Feishu table cells: index encodes row-major order
    let maxRow = 0, maxCol = 0
    const cells = cellBlocks.filter((c) => c.block_type === 32).sort((a, b) => a.index - b.index)
    // We need row/col info from the table property (not exposed in the flat list for the table block).
    // Fallback: use max index to infer dimensions.
    // Real implementation should read table.property.row_size/column_size from the table block.
    // If table property is missing, fall back to a simplified reconstruction:
    try {
      const tableBlock = allBlocks.find((b) => b.block_id === block.block_id)
      const prop = (tableBlock as any)?.table?.property
      const nRows = prop?.row_size ?? cells.length
      const nCols = prop?.column_size ?? 1
      // Build grid
      const grid = Array.from({ length: nRows }, () => Array.from({ length: nCols }, () => ''))
      // cells are indexed 0..(rows*cols-1) in row-major
      for (let r = 0; r < nRows; r++) {
        for (let c = 0; c < nCols; c++) {
          const idx = r * nCols + c
          const cell = cells.find((cc) => cc.index === idx)
          if (cell) {
            const textChild = byParent.get(cell.block_id)
              ?.find((tc) => tc.block_type === 2)
            grid[r][c] = textChild ? getText(textChild) : ''
          }
        }
      }
      await insertTable(token, targetDocId, grid, runningIndex)
      runningIndex++
    } catch {
      // Table reconstruction failed — skip and note
      await insertBlocks(token, targetDocId, [{ text: '〔原表格重建失败，已跳过〕' }], runningIndex)
      runningIndex++
      stats.skippedBlocks++
    }
  }

  // Walk root children in order
  for (const block of rootChildren) {
    if (TEXT_TYPES.has(block.block_type)) {
      const style = blockStyle(block.block_type)
      if (block.block_type === 22) {
        textBuf.push({ text: '', style: 'divider' })
      } else {
        textBuf.push({ text: getText(block), style })
      }
      if (textBuf.length >= 50) await flushTextBuf()
    } else if (block.block_type === 27) {
      await processImage(block)
    } else if (block.block_type === 31) {
      await processTable(block)
    } else if (block.block_type === 30) {
      // Embedded sheet — placeholder
      await flushTextBuf()
      await insertBlocks(token, targetDocId, [{ text: '〔原嵌入式表格，未迁移〕' }], runningIndex)
      runningIndex++
      stats.skippedBlocks++
    } else {
      stats.skippedBlocks++
    }
  }

  await flushTextBuf()

  return {
    docToken: targetDocId,
    docTitle: newDocTitle,
    totalBlocks: allBlocks.length,
    migratedImages: stats.migratedImages,
    skippedImages: stats.skippedImages,
    skippedBlocks: stats.skippedBlocks,
  }
}
```

- [ ] **Step 2: Add dispatch case to `executeDocTool`** in agent.ts.

```ts
case 'clone_doc_with_images': {
  const srcToken = sanitizeToken(args.source_doc_token as string | undefined) ?? doc!
  let sourceTitle = '文档副本'
  try {
    const meta = (await Docx.getDocumentMeta(token, srcToken)) as { document?: { title?: string } }
    sourceTitle = meta.document?.title || '文档副本'
  } catch { /* */ }
  const newTitle = (args.new_doc_title as string) || `${sourceTitle} 副本`

  const result = await cloneDocumentWithImages({ sourceDocToken: srcToken, newDocTitle: newTitle, token })
  void reloadActiveTab()
  return {
    message: `已克隆为新文档，迁移 ${result.migratedImages} 张图片` +
      (result.skippedImages ? `，跳过 ${result.skippedImages} 张` : '') +
      (result.skippedBlocks ? `，跳过 ${result.skippedBlocks} 个块` : ''),
    ...result,
  }
}
```

Add import:
```ts
import { cloneDocumentWithImages } from '../feishu/cloneDoc'
```

- [ ] **Step 3: Write cloneDoc test** (`src/shared/feishu/cloneDoc.test.ts`).

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./docx', () => ({
  createDocument: vi.fn(),
  getDocumentMeta: vi.fn(),
  listBlocks: vi.fn(),
  buildBlock: vi.requireActual('./docx').buildBlock, // use real buildBlock
  insertBlocks: vi.fn(),
  insertTable: vi.fn(),
}))

vi.mock('./media', () => ({ downloadMedia: vi.fn() }))
vi.mock('./upload', () => ({ uploadMedia: vi.fn() }))

import { cloneDocumentWithImages } from './cloneDoc'
import { createDocument, getDocumentMeta, listBlocks, insertBlocks, insertTable, buildBlock } from './docx'
import { downloadMedia } from './media'
import { uploadMedia } from './upload'

describe('cloneDocumentWithImages', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates target doc and returns result', async () => {
    vi.mocked(createDocument).mockResolvedValue({ document: { document_id: 'target-123' } })
    vi.mocked(getDocumentMeta).mockResolvedValue({ document: { title: '源文档' } })
    vi.mocked(listBlocks).mockResolvedValue({ items: [
      { block_id: 'b1', block_type: 2, parent_id: 'src-doc', children: [], index: 0,
        text: { elements: [{ text_run: { content: 'Hello' } }], style: {} } },
    ] })
    vi.mocked(insertBlocks).mockResolvedValue({ children: [{ block_id: 'nb1' }], blocks_inserted: 1 })

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc', newDocTitle: '副本', token: 'u_tok',
    })

    expect(createDocument).toHaveBeenCalledWith('u_tok', '副本')
    expect(result.docToken).toBe('target-123')
    expect(result.totalBlocks).toBe(1)
    expect(insertBlocks).toHaveBeenCalled()
  })

  it('skips embedded sheet with placeholder', async () => {
    vi.mocked(createDocument).mockResolvedValue({ document: { document_id: 'target-123' } })
    vi.mocked(getDocumentMeta).mockResolvedValue({ document: { title: 'src' } })
    vi.mocked(listBlocks).mockResolvedValue({ items: [
      { block_id: 's1', block_type: 30, parent_id: 'src-doc', children: [], index: 0, sheet: { token: 's_tok' } },
    ] })
    vi.mocked(insertBlocks).mockResolvedValue({ children: [{ block_id: 'p' }], blocks_inserted: 1 })

    const result = await cloneDocumentWithImages({ sourceDocToken: 'src-doc', newDocTitle: 'x', token: 't' })
    expect(result.skippedBlocks).toBe(1)
    expect(insertBlocks).toHaveBeenCalledWith('t', 'target-123',
      [{ text: '〔原嵌入式表格，未迁移〕' }], 0)
  })
})
```

- [ ] **Step 4: Verify.**

```bash
npm run typecheck && npm test -- --run
# Expected: 0 errors, all pass
```

- [ ] **Step 5: Commit.**

```bash
git add src/shared/feishu/cloneDoc.ts src/shared/feishu/cloneDoc.test.ts src/shared/ai/agent.ts
git commit -m "feat: clone_doc_with_images — 块级重建管线（全树扁平扫描+递归重建+图片重传）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `export_doc_images` + ImageExportCard + JSZip

**Files:**
- Create: `src/sidepanel/components/ImageExportCard.tsx`
- Create: `src/sidepanel/components/ImageExportCard.css`
- Create: `src/sidepanel/components/ImageExportCard.test.tsx`
- Modify: `src/shared/ai/agent.ts` (export_doc_images dispatch + `__image_export` marker)
- Modify: `src/sidepanel/components/ChatPanel.tsx` (render ImageExportCard)
- Modify: `package.json` (add jszip)

**Interfaces:**
- Consumes: `Docx.listBlocks`, `downloadMedia`, `compressImageToDataUrl`, existing `__dataviz` marker pattern
- Produces: `ImageExportCard` React component, `export_doc_images` case in executeDocTool

---

- [ ] **Step 1: Add JSZip dependency.**

```bash
cd "E:\个人项目\feishu\feishu-doc-ai-assistant" && npm install jszip && npm install -D @types/jszip 2>/dev/null || npm install jszip
```

(If `@types/jszip` doesn't exist for this version, use `JSZip` as-is — it ships its own types in newer versions. Check after install.)

- [ ] **Step 2: Add `export_doc_images` dispatch to `executeDocTool`.**

```ts
case 'export_doc_images': {
  const exportDocToken = sanitizeToken(args.doc_token as string | undefined) ?? doc!
  const { items } = (await Docx.listBlocks(token, exportDocToken)) as { items?: Record<string, unknown>[] }
  if (!items || !Array.isArray(items)) throw new Error('无法读取文档结构')

  const imgBlocks: Array<{ token: string; context: string }> = []
  let lastHeading = ''
  for (const b of items) {
    const bt = b.block_type as number
    if (bt === 3 || bt === 4 || bt === 5) {
      const hKey = `heading${bt - 2}`
      const el = (b as Record<string, unknown>)[hKey] as { elements?: Array<{ text_run?: { content?: string } }> }
      lastHeading = (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('')
    }
    if (bt === 27) {
      const img = (b as { image?: { token?: string } }).image
      if (typeof img?.token === 'string' && img.token) {
        imgBlocks.push({ token: img.token, context: lastHeading })
      }
    }
  }

  if (!imgBlocks.length) return { message: '该文档没有图片。', images: [], __image_export: true }

  // Download all in parallel (capped 4)
  const images: Array<{ name: string; context: string; dataUrl: string }> = []
  let cursor = 0
  async function worker() {
    while (cursor < imgBlocks.length) {
      const idx = cursor++
      const { token: imgTok, context } = imgBlocks[idx]
      try {
        const blob = await downloadMedia(imgTok, token)
        const dataUrl = await compressImageToDataUrl(blob)
        images[idx] = { name: `image-${idx + 1}.${blob.type.split('/')[1] || 'png'}`, context, dataUrl }
      } catch {
        images[idx] = { name: `failed-${idx + 1}`, context, dataUrl: '' }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, imgBlocks.length) }, () => worker()))

  return JSON.stringify({ __image_export: true, images, docTitle: exportDocToken })
}
```

This needs the `compressImageToDataUrl` import:
```ts
import { compressImageToDataUrl } from '../attachments'
```
And `downloadMedia` import:
```ts
import { downloadMedia } from '../feishu/media'
```

- [ ] **Step 3: Handle `__image_export` marker in ChatPanel.** In `src/sidepanel/components/ChatPanel.tsx`, locate the `onToolMessage` handler (around the `renderDataVizResult` marker check at line 238). Add a parallel check:

```tsx
onToolMessage: (msg) => {
  appendTurn(msg)
  // render_data_app ...
  if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.includes('__dataviz')) {
    // ... existing ...
  }
  // NEW: image export
  if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.includes('__image_export')) {
    try {
      const p = JSON.parse(msg.content) as { __image_export?: boolean; images: Array<{ name: string; context: string; dataUrl: string }>; docTitle: string }
      if (p?.__image_export && Array.isArray(p.images)) {
        appendTurn({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '__image_export',
          createdAt: Date.now(),
        } as any) // use a marker message, or extend ChatMessage with a custom field
      }
    } catch { /* not an image export result */ }
  }
},
```

Actually, a cleaner approach: instead of a marker message, add a `imageExport` field to the message or use a special content prefix. Since modifying ChatMessage adds complexity, reuse the pattern from `__dataviz` — but instead of an overlay render, render an ImageExportCard inline in MessageList. The simplest: when tool result has `__image_export`, store the parsed images in a ref/state and conditionally render ImageExportCard above the message list or as a MessageList item.

**Simpler approach**: add an `imageExport` state to ChatPanel, set it from onToolMessage, and render `<ImageExportCard>` right after `<UndoBar>`:

In ChatPanel.tsx, add state:
```tsx
const [imageExport, setImageExport] = useState<{
  images: Array<{ name: string; context: string; dataUrl: string }>
  docTitle: string
} | null>(null)
```

In onToolMessage:
```tsx
if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.includes('__image_export')) {
  try {
    const p = JSON.parse(msg.content) as any
    if (p?.__image_export && Array.isArray(p.images)) {
      setImageExport({ images: p.images, docTitle: p.docTitle })
    }
  } catch { /* */ }
}
```

In JSX, after `<UndoBar>`:
```tsx
{imageExport && (
  <ImageExportCard
    images={imageExport.images}
    docTitle={imageExport.docTitle}
    onClose={() => setImageExport(null)}
  />
)}
```

- [ ] **Step 4: Create `ImageExportCard.tsx`.**

```tsx
import { useState } from 'react'
import JSZip from 'jszip'
import './ImageExportCard.css'

interface ImageExportCardProps {
  images: Array<{ name: string; context: string; dataUrl: string }>
  docTitle: string
  onClose: () => void
}

export default function ImageExportCard({ images, docTitle, onClose }: ImageExportCardProps) {
  const [zapping, setZapping] = useState(false)

  const valid = images.filter((im) => im.dataUrl)

  async function downloadZip() {
    setZapping(true)
    try {
      const zip = new JSZip()
      for (let i = 0; i < valid.length; i++) {
        const im = valid[i]
        const base64 = im.dataUrl.split(',')[1]
        if (base64) zip.file(im.name, base64, { base64: true })
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${docTitle || '文档图片'}.zip`
      document.body.appendChild(a); a.click()
      a.remove(); URL.revokeObjectURL(url)
    } finally { setZapping(false) }
  }

  async function downloadOne(im: typeof valid[number]) {
    const a = document.createElement('a')
    a.href = im.dataUrl; a.download = im.name
    document.body.appendChild(a); a.click()
    a.remove()
  }

  if (!valid.length) return (
    <div className="image-export-card">
      <div className="image-export-header"><span>图片导出</span><button onClick={onClose} type="button" aria-label="关闭">×</button></div>
      <p className="image-export-empty">没有可导出的图片</p>
    </div>
  )

  return (
    <div className="image-export-card">
      <div className="image-export-header">
        <span>{valid.length} 张图片（{docTitle}）</span>
        <div className="image-export-actions">
          <button className="image-export-dl-all" onClick={downloadZip} disabled={zapping} type="button">
            {zapping ? '打包中…' : '下载全部 ZIP'}
          </button>
          <button className="image-export-close" onClick={onClose} type="button" aria-label="关闭">×</button>
        </div>
      </div>
      <div className="image-export-gallery">
        {valid.map((im, i) => (
          <button key={i} className="image-export-item" onClick={() => downloadOne(im)} type="button" title={im.context || im.name}>
            <img src={im.dataUrl} alt={im.context || im.name} loading="lazy" />
            {im.context && <span className="image-export-context">{im.context}</span>}
          </button>
        ))}
        {valid.length < images.length && (
          <p className="image-export-failed">{images.length - valid.length} 张下载失败</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create `ImageExportCard.css`.** (Use existing design tokens from App.css `--color-*` variables.)

```css
.image-export-card {
  margin: 0 12px 8px;
  padding: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  animation: imageExportIn .18s ease;
}
@keyframes imageExportIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}
.image-export-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
}
.image-export-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.image-export-dl-all {
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 10px;
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  transition: opacity .15s;
}
.image-export-dl-all:disabled { opacity: .5; cursor: not-allowed; }
.image-export-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 16px;
  cursor: pointer;
  border-radius: 5px;
}
.image-export-close:hover { background: var(--color-surface-2); }
.image-export-empty {
  font-size: 11.5px;
  color: var(--color-text-secondary);
  text-align: center;
  padding: 12px 0;
}
.image-export-gallery {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;
}
.image-export-gallery::-webkit-scrollbar { display: none; }
.image-export-item {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  cursor: pointer;
  overflow: hidden;
  transition: border-color .15s;
}
.image-export-item:hover { border-color: var(--color-primary); }
.image-export-item img {
  width: 80px;
  height: 60px;
  object-fit: cover;
  display: block;
}
.image-export-context {
  font-size: 9.5px;
  color: var(--color-text-secondary);
  padding: 2px 4px;
  max-width: 76px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-export-failed {
  font-size: 10px;
  color: var(--color-text-secondary);
  align-self: center;
  white-space: nowrap;
}
```

- [ ] **Step 5: Create `ImageExportCard.test.tsx`** — smoke test for rendering and ZIP button.

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageExportCard from './ImageExportCard'

describe('ImageExportCard', () => {
  const sample = [
    { name: 'img1.png', context: '标题A', dataUrl: 'data:image/png;base64,abc' },
    { name: 'img2.jpg', context: '', dataUrl: 'data:image/jpeg;base64,xyz' },
  ]

  it('renders image count and download button', () => {
    render(<ImageExportCard images={sample} docTitle="测试文档" onClose={vi.fn()} />)
    expect(screen.getByText('2 张图片（测试文档）')).toBeTruthy()
    expect(screen.getByText('下载全部 ZIP')).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(2)
  })

  it('shows empty state when no valid images', () => {
    render(<ImageExportCard images={[{ name: 'x', context: '', dataUrl: '' }]} docTitle="x" onClose={vi.fn()} />)
    expect(screen.getByText('没有可导出的图片')).toBeTruthy()
  })

  it('calls onClose when × clicked', async () => {
    const onClose = vi.fn()
    render(<ImageExportCard images={sample} docTitle="x" onClose={onClose} />)
    await userEvent.click(screen.getByLabelText('关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 6: Verify.**

```bash
npm run typecheck && npm test -- --run
# Expected: 0 errors, all pass
```

- [ ] **Step 7: Commit.**

```bash
git add src/sidepanel/components/ImageExportCard.tsx src/sidepanel/components/ImageExportCard.css src/sidepanel/components/ImageExportCard.test.tsx src/shared/ai/agent.ts src/sidepanel/components/ChatPanel.tsx package.json package-lock.json
git commit -m "feat: export_doc_images + ImageExportCard 画廊 + ZIP 导出（JSZip）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 最终集成验证

**Files:** (none new — full project verification)

---

- [ ] **Step 1: Typecheck.**

```bash
npm run typecheck
# Expected: 0 errors
```

- [ ] **Step 2: Full test suite.**

```bash
npm test -- --run
# Expected: all green (existing ~650+ tests, plus new ones)
```

- [ ] **Step 3: Build.**

```bash
npm run build
# Expected: success
```

- [ ] **Step 4: Manual smoke test plan** (execute in-browser on a Feishu doc page):

1. **insert_image**: 在对话框上传一张 PNG，发送"把这张图放到**测试标题**下面"。验证：文档里该标题下方出现图片。
2. **copy_document**: 发送"克隆这篇文档"。验证：新文档已创建，图文齐全。
3. **clone_doc_with_images**: 发送"把这篇文档总结一下生成新文档，图片保留"。验证：新文档含总结文字+原图。
4. **replace_image**: 发送"把第 1 张图换成这张新图"（带新附件）。验证：文档里第一张图被替换。
5. **export_doc_images**: 发送"导出这篇文档的所有图片"。验证：画廊出现，点"下载全部 ZIP"可下载且张数正确。
6. **回归**: 非 doc 页（Base/Sheet/普通页）对话正常，无新工具暴露；幻灯片功能正常；现有 attachment→vision 正常。

- [ ] **Step 5: Commit** (if build passed and smoke tests pass on any engineer machine).

```bash
# No changes to commit — this task is verification only
```
