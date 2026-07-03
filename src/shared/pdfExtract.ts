import pdf2md from '@opendocsg/pdf2md'

/**
 * PDF → Markdown 抽取（本地、浏览器内，基于 pdf2md / pdf.js）。
 * 无出站：pdf2md 完全在设备上解析 PDF。
 *
 * v1 在主线程运行（Web Worker 延后 Phase 2 —— 见 plan DEV-v1-1）。
 */

export interface ScanResult { likelyScan: boolean; reason: string }

/** 启发式：抽取文本几乎为空 → 该 PDF 是扫描件/纯图片，pdf2md 没拿到可用文本层。
 *  扫描件返回近乎 0 字；真实文档返回大量字符。阈值 `minChars`（默认 20）按非空白字符总数。 */
export function detectScan(rawMd: string, minChars = 20): ScanResult {
  const chars = (rawMd ?? '').replace(/\s+/g, '').length
  const likelyScan = chars < minChars
  return {
    likelyScan,
    reason: likelyScan ? `未检测到文本层（仅 ${chars} 字，可能是扫描件/纯图片 PDF），pdf2md 无法提取` : '',
  }
}

/** 把 pdf2md 抛出的错误映射为用户可读的友好错误。导出以便单测直接覆盖（异步 reject
 *  集成路径不在 vitest 下测——mock 的 reject 会被 vitest 记为 unhandled rejection，
 *  见 vision.test.ts 同款处理）。 */
export function classifyPdfError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  if (/password|encrypt|decrypt|permission/i.test(msg)) {
    return new Error('PDF 受密码保护或损坏，无法解析')
  }
  return new Error(`PDF 解析失败：${msg}`)
}

/** Strip HTML comments (e.g. pdf2md's `<!-- PAGE_BREAK -->` markers) so they don't leak into the
 *  preview or the editable markdown source. Non-greedy, spans newlines. Exported for unit testing. */
export function stripHtmlComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '')
}

/** 从 PDF 字节抽取 markdown。加密/损坏 → 抛友好错误（由上层捕获展示）。 */
export async function extractMarkdown(buffer: ArrayBuffer): Promise<string> {
  try {
    const text = await pdf2md(new Uint8Array(buffer))
    return typeof text === 'string' ? stripHtmlComments(text) : ''
  } catch (e) {
    throw classifyPdfError(e)
  }
}
