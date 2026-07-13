import type { AppSettings } from '../types'
import type { VizField } from '../dataviz/types'
import { stripFences as fences } from './text'
import { sanitizeForLlm } from './redact'
import { chatCompleteStream } from './llm'
import type { Material } from './slidesSources'
import type { SourceRef } from './slidesStore'
import type { SlideImage } from './slidesImages'
import { remapMarkers, harvestDocImages, MAX_DOC_IMAGES } from './slidesImages'
import { resolveToken } from '../feishu/auth'

/**
 * AI 幻灯片 (PPT) — turn Feishu content into a multi-page slide deck. The model returns only
 * CONTENT (per-slide titles/bullets/…); the sandbox's reliable `ui.slides` helper renders the paged
 * presentation. Link-driven: `runMaterialsToSlides` synthesizes ONE deck across N pasted doc/table
 * links (the Slides panel's path). `generateSlidesFromData` is retained for the demo panel.
 * `sanitizeSlides` / `adjustSlide` are shared by both. Read-only; the produced artifact is JSON.
 */

/** One slide. `layout` picks how the sandbox renders it; fields are content the model fills. */
export interface Slide {
  layout?: 'title' | 'section' | 'bullets' | 'two-col' | 'quote' | 'stats' | 'chart' | 'embed'
    | 'cover' | 'cards' | 'image-split' | 'timeline'
  title?: string
  subtitle?: string
  eyebrow?: string
  bullets?: string[]
  bullets2?: string[]
  quote?: string
  by?: string
  stats?: Array<{ num?: string; label?: string }>
  /** layout:'chart' — a self-contained ECharts option (numbers embedded; rendered via ui.chart). */
  chart?: Record<string, unknown>
  /** layout:'embed' — a saved 看板's render code, re-run live against the table's rows. */
  code?: string
  /** layout:'embed' — Plan B: a saved board's declarative spec (no-remote-code builds). */
  spec?: import('../dataviz/spec').VizSpec
  cards?: Array<{ title?: string; body?: string; num?: string; image?: string }>
  image?: string
  imageSide?: 'left' | 'right'
  imageCaption?: string
  /** layout:'timeline' — an ordered sequence of steps/milestones rendered on a connecting rail. */
  steps?: Array<{ title?: string; body?: string }>
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '')).filter((s) => s.trim()).slice(0, 7) : [] // ≤7 bullets/page

