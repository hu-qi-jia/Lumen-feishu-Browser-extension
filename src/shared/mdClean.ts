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

// ─── Heading-level normalization (decimal-numbered outlines) ────────────────

/** A `#`-heading line whose title text begins with a decimal section number, e.g. `## 2.1 Setup`. */
const HEADING_NUM = /^(#{1,6})\s+(\d+(?:\.\d+)*)\s+(\S.*)$/

/**
 * Re-level decimal-numbered section headings by their numbering depth.
 *
 * pdf2md detects headings by font size but can't tell LEVELS apart when the font gaps are small,
 * so it flattens a whole numbered outline to one level — "2 Method", "2.1 Setup", "2.1.1
 * Participants" all come out as `##`. The decimal numbering itself encodes the hierarchy:
 * dot-depth → heading level (2 → `#`, 2.1 → `##`, 2.1.1 → `###`). Re-leveling restores distinct
 * levels in the preview AND in the inserted Feishu doc (which has h1–h3).
 *
 * Safety — no false positives, because we only ever FIX a level pdf2md already assigned:
 *  • Only lines pdf2md ALREADY marked as headings (start with `#`) are touched — we re-level them,
 *    never invent a heading out of body text or a `1. …` list item.
 *  • A single-part number (2, 3) is treated as a chapter only when the document also contains a
 *    deeper `2.x` sub-section, so an unrelated `## 10 Best Practices` (no 10.x anywhere) is left
 *    exactly as-is.
 * Lines inside code fences are skipped. Idempotent.
 */
export function normalizeHeadingLevels(md: string): string {
  if (!md) return ''
  const lines = md.replace(/\r\n?/g, '\n').split('\n')

  // Pass 1 — collect decimal section numbers that begin a #-heading's title.
  const found: Array<{ idx: number; num: string; depth: number; title: string }> = []
  let inFence = false
  let fenceMarker = ''
  lines.forEach((raw, idx) => {
    const fence = raw.match(/^\s{0,3}(```|~~~)/)
    if (fence) {
      if (!inFence) { inFence = true; fenceMarker = fence[1] }
      else if (fence[1] === fenceMarker) { inFence = false; fenceMarker = '' }
      return
    }
    if (inFence) return
    const m = raw.match(HEADING_NUM)
    if (m) found.push({ idx, num: m[2], depth: m[2].split('.').length, title: m[3] })
  })

  // Chapter roots = the first segment of every multi-part section number present (2.1, 2.1.1 → "2").
  // A bare "2" is only a chapter when a "2.x" sub-section exists; otherwise leave it untouched.
  const chapterRoots = new Set<string>()
  for (const f of found) if (f.depth >= 2) chapterRoots.add(f.num.split('.')[0])

  // Pass 2 — re-level in place. Markdown caps at 6 `#`; the renderer + Feishu clamp 4–6 down to h3.
  for (const f of found) {
    const level = f.depth >= 2 ? f.depth : chapterRoots.has(f.num) ? 1 : -1
    if (level < 0) continue
    lines[f.idx] = '#'.repeat(Math.min(level, 6)) + ' ' + f.num + ' ' + f.title
  }
  return lines.join('\n')
}
