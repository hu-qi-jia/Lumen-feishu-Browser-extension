import type { Slide } from './slides'
import { resolveImage, type SlideImage } from './slidesImages'

export interface SlideCtx {
  deckName: string
  index: number
  total: number
  images: SlideImage[]
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const bl = (arr?: string[]): string =>
  `<ul class="s-bullets">${(arr ?? []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`

/** Resolve an image id to an <img> tag (rounded frame + shadow + alt). Empty if not found. */
function imgTag(images: SlideImage[], id?: string, caption?: string, cls = 's-photo'): string {
  const im = resolveImage(images, id)
  if (!im) return ''
  const alt = esc(caption || im.label)
  return `<div class="${cls}"><img src="${im.dataUrl}" alt="${alt}" /></div>`
}

function eyebrow(s: Slide): string {
  return s.eyebrow ? `<div class="s-eyebrow">${esc(s.eyebrow)}</div>` : ''
}
function head(s: Slide): string {
  return s.title ? `<div class="s-head">${esc(s.title)}</div>` : ''
}
function footer(ctx?: SlideCtx): string {
  if (!ctx) return ''
  return `<div class="s-footer">${esc(ctx.deckName)} · ${ctx.index + 1} / ${ctx.total}</div>`
}

type Fn = (s: Slide, ctx: SlideCtx | undefined) => string

const title: Fn = (s) => `<div class="s-title">${esc(s.title ?? '')}</div>` + (s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : '')
const section: Fn = (s) => `<div class="s-section-num">SECTION</div><div class="s-title">${esc(s.title ?? '')}</div>` + (s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : '')
const quote: Fn = (s) => `<div class="s-quote">&ldquo;${esc(s.quote ?? s.title ?? '')}&rdquo;</div>` + (s.by ? `<div class="s-by">&mdash; ${esc(s.by)}</div>` : '')
const bullets: Fn = (s) => `${eyebrow(s)}${head(s)}${bl(s.bullets)}` + (s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : '')
const twoCol: Fn = (s) => `${eyebrow(s)}${head(s)}<div class="s-two"><div>${bl(s.bullets)}</div><div>${bl(s.bullets2)}</div></div>`
const stats: Fn = (s) => `${eyebrow(s)}${head(s)}<div class="s-stats">${(s.stats ?? []).map((t) => `<div class="s-stat"><div class="s-num">${esc(t.num)}</div><div class="s-label">${esc(t.label)}</div></div>`).join('')}</div>`
const chart: Fn = (s) => `${eyebrow(s)}${head(s)}<div class="s-chart" data-chart="${esc(JSON.stringify(s.chart ?? {}))}"></div>${s.bullets?.length ? bl(s.bullets) : ''}`
const embed: Fn = (s) => `${head(s)}<div class="s-embed"><div class="muted center">看板内容请在扩展浮窗中查看</div></div>`

const cover: Fn = (s, ctx) => {
  const bg = imgTag(ctx?.images ?? [], s.image, s.imageCaption, 's-cover-bg')
  return `<div class="s-cover${bg ? ' s-cover--hasimg' : ''}">${bg}<div class="s-cover-inner"><div class="s-title">${esc(s.title ?? '')}</div>${s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : ''}</div></div>`
}

const cards: Fn = (s, ctx) => {
  const imgs = ctx?.images ?? []
  const items = (s.cards ?? []).map((c) =>
    `<div class="s-card">${c.image ? imgTag(imgs, c.image, undefined, 's-card-img') : ''}${c.num ? `<div class="s-card-num">${esc(c.num)}</div>` : ''}<div class="s-card-title">${esc(c.title ?? '')}</div>${c.body ? `<div class="s-card-body">${esc(c.body)}</div>` : ''}</div>`,
  ).join('')
  return `${eyebrow(s)}${head(s)}<div class="s-cards">${items}</div>`
}

const imageSplit: Fn = (s, ctx) => {
  const img = imgTag(ctx?.images ?? [], s.image, s.imageCaption, 's-split-img')
  const text = `<div class="s-split-text">${eyebrow(s)}${head(s)}${bl(s.bullets)}${s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : ''}</div>`
  return `<div class="s-split s-split--${s.imageSide ?? 'right'}">${s.imageSide === 'left' ? img + text : text + img}</div>`
}

const LAYOUTS: Record<string, Fn> = {
  title, section, quote, twocol: twoCol, bullets, stats, chart, embed, cover, cards,
  'image-split': imageSplit, 'two-col': twoCol,
}

export function slideInnerHtml(s: Slide, ctx?: SlideCtx): string {
  const fn = LAYOUTS[s.layout ?? 'bullets'] ?? bullets
  return fn(s, ctx) + footer(ctx)
}