/** Coerce model output into safe, well-formed slides (ui.slides also tolerates gaps, but trim here). */
export function sanitizeSlides(raw: unknown): Slide[] {
  if (!Array.isArray(raw)) return []
  const out: Slide[] = []
  for (const r0 of raw) {
    if (!r0 || typeof r0 !== 'object') continue
    const r = r0 as Record<string, unknown>
    const layout = (['title', 'section', 'bullets', 'two-col', 'quote', 'stats', 'chart', 'embed', 'cover', 'cards', 'image-split', 'timeline'] as const)
      .find((l) => l === r.layout) ?? 'bullets'
    const s: Slide = { layout }
    if (typeof r.title === 'string') s.title = r.title.slice(0, 120)
    if (typeof r.subtitle === 'string') s.subtitle = r.subtitle.slice(0, 200)
    if (typeof r.quote === 'string') s.quote = r.quote.slice(0, 400)
    if (typeof r.by === 'string') s.by = r.by.slice(0, 80)
    if (typeof r.eyebrow === 'string') s.eyebrow = r.eyebrow.slice(0, 40)
    if (typeof r.imageCaption === 'string') s.imageCaption = r.imageCaption.slice(0, 80)
    if (r.imageSide === 'left' || r.imageSide === 'right') s.imageSide = r.imageSide
    // Trim before storing: the pool ids are exact, so a model-returned " img_3" must become "img_3"
    // or resolveImage() silently fails to match and the image slot renders blank.
    if (typeof r.image === 'string') {
      const img = r.image.trim().slice(0, 60)
      if (img) s.image = img
    }
    if (r.bullets) s.bullets = arr(r.bullets)
    if (r.bullets2) s.bullets2 = arr(r.bullets2)
    if (Array.isArray(r.stats)) {
      s.stats = (r.stats as unknown[]).slice(0, 6).map((t) => {
        const o = (t ?? {}) as Record<string, unknown>
        return { num: String(o.num ?? '').slice(0, 24), label: String(o.label ?? '').slice(0, 60) }
      })
    }
    if (Array.isArray(r.cards)) {
      s.cards = (r.cards as unknown[]).slice(0, 6).map((c) => {
        const o = (c ?? {}) as Record<string, unknown>
        const card: NonNullable<Slide['cards']>[number] = {}
        if (typeof o.title === 'string') card.title = o.title.slice(0, 60)
        if (typeof o.body === 'string') card.body = o.body.slice(0, 160)
        if (typeof o.num === 'string') card.num = o.num.slice(0, 24)
        if (typeof o.image === 'string') {
          const img = o.image.trim().slice(0, 60)
          if (img) card.image = img
        }
        return card
      })
    }
    if (Array.isArray(r.steps)) {
      s.steps = (r.steps as unknown[]).slice(0, 6).map((c) => {
        const o = (c ?? {}) as Record<string, unknown>
        const step: NonNullable<Slide['steps']>[number] = {}
        if (typeof o.title === 'string') step.title = o.title.slice(0, 60)
        if (typeof o.body === 'string') step.body = o.body.slice(0, 140)
        return step
      }).filter((st) => st.title || st.body)
    }
    // A chart slide carries a self-contained ECharts option object (data inside).
    if (layout === 'chart' && r.chart && typeof r.chart === 'object') s.chart = r.chart as Record<string, unknown>
    // An embed slide carries a saved 看板's render code, OR (no-remote-code / Plan B) a declarative
    // VizSpec rendered by the bundled interpreter. Preserve whichever is present so a deck survives
    // re-sanitisation without losing its embedded board.
    if (layout === 'embed' && typeof r.code === 'string') s.code = r.code
    if (layout === 'embed' && r.spec && typeof r.spec === 'object') s.spec = r.spec as Slide['spec']
    // Drop empty/no-content slides (nothing to show).
    if (s.title || s.subtitle || s.quote || s.bullets?.length || s.bullets2?.length || s.stats?.length || s.cards?.length || s.steps?.length || s.chart || s.code || s.spec || s.image) out.push(s)
  }
  return out.slice(0, 24)
}

/** Adjust ONE slide per a natural-language instruction (e.g. "这页改成饼图" / "精简为 3 条"). The
 *  model returns the revised single slide; the rest of the deck is untouched. */
export async function adjustSlide(
  settings: AppSettings,
  input: { slide: Slide; instruction: string; signal?: AbortSignal },
): Promise<Slide> {
  const content =
    `下面是一套演示里的【某一页幻灯片】(JSON)。请按【调整要求】只修改这一页，保持信息忠实、不要编造。\n` +
    `可选 layout：title / section / bullets / two-col / quote / stats / chart；字段：title、subtitle、bullets[]、bullets2[]、quote、by、stats[{num,label}]、chart(自包含 ECharts 配置对象)。\n` +
    `可以改 layout、文字、要点，或把数据这页改成 chart（图表）。文字精炼（标题≤20 字、要点≤30 字）。\n` +
    `只输出修改后的【单个幻灯片 JSON 对象】，不要数组、不要解释、不要代码围栏。\n` +
    `【当前这页】\n${JSON.stringify(input.slide)}\n【调整要求】${input.instruction}`
  const out = fences(await chatCompleteStream(settings, content, { signal: input.signal }))
  if (!out) throw new Error('模型未返回内容。')
  let parsed: unknown
  try { parsed = JSON.parse(out) } catch { throw new Error('调整结果解析失败，请重试或换种说法。') }
  const [s] = sanitizeSlides([parsed])
  if (!s) throw new Error('调整后这页没有可用内容，请换种说法重试。')
  return s
}

/** Adjust a WHOLE deck per a natural-language instruction (e.g. "第3页改饼图" / "所有标题精简到
 *  6 字"). The model sees every page (numbered), decides which to change, and returns the full
 *  revised deck — untouched pages are preserved. One call vs N for per-page adjustSlide, and it
 *  understands page references in plain language (no separate page-picker UI needed). */
