/**
 * 布局重建：将 TextLine + ExtractedImage 组装为 Block 列表，再输出 Markdown。
 *
 * 职责：
 *   1. 标题检测（按字号 > avg * 1.3，或数字编号）
 *   2. 列表检测（行首 - * + 或 数字.）
 *   3. 图片插入（按 Y 坐标插入到对应文本位置）
 *   4. 多栏检测（启发式：若左半页和右半页各有独立文本列，按列分别输出）
 *
 * 纯函数、无 IO、无 AI。
 */
import type { TextLine, ExtractedImage, Block } from './types'

/** 行首列表标记。 */
const LIST_RE = /^\s*([-*+]\s+|\d+[.)]\s+|[（(][\d一二三四五六七八九十]+[)）]\s+|[①②③④⑤⑥⑦⑧⑨⑩]\s+)/
/** 数字编号标题：1 / 1.1 / 1.1.1。 */
const NUM_HEADING_RE = /^(\d+(?:\.\d+)*)\s+(.+)$/

/** 检测标题级别。返回 0 = 非标题，1-6 = 标题级别。 */
function detectHeadingLevel(line: TextLine, avgFontSize: number, maxFontSize: number): number {
  // 数字编号标题：按点深度定级
  const numMatch = line.text.match(NUM_HEADING_RE)
  if (numMatch) {
    const depth = numMatch[1].split('.').length
    return Math.min(depth + 1, 6) // 1 → ##, 1.1 → ###, 1.1.1 → ####
  }
  // 字号标题：字号 > avg * 1.3 且行较短（< 60 字）
  if (line.fontSize > avgFontSize * 1.3 && line.text.length < 60 && line.text.trim()) {
    // 按字号比例定级
    const ratio = line.fontSize / maxFontSize
    if (ratio > 0.95) return 1
    if (ratio > 0.85) return 2
    return 3
  }
  return 0
}

/** 按连续 2+ 空格分割为列。用于表格检测。 */
function splitIntoColumns(text: string): string[] {
  return text.split(/\s{2,}/).map((s) => s.trim()).filter((s) => s.length > 0)
}

/** 表格标题行：表 X-Y 后跟标题文字。不应被误判为表格行。 */
const TABLE_TITLE_RE = /^表\s*\d+[-－‐]\s*\d+/

/**
 * 检测一行是否可能是表格行。
 *
 * 仅按 2+ 空格分隔检测多列。单空格分隔的短词序列不可靠——
 * 中文 PDF 常在字间插入空格（如"作 者 胡起嘉"），英文标题
 * 也是单空格短词序列（如"Lightweight Design and Service System"），
 * 这些都不是表格行。
 *
 * 排除：列表行、数字编号标题行、表格标题行（表 X-Y ...）
 */
function isTableRow(text: string): boolean {
  if (LIST_RE.test(text) || NUM_HEADING_RE.test(text)) return false
  if (TABLE_TITLE_RE.test(text)) return false
  const trimmed = text.trim()
  if (!trimmed) return false

  // 2+ 空格分隔的多列
  return splitIntoColumns(trimmed).length >= 2
}

/** 将表格行组转为 Markdown pipe 表格。仅按 2+ 空格分列；无 2+ 空格的行整行作为单个单元格。 */
function rowsToTable(rows: TextLine[]): string {
  const colRows = rows.map((r) => {
    const multi = splitIntoColumns(r.text)
    return multi.length >= 2 ? multi : [r.text.trim()]
  })
  const maxCols = Math.max(...colRows.map((r) => r.length))
  const aligned = colRows.map((r) => {
    while (r.length < maxCols) r.push('')
    return r
  })
  const header = `| ${aligned[0].join(' | ')} |`
  const separator = `| ${aligned[0].map(() => '---').join(' | ')} |`
  const body = aligned.slice(1).map((r) => `| ${r.join(' | ')} |`)
  return [header, separator, ...body].join('\n')
}

/**
 * 将行 + 图片组装为 Block 列表（按 Y 坐标从上到下排序）。
 * 包含表格检测：连续 2+ 行有 2+ 列（多空格分隔）→ pipe 表格。
 */
