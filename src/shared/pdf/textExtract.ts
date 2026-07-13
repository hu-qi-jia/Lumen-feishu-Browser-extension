/**
 * 文本提取：从 pdfjs 的 getTextContent() 结果重建行与段落。
 *
 * pdf2md 的启发式按字号/Y 坐标分组，断句常错。这里自行实现：
 *   1. groupIntoLines    — 按 Y 坐标容差分行
 *   2. mergeIntoParagraphs — 按行间距 + 标点启发式合并软折行
 *
 * 纯函数、无 IO、无 AI——可单测。
 */
import type { TextItem, TextLine } from './types'

/** 行尾标点（中英文）。用于判断是否软折行——有标点说明是句子结束，不合并。 */
const END_PUNCT = /[。！？；，、：．…）》」』\]\)!?,;:.]$/
/** 行首大写字母或数字——说明是新句子的开头，不与上一行合并。 */
const START_UPPER = /^[A-Z0-9"'（(\[【]/
/** 列表标记：行首是 - * + 或 数字. 或 中文序号。 */
const LIST_START = /^\s*([-*+]\s+|\d+[.)]\s+|[（(][\d一二三四五六七八九十]+[)）]\s+|[①②③④⑤⑥⑦⑧⑨⑩]\s+)/
/** 标题启发式：纯数字编号（1 / 1.1 / 1.1.1）或全大写短行。 */
const NUM_HEADING = /^(\d+(?:\.\d+)*)\s+(.+)$/
const ALL_UPPER = /^[A-Z][A-Z\s\-:]{2,}$/
/** 表格标题行：表 X-Y 后跟标题文字。不应被误判为表格行。 */
const TABLE_TITLE_RE = /^表\s*\d+[-－‐]\s*\d+/

/**
 * 将 pdfjs 的 TextItem 数组按 Y 坐标分行。
 * 同一 Y 容差内（默认 2pt）的 item 归为同一行；行内按 X 坐标排序。
 */
export function groupIntoLines(items: TextItem[], page: number, yTolerance = 2): TextLine[] {
  if (!items.length) return []
  // 按 Y 降序（PDF 坐标系 Y 向上，但文本阅读顺序从上到下 → Y 大的在上方）
  // 先按 Y 分组，再按 X 排序
  const sorted = [...items].sort((a, b) => {
    const ya = a.transform[5]
    const yb = b.transform[5]
    if (Math.abs(ya - yb) > yTolerance) return yb - ya // Y 大的在前（页面上方）
    return a.transform[4] - b.transform[4] // 同行按 X 升序
  })

  const lines: TextLine[] = []
  let curItems: TextItem[] = []
  let curY = sorted[0].transform[5]

  for (const item of sorted) {
    const y = item.transform[5]
    if (curItems.length && Math.abs(y - curY) > yTolerance) {
      lines.push(mergeItemsToLine(curItems, page, curY))
      curItems = [item]
      curY = y
    } else {
      curItems.push(item)
    }
  }
  if (curItems.length) lines.push(mergeItemsToLine(curItems, page, curY))
  return lines
}

/** 将同一行的 TextItem 合并为一个 TextLine。 */
function mergeItemsToLine(items: TextItem[], page: number, y: number): TextLine {
  const text = items
    .map((it) => it.str)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const fontSize = Math.max(...items.map((it) => it.height || 0)) || 10
  const x = Math.min(...items.map((it) => it.transform[4]))
  // 字体名：取出现最多的
  const fontNames = items.map((it) => it.fontName).filter(Boolean) as string[]
  const fontName = fontNames.length ? mostFrequent(fontNames) : undefined
  return { text, y, x, fontSize, fontName, page }
}

function mostFrequent<T>(arr: T[]): T {
  const counts = new Map<T, number>()
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = arr[0], bestCount = 0
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c }
  return best
}