export async function adjustDeck(
  settings: AppSettings,
  input: { slides: Slide[]; images?: SlideImage[]; instruction: string; signal?: AbortSignal },
): Promise<Slide[]> {
  const pool = input.images ?? []
  const numbered = input.slides.map((s, i) => `${i + 1}. ${JSON.stringify(s)}`).join('\n')
  const layoutLine = pool.length
    ? `可选 layout：title / section / bullets / two-col / quote / stats / chart / cover / cards / image-split / timeline`
    : `可选 layout：title / section / bullets / two-col / quote / stats / chart / timeline（无可用图片，禁止 cover 背景图 / image-split）`
  const imageLine = pool.length
    ? `\n【可用图片】\n${pool.map((im) => `- ${im.id}（${im.label}）`).join('\n')}\n把图片放到指定页时：把该页 image 改为此 id，layout 改为 image-split（或 cover/cards），可用 imageSide 控制左右。\n`
    : ``
  const content =
    `下面是一套完整的演示幻灯片（JSON 数组，共 ${input.slides.length} 页，已标注页码）。请按【修改要求】修改其中需要改的页，**没有明确提到的页必须原样保留**。\n` +
    `修改要求里可能用自然语言指代页码或范围（如"第3页"、"封面"、"第5-7页"、"每页"、"全部"），由你判断该改哪些页；也可能指代某张图片（按其 label）。\n` +
    `${layoutLine}；字段：title、subtitle、eyebrow、bullets[]、bullets2[]、quote、by、stats、chart、cards[]、steps[]、image、imageSide、imageCaption。\n` +
    `可以改 layout、文字、要点，或把某页改成 chart / image-split。文字精炼（标题≤20 字、要点≤30 字）。\n` +
    `只输出修改后的【完整 slides JSON 数组】（必须包含所有页、顺序不变，包括没改的），不要解释、不要代码围栏。\n` +
    `【当前幻灯片】\n${numbered}\n${imageLine}【修改要求】${input.instruction}`
  const out = fences(await chatCompleteStream(settings, content, { signal: input.signal }))
  if (!out) throw new Error('模型未返回内容。')
  let parsed: unknown
  try { parsed = JSON.parse(out) } catch { throw new Error('修改结果解析失败，请重试或换种说法。') }
  const slides = sanitizeSlides(parsed)
  if (!slides.length) throw new Error('修改后没有可用内容，请换种说法重试。')
  return slides
}

// ─── 单表 → PPT（demo panel 用；正式流程走下面的多资料路径）──────────────────────

const fieldList = (schema: VizField[]) =>
  schema.map((f) => `${f.name}（${f.type}）${f.samples?.length ? `｜样本: ${f.samples.join(', ')}` : ''}`).join('\n')

