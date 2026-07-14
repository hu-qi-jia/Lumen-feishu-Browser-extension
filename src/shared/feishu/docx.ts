/**
 * Feishu Docs (docx/v1) API wrapper.
 *
 * The document's root block id == document_id, so child blocks are appended under
 * that id. Block payloads are non-trivial (typed per block_type); `buildBlock`
 * turns simple {text, style} specs into the API's block structure so the agent
 * doesn't have to know the raw schema.
 *
 * Endpoints verified live before being relied on (see harness/docx.test.ts).
 */
import { feishuReq } from './http'
import { writeRange } from './sheets'

export type BlockStyle =
  | 'text' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'quote' | 'code' | 'todo' | 'divider' | 'image'
export interface BlockSpec { text: string; style?: BlockStyle; imageToken?: string }

// block_type codes (verified live): 2=text 3/4/5=heading1-3 12=bullet 13=ordered
// 14=code 15=quote 17=todo 22=divider
const BLOCK_TYPE: Record<BlockStyle, { type: number; key: string }> = {
  text: { type: 2, key: 'text' },
  h1: { type: 3, key: 'heading1' },
  h2: { type: 4, key: 'heading2' },
  h3: { type: 5, key: 'heading3' },
  bullet: { type: 12, key: 'bullet' },
  ordered: { type: 13, key: 'ordered' },
  quote: { type: 15, key: 'quote' },
  code: { type: 14, key: 'code' },
  todo: { type: 17, key: 'todo' },
  divider: { type: 22, key: 'divider' },
  image: { type: 27, key: 'image' },
}

// Parse inline markdown (**bold**, *italic*, `code`) into styled text_run elements.
function parseInline(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text_run: { content: text.slice(last, m.index) } })
    const style = m[2] != null ? { bold: true } : m[3] != null ? { italic: true } : { inline_code: true }
    out.push({ text_run: { content: m[2] ?? m[3] ?? m[4], text_element_style: style } })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text_run: { content: text.slice(last) } })
  return out.length ? out : [{ text_run: { content: text } }]
}

export function buildBlock(spec: BlockSpec): Record<string, unknown> {
  if (spec.style === 'image') {
    // With a token this is a finished image block; WITHOUT one it's the EMPTY image block that
    // the official insert-image flow creates first (Step 1), then binds a material to via PATCH
    // `replace_image` (Step 3). Emitting `image:{token:''}` for the empty block is rejected, so
    // only include `token` when we actually have one.
    return spec.imageToken
      ? { block_type: 27, image: { token: spec.imageToken } }
      : { block_type: 27, image: {} }
  }
  const { type, key } = BLOCK_TYPE[spec.style ?? 'text'] ?? BLOCK_TYPE.text
  if (key === 'divider') return { block_type: type, divider: {} }
  const inner: Record<string, unknown> = { elements: parseInline(spec.text), style: {} }
  if (key === 'todo') (inner.style as Record<string, unknown>).done = false
  return { block_type: type, [key]: inner }
}

// ─── Markdown → blocks ──────────────────────────────────────────────────────

