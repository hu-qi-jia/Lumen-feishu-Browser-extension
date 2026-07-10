import type { ChatCompletionTool } from 'openai/resources'
import { FEISHU_TOOLS, KNOWLEDGE_TOOLS } from './tools'
import { HAS_KNOWLEDGE_BASE } from '../config'
import { skillsToTools, filterSkillsForContext, type UserSkill } from './userSkills'

// 工具选择层：按当前页面类型暴露相关工具子集，减少无关工具干扰模型选择。

// "Create-once" tools: re-running the SAME call (same args) in one turn almost always
// means an accidental duplicate (e.g. the model retried after a slow response) and
// would create a second table/doc/sheet. We dedupe exact repeats within a turn.
export const CREATE_ONCE_TOOLS = new Set([
  'create_bitable_app', 'create_table', 'create_field', 'create_view',
  'create_document', 'create_doc_from_markdown', 'insert_table', 'insert_sheet',
  'create_spreadsheet', 'add_sheet', 'base_table_to_sheet', 'summarize_table',
  'generate_data_report',
  // insert_image / replace_image: some LLMs emit the identical call twice in a turn,
  // which inserts the image twice. An exact repeat (same attachment_id + anchor) is an
  // accidental duplicate — dedupe it. Two genuinely different anchors still differ in args,
  // so "插到 A 和 B 下面" (different sigs) is NOT affected.
  'insert_image', 'replace_image',
])

// Tools that operate on Spreadsheets/Docs — they carry their own resource token
// (spreadsheet_token / document_id) and must NOT be blocked by the Base app_token guard.
export const SHEET_TOOLS = new Set([
  'create_spreadsheet', 'get_spreadsheet', 'list_sheets', 'add_sheet', 'delete_sheet',
  'read_range', 'write_range', 'append_rows', 'fill_column', 'find_replace',
  'set_number_format', 'insert_dimension', 'delete_dimension',
])
export const DOC_TOOLS = new Set([
  'create_document', 'create_doc_from_markdown', 'get_document_content', 'list_blocks',
  'add_document_content', 'insert_table', 'insert_sheet', 'delete_document_blocks',
  'insert_image', 'copy_document', 'replace_image', 'export_doc_images',
])
// Pure READ tools — side-effect-free, so when the model batches several in one round they can run
// CONCURRENTLY instead of one-after-another (cuts wall-time for "read A and B and C" patterns).
export const READ_ONLY_TOOLS = new Set([
  'get_app_info', 'list_tables', 'list_fields', 'list_records', 'search_records', 'list_views',
  'list_dashboards', 'get_spreadsheet', 'list_sheets', 'read_range', 'get_document_content', 'list_blocks',
  // 知识库（Obsidian）三件套均为只读 → 可与其他只读调用同轮并行
  'search_knowledge_base', 'list_knowledge_notes', 'read_knowledge_note',
])
// Cross-cutting tools exposed on EVERY page (incl. the "create a new X" entry points) so the user
// can always ask a question, escape-hatch a raw API call, render a viz, or create a fresh resource.
const CORE_TOOLS = new Set([
  'feishu_api_call', 'render_data_app',
  'create_bitable_app', 'create_spreadsheet', 'create_document', 'create_doc_from_markdown',
])

/**
 * Expose only the tools relevant to the CURRENT page (core + that resource's toolset) instead of
 * all ~55 every turn. Fewer, on-topic tools → the model picks the right one far more reliably (a
 * top cause of wrong-tool / wrong-resource destructive mistakes) and the request is cheaper/faster.
 * On a Base: bitable tools (everything not sheet/doc). On Sheet/Doc: that resource's tools. On an
 * unresolved/other page: core + creators only (guides the user to open a concrete resource).
 */
export function toolsForContext(
  kind: string | undefined,
  opts?: { kbEnabled?: boolean; userSkills?: UserSkill[] },
): ChatCompletionTool[] {
  const base = FEISHU_TOOLS.filter((t) => {
    const name = (t as { function?: { name?: string } }).function?.name ?? ''
    if (CORE_TOOLS.has(name)) return true
    if (kind === 'sheet') return SHEET_TOOLS.has(name)
    if (kind === 'doc') return DOC_TOOLS.has(name)
    if (kind === 'base') return !SHEET_TOOLS.has(name) && !DOC_TOOLS.has(name)
    return false // unknown / unresolved wiki → core + creators only
  })
  // 知识库默认开启（构建启用且未显式关闭）。原为按会话 opt-in + App.tsx 用 `=== true` 把
  // undefined 当关 → 用户"在 Hub 选中知识库"却没去对话里拨开关时，工具被静默丢弃、agent 退回
  // 角色 拒绝。改成"除非显式 false 否则带上"：undefined / true 都注入，仅显式 false 才关。
  let tools = base
  if (HAS_KNOWLEDGE_BASE && opts?.kbEnabled !== false) tools = [...tools, ...KNOWLEDGE_TOOLS]
  // 用户自定义技能：按 scope 筛选启用的技能并追加为工具
  if (opts?.userSkills?.length) {
    const active = filterSkillsForContext(opts.userSkills, kind)
    if (active.length) tools = [...tools, ...skillsToTools(active)]
  }
  return tools
}