function buildDataSlidesPrompt(schema: VizField[], sampleRows: Record<string, string>[], request?: string): string {
  return (
    `你是顶尖的演示设计师 + 数据分析师。把下面这张表（飞书多维表格 / 电子表格）做成一套【可翻页的幻灯片 PPT】，向他人汇报这张表的内容与发现。\n` +
    `输出一个 JSON 对象：{"title":"演示标题","slides":[ 每张幻灯片一个对象 ]}。按内容给每张选 layout：\n` +
    `  · {"layout":"title","title":"主标题","subtitle":"一句话主旨"} —— 仅第 1 张封面\n` +
    `  · {"layout":"section","title":"章节名","subtitle":"可选小字"} —— 章节分隔\n` +
    `  · {"layout":"bullets","title":"小标题","bullets":["要点",...]} —— 概览 / 维度说明 / 发现，每页 3–6 条\n` +
    `  · {"layout":"two-col","title":"小标题","bullets":[...],"bullets2":[...]} —— 对比 / 分组\n` +
    `  · {"layout":"stats","title":"小标题","stats":[{"num":"123","label":"说明"},...]} —— 关键数字\n` +
    `  · {"layout":"timeline","title":"小标题","steps":[{"title":"阶段一","body":"一句话说明"},...]} —— 流程 / 路线图 / 阶段演进（3–6 步）\n` +
    `  · {"layout":"chart","title":"小标题","chart":{完整 ECharts 配置对象}} —— **数据维度优先用图表展示**（分布/占比→饼或柱、趋势→折线、排名→条形），这样才像真正的 PPT。chart 必须是自包含 ECharts option：把从【样本数据】里数出来 / 算出来的数字直接写进 series.data，类目写进 xAxis.data 或 pie 的 name；类型只用 bar / line / pie / scatter；不设 backgroundColor。\n` +
    `  · {"layout":"quote","quote":"结论","by":"可选"} —— 重点结论 / 建议收尾\n` +
    `【内容建议】封面 → 这张表在跟踪什么（字段含义）→ **用 1–3 张 chart 展示主要分布 / 占比 / 排名 / 趋势** → 值得注意的模式 → 结论 / 建议。\n` +
    `【诚实硬规则】**只用下面【样本数据】里能直接数出来 / 算出来的数字**；样本可能不是全部行，凡涉及数量请措辞为「样本中…」，**绝不编造精确总数或比例**；只用真实存在的字段名；不确定的用定性要点而非假数字。\n` +
    `【要求】8–16 张（最多 24）；第 1 张必须是 title 封面；文字精炼（标题≤20 字、要点≤30 字）；中文。\n` +
    (request?.trim() ? `【用户额外要求】${request.trim()}\n` : '') +
    `只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n\n【字段】\n${fieldList(schema)}\n\n【样本数据（前 ${sampleRows.length} 行）】\n${sanitizeForLlm(JSON.stringify(sampleRows))}`
  )
}

export async function generateSlidesFromData(
  settings: AppSettings,
  input: { schema: VizField[]; sampleRows: Record<string, string>[]; request?: string; signal?: AbortSignal; onProgress?: (chars: number) => void },
): Promise<{ name: string; slides: Slide[] }> {
  const out = fences(await chatCompleteStream(settings, buildDataSlidesPrompt(input.schema, input.sampleRows, input.request), {
    signal: input.signal, onChunk: (f) => input.onProgress?.(f.length),
  }))
  if (!out) throw new Error('模型未返回内容。')
  let parsed: { title?: string; slides?: unknown }
  try { parsed = JSON.parse(out) } catch { throw new Error('幻灯片解析失败，请重试或换一个支持 JSON 输出的模型。') }
  const slides = sanitizeSlides(parsed.slides)
  if (!slides.length) throw new Error('没有生成可用的幻灯片内容。')
  return { name: String(parsed.title || '数据演示').slice(0, 40), slides }
}

// ─── 多链接 → PPT（link-driven, 综合 N 份文档/表格资料）──────────────────────────

const MATERIAL_DOC_BUDGET = 16000
const MATERIAL_TABLE_SAMPLE = 50

/** Per-doc char budget when several docs share a deck — even split with a 2k floor so one huge
 *  doc can't crowd out the others. */
function docBudgetEach(docCount: number): number {
  return docCount ? Math.max(2000, Math.floor(MATERIAL_DOC_BUDGET / docCount)) : 0
}

