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

/**
 * 将行 + 图片组装为 Block 列表（按 Y 坐标从上到下排序）。
 */
export function buildBlocks(lines: TextLine[], images: ExtractedImage[]): Block[] {
  if (!lines.length && !images.length) return []

  const avgFontSize = lines.length
    ? lines.reduce((s, l) => s + l.fontSize, 0) / lines.length
    : 10
  const maxFontSize = lines.length ? Math.max(...lines.map((l) => l.fontSize)) : 10

  // 将行转为 Block
  const lineBlocks: Block[] = lines
    .filter((l) => l.text.trim() !== '')
    .map((line) => {
      const level = detectHeadingLevel(line, avgFontSize, maxFontSize)
      const isList = LIST_RE.test(line.text)
      if (level > 0) {
        return { text: `${'#'.repeat(level)} ${line.text}`, y: line.y, x: line.x, kind: 'heading' as const, level, page: line.page }
      }
      if (isList) {
        return { text: line.text, y: line.y, x: line.x, kind: 'list' as const, page: line.page }
      }
      return { text: line.text, y: line.y, x: line.x, kind: 'paragraph' as const, page: line.page }
    })

  // 将图片转为 Block
  const imageBlocks: Block[] = images.map((img) => ({
    text: `![image-p${img.page}-${Math.round(img.x)}-${Math.round(img.y)}](${img.dataUrl})`,
    y: img.y,
    x: img.x,
    kind: 'image' as const,
    page: img.page,
  }))

  // 合并并按 (page, y 降序, x 升序) 排序
  // Y 降序 = 页面上方在前（PDF 坐标系 Y 向上）
  const all = [...lineBlocks, ...imageBlocks].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page
    if (Math.abs(a.y - b.y) > 5) return b.y - a.y // Y 大的在前
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
    // 页间分隔
    if (pageBreaks && block.page !== prevPage) {
      parts.push('\n---\n')
      prevKind = ''
    }

    // 块间空行规则
    if (prevKind && prevKind !== 'list') {
      // 非 list 之后都加空行
      parts.push('\n\n')
    } else if (prevKind === 'list' && block.kind !== 'list') {
      // list → 非 list 加空行
      parts.push('\n\n')
    } else if (prevKind === 'list' && block.kind === 'list') {
      // list → list 不加空行（连续列表项）
      parts.push('\n')
    }

    parts.push(block.text)
    prevPage = block.page
    prevKind = block.kind
  }

  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}
