/**
 * PDF → Markdown 统一入口（纯本地、无 AI）。
 *
 * 基于 pdfjs-dist 直接实现文本+图片提取，绕过 pdf2md 的启发式黑盒。
 * 三大问题修复：
 *   1. 断句   — textExtract.ts 自行分行 + 段落合并（标点/行间距启发式）
 *   2. 空白   — clean.ts 的 dropEmptyParagraphs 删除纯空行
 *   3. 图片   — imageExtract.ts 遍历操作符提取内嵌图片为 dataURL
 *
 * Worker 化：pdfjs-dist 在 Web Worker 中解析，不卡 UI。
 */
import * as pdfjsLib from 'pdfjs-dist'
import type { TextItem, PageContent, ExtractedImage } from './types'
import { groupIntoLines } from './textExtract'
import { extractPageImages } from './imageExtract'
import { buildBlocks, blocksToMarkdown } from './layout'
import { cleanPdfMarkdown } from './clean'

// 配置 Worker（Vite 会处理 ?url 导入）
// 注意：pdfjs-dist v4 的 worker 是 .mjs 格式
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface ScanResult { likelyScan: boolean; reason: string }

/** 启发式：抽取文本几乎为空 → 扫描件/纯图片 PDF。 */
export function detectScan(rawMd: string, minChars = 20): ScanResult {
  const chars = (rawMd ?? '').replace(/\s+/g, '').length
  const likelyScan = chars < minChars
  return {
    likelyScan,
    reason: likelyScan ? `未检测到文本层（仅 ${chars} 字，可能是扫描件/纯图片 PDF）` : '',
  }
}

/** 把 pdfjs 错误映射为用户可读的友好错误。 */
export function classifyPdfError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  if (/password|encrypt|decrypt|permission/i.test(msg)) {
    return new Error('PDF 受密码保护或损坏，无法解析')
  }
  return new Error(`PDF 解析失败：${msg}`)
}

/** 从 PDF ArrayBuffer 提取 Markdown（主入口）。 */
export async function extractMarkdown(buffer: ArrayBuffer): Promise<string> {
  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
    const pages: PageContent[] = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1 })

      // 文本提取
      const textContent = await page.getTextContent()
      const items = textContent.items
        .filter((it): it is { str: string; transform: number[]; width: number; height: number; fontName?: string; hasEOL?: boolean } =>
          'str' in it && typeof (it as { str: unknown }).str === 'string',
        )
        .map((it) => ({
          str: it.str,
          transform: it.transform,
          width: it.width,
          height: it.height,
          fontName: it.fontName,
          hasEOL: it.hasEOL,
        })) as TextItem[]

      const lines = groupIntoLines(items, i)

      // 图片提取（需要先触发一次渲染以填充 page.objs）
      // 用一个最小 scale 的 OffscreenCanvas 渲染，仅为触发图片对象加载
      let images: ExtractedImage[] = []
      try {
        // 渲染到 OffscreenCanvas 以触发图片对象加载
        const minViewport = page.getViewport({ scale: 0.1 })
        const canvas = new OffscreenCanvas(minViewport.width, minViewport.height)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport: minViewport }).promise
        }
        images = await extractPageImages(page, i)
      } catch {
        // 图片提取失败不阻断文本提取
      }

      pages.push({ page: i, lines, images })
      // viewport 未使用但保留以备多栏检测
      void viewport
    }

    // 合并所有页的 lines + images，统一构建 blocks
    const allLines = pages.flatMap((p) => p.lines)
    const allImages = pages.flatMap((p) => p.images)
    const blocks = buildBlocks(allLines, allImages)
    const md = blocksToMarkdown(blocks, true)

    await pdf.destroy()
    return cleanPdfMarkdown(md)
  } catch (e) {
    throw classifyPdfError(e)
  }
}
