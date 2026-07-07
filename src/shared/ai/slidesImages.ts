import type { Slide } from './slides'

export interface SlideImage {
  id: string
  source: 'doc' | 'upload'
  label: string
  dataUrl: string
  context?: string
}

export function resolveImage(images: SlideImage[], id?: string): SlideImage | undefined {
  if (!id) return undefined
  return images.find((i) => i.id === id)
}

/** Remap 【图{n}】 markers: local n → map[n-1] (global). Unmapped n left as-is. */
export function remapMarkers(text: string, map: number[]): string {
  return text.replace(/【图(\d+)】/g, (_m, d) => {
    const n = Number(d)
    return map[n - 1] != null ? `【图${map[n - 1]}】` : `【图${n}】`
  })
}

/** Remove 【图{n}】 markers for the given (local) numbers from text. */
export function stripMarkers(text: string, locals: number[]): string {
  const set = new Set(locals)
  return text.replace(/【图(\d+)】/g, (m, d) => (set.has(Number(d)) ? '' : m))
}

const textOf = (el: unknown): string => {
  // 提取 text_run.content / headingN.elements 等
  const e = (el as { elements?: Array<{ text_run?: { content?: string } }> })?.elements
  if (!Array.isArray(e)) return ''
  return e.map((x) => String(x?.text_run?.content ?? '')).join('')
}

/** Walk a docx block list → readable text with 【图n】 markers at image-block positions,
 *  plus per-image {token, context = nearest preceding heading + the text line right before it}.
 *  The richer context (heading | preceding line) lets both the model and the post-gen placement
 *  pass match each image to the page that actually discusses it. Pure. */
export function serializeDocBlocks(items: unknown[]): { text: string; images: Array<{ token: string; context: string }> } {
  const lines: string[] = []
  const images: Array<{ token: string; context: string }> = []
  let lastHeading = ''
  let lastText = ''
  let imgIdx = 0
  for (const raw of items) {
    const b = raw as { block_type?: number; [k: string]: unknown }
    if (!b || typeof b.block_type !== 'number') continue
    switch (b.block_type) {
      case 2: { // text
        const t = textOf(b.text); if (t) { lastText = t; lines.push(t) } break
      }
      case 3: case 4: case 5: { // heading1-3
        const t = textOf((b as Record<string, unknown>)[`heading${b.block_type - 2}`])
        // A new heading starts a section — clear lastText so an image right under it doesn't
        // inherit the preceding section's text as its context.
        if (t) { lastHeading = t; lastText = ''; lines.push(`${'#'.repeat(b.block_type - 2)} ${t}`) }
        break
      }
      case 12: case 13: { // bullet / ordered
        const t = textOf((b as Record<string, unknown>)[b.block_type === 12 ? 'bullet' : 'ordered'])
        if (t) { lastText = t; lines.push(`- ${t}`) }; break
      }
      case 27: { // image
        const img = (b as { image?: { token?: string } }).image
        const token = typeof img?.token === 'string' ? img.token : ''
        if (token) {
          imgIdx++
          lines.push(`【图${imgIdx}】`)
          const ctx = [lastHeading, lastText].filter(Boolean).join('｜')
          images.push({ token, context: ctx })
        }
        break
      }
      default: break // tables(31)/sheet(30)/etc skipped
    }
  }
  return { text: lines.join('\n'), images }
}

// Reference Slide type so the import is retained for downstream tasks without creating a cycle.
export type { Slide }

// --- harvestDocImages (Task 7): parallel download + compress of doc images ---
import { downloadMedia } from '../feishu/media'
import { compressImageToDataUrl } from '../attachments'

/** Cap parallel image downloads to avoid hammering the API. */
const DL_CONCURRENCY = 10
/** Hard cap images per deck — high enough to capture all images in typical docs. */
export const MAX_DOC_IMAGES = 60

/** Download + compress all doc images in parallel (capped). Failed images are skipped
 *  (returned in failedTokens + failures) — the caller strips their 【图n】 markers from text.
 *
 *  IDs are PROVISIONAL: doc-{i+1} where i is the index in the input list. Survivors keep
 *  their provisional id (gaps left where downloads failed) so the caller can run the LLM
 *  generation in parallel against a provisional id pool and reconcile afterwards.
 *
 *  Each failure is classified (`http` / `decode` / `other`) and warned to the console, so a
 *  recurring download problem can actually be diagnosed. The previous `catch {}` swallowed the
 *  error entirely — which is why "some images fail" stayed unfixable. */
export type ImageFailReason = 'http' | 'decode' | 'other'

export async function harvestDocImages(args: {
  userToken: string
  docImages: Array<{ token: string; context: string }>
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}): Promise<{ images: SlideImage[]; failedTokens: string[]; failures: Array<{ reason: ImageFailReason; detail: string }> }> {
  const list = args.docImages.slice(0, MAX_DOC_IMAGES)
  const total = list.length
  const results: Array<{ ok: true; img: SlideImage } | { ok: false; token: string; reason: ImageFailReason; detail: string }> = []
  let cursor = 0, done = 0

  function classifyFailure(detail: string): ImageFailReason {
    if (/图片下载失败|网络|请求|fetch|timeout|超时|\b4\d{2}\b|\b5\d{2}\b/i.test(detail)) return 'http'
    if (/图片加载失败|加载|decode|解码|canvas|toDataURL|无法创建/i.test(detail)) return 'decode'
    return 'other'
  }

  async function worker(): Promise<void> {
    while (cursor < list.length) {
      const my = cursor++
      const { token, context } = list[my]
      try {
        if (args.signal?.aborted) return
        const blob = await downloadMedia(token, args.userToken)
        const dataUrl = await compressImageToDataUrl(blob, { longEdge: 1024, quality: 0.8 })
        results[my] = { ok: true, img: { id: `doc-${my + 1}`, source: 'doc', label: `文档图${my + 1}`, dataUrl, context } }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        const reason = classifyFailure(detail)
        results[my] = { ok: false, token, reason, detail }
        console.warn(`[slides] 文档图${my + 1} 下载失败 [${reason}]: ${detail} (token …${token.slice(-6)})`)
      }
      done++
      args.onProgress?.(done, total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(DL_CONCURRENCY, total) }, () => worker()))

  const images: SlideImage[] = []
  const failedTokens: string[] = []
  const failures: Array<{ reason: ImageFailReason; detail: string }> = []
  for (const r of results) {
    if (r?.ok) images.push(r.img)
    else if (r) { failedTokens.push(r.token); failures.push({ reason: r.reason, detail: r.detail }) }
  }
  return { images, failedTokens, failures }
}
