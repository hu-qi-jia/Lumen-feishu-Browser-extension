/**
 * 清洗：dropEmptyParagraphs + dropPageNumbers + dropRepeatingHeaders + normalizeFormulaChars + squeezeBlank。
 *
 * 与 mdClean.ts 的区别：
 *   - dropEmptyParagraphs：删除纯空白行（仅含空格/制表符），解决空白占位符问题
 *   - dropPageNumbers：删除独立纯数字行（页码 58/59/60…）
 *   - dropRepeatingHeaders：删除在分页符附近重复出现的短行（页眉/页脚）
 *   - normalizeFormulaChars：将 Unicode 数学斜体字符（𝐴𝑐𝑐、𝐺𝑦𝑟、∆𝑌𝑎𝑤）转为 ASCII
 *   - squeezeBlank：复用 mdClean.ts 的 3+ 空行压缩
 */
import { cleanMarkdown } from '../mdClean'

/** 结构性行：表格、代码围栏、标题、分隔线——即使内容为空也保留。 */
function isStructuralLine(line: string): boolean {
  return (
    /^\s*\|.*\|/.test(line) || // 表格行
    /^\s*```/.test(line) ||    // 代码围栏
    /^\s*#{1,6}\s/.test(line) || // 标题
    /^\s*---\s*$/.test(line) ||  // 分隔线
    /^\s*!\[/.test(line)         // 图片
  )
}

/**
 * 删除纯空白段落（仅含空格/制表符的行），保留结构性行。
 * 解决 pdf2md 方案中"图片页/装饰页残留空段落"的空白占位符问题。
 */
export function dropEmptyParagraphs(md: string): string {
  if (!md) return ''
  return md
    .split('\n')
    .filter((line) => line.trim() !== '' || isStructuralLine(line))
    .join('\n')
}

/**
 * 删除独立纯数字行（页码）。
 * 匹配仅含 1-3 位数字的行，如 "58"、"69"、"123"。
 * 不匹配：含其他字符的行、4+ 位数字（可能是年份/编号）。
 */
export function dropPageNumbers(md: string): string {
  if (!md) return ''
  return md
    .split('\n')
    .filter((line) => !/^\s*\d{1,3}\s*$/.test(line))
    .join('\n')
}

/**
 * 删除在分页符（---）附近重复出现的短行（页眉/页脚）。
 *
 * 启发式：按 --- 分割为"页"，检查每页第一行/最后行是否在多页中重复出现。
 * 若某行出现 >= 2 次（长度 <= 30），删除所有页中的该行。
 */
export function dropRepeatingHeaders(md: string): string {
  if (!md) return ''
  const pages = md.split(/\n*---\n*/)
  if (pages.length < 3) return md

  const firstLines = pages.map((p) => p.trim().split('\n')[0]?.trim() ?? '')
  const lastLines = pages.map((p) => {
    const lines = p.trim().split('\n')
    return lines[lines.length - 1]?.trim() ?? ''
  })

  const firstCounts = new Map<string, number>()
  const lastCounts = new Map<string, number>()
  for (const line of firstLines) {
    if (line && line.length <= 30) firstCounts.set(line, (firstCounts.get(line) ?? 0) + 1)
  }
  for (const line of lastLines) {
    if (line && line.length <= 30) lastCounts.set(line, (lastCounts.get(line) ?? 0) + 1)
  }

  const headers = new Set<string>()
  const footers = new Set<string>()
  for (const [line, count] of firstCounts) if (count >= 2) headers.add(line)
  for (const [line, count] of lastCounts) if (count >= 2) footers.add(line)

  if (!headers.size && !footers.size) return md

  const cleanedPages = pages.map((p) => {
    const lines = p.split('\n')
    while (lines.length && headers.has(lines[0].trim())) lines.shift()
    while (lines.length && footers.has(lines[lines.length - 1].trim())) lines.pop()
    return lines.join('\n')
  })

  return cleanedPages.join('\n---\n')
}

/**
 * 将 Unicode 数学斜体/粗体字符规范化为 ASCII。
 *
 * PDF 中的公式常使用 Mathematical Alphanumeric Symbols（U+1D400-U+1D7FF），
 * 如 𝐴𝑐𝑐、𝐺𝑦𝑟、∆𝑌𝑎𝑤。这些字符在 Markdown 中显示不正确且难以编辑。
 */
export function normalizeFormulaChars(md: string): string {
  if (!md) return ''
  let result = md
  // 数学斜体大写 A-Z: U+1D434-U+1D44D（连续）
  result = result.replace(/[\u{1D434}-\u{1D44D}]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1D434 + 0x41))
  // 数学斜体小写 a-g: U+1D44E-U+1D454
  result = result.replace(/[\u{1D44E}-\u{1D454}]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1D44E + 0x61))
  // 数学斜体小写 i-z: U+1D456-U+1D467（跳过 h=U+1D455 保留位）
  result = result.replace(/[\u{1D456}-\u{1D467}]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1D456 + 0x69))
  // ℎ (U+210E, Planck constant) → h
  result = result.replace(/\u{210E}/gu, 'h')
  // 数学粗体大写 A-Z: U+1D400-U+1D419
  result = result.replace(/[\u{1D400}-\u{1D419}]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1D400 + 0x41))
  // 数学粗体小写 a-z: U+1D41A-U+1D433
  result = result.replace(/[\u{1D41A}-\u{1D433}]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1D41A + 0x61))
  // 数学粗斜体大写 A-Z: U+1D468-U+1D481
  result = result.replace(/[\u{1D468}-\u{1D481}]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1D468 + 0x41))
  // 数学粗斜体小写 a-z: U+1D482-U+1D49B
  result = result.replace(/[\u{1D482}-\u{1D49B}]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1D482 + 0x61))
  // ∆ (U+2206) → Δ
  result = result.replace(/\u{2206}/gu, 'Δ')
  return result
}

/**
 * 统一清洗管线。
 * 顺序：公式规范化 → 页码删除 → 页眉删除 → 空行删除 → squeezeBlank。
 * 幂等。
 */
export function cleanPdfMarkdown(md: string): string {
  if (!md) return ''
  let result = normalizeFormulaChars(md)
  result = dropPageNumbers(result)
  result = dropRepeatingHeaders(result)
  result = dropEmptyParagraphs(result)
  result = cleanMarkdown(result, { debreak: false, squeezeBlank: true })
  return result
}
