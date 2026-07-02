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
    | 'cover' | 'cards' | 'image-split'
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
  /** layout:'embed' — a saved 看板/小程序's render code, re-run live against the table's rows. */
  code?: string
  /** layout:'embed' — Plan B: a saved board's declarative spec (no-remote-code builds). */
  spec?: import('../dataviz/spec').VizSpec
  cards?: Array<{ title?: string; body?: string; num?: string; image?: string }>
  image?: string
  imageSide?: 'left' | 'right'
  imageCaption?: string
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
    const layout = (['title', 'section', 'bullets', 'two-col', 'quote', 'stats', 'chart', 'embed', 'cover', 'cards', 'image-split'] as const)
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
    // A chart slide carries a self-contained ECharts option object (data inside).
    if (layout === 'chart' && r.chart && typeof r.chart === 'object') s.chart = r.chart as Record<string, unknown>
    // An embed slide carries a saved 看板's render code, OR (no-remote-code / Plan B) a declarative
    // VizSpec rendered by the bundled interpreter. Preserve whichever is present so a deck survives
    // re-sanitisation without losing its embedded board.
    if (layout === 'embed' && typeof r.code === 'string') s.code = r.code
    if (layout === 'embed' && r.spec && typeof r.spec === 'object') s.spec = r.spec as Slide['spec']
    // Drop empty/no-content slides (nothing to show).
    if (s.title || s.subtitle || s.quote || s.bullets?.length || s.bullets2?.length || s.stats?.length || s.cards?.length || s.chart || s.code || s.spec || s.image) out.push(s)
  }
  return out.slice(0, 40)
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
    ? `可选 layout：title / section / bullets / two-col / quote / stats / chart / cover / cards / image-split`
    : `可选 layout：title / section / bullets / two-col / quote / stats / chart（无可用图片，禁止 cover 背景图 / image-split）`
  const imageLine = pool.length
    ? `\n【可用图片】\n${pool.map((im) => `- ${im.id}（${im.label}）`).join('\n')}\n把图片放到指定页时：把该页 image 改为此 id，layout 改为 image-split（或 cover/cards），可用 imageSide 控制左右。\n`
    : ``
  const content =
    `下面是一套完整的演示幻灯片（JSON 数组，共 ${input.slides.length} 页，已标注页码）。请按【修改要求】修改其中需要改的页，**没有明确提到的页必须原样保留**。\n` +
    `修改要求里可能用自然语言指代页码或范围（如"第3页"、"封面"、"第5-7页"、"每页"、"全部"），由你判断该改哪些页；也可能指代某张图片（按其 label）。\n` +
    `${layoutLine}；字段：title、subtitle、eyebrow、bullets[]、bullets2[]、quote、by、stats、chart、cards[]、image、imageSide、imageCaption。\n` +
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
    `  · {"layout":"chart","title":"小标题","chart":{完整 ECharts 配置对象}} —— **数据维度优先用图表展示**（分布/占比→饼或柱、趋势→折线、排名→条形），这样才像真正的 PPT。chart 必须是自包含 ECharts option：把从【样本数据】里数出来 / 算出来的数字直接写进 series.data，类目写进 xAxis.data 或 pie 的 name；类型只用 bar / line / pie / scatter；不设 backgroundColor。\n` +
    `  · {"layout":"quote","quote":"结论","by":"可选"} —— 重点结论 / 建议收尾\n` +
    `【内容建议】封面 → 这张表在跟踪什么（字段含义）→ **用 1–3 张 chart 展示主要分布 / 占比 / 排名 / 趋势** → 值得注意的模式 → 结论 / 建议。\n` +
    `【诚实硬规则】**只用下面【样本数据】里能直接数出来 / 算出来的数字**；样本可能不是全部行，凡涉及数量请措辞为「样本中…」，**绝不编造精确总数或比例**；只用真实存在的字段名；不确定的用定性要点而非假数字。\n` +
    `【要求】8–14 张；第 1 张必须是 title 封面；文字精炼（标题≤20 字、要点≤30 字）；中文。\n` +
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
      ? `可选 layout：title / section / bullets / two-col / quote / stats / chart / **cover / cards / image-split**（cover/image-split 需配图）`
      : `可选 layout：title / section / bullets / two-col / quote / stats / chart（本次没有可用图片，**禁止使用 cover 背景图 / image-split 等需要图片的版式**）`
  const fieldsLine = pool.length
    ? `字段：title、subtitle、eyebrow、bullets[]、bullets2[]、quote、by、stats[{num,label}]、chart、cards[{title,body,num,image}]、image(图片id)、imageSide(left|right)、imageCaption。`
    : `字段：title、subtitle、eyebrow、bullets[]、bullets2[]、quote、by、stats[{num,label}]、chart。`
  const imageLine = pool.length
    ? `\n【可用图片（image 字段填这些 id 之一）】\n${pool.map((im) => `- ${im.id}（${im.source === 'doc' ? '文档图' : '用户上传'}·${im.label}${im.context ? `·${im.context}` : ''}）`).join('\n')}\n适合配图的页用 cover / image-split / cards，把图片 id 填进 image（或卡片 image）；图片说明从上下文推断，不要编造。正文里的【图n】是原文配图位置，按其上下文放到对应页。\n`
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
    `  · {"layout":"image-split","title":"","image":"图片id","imageSide":"left|right","bullets":[...]} —— 图文左右\n` +
    `  · {"layout":"chart","title":"小标题","chart":{完整 ECharts 配置对象}} —— **数据维度优先用图表展示**（分布/占比→饼或柱、趋势→折线、排名→条形）。chart 必须是自包含 ECharts option：把【样本数据】里数出来的数字直接写进 series.data，类目写进 xAxis.data 或 pie 的 name；类型只用 bar / line / pie / scatter；不设 backgroundColor。\n` +
    `  · {"layout":"quote","quote":"结论","by":"可选"} —— 重点结论 / 收尾\n` +
    `${fieldsLine}\n` +
    `【诚实硬规则】**只用上面资料里能直接读到 / 数出来的数字**；表格样本可能不是全部行，凡涉及数量请措辞为「样本中…」，**绝不编造精确总数或比例**；只用真实存在的字段名；不确定的用定性要点而非假数字。\n` +
    `【要求】8–16 张；第 1 张必须是 title 或 cover 封面；文字精炼（标题≤20 字、要点≤30 字）；用中文。\n` +
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
}