/** Convert a markdown string into BlockSpec[] (block-level + inline bold/italic/code). */
export function markdownToBlocks(md: string): BlockSpec[] {
  const blocks: BlockSpec[] = []
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let inCode = false
  let codeBuf: string[] = []
  for (const raw of lines) {
    const line = raw
    if (line.trim().startsWith('```')) {
      if (inCode) { blocks.push({ text: codeBuf.join('\n'), style: 'code' }); codeBuf = []; inCode = false }
      else inCode = true
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    const tr = line.trim()
    if (!tr) continue
    if (/^(---|\*\*\*|___)$/.test(tr)) { blocks.push({ text: '', style: 'divider' }); continue }
    let mm: RegExpMatchArray | null
    if ((mm = tr.match(/^(#{1,6})\s+(.*)$/))) {
      // Feishu docx only has heading1–3 (block_type 3/4/5). pdf2md emits H4–H6 for deeper sections
      // (its DetectHeaders starts at level 2), so clamp 4–6 down to h3 — otherwise they'd fall
      // through to plain text and land as literal "#### …" in the document.
      const level = Math.min(mm[1].length, 3)
      blocks.push({ text: mm[2], style: (['h1', 'h2', 'h3'] as const)[level - 1] })
    } else if ((mm = tr.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      blocks.push({ text: mm[2], style: 'todo' })
    } else if ((mm = tr.match(/^[-*+]\s+(.*)$/))) {
      blocks.push({ text: mm[1], style: 'bullet' })
    } else if ((mm = tr.match(/^\d+\.\s+(.*)$/))) {
      blocks.push({ text: mm[1], style: 'ordered' })
    } else if ((mm = tr.match(/^>\s?(.*)$/))) {
      blocks.push({ text: mm[1], style: 'quote' })
    } else {
      blocks.push({ text: tr, style: 'text' })
    }
  }
  if (inCode && codeBuf.length) blocks.push({ text: codeBuf.join('\n'), style: 'code' })
  return blocks
}

// ─── Documents ──────────────────────────────────────────────────────────────

export function createDocument(token: string, title: string, folderToken?: string) {
  return feishuReq('POST', '/docx/v1/documents', token, {
    title,
    ...(folderToken ? { folder_token: folderToken } : {}),
  })
}

/** Create a document and fill it from a markdown string in one call. */
export async function createDocFromMarkdown(
  token: string,
  title: string,
  markdown: string,
  folderToken?: string
) {
  const created = (await createDocument(token, title, folderToken)) as {
    document?: { document_id?: string }
  }
  const docId = created.document?.document_id
  // Table-aware: markdown tables become real Feishu tables, not literal `| … |` text.
  const segs = markdownToSegments(markdown)
  const res = docId && segs.length ? await insertSegments(token, docId, segs, 0) : { blocks_inserted: 0 }
  return { ...created, blocks_inserted: res.blocks_inserted }
}

/** Plain-text dump of the whole document. */
export function getDocumentContent(token: string, documentId: string) {
  return feishuReq('GET', `/docx/v1/documents/${documentId}/raw_content`, token)
}

/** Document metadata (mainly the real title). Used to name a direct /docx/ page reliably —
 *  the SPA's document.title is unreliable on some (esp. private/on-prem) deployments. */
export function getDocumentMeta(token: string, documentId: string) {
  return feishuReq('GET', `/docx/v1/documents/${documentId}`, token) as Promise<{ document?: { title?: string } }>
}

/** List a document's blocks, following pagination so large docs aren't silently truncated
 *  (the agent computes block indices off this view — a single page would hide blocks past #500). */
export async function listBlocks(token: string, documentId: string, cap = 2000) {
  const items: unknown[] = []
  let pageToken: string | undefined
  let truncated = false
  do {
    const res = (await feishuReq('GET', `/docx/v1/documents/${documentId}/blocks`, token, undefined, {
      page_size: '500',
      ...(pageToken ? { page_token: pageToken } : {}),
    })) as { items?: unknown[]; has_more?: boolean; page_token?: string }
    if (Array.isArray(res.items)) items.push(...res.items)
    pageToken = res.has_more ? res.page_token : undefined
    if (items.length >= cap) { truncated = !!pageToken; pageToken = undefined } // bound context size
  } while (pageToken)
  // A flat, 0-indexed view of the doc's ROOT children — the very thing delete_document_blocks
  // / insert indices count by. list_blocks otherwise returns the whole nested tree, and the
  // agent counting "root children" off the tree is the documented cause of off-by-one deletes
  // (it counts every nested block). Handing it N + a numbered list makes the index unambiguous.
  const root = summarizeRootChildren(items, documentId)
  return {
    items: items.slice(0, cap), has_more: truncated, truncated,
    root_children_count: root.count, root_children_truncated: root.truncated, root_children: root.indexed,
  }
}

/** 飞书 docx 里所有「文本类」块的 payload key：正文 / 各级标题 / 有序无序列表 / 引用 / 代码 / 待办。
 *  这些块的 value 形如 { elements: [{ text_run: { content } }] }。按 **key 存在性** 读取，不依赖
 *  block_type 数字——本仓读侧(BLOCK_TYPE_NAMES)与写侧(BLOCK_TYPE)的 type 编号本就不一致，按 key
 *  读最稳，且顺带让列表/引用/代码块也能被读出（旧版只认 text/heading，列表项一律读成空串）。 */
const TEXT_BLOCK_KEYS = ['text', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'bullet', 'ordered', 'code', 'quote', 'todo'] as const

/** 读取任意「文本类」块的纯文本；非文本块（表格/图片/分割线/iframe/callout 容器等）返回 ''。
 *  summarizeRootChildren / summarizeDocument / resolveSelectionContext 共用。 */
function readBlockText(block: Record<string, unknown>): string {
  for (const k of TEXT_BLOCK_KEYS) {
    const el = block[k] as { elements?: Array<{ text_run?: { content?: string } }> } | undefined
    if (el && Array.isArray(el.elements)) {
      return el.elements.map((e) => e?.text_run?.content ?? '').join('')
    }
  }
  return ''
}

/** 飞书 block_type → 短名（给 summarizeRootChildren 的索引清单用，让人一眼看懂每行是什么块）。 */
const BLOCK_TYPE_NAMES: Record<number, string> = {
  1: 'page', 2: 'text', 3: 'h1', 4: 'h2', 5: 'h3', 6: 'h4', 7: 'h5', 8: 'h6',
  9: 'bullet', 10: 'ordered', 11: 'code', 12: 'quote', 13: 'todo', 14: 'bitable',
  15: 'callout', 17: 'divider', 19: 'iframe', 22: 'table', 27: 'image', 30: 'sheet',
}
function blockTypeName(bt: number): string {
  return BLOCK_TYPE_NAMES[bt] ?? `type${bt}`
}

/**
 * 纯：把整棵块树压成「文档根直接子块」的扁平 0 基索引清单（{ i, t, s }）。`list_blocks`
 * 返回嵌套树，模型要靠它数根块数极易数错（把嵌套块也算进去）→ off-by-one 删除。这里
 * 替它数好 N，并给带索引的清单，删/插哪个根块一目了然。`cap` 限清单长度防爆体积；`count`
 * 始终是真实总数（清单截断时 `truncated=true`）。
 */
export function summarizeRootChildren(
  items: unknown[],
  documentId: string,
  cap = 120,
): { count: number; indexed: Array<{ i: number; t: string; s: string }>; truncated: boolean } {
  const root = (items as Record<string, unknown>[])
    .filter((b) => b.parent_id === documentId)
    .sort((a, b) => ((a.index as number) ?? 0) - ((b.index as number) ?? 0))
  const truncated = root.length > cap
  const slice = truncated ? root.slice(0, cap) : root
  return {
    count: root.length,
    truncated,
    indexed: slice.map((b, i) => ({
      i,
      t: blockTypeName((b.block_type as number) ?? 0),
      s: readBlockText(b).slice(0, 40),
    })),
  }
}

/**
 * 纯：把文档压成「紧凑、带全文、可分页可搜索的根块大纲」交给 LLM——一个工具读遍任意大小的文档。
 *
 * 为什么：飞书 list_blocks 返回的是整棵嵌套树的原始 JSON（每块的 elements/text_run/style 全展开），
 * 任何稍大的文档都远超工具结果字符上限（MAX_TOOL_RESULT_CHARS），被截断后模型既看不到总块数也看
 * 不到后半篇，只能在 get_document_content / list_blocks / feishu_api_call 之间反复横跳、逐块补查
 * （极慢且不收敛）。本函数把根级块压成紧凑大纲，并提供两个收敛把手：
 *   - 分页：start 从结果列表第 N 条开始，limit/charBudget 控制单页大小；返回 has_more +
 *     next_start_index 告诉模型下一页从哪起——长文档按 next_start_index 顺序翻页即可，确定性收敛。
 *   - 定位：query 按文本子串过滤（大小写不敏感、去首尾空格），一次调用找到"目录 / 某标题"所在块。
 *
 * 返回字段顺序刻意把导航信息（count / start_index / has_more / next_start_index / matched_count）
 * 全排在 outline 之前：即使整页仍超字符上限被全局截断，模型也总能看到"总数 + 当前位置 + 还有没有
 * 更多 + 下一页起点"，只丢 outline 尾部（截断发生在完整的 }, 边界，不留半条记录）。
 *
 * 大纲只含文档根的直接子块；嵌套块（callout 内段落、表格内部单元格）不在其中，需深入时用
 * feishu_api_call 指定 block_id。每条 i 是该块在根子块中的绝对 0 基索引（= 插入/删除用的 index）。
 */
export function summarizeDocument(
  items: unknown[],
  documentId: string,
  opts: { start?: number; limit?: number; charBudget?: number; query?: string } = {},
): {
  document_id: string
  root_children_count: number
  start_index: number
  has_more: boolean
  next_start_index?: number
  matched_count?: number
  outline: Array<{ i: number; type: string; id: string; text: string }>
} {
  const start = Math.max(0, Math.floor(opts.start ?? 0))
  const limit = Math.max(1, Math.floor(opts.limit ?? 80))
  // Compact-char budget per page, kept well under MAX_TOOL_RESULT_CHARS so a whole page (with the
  // nav fields) fits without the global truncator cutting the outline tail (which would make
  // next_start_index skip those cut entries). Text-heavy pages render near 1:1 compact→pretty.
  const charBudget = Math.max(1, Math.floor(opts.charBudget ?? 6000))
  const query = opts.query?.trim().toLowerCase()

  const root = (items as Record<string, unknown>[])
    .filter((b) => b.parent_id === documentId)
    .sort((a, b) => ((a.index as number) ?? 0) - ((b.index as number) ?? 0))
  // Absolute root-child index per block (object-ref keyed → O(1)). Lets a `query`-filtered page
  // still report each entry's TRUE root index (the one insert/delete/index use), not its position
  // in the filtered list.
  const rootIndexOf = new Map<Record<string, unknown>, number>()
  root.forEach((b, idx) => rootIndexOf.set(b, idx))

  const source = query ? root.filter((b) => readBlockText(b).toLowerCase().includes(query)) : root

  const outline: Array<{ i: number; type: string; id: string; text: string }> = []
  let chars = 0
  let pos = start
  for (; pos < source.length; pos++) {
    if (outline.length >= limit) break
    const b = source[pos]
    const entry = {
      i: rootIndexOf.get(b) ?? 0,
      type: blockTypeName((b.block_type as number) ?? 0),
      id: String(b.block_id ?? ''),
      text: readBlockText(b),
    }
    const entryChars = JSON.stringify(entry).length
    // Stop at the char budget, but always keep >= 1 entry (a single huge block still returns itself).
    if (outline.length > 0 && chars + entryChars > charBudget) break
    outline.push(entry)
    chars += entryChars
  }
  const hasMore = pos < source.length
  return {
    document_id: documentId,
    // count is ALWAYS the true unfiltered total.
    root_children_count: root.length,
    start_index: start,
    has_more: hasMore,
    // next_start_index pages through `source` (filtered if query, else root) — pass it back as start.
    next_start_index: hasMore ? start + outline.length : undefined,
    ...(query !== undefined ? { matched_count: source.length } : {}),
    outline,
  }
}

/** 纯：在扁平块列表里，按 selectedText 文本匹配定位「所在完整段落 + 最近上方标题 + block_id」。
 *  无 DOM 依赖（block_id 始终走 API 的既定原则）；list_blocks 已是扁平有序列表。
 *  返回 block_id 让 agent 可直接调 update_document_block / delete_document_blocks，省一次 list_blocks。 */
export function resolveSelectionContext(
  blocks: unknown[],
  selectedText: string,
): { paragraphText?: string; headingText?: string; blockId?: string } {
  const needle = (selectedText ?? '').trim()
  if (!needle) return {}
  const list = blocks as Record<string, unknown>[]
  let lastHeading: string | undefined
  for (const b of list) {
    const bt = b.block_type as number
    const isHeading = bt >= 3 && bt <= 5
    const text = readBlockText(b)
    if (isHeading && text) lastHeading = text
    if (text && text.includes(needle)) {
      return {
        paragraphText: text,
        headingText: isHeading ? text : lastHeading,
        blockId: typeof b.block_id === 'string' ? b.block_id : undefined,
      }
    }
  }
  return {}
}

/**
 * 异步包装：拉取文档块后跑 resolveSelectionContext。blockId/paragraphText/headingText 回填到 chip。
 * chip 落地时调用，让 agent 拿到 block_id 可直接改写，省一次 list_blocks 调用。
 */
export async function fetchSelectionContext(
  token: string,
  documentId: string,
  selectedText: string,
): Promise<{ paragraphText?: string; headingText?: string; blockId?: string }> {
  const { items } = await listBlocks(token, documentId)
  return resolveSelectionContext(items, selectedText)
}

/** Insert built blocks under a parent (default: document root) at `index`. Feishu caps the
 *  children array at 50 per call, so we CHUNK — inserting each chunk at the running offset.
 *  Without this, a wide report/audit/summary left a blank doc + a confusing API error. */
export async function insertBlocks(
  token: string,
  documentId: string,
  specs: BlockSpec[],
  index = 0,
  parentBlockId?: string
) {
  const parent = parentBlockId ?? documentId
  const children = specs.map(buildBlock)
  const CHUNK = 50
  const created: Array<{ block_id?: string }> = []
  for (let i = 0; i < children.length; i += CHUNK) {
    const res = (await feishuReq('POST', `/docx/v1/documents/${documentId}/blocks/${parent}/children`, token, {
      index: index + i,
      children: children.slice(i, i + CHUNK),
    })) as { children?: Array<{ block_id?: string }> }
    if (Array.isArray(res.children)) created.push(...res.children)
  }
  return { children: created, blocks_inserted: children.length }
}

// ─── Tables (one-shot, fully populated via the descendant endpoint) ─────────

interface Descendant { block_id: string; block_type: number; children?: string[]; [k: string]: unknown }

/**
 * Build the `descendant` payload for a populated table — table(31) → cells(32) → text(2),
 * in ROW-MAJOR order. Pure (no I/O), so it's unit-tested. Feishu REQUIRES every table cell
 * to contain ≥1 child block, so even an empty cell gets an (empty) text block.
 */
export function buildTableDescendants(
  data: string[][],
  opts: { headerRow?: boolean } = {},
): { children_id: string[]; descendants: Descendant[]; rows: number; cols: number } {
  const rows = data.length
  const cols = Math.max(1, ...data.map((r) => r.length))
  const cellIds: string[] = []
  const cells: Descendant[] = []
  const texts: Descendant[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellId = `c_${r}_${c}`
      const textId = `t_${r}_${c}`
      cellIds.push(cellId)
      cells.push({ block_id: cellId, block_type: 32, table_cell: {}, children: [textId] })
      const content = data[r]?.[c] ?? ''
      texts.push({
        block_id: textId, block_type: 2,
        text: { elements: content ? parseInline(content) : [{ text_run: { content: '' } }], style: {} },
        children: [],
      })
    }
  }
  const table: Descendant = {
    block_id: 'tbl', block_type: 31,
    table: { property: { row_size: rows, column_size: cols, header_row: opts.headerRow ?? true } },
    children: cellIds,
  }
  return { children_id: ['tbl'], descendants: [table, ...cells, ...texts], rows, cols }
}

/**
 * Insert a TABLE filled with `data` (string[][]) in ONE call via the descendant endpoint.
 * Replaces the old create-empty-then-PATCH approach, which fired N+1 rate-limited writes
 * AND relied on a non-paginated listBlocks — so on a doc with >500 blocks the new cells
 * fell outside the first page and were silently left empty.
 */
export async function insertTable(token: string, documentId: string, data: string[][], index = 0) {
  if (!data.length) return { table_block_id: null, rows: 0, cols: 0 }
  const { children_id, descendants, rows, cols } = buildTableDescendants(data, { headerRow: true })
  const res = (await feishuReq(
    'POST',
    `/docx/v1/documents/${documentId}/blocks/${documentId}/descendant`,
    token,
    { index, children_id, descendants },
  )) as { children?: Array<{ block_id: string }> }
  return { table_block_id: res.children?.[0]?.block_id ?? null, rows, cols }
}

// ─── Markdown WITH tables → real Feishu blocks + table blocks ────────────────
// markdownToBlocks alone turns a markdown table (| a | b |) into literal text — so a clipped /
// reported table landed as raw `| … |` lines. These split markdown into text-runs (→ insertBlocks)
// and table-runs (→ insertTable, the descendant endpoint) and insert them in order.

export type MdSegment = { kind: 'blocks'; specs: BlockSpec[] } | { kind: 'table'; rows: string[][] }

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/
const tableCells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((s) => s.trim())
/** True when `t` contains a markdown table (a |row| immediately followed by a |---| separator). */
export function hasMarkdownTable(t: string): boolean {
  const ls = (t || '').split('\n')
  return ls.some((l, i) => TABLE_ROW.test(l) && i + 1 < ls.length && TABLE_SEP.test(ls[i + 1]))
}

export function markdownToSegments(md: string): MdSegment[] {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n')
  const segs: MdSegment[] = []
  let buf: string[] = []
  let inCode = false
  const flush = () => { if (buf.length) { const specs = markdownToBlocks(buf.join('\n')); if (specs.length) segs.push({ kind: 'blocks', specs }); buf = [] } }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim().startsWith('```')) { inCode = !inCode; buf.push(l); continue }
    if (!inCode && TABLE_ROW.test(l) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flush()
      const rows = [tableCells(l)]
      i += 2 // skip header + separator
      // Consume ALL following |…| rows as DATA. (Don't stop on a TABLE_SEP-looking row: the real
      // separator is already consumed above, and a body row of only dashes is legitimate data —
      // testing it would truncate the table and silently drop that row + everything after it.)
      while (i < lines.length && TABLE_ROW.test(lines[i])) { rows.push(tableCells(lines[i])); i++ }
      i--
      segs.push({ kind: 'table', rows })
    } else buf.push(l)
  }
  flush()
  return segs
}

/** Insert a mixed sequence (text blocks + tables) in order, tracking the running block index. */
export async function insertSegments(token: string, documentId: string, segments: MdSegment[], index = 0) {
  let idx = index, inserted = 0
  for (const seg of segments) {
    if (seg.kind === 'blocks' && seg.specs.length) {
      const r = await insertBlocks(token, documentId, seg.specs, idx)
      idx += r.blocks_inserted; inserted += r.blocks_inserted
    } else if (seg.kind === 'table' && seg.rows.length) {
      await insertTable(token, documentId, seg.rows, idx)
      idx += 1; inserted += 1 // a table is one top-level block
    }
  }
  return { blocks_inserted: inserted }
}

/** Insert AI-supplied BlockSpec[] but expand any text block that embeds a markdown table into a
 *  real table (the assistant sometimes stuffs a `| … |` table into a text block). */
export async function insertContentBlocks(token: string, documentId: string, specs: BlockSpec[], index = 0) {
  const segments: MdSegment[] = []
  let buf: BlockSpec[] = []
  const flush = () => { if (buf.length) { segments.push({ kind: 'blocks', specs: buf }); buf = [] } }
  for (const s of specs) {
    if ((!s.style || s.style === 'text') && hasMarkdownTable(s.text)) { flush(); for (const seg of markdownToSegments(s.text)) segments.push(seg) }
    else buf.push(s)
  }
  flush()
  return insertSegments(token, documentId, segments, index)
}

// ─── Embedded spreadsheet (电子表格, block_type 30) ──────────────────────────

/** Split a docx Sheet-block token `{spreadsheetToken}_{sheetId}` on the LAST underscore. */
export function splitSheetToken(token: string): { spreadsheetToken: string; sheetId: string } | null {
  const i = token.lastIndexOf('_')
  if (i <= 0 || i >= token.length - 1) return null
  return { spreadsheetToken: token.slice(0, i), sheetId: token.slice(i + 1) }
}

function colLetter(n: number): string {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

/**
 * Embed a NEW spreadsheet (电子表格) into the document and optionally fill it with `data`.
 * Creating a Sheet block (30) AUTO-creates a fresh spreadsheet; its token comes back as
 * `{spreadsheetToken}_{sheetId}`. The block-create caps at 9×9, so we create within that
 * and write the full data through the Sheets values API (which grows the grid).
 */
export async function insertSheet(token: string, documentId: string, data: string[][] = [], index = 0) {
  const rows = data.length || 5
  const cols = data.length ? Math.max(1, ...data.map((r) => r.length)) : 4
  const created = (await feishuReq(
    'POST',
    `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
    token,
    { index, children: [{ block_type: 30, sheet: { row_size: Math.min(rows, 9), column_size: Math.min(cols, 9) } }] },
  )) as { children?: Array<{ block_id: string; sheet?: { token?: string } }> }
  const block = created.children?.[0]
  const parsed = block?.sheet?.token ? splitSheetToken(block.sheet.token) : null
  // If there's data to write but the embedded-sheet token didn't parse, FAIL LOUDLY — otherwise
  // we'd return a success shape with an empty sheet and the agent would report it as filled.
  if (data.length && !parsed) {
    throw new Error('无法解析嵌入表格 token，数据未写入（请重试或手动填充该表格）')
  }
  if (data.length && parsed) {
    const range = `${parsed.sheetId}!A1:${colLetter(cols)}${rows}`
    await writeRange(token, parsed.spreadsheetToken, range, data)
  }
  return {
    sheet_block_id: block?.block_id ?? null,
    spreadsheet_token: parsed?.spreadsheetToken ?? null,
    sheet_id: parsed?.sheetId ?? null,
    rows, cols,
  }
}

// ─── Embedded Bitable (多维表格, block_type 18) ──────────────────────────────

/** Split a docx Bitable-block token `{appToken}_{tableId}` on the LAST underscore. */
export function splitBitableToken(token: string): { appToken: string; tableId: string } | null {
  const i = token.lastIndexOf('_')
  if (i <= 0 || i >= token.length - 1) return null
  return { appToken: token.slice(0, i), tableId: token.slice(i + 1) }
}

/**
 * Embed a NEW Bitable (多维表格) into the document. Creating a Bitable block (18)
 * AUTO-creates a fresh Base app + table; its token comes back as `{appToken}_{tableId}`.
 * Returns app_token + table_id so the agent can continue operating on the Base
 * with create_field/create_record etc.
 */
export async function insertBitable(token: string, documentId: string, index = 0) {
  const created = (await feishuReq(
    'POST',
    `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
    token,
    { index, children: [{ block_type: 18, bitable: { view_type: 1 } }] },
  )) as { children?: Array<{ block_id: string; bitable?: { token?: string } }> }
  const block = created.children?.[0]
  const parsed = block?.bitable?.token ? splitBitableToken(block.bitable.token) : null
  if (!parsed) {
    throw new Error('无法解析多维表格 token（请重试或手动操作该多维表格）')
  }
  return {
    bitable_block_id: block?.block_id ?? null,
    app_token: parsed.appToken,
    table_id: parsed.tableId,
  }
}

// ─── Callout (高亮块, block_type 19) ─────────────────────────────────────────

/**
 * Insert a Callout (高亮块) with text content. A callout is a container that needs
 * a text child block to carry the content — create the callout, then add a text
 * child under it.
 */
export async function insertCallout(token: string, documentId: string, text: string, index = 0) {
  const created = (await feishuReq(
    'POST',
    `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
    token,
    { index, children: [{ block_type: 19, callout: { background_color: 0, border_color: 0, text_color: 0, emoji_id: '' } }] },
  )) as { children?: Array<{ block_id: string }> }
  const calloutBlockId = created.children?.[0]?.block_id
  if (!calloutBlockId) throw new Error('创建高亮块失败。')
  // Add a text child block under the callout to carry the content.
  await feishuReq(
    'POST',
    `/docx/v1/documents/${documentId}/blocks/${calloutBlockId}/children`,
    token,
    { index: 0, children: [{ block_type: 2, text: { elements: parseInline(text), style: {} } }] },
  )
  return { callout_block_id: calloutBlockId }
}

// ─── Iframe (内嵌网页, block_type 26) ────────────────────────────────────────

/** Insert an Iframe (内嵌网页) block embedding an external URL. */
export function insertIframe(token: string, documentId: string, url: string, index = 0) {
  return feishuReq(
    'POST',
    `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
    token,
    { index, children: [{ block_type: 26, iframe: { component: { type: 1, url: encodeURIComponent(url) } } }] },
  )
}

// ─── Block text update ───────────────────────────────────────────────────────

/**
 * Update an existing text-bearing block's content and style. PATCHes the block with
 * new text elements (parsed for inline bold/italic/code) and a new block_type if the
 * style changes (e.g. text → heading). Use list_blocks first to get the block_id.
 */
export function updateBlockText(
  token: string,
  documentId: string,
  blockId: string,
  text: string,
  style: BlockStyle = 'text',
) {
  const { type, key } = BLOCK_TYPE[style] ?? BLOCK_TYPE.text
  if (key === 'divider' || key === 'image') {
    throw new Error(`${style} 样式不支持 updateBlockText（仅支持文本类块）`)
  }
  const body: Record<string, unknown> = {
    block_type: type,
    [key]: {
      elements: parseInline(text),
      style: style === 'code' ? { language: 1 } : undefined,
    },
  }
  return patchBlock(token, documentId, blockId, body)
}

/** Delete a contiguous range of child blocks [startIndex, endIndex). */
/**
 * 纯：删除范围预校验。飞书 batch_delete 的报错是模糊的 `invalid param`，模型读不懂就容易
 * 盲目重试（实测连弹 4 次确认框）。这里按真实子块数 N 把错误翻译成可自愈的精确信息
 * （"共 N 个、有效索引 0~N-1、你传的是 X/Y"），模型一次就能改对。半开区间 [start, end)。
 */
export function assertValidDeleteRange(
  parentBlockId: string | undefined,
  startIndex: number,
  endIndex: number,
  childCount: number,
): void {
  if (!parentBlockId) {
    throw new Error('delete_document_blocks 需要 parent_block_id（删除文档正文块时填 document_id）。')
  }
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
    throw new Error(`删除范围无效：start_index / end_index 必须是整数，你传的是 start_index=${startIndex}、end_index=${endIndex}。`)
  }
  if (startIndex < 0 || endIndex > childCount || startIndex >= endIndex) {
    throw new Error(
      `删除范围无效：parent=${parentBlockId} 的直接子块共 ${childCount} 个（有效索引 0~${childCount - 1}），` +
      `半开区间 [start_index, end_index) 要求 0 ≤ start < end ≤ ${childCount}。` +
      `你传的是 start_index=${startIndex}、end_index=${endIndex}。请按真实数量修正后再调用（不要原样重试）。`,
    )
  }
}

export function deleteBlocks(
  token: string,
  documentId: string,
  parentBlockId: string,
  startIndex: number,
  endIndex: number
) {
  return feishuReq(
    'DELETE',
    `/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children/batch_delete`,
    token,
    { start_index: startIndex, end_index: endIndex }
  )
}

/** Patch a single block (PATCH /docx/v1/documents/:doc/blocks/:block_id). Used to bind an
 *  uploaded image material to an empty image block via the `replace_image` operation — Step 3
 *  of the official insert-image flow (create empty block → upload to it → PATCH replace_image). */
export function patchBlock(
  token: string,
  documentId: string,
  blockId: string,
  body: Record<string, unknown>
) {
  return feishuReq('PATCH', `/docx/v1/documents/${documentId}/blocks/${blockId}`, token, body)
}