function buildMaterialsPrompt(materials: Material[], request?: string, themeHint?: string, pool: SlideImage[] = []): string {
  const docs = materials.filter((m): m is Extract<Material, { kind: 'doc' }> => m.kind === 'doc')
  const perDoc = docBudgetEach(docs.length)
  const blocks = materials.map((m, i) => {
    if (m.kind === 'doc') {
      const over = m.text.length > perDoc
      return `【资料${i + 1}｜文档《${m.label}》】\n${m.text.slice(0, perDoc)}${over ? `\n…（已截取前 ${perDoc} 字）` : ''}`
    }
    const flds = m.schema.map((f) => `${f.name}（${f.type}）${f.samples?.length ? `｜样本: ${f.samples.join(', ')}` : ''}`).join('\n')
    const sample = m.sampleRows.slice(0, MATERIAL_TABLE_SAMPLE)
    const kindLabel = m.kind === 'base' ? '多维表格' : '表格'
    return `【资料${i + 1}｜${kindLabel}《${m.label}》】\n字段：\n${flds}\n样本数据（前 ${sample.length} 行，可能非全部）:\n${sanitizeForLlm(JSON.stringify(sample))}`
  })
  const layoutLine =
    pool.length
      ? `可选 layout：title / section / bullets / two-col / quote / stats / chart / **cover / cards / image-split**（cover/image-split 需配图）/ timeline`
      : `可选 layout：title / section / bullets / two-col / quote / stats / chart / timeline（本次没有可用图片，**禁止使用 cover 背景图 / image-split 等需要图片的版式**）`
  const fieldsLine = pool.length
    ? `字段：title、subtitle、eyebrow、bullets[]、bullets2[]、quote、by、stats[{num,label}]、chart、cards[{title,body,num,image}]、steps[{title,body}]、image(图片id)、imageSide(left|right)、imageCaption。`
    : `字段：title、subtitle、eyebrow、bullets[]、bullets2[]、quote、by、stats[{num,label}]、chart、steps[{title,body}]。`
  const imageLine = pool.length
    ? `\n【可用图片（image 字段填这些 id 之一）】\n${pool.map((im) => `- ${im.id}（${im.source === 'doc' ? '文档图' : '用户上传'}·${im.label}${im.context ? `·上下文:${im.context}` : ''}）`).join('\n')}\n**文档图必须按上下文落到对应页**：正文里的【图n】就是该图在原文的位置——讲到那段内容的那一页要用 image-split（image 填该图 id），让图与讲解同页。不要把多张图堆在同一页，**也不要漏掉任何一张文档图（每张文档图至少出现一次）**。上传图只在用户明确要求放到某页时使用。图片说明从其上下文推断，不要编造。\n`
    : ``
  return (
    `你是顶尖的演示设计师 + 数据分析师。下面有 ${materials.length} 份资料（文档 / 表格），请综合它们做成一套【可翻页的幻灯片 PPT】，向他人讲清楚这些资料的整体内容、关键发现与结论。\n` +
    `输出一个 JSON 对象：{"title":"演示标题","slides":[ 每张幻灯片一个对象 ]}。${layoutLine}\n` +
    `  · {"layout":"title","title":"主标题","subtitle":"一句话主旨"} —— 仅第 1 张封面\n` +
    `  · {"layout":"section","title":"章节名","subtitle":"可选小字"} —— 章节分隔\n` +
    `  · {"layout":"bullets","eyebrow":"可选小标","title":"小标题","bullets":["要点",...]} —— 概览 / 维度说明 / 发现，每页 3–6 条\n` +
    `  · {"layout":"two-col","title":"小标题","bullets":[...],"bullets2":[...]} —— 对比 / 分组\n` +
    `  · {"layout":"stats","title":"小标题","stats":[{"num":"123","label":"说明"},...]} —— 关键数字\n` +
    `  · {"layout":"cards","title":"小标题","cards":[{"title":"","body":"","num":"","image":""},...]} —— 卡片网格\n` +
    `  · {"layout":"timeline","title":"小标题","steps":[{"title":"阶段一","body":"一句话说明"},...]} —— 流程 / 路线图 / 里程碑 / 演进时间线（3–6 步，按顺序）\n` +
    `  · {"layout":"image-split","title":"","image":"图片id","imageSide":"left|right","bullets":[...]} —— 图文左右\n` +
    `  · {"layout":"chart","title":"小标题","chart":{完整 ECharts 配置对象}} —— **数据维度优先用图表展示**（分布/占比→饼或柱、趋势→折线、排名→条形）。chart 必须是自包含 ECharts option：把【样本数据】里数出来的数字直接写进 series.data，类目写进 xAxis.data 或 pie 的 name；类型只用 bar / line / pie / scatter；不设 backgroundColor。\n` +
    `  · {"layout":"quote","quote":"结论","by":"可选"} —— 重点结论 / 收尾\n` +
    `${fieldsLine}\n` +
    `【诚实硬规则】**只用上面资料里能直接读到 / 数出来的数字**；表格样本可能不是全部行，凡涉及数量请措辞为「样本中…」，**绝不编造精确总数或比例**；只用真实存在的字段名；不确定的用定性要点而非假数字。\n` +
    `【要求】约 8–16 张（视内容长短，最多 24 张；每页一个主题）；第 1 张必须是 **title 封面**，且**封面页（第 1 页）禁止任何图片**——不要用 cover 背景图、不要把 image-split 放在第 1 页，所有图片从第 2 页起再用；文字精炼（标题≤20 字、要点≤30 字）；用中文。\n` +
    `【视觉风格】${themeHint || '商务克制：结论先行、要点精炼、避免装饰。'}\n` +
    `【内容预算】画布固定 1920×1080 且不滚动：每页只承载一个主题。\n` +
    (request?.trim() ? `【用户额外要求】${request.trim()}\n` : '') +
    imageLine +
    `只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n\n${blocks.join('\n\n')}`
  )
}