/** Generate one deck synthesized from N resolved+materials (docs + tables). No embed slides —
 *  embed (saved-board) reuse is a current-table concept that doesn't apply to multi-link input. */
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
  // 1) 聚合 doc imageTokens，分配全局编号并 remap 正文里的【图n】
  const fetch = opts?.imageFetcher ?? harvestDocImages
  const docs = materials.filter((m): m is Extract<Material, { kind: 'doc' }> => m.kind === 'doc')
  const perDoc = docBudgetEach(docs.length)

  const globalDocImages: Array<{ token: string; context: string }> = []
  const remappedTexts = new Map<Material, string>()
  for (const m of docs) {
    const local = m.imageTokens ?? []
    if (!local.length) { remappedTexts.set(m, m.text); continue }
    const base = globalDocImages.length
    const map = local.map((_, i) => base + i + 1) // local i (1-based) → global
    globalDocImages.push(...local)
    m.text = remapMarkers(m.text, map)
    remappedTexts.set(m, m.text)
  }
  const capped = globalDocImages.slice(0, MAX_DOC_IMAGES)
  // 收集被 cap 的失败本地号（超出上限的）以剔除其标记：用其在原文里的全局号
  const overflowGlobals = globalDocImages.slice(MAX_DOC_IMAGES).map((_, i) => MAX_DOC_IMAGES + i + 1)

  // 2) 下载 + 压缩（并行），失败返回 failedTokens
  //    resolveToken is only needed for the real harvester (network); an injected imageFetcher
  //    is a test seam that ignores the token, so skip the (settings-dependent) resolve in that case.
  const useRealFetcher = fetch === harvestDocImages
  const token = useRealFetcher ? await resolveToken(settings) : ''
  const harvested = capped.length
    ? await fetch({ userToken: token, docImages: capped, signal: opts?.signal, onProgress: opts?.onImageProgress })
    : { images: [], failedTokens: [] }

  // 3) survivors 被 harvestDocImages 重新连续编号为 doc-1..doc-K。
  //    需把正文里的【图{oldGlobal}】映射到 survivor 的新编号，并剔除失败/溢出的标记。
  //    建立 oldGlobal → new 的映射：
  const survivorOldGlobals: number[] = [] // 与 harvested.images 顺序对齐的 oldGlobal
  let gi = 0
  for (let i = 0; i < capped.length; i++) {
    gi++
    const ok = !harvested.failedTokens.includes(capped[i].token)
    if (ok) survivorOldGlobals.push(gi)
  }
  // oldGlobal → new doc-K
  const oldToNew = new Map<number, number>()
  survivorOldGlobals.forEach((og, k) => oldToNew.set(og, k + 1))
  // 重写正文：把【图{og}】→【图{new}】，再把无 new（失败/溢出）的标记剔除
  const failedGlobals = capped
    .map((c, i) => (harvested.failedTokens.includes(c.token) ? i + 1 : -1))
    .filter((n) => n > 0)
  const allDropGlobals = new Set([...failedGlobals, ...overflowGlobals])
  for (const m of docs) {
    let t = m.text
    t = t.replace(/【图(\d+)】/g, (mm, d) => {
      const n = Number(d)
      return oldToNew.has(n) ? `【图${oldToNew.get(n)}】` : (allDropGlobals.has(n) ? '' : mm)
    })
    m.text = t
  }
  const pool: SlideImage[] = harvested.images

  // 4) 生成
  const out = fences(await chatCompleteStream(settings, buildMaterialsPrompt(materials, request, opts?.themeHint, pool), {
    signal: opts?.signal, onChunk: (f) => opts?.onProgress?.(f.length),
  }))
  if (!out) throw new Error('模型未返回内容。')
  let parsed: { title?: string; slides?: unknown }
  try { parsed = JSON.parse(out) } catch { throw new Error('幻灯片解析失败，请重试或换一个支持 JSON 输出的模型。') }
  const slides = sanitizeSlides(parsed.slides)
  if (!slides.length) throw new Error('没有生成可用的幻灯片内容。')
  return {
    name: String(parsed.title || '综合演示').slice(0, 40),
    slides,
    images: pool,
    truncated: docs.some((d) => (remappedTexts.get(d) ?? d.text).length > perDoc) || globalDocImages.length > MAX_DOC_IMAGES,
    sources: materials.map((m) => ({ kind: m.kind, label: m.label, url: m.url })),
  }
}
