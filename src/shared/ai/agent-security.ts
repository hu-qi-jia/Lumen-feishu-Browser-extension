import type { ChatCompletionMessageParam } from 'openai/resources'
import type { ChatMessage } from '../types'

// 安全策略层：API 调用白名单 / 文件级删除硬拒 / 内容级删除确认 / 结果脱敏截断。
// 全部为纯函数，独立于 agent 主循环，便于审计与单测。

const API_ALLOWED_PREFIXES = [
  /^\/bitable\//, /^\/sheets\//, /^\/docx\//, /^\/doc\//, /^\/wiki\//, /^\/board\//,
  /^\/drive\/v1\/files\//, /^\/drive\/v1\/medias\//, /^\/drive\/v1\/metas\b/,
]
// Hard-blocked even if a path otherwise matches — ownership/permission/identity-sensitive.
const API_BLOCKED = [/transfer_owner/i, /\/permissions\//i, /\/im\//i, /\/contact\//i, /\/admin\//i]

export function assertApiCallAllowed(path: string): void {
  if (!path.startsWith('/')) throw new Error('feishu_api_call: path 必须以 / 开头（相对 /open-apis）')
  if (/[@\\]|\.\.|\/\//.test(path)) throw new Error('feishu_api_call: path 含非法字符')
  if (API_BLOCKED.some((re) => re.test(path))) {
    throw new Error('feishu_api_call: 该接口涉及成员/权限/通讯录/消息，出于安全已禁止调用。请改用专用工具或让用户在飞书内手动操作。')
  }
  if (!API_ALLOWED_PREFIXES.some((re) => re.test(path))) {
    throw new Error(`feishu_api_call: 仅允许多维表格/电子表格/文档/云空间文件等业务接口，路径「${path}」不在白名单内（出于企业安全默认拒绝）。`)
  }
}

/** A generic api call that MODIFIES (PUT/PATCH) — gated by destructive confirmation.
 *  DELETE is not here: file-level deletion via the generic API is blocked outright
 *  (see isFileLevelDelete), not merely confirmed. */
export function isWritingApiCall(name: string, args: Record<string, unknown>): boolean {
  return name === 'feishu_api_call' && /^(PUT|PATCH)$/i.test(String(args.method ?? ''))
}

/** A generic feishu_api_call that DELETES/TRASHES content via a POST — bitable/doc `batch_delete`,
 *  a drive move-to-trash, or a Sheets `sheets_batch_update` carrying a deleteDimension/Range/Sheet.
 *  These slip past isWritingApiCall (PUT/PATCH only) AND the file-level DELETE block, so without
 *  this a raw-API deletion would run with NO confirmation. DENY-BY-DEFAULT: any POST whose path or
 *  body looks like a deletion is gated (an extra confirm is far safer than a silent destroy; legit
 *  create/get/search POSTs don't carry delete/trash/remove tokens, so they aren't over-prompted). */
export function isDestructiveApiCall(name: string, args: Record<string, unknown>): boolean {
  if (name !== 'feishu_api_call') return false
  const method = String(args.method ?? '').toUpperCase()
  const path = String(args.path ?? '')
  if (method === 'DELETE') return true // (also file-level-blocked, but content DELETE if it ever isn't)
  if (method === 'POST') {
    if (/(batch_delete|\/delete|delete_|trash|move_to_trash)/i.test(path)) return true // delete endpoints
    // Body check is narrow ON PURPOSE — a Sheets batch_update delete request. NOT a generic
    // /"delete.../ (that false-flagged benign payloads with a field/key named e.g. "deleted").
    const body = JSON.stringify(args.body ?? args.payload ?? args.data ?? {})
    if (/"(deleteDimension|deleteRange|deleteSheet)"/i.test(body)) return true
  }
  return false
}

// File / container-level deletion is NEVER performed by the assistant — destroying a
// whole table, spreadsheet, document or drive file must be the user's own deliberate
// action in Feishu. Content-level deletion (rows, fields, blocks, dedupe) stays allowed
// behind the destructive-confirmation gate.
const FILE_LEVEL_DELETE_TOOLS = new Set(['delete_table', 'delete_sheet'])

export function isFileLevelDelete(name: string, args: Record<string, unknown>): boolean {
  if (FILE_LEVEL_DELETE_TOOLS.has(name)) return true
  if (name === 'feishu_api_call') {
    const method = String(args.method ?? '').toUpperCase()
    const path = String(args.path ?? '')
    // Any DELETE through the generic API could remove a whole file/app/doc — block all.
    if (method === 'DELETE') return true
    // POST move_to_trash destroys a whole cloud file too — same file-level hard block,
    // not merely the content-delete confirmation gate.
    if (method === 'POST' && /move_to_trash/i.test(path)) return true
  }
  return false
}

export const FILE_LEVEL_DELETE_MSG =
  '安全策略：助手不会删除整张表 / 电子表格 / 文档 / 云文件（文件级删除）。如确需删除，请你在飞书中手动操作。'

/** A one-line, human-readable summary of a content-delete / write op, shown on the
 *  confirm card so the user can approve with a button instead of typing. */
export function describeDestructiveOp(name: string, args: Record<string, unknown>): string {
  const len = (k: string) => (Array.isArray(args[k]) ? (args[k] as unknown[]).length : undefined)
  switch (name) {
    case 'delete_record':
      return '删除 1 条记录'
    case 'batch_delete_records':
      return `批量删除 ${len('record_ids') ?? '若干'} 条记录`
    case 'delete_field':
      return `删除字段「${String(args.field_name ?? args.field_id ?? '')}」（含该列全部数据）`
    case 'delete_dimension': {
      // Show the EXACT 1-based range on the confirm card so the user catches a wrong delete
      // (e.g. "删除第 1–2 行" makes it obvious row 1 = the header is about to go).
      const dim = String(args.dimension ?? '').toUpperCase() === 'COLUMNS' ? '列' : '行'
      const s = Number(args.start_index), c = Number(args.count)
      return Number.isFinite(s) && Number.isFinite(c) && c > 0
        ? `删除电子表格第 ${s + 1}–${s + c} ${dim}（共 ${c} ${dim}）`
        : `删除电子表格的若干${dim}`
    }
    case 'delete_document_blocks': {
      // The tool deletes the range [start_index, end_index); there is no `block_ids` arg, so the
      // count must come from the indices (otherwise the confirm card always reads「若干」).
      const s = Number(args.start_index), e = Number(args.end_index)
      const n = Number.isFinite(s) && Number.isFinite(e) ? e - s : undefined
      return `删除文档中的 ${n != null && n > 0 ? n : '若干'} 个内容块`
    }
    case 'dedupe_records':
      return '删除重复记录（去重）'
    case 'update_where': {
      // Bulk-writes `set` to every record matching `filter` — confirm before touching many rows.
      const set = (args.set ?? {}) as Record<string, unknown>
      const fields = Object.keys(set)
      return `按条件批量修改记录${fields.length ? `（写入字段：${fields.join(' / ')}）` : ''}`
    }
    case 'cross_table_lookup':
      return `跨表回填并写入「${String(args.into_field ?? '')}」列${args.create_field_if_missing === false ? '' : '（列不存在时会新建）'}`
    case 'smart_fill_apply':
      return '智能填充·写入预览的推断结果（批量补全空缺单元格）'
    case 'feishu_api_call':
      return `${String(args.method ?? '')} ${String(args.path ?? '')}（修改写入）`
    default:
      return `执行 ${name}（写操作）`
  }
}

// Maximum CHARACTERS (UTF-16 code units, not bytes) of a single tool result sent to the LLM.
// Prevents bulk PII (phone numbers, names, etc.) from being sent to external AI. Sliced by
// code unit below, so it's measured/reported in 字符 (a CJK char is ~3 UTF-8 bytes).
const MAX_TOOL_RESULT_CHARS = 8_000

// Content-level delete tools that require explicit user confirmation before calling.
// File-level deletes (delete_table / delete_sheet) are NOT here — they are hard-blocked
// by isFileLevelDelete above and never reach this gate.
export const DESTRUCTIVE_TOOLS = new Set([
  'delete_field',
  'delete_record',
  'batch_delete_records',
  'delete_dimension',
  'delete_document_blocks',
  'dedupe_records',
])

// Non-delete BULK WRITE tools that also need a confirmation gate: they modify many records at
// once (update_where overwrites every matched row; cross_table_lookup back-fills a column on
// every source row and can auto-create the column). Without this they ran with no confirm card.
export const WRITE_TOOLS = new Set(['update_where', 'cross_table_lookup', 'smart_fill_apply'])

// Returns true only if the most recent user message contains a clear "yes" signal.
const CONFIRM_PATTERNS = /^(确认|是|是的|好|好的|yes|ok|okay|confirm|delete|删除|继续|执行)$/i

export function checkDestructiveConfirmation(
  history: ChatMessage[],
  msgs: ChatCompletionMessageParam[]
): boolean {
  // Look at the last user message in the full message chain
  const allMsgs = [...msgs]
  for (let i = allMsgs.length - 1; i >= 0; i--) {
    const m = allMsgs[i]
    if (m.role === 'user') {
      const text = (typeof m.content === 'string' ? m.content : '').trim()
      return CONFIRM_PATTERNS.test(text)
    }
    // Stop looking back past the last assistant message that asked for confirmation
    if (m.role === 'assistant') break
  }
  // Also accept if the previous history shows a confirmation pattern
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role === 'user') {
      return CONFIRM_PATTERNS.test((m.content ?? '').trim())
    }
    if (m.role === 'assistant') break
  }
  return false
}

// Strip whitespace and validate that a token/ID only contains safe characters
export function sanitizeToken(val: string | undefined): string | undefined {
  if (!val) return undefined
  const s = val.trim()
  // Feishu tokens contain only alphanumeric + underscore/hyphen
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error(`无效 ID 格式: ${s}`)
  return s
}

/**
 * Truncate tool results before sending to LLM.
 * Feishu records can contain PII (phone numbers, names, emails).
 * We limit how much raw data leaves the browser to the external AI service.
 */
export function truncateToolResult(json: string): string {
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json
  const truncated = json.slice(0, MAX_TOOL_RESULT_CHARS)
  // Find last complete JSON object boundary to avoid broken JSON
  const lastBrace = Math.max(truncated.lastIndexOf('},'), truncated.lastIndexOf(']'))
  const cut = lastBrace > MAX_TOOL_RESULT_CHARS * 0.5 ? lastBrace + 1 : MAX_TOOL_RESULT_CHARS
  return json.slice(0, cut) + `\n... [结果已截断，共 ${json.length} 字符，只传输前 ${cut} 字符以保护数据隐私]`
}