export interface MaterialsSlidesResult {
  name: string
  slides: Slide[]
  images: SlideImage[]
  truncated: boolean
  sources: SourceRef[]
  /** Doc images that were attempted but failed to download — surfaced so the UI can explain why
   *  fewer images than the doc contains appear in the pool/tray. */
  imgFailed: number
  /** Human-readable breakdown of why images failed (e.g. "2 网络错误·1 解码失败"). Empty when
   *  nothing failed or when the reason is unclassified. */
  imgFailedDetail?: string
}

/** Turn classified image failures into a compact Chinese summary for the UI. Pure. Tolerates a
 *  missing list (the test seam / future alt fetchers may return only {images, failedTokens}). */
export function summarizeImageFailures(failures: Array<{ reason: string }> | undefined): string {
  if (!failures?.length) return ''
  const labels: Record<string, string> = { http: '网络/接口', decode: '解码', other: '其他' }
  const counts: Record<string, number> = {}
  for (const f of failures) counts[f.reason] = (counts[f.reason] ?? 0) + 1
  return Object.entries(counts)
    .map(([k, v]) => `${v} ${labels[k] ?? k}`)
    .join('·')
}

/** Guarantee EVERY doc image appears in the deck. Two passes:
 *  1) The model is told to place each 【图n】 on its context page, but it sometimes skips images.
 *     Any still-unreferenced doc image whose (heading + preceding text) context overlaps a text
 *     slide (bullets/two-col) is injected there — converted to image-split so the image renders.
 *  2) Anything still unreferenced (no textual match anywhere — e.g. an image whose context didn't
 *     survive into any slide) is collected into `cards` gallery page(s), 6/page, so NO doc image is
 *     ever dropped. The gallery is inserted before the final slide when that slide is a closing
 *     quote/section, otherwise appended. Upload images are placed only on explicit user
 *     instruction, so they're left alone. Pure. */