export function buildBlocks(lines: TextLine[], images: ExtractedImage[]): Block[] {
  if (!lines.length && !images.length) return []

  const avgFontSize = lines.length
    ? lines.reduce((s, l) => s + l.fontSize, 0) / lines.length
    : 10
  const maxFontSize = lines.length ? Math.max(...lines.map((l) => l.fontSize)) : 10

  // 先过滤空行，保留索引映射
  const nonEmpty = lines.filter((l) => l.text.trim() !== '')

  // 检测表格组：连续的 isTableRow 行
  const tableGroups: { start: number; end: number }[] = []
  let i = 0
  while (i < nonEmpty.length) {
    if (isTableRow(nonEmpty[i].text)) {
      const start = i
      while (i < nonEmpty.length && isTableRow(nonEmpty[i].text)) i++
      if (i - start >= 2) tableGroups.push({ start, end: i - 1 })
    } else {
      i++
    }
  }

  // 标记哪些行属于表格
  const inTable = new Set<number>()
  for (const g of tableGroups) {
    for (let j = g.start; j <= g.end; j++) inTable.add(j)
  }

  // 将行转为 Block
  const lineBlocks: Block[] = []
  for (let j = 0; j < nonEmpty.length; j++) {
    const line = nonEmpty[j]
    if (inTable.has(j)) {
      // 表格行：找到所属组，整组转为一个 table Block
      const group = tableGroups.find((g) => j >= g.start && j <= g.end)
      if (group && j === group.start) {
        const rows = nonEmpty.slice(group.start, group.end + 1)
        lineBlocks.push({
          text: rowsToTable(rows), y: line.y, x: line.x,
          kind: 'table' as const, page: line.page,
        })
      }
      // 非 start 行跳过（已合并到 table Block）
      continue
    }
    const level = detectHeadingLevel(line, avgFontSize, maxFontSize)
    const isList = LIST_RE.test(line.text)
    if (level > 0) {
      lineBlocks.push({ text: `${'#'.repeat(level)} ${line.text}`, y: line.y, x: line.x, kind: 'heading' as const, level, page: line.page })
    } else if (isList) {
      lineBlocks.push({ text: line.text, y: line.y, x: line.x, kind: 'list' as const, page: line.page })
    } else {
      lineBlocks.push({ text: line.text, y: line.y, x: line.x, kind: 'paragraph' as const, page: line.page })
    }
  }

  // 将图片转为 Block
  const imageBlocks: Block[] = images.map((img) => ({
    text: `![image-p${img.page}-${Math.round(img.x)}-${Math.round(img.y)}](${img.dataUrl})`,
    y: img.y,
    x: img.x,
    kind: 'image' as const,
    page: img.page,
  }))

  // 合并并按 (page, y 降序, x 升序) 排序
  const all = [...lineBlocks, ...imageBlocks].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page
    if (Math.abs(a.y - b.y) > 5) return b.y - a.y
    return a.x - b.x
  })

  return all
}

/**
 * 检测多栏布局。
 *
 * 启发式：若页面宽度 > 500pt 且文本 X 坐标明显分两簇（左簇 x < pageWidth/2，
 * 右簇 x > pageWidth/2），且两簇各有 > 3 行 → 判定双栏。
 *
 * 当前实现：仅检测，不做分栏重组（多栏 PDF 较少，先标记）。
 */
export function detectMultiColumn(lines: TextLine[], pageWidth: number): boolean {
  if (pageWidth < 500 || lines.length < 8) return false
  const midX = pageWidth / 2
  const left = lines.filter((l) => l.x < midX)
  const right = lines.filter((l) => l.x >= midX)
  return left.length >= 4 && right.length >= 4
}

/**
 * 将 Block 列表转为 Markdown 文本。
 *
 * 规则：
 *   - heading: 前后空行
 *   - paragraph: 前后空行
 *   - list: 连续的 list 项之间不空行，与其他块之间空行
 *   - image: 前后空行
 *   - 页间：插入 --- 分隔线（不丢弃页边界信息）
 */
export function blocksToMarkdown(blocks: Block[], pageBreaks = true): string {
  if (!blocks.length) return ''

  const parts: string[] = []
  let prevPage = blocks[0].page
  let prevKind = ''

  for (const block of blocks) {
    // 页间分隔：用 HTML 注释标记（Markdown 渲染器会 strip 掉，不显示）
    // 不用 --- 因为会与表格分隔线 | --- | 和水平线冲突
    if (pageBreaks && block.page !== prevPage) {
      parts.push('\n\n<!-- page break -->\n\n')
      prevKind = ''
    }

    // 块间空行规则
    if (prevKind && prevKind !== 'list') {
      parts.push('\n\n')
    } else if (prevKind === 'list' && block.kind !== 'list') {
      parts.push('\n\n')
    } else if (prevKind === 'list' && block.kind === 'list') {
      parts.push('\n')
    }

    parts.push(block.text)
    prevPage = block.page
    prevKind = block.kind
  }

  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}
