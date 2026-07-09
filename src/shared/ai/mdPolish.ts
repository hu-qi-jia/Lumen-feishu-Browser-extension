import type { AppSettings } from '../types'
import { chatComplete } from './llm'

/** 单块最大字符数（约 ~4k token，留足上下文余量）。 */
const POLISH_MAX_CHARS = 12000

const POLISH_PROMPT =
  '你是一个 Markdown 清理助手。下面给你一段从 PDF 中抽取的 Markdown，可能存在断句、错位、乱码、破损的表格/列表/标题层级等问题。请：\n' +
  '- 修复上述问题，保证语义通顺，不改变原意。\n' +
  '- 只清理、不补造：不得添加原文没有的内容，不得臆测或编造任何数据。\n' +
  '- 直接输出清理后的 Markdown，不要加任何解释、前言或代码围栏。'

/**
 * 按二级标题（`## `）/ 分页符（`---`）边界把长文档切成 ≤ maxChars 的块；无标题则按长度切。纯函数。
 *
 * 实现要点：
 * - 用前瞻 `(?=^## |^---$)` 在每个标题/分页符 *之前* 切开，标题随其正文进入同一块——
 *   这样每个非空块都以 `## ` 开头（满足"保留章节边界"的语义），且标题不会与正文分离。
 * - `flush` 内做长度兜底：仍超 maxChars 的单段（如无标题的连续长文本）按 maxChars 硬切，
 *   保证返回的每个块都 ≤ maxChars。
 */
export function chunkMarkdown(md: string, maxChars = POLISH_MAX_CHARS): string[] {
  if (!(md ?? '').length) return []
  if (md.length <= maxChars) return [md]
  const parts = md.split(/(?=^## |^---$)/m)
  const chunks: string[] = []
  let buf = ''
  const flush = () => {
    if (!buf) return
    for (let i = 0; i < buf.length; i += maxChars) chunks.push(buf.slice(i, i + maxChars))
    buf = ''
  }
  for (const p of parts) {
    if ((buf + p).length > maxChars && buf) { flush(); buf = p }
    else buf += p
  }
  flush()
  return chunks
}

/**
 * 纯文本润色：复用 chatComplete（自动适配 OpenAI / Anthropic 格式）。
 * 文本进、文本出，无需视觉模型。长文档自动分块、逐块润色后用空行拼接。失败由上层降级到 rawMd。
 */
export async function polishMarkdown(settings: AppSettings, rawMd: string): Promise<string> {
  const chunks = chunkMarkdown(rawMd)
  const out: string[] = []
  for (const chunk of chunks) {
    const text = await chatComplete(settings, chunk, POLISH_PROMPT)
    if (!text) throw new Error('模型未返回内容。')
    out.push(text)
  }
  return out.join('\n\n')
}
