/**
 * 本地、确定性的 Markdown 后处理，专治 pdf2md 的两类系统性毛病。无 AI、无网络——纯启发式：
 *   1. debreak     — pdf2md 按列宽把段落软折行，在句中插入单个 \n。这里把折行并回上一行
 *                     （中文直接连，拉丁/数字边界补一个空格）。标题、列表、引用、表格、
 *                     分隔线、代码块——一律不合并。
 *   2. squeezeBlank — 3+ 连续空行压成一个空行（段落分隔）。
 * 两者幂等：跑两次 == 跑一次。
 */
export interface CleanOpts { debreak?: boolean; squeezeBlank?: boolean }
export const DEFAULT_CLEAN: Required<CleanOpts> = { debreak: true, squeezeBlank: true }

/** 行首是块级元素（标题/列表/引用/代码围栏/分隔线/表格行）→ 不与前一行合并。 */
const BLOCK_START = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|---|\*\*\*|___|\|)/
/** 独占一行的 Setext 下划线或分隔线。 */
const RULE_LINE = /^\s*(-{3,}|={3,}|\*{3,}|_{3,})\s*$/

function isAsciiWord(c: string): boolean { return /[A-Za-z0-9]/.test(c) }

/** 仅在拉丁/数字边界补空格；中—中、中—拉 连接保持紧贴（pdf2md 本来就没有多余空格）。 */
function joinerBetween(prevTrim: string, curTrim: string): string {
  const a = prevTrim.slice(-1)
  const b = curTrim[0] ?? ''
  return isAsciiWord(a) && isAsciiWord(b) ? ' ' : ''
}

export function cleanMarkdown(md: string, opts: CleanOpts = {}): string {
  if (!md) return ''
  const o: Required<CleanOpts> = { ...DEFAULT_CLEAN, ...opts }
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let inFence = false
  let fenceMarker = ''

  for (const raw of lines) {
    const fence = raw.match(/^\s{0,3}(```|~~~)/)
    if (fence) {
      if (!inFence) { inFence = true; fenceMarker = fence[1] }
      else if (fence[1] === fenceMarker) { inFence = false; fenceMarker = '' }
      out.push(raw); continue
    }
    if (inFence) { out.push(raw); continue }

    if (o.debreak && out.length > 0) {
      const prev = out[out.length - 1]
      const prevTrim = prev.trim()
      const curTrim = raw.trim()
      if (
        prevTrim !== '' && curTrim !== '' &&
        !BLOCK_START.test(prev) && !BLOCK_START.test(raw) &&
        !RULE_LINE.test(raw)
      ) {
        out[out.length - 1] = prev.replace(/\s+$/, '') + joinerBetween(prevTrim, curTrim) + curTrim
        continue
      }
    }
    out.push(raw)
  }

  let result = out.join('\n')
  if (o.squeezeBlank) result = result.replace(/\n{3,}/g, '\n\n')
  return result
}