export function placeDocImages(slides: Slide[], images: SlideImage[]): Slide[] {
  const docImgs = images.filter((i) => i.source === 'doc')
  if (!docImgs.length || !slides.length) return slides

  // Only bullets/two-col slides convert to image-split cleanly (their title+bullets map to the
  // text side). stats/chart/cover would lose content, so they're skipped as placement targets.
  const PLACEABLE = new Set(['bullets', 'two-col'])
  const textOf = (s: Slide): string =>
    [s.title, s.subtitle, s.eyebrow, ...(s.bullets ?? []), ...(s.bullets2 ?? [])].filter(Boolean).join(' ')
  const toks = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1))

  const placed = new Set<string>()
  for (const s of slides) {
    if (s.image) placed.add(s.image)
    s.cards?.forEach((c) => { if (c.image) placed.add(c.image) })
  }
  const rows = slides.map((s) => ({ s, toks: toks(textOf(s)) }))

  // Pass 1 — best textual match onto a bullets/two-col page. The cover (slide 0) is never a
  // placement target — see stripFirstPageImage; the first page must stay image-free.
  for (const img of docImgs) {
    if (placed.has(img.id)) continue
    const imgTok = toks(`${img.context ?? ''} ${img.label}`)
    let best = -1, bestScore = -1
    for (let i = 0; i < rows.length; i++) {
      if (i === 0) continue                                // never place on the cover
      if (rows[i].s.image) continue                        // already carries an image
      if (!PLACEABLE.has(rows[i].s.layout ?? 'bullets')) continue
      let score = 0
      for (const t of imgTok) if (rows[i].toks.has(t)) score++
      if (score > bestScore) { bestScore = score; best = i }
    }
    if (best < 0 || bestScore <= 0) continue               // no textual match → defer to pass 2
    const o = rows[best].s
    const bullets = [...(o.bullets ?? []), ...(o.bullets2 ?? [])]
    rows[best].s = {
      layout: 'image-split',
      title: o.title, eyebrow: o.eyebrow, subtitle: o.subtitle,
      bullets: bullets.length ? bullets : undefined,
      image: img.id, imageSide: 'right',
    }
    placed.add(img.id)
    rows[best].toks = toks(textOf(rows[best].s))           // now image-bearing (one image/page)
  }

  let out = rows.map((r) => r.s)

  // Pass 2 — every still-unreferenced doc image goes into gallery page(s) so none is dropped.
  const remaining = docImgs.filter((i) => !placed.has(i.id))
  if (remaining.length) {
    const pages: Slide[] = []
    for (let i = 0; i < remaining.length; i += 6) {
      const batch = remaining.slice(i, i + 6)
      pages.push({
        layout: 'cards',
        title: pages.length === 0 ? '附：文档图片' : undefined,
        cards: batch.map((im) => ({ image: im.id, title: (im.context || im.label).slice(0, 60) })),
      })
    }
    const last = out[out.length - 1]
    const beforeLast = !!last && (last.layout === 'quote' || last.layout === 'section')
    out = beforeLast ? [...out.slice(0, -1), ...pages, last] : [...out, ...pages]
  }
  return out
}

/** Drop slide.image / card.image references that point to images which failed to download
 *  (or were hallucinated by the model). image-split degrades to bullets (text side survives),
 *  cover degrades to title, cards just lose the image. Pure mutation of the passed array.
 *
 *  Exists because download runs in parallel with generation: the model is given a provisional
 *  pool (all doc image ids promised), and some ids later turn out to have no dataUrl. */
function stripFailedImageRefs(slides: Slide[], validIds: Set<string>): Slide[] {
  const ok = (id?: string): boolean => !id || validIds.has(id)
  for (const s of slides) {
    if (s.image && !ok(s.image)) {
      if (s.layout === 'image-split') {
        s.layout = 'bullets'
        delete s.image; delete s.imageSide; delete s.imageCaption
      } else if (s.layout === 'cover') {
        s.layout = 'title'
        delete s.image
      } else {
        delete s.image
      }
    }
    if (s.cards) {
      for (const c of s.cards) if (c.image && !ok(c.image)) delete c.image
    }
  }
  return slides
}

/** The cover/title page (slide 0) must carry NO image. The model is told to make page 1 a plain
 *  `title` cover, but it sometimes returns `cover` with a background image or even an `image-split`
 *  at index 0. This strips any image there so the rule holds regardless of model behaviour:
 *  image-split → bullets (its text side survives), cover → title, cards → each card loses its
 *  image, anything else just drops `image`. Run BEFORE placeDocImages so a doc image that lived only
 *  on the cover gets re-placed onto a content page (or the gallery) instead of being lost.
 *  Pure mutation of the passed array. */
export function stripFirstPageImage(slides: Slide[]): Slide[] {
  if (!slides.length) return slides
  const s = slides[0]
  if (s.image) {
    if (s.layout === 'image-split') {
      s.layout = 'bullets'
      delete s.image; delete s.imageSide; delete s.imageCaption
    } else if (s.layout === 'cover') {
      s.layout = 'title'
      delete s.image
    } else {
      delete s.image
    }
  }
  if (s.cards) for (const c of s.cards) delete c.image
  return slides
}

