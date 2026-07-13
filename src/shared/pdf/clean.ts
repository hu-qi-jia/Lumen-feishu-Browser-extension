/**
 * 清洗：dropEmptyParagraphs + squeezeBlank。
 *
 * 与 mdClean.ts 的区别：
 *   - dropEmptyParagraphs：删除纯空白行（仅含空格/制表符），解决空白占位符问题
 *   - squeezeBlank：复用 mdClean.ts 的 3+ 空行压缩
 *   - 不做 debreak（新方案在 textExtract.ts 已处理软折行）
 *   - 不做 normalizeHeadingLevels（新方案在 layout.ts 已处理标题层级）
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
 * 统一清洗：dropEmptyParagraphs → squeezeBlank。
 * 幂等。
 */
export function cleanPdfMarkdown(md: string): string {
  if (!md) return ''
  let result = dropEmptyParagraphs(md)
  // 复用 mdClean.ts 的 squeezeBlank（debreak 关闭，新方案不需要）
  result = cleanMarkdown(result, { debreak: false, squeezeBlank: true })
  return result
}