/**
 * 检测一行是否可能是表格行。
 * 与 layout.ts 的 isTableRow 保持一致逻辑，但这里用于段落合并前的预检测。
 *
 * 两种模式：
 *   1. 2+ 空格分隔的多列
 *   2. 单空格分隔的短词序列（>= 4 个短词，每个 <= 12 字符）
 */
function isTableRowLike(text: string): boolean {
  if (LIST_START.test(text) || NUM_HEADING.test(text)) return false
  if (TABLE_TITLE_RE.test(text)) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  // 模式 1：2+ 空格分隔
  if (trimmed.split(/\s{2,}/).filter((s) => s.length > 0).length >= 2) return true
  // 模式 2：单空格分隔的短词序列
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0)
  if (words.length >= 4) {
    const shortWords = words.filter((w) => w.length <= 12)
    if (shortWords.length / words.length >= 0.8) return true
  }
  return false
}

/**
 * 标记表格行组：连续 2+ 行匹配 isTableRowLike → 标记为表格行。
 * 返回一个 Set，包含所有属于表格组的行索引。
 */
function detectTableGroups(lines: TextLine[]): Set<number> {
  const tableIndices = new Set<number>()
  let i = 0
  while (i < lines.length) {
    if (isTableRowLike(lines[i].text)) {
      const start = i
      while (i < lines.length && isTableRowLike(lines[i].text)) i++
      if (i - start >= 2) {
        for (let j = start; j < i; j++) tableIndices.add(j)
      }
    } else {
      i++
    }
  }
  return tableIndices
}

/**
 * 将行合并为段落。
 *
 * 规则：
 *   - 表格行：强制独立成段（不参与软折行合并，保留原始行结构供 layout.ts 识别）
 *   - 行间距 > 1.8 * avgFontSize → 新段落
 *   - 当前行是列表/标题起始 → 新段落
 *   - 上一行以标点结尾 → 新段落（不合并）
 *   - 当前行以大写字母/数字开头 → 新段落
 *   - 否则：软折行合并到上一行（中文紧贴，拉丁边界补空格）
 */
export function mergeIntoParagraphs(lines: TextLine[]): string[] {
  if (!lines.length) return []
  const avgFontSize = lines.reduce((s, l) => s + l.fontSize, 0) / lines.length
  const tableIndices = detectTableGroups(lines)
  const paragraphs: string[] = []
  let cur = ''
  let prevY = lines[0].y

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    // 表格行：强制独立成段
    if (tableIndices.has(idx)) {
      if (cur) { paragraphs.push(cur); cur = '' }
      paragraphs.push(line.text)
      prevY = line.y
      continue
    }
    const gap = prevY - line.y
    const isListOrHeading = LIST_START.test(line.text) || NUM_HEADING.test(line.text) || ALL_UPPER.test(line.text)
    const endsWithPunct = END_PUNCT.test(cur)
    const startsUpper = START_UPPER.test(line.text)
    const newParagraph = cur === ''
      || gap > 1.8 * avgFontSize
      || isListOrHeading
      || endsWithPunct
      || startsUpper

    if (newParagraph) {
      if (cur) paragraphs.push(cur)
      cur = line.text
    } else {
      cur = cur + joinerBetween(cur, line.text) + line.text
    }
    prevY = line.y
  }
  if (cur) paragraphs.push(cur)
  return paragraphs
}

/** 拉丁/数字边界补空格；中文紧贴。 */
function joinerBetween(prev: string, cur: string): string {
  const a = prev.slice(-1)
  const b = cur[0] ?? ''
  if (!a || !b) return ''
  const isAsciiWord = (c: string) => /[A-Za-z0-9]/.test(c)
  return isAsciiWord(a) && isAsciiWord(b) ? ' ' : ''
}

/** 从一页的 TextItem 数组提取段落文本。 */
export function extractParagraphsFromItems(items: TextItem[], page: number): string[] {
  const lines = groupIntoLines(items, page)
  return mergeIntoParagraphs(lines)
}