/** Generate one deck synthesized from N resolved+materials (docs + tables). No embed slides —
 *  embed (saved-board) reuse is a current-table concept that doesn't apply to multi-link input.
 *
 *  Performance: image download and LLM generation run IN PARALLEL. The model only needs image
 *  ids + contexts (not dataUrls) for the prompt, so a provisional pool (doc-1..doc-N) is handed
 *  to the LLM immediately; the real downloads happen concurrently. Afterwards, any image id the
 *  model referenced that didn't survive download is stripped from the slides. */
export async function runMaterialsToSlides(
  settings: AppSettings,
  materials: Material[],
  request?: string,
  opts?: {
    signal?: AbortSignal
    onProgress?: (chars: number) => void
    themeHint?: string
    onImageProgress?: (done: number, total: number) => void
    /** Test seam + future alt sources. Default: harvestDocImages. */
    imageFetcher?: typeof harvestDocImages
  },
): Promise<MaterialsSlidesResult> {
  // 1) 聚合 doc imageTokens，分配全局 provisional 编号并 remap 正文里的【图n】
  const fetch = opts?.imageFetcher ?? harvestDocImages
  const docs = materials.filter((m): m is Extract<Material, { kind: 'doc' }> => m.kind === 'doc')
  const perDoc = docBudgetEach(docs.length)

  const globalDocImages: Array<{ token: string; context: string }> = []
  for (const m of docs) {
    const local = m.imageTokens ?? []
    if (!local.length) continue
    const base = globalDocImages.length
    const map = local.map((_, i) => base + i + 1) // local i (1-based) → global provisional
    globalDocImages.push(...local)
    m.text = remapMarkers(m.text, map)
  }
  const capped = globalDocImages.slice(0, MAX_DOC_IMAGES)

  // 2) provisional 池（id + context，不含 dataUrl）给 LLM；真实下载并行进行
  const provisionalPool: SlideImage[] = capped.map((c, i) => ({
    id: `doc-${i + 1}`, source: 'doc', label: `文档图${i + 1}`, dataUrl: '', context: c.context,
  }))

  // 3) 并行：下载图片 + LLM 生成
  //    resolveToken is only needed for the real harvester (network); an injected imageFetcher
  //    is a test seam that ignores the token, so skip the (settings-dependent) resolve in that case.
  const useRealFetcher = fetch === harvestDocImages
  const token = useRealFetcher ? await resolveToken(settings) : ''
  const downloadP: Promise<{ images: SlideImage[]; failedTokens: string[]; failures: Array<{ reason: string; detail: string }> }> = capped.length
    ? fetch({ userToken: token, docImages: capped, signal: opts?.signal, onProgress: opts?.onImageProgress })
    : Promise.resolve({ images: [], failedTokens: [], failures: [] })
  const llmP: Promise<string> = chatCompleteStream(settings, buildMaterialsPrompt(materials, request, opts?.themeHint, provisionalPool), {
    signal: opts?.signal, onChunk: (f) => opts?.onProgress?.(f.length),
  })
  const [harvested, out] = await Promise.all([downloadP, llmP])

  if (!out) throw new Error('模型未返回内容。')
  let parsed: { title?: string; slides?: unknown }
  try { parsed = JSON.parse(out) } catch { throw new Error('幻灯片解析失败，请重试或换一个支持 JSON 输出的模型。') }

  // 4) 剥离指向失败/幻觉图片的引用 → 清空封面页图片 → 补全未被引用的文档图
  const survivorIds = new Set(harvested.images.map((i) => i.id))
  const pool: SlideImage[] = harvested.images
  const slides = placeDocImages(stripFirstPageImage(stripFailedImageRefs(sanitizeSlides(parsed.slides), survivorIds)), pool)
  if (!slides.length) throw new Error('没有生成可用的幻灯片内容。')
  return {
    name: String(parsed.title || '综合演示').slice(0, 40),
    slides,
    images: pool,
    truncated: docs.some((d) => d.text.length > perDoc) || globalDocImages.length > MAX_DOC_IMAGES,
    sources: materials.map((m) => ({ kind: m.kind, label: m.label, url: m.url })),
    imgFailed: harvested.failedTokens.length,
    imgFailedDetail: summarizeImageFailures(harvested.failures),
  }
}
