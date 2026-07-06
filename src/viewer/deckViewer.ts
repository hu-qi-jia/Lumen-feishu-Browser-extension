/**
 * Standalone deck-viewer page — opened in its own tab so viewing a generated PPT does NOT
 * depend on staying on a Feishu page (the old on-page overlay did). It reads the deck from
 * `chrome.storage.session` (key `deckView`), renders it with the SAME styles + slide-inner-HTML
 * as the exported HTML file, and hydrates chart slides via the bundled ECharts (the extension-
 * page CSP `script-src 'self'` forbids the CDN the standalone file uses, so we import it instead).
 *
 * The deck's SlideTheme is injected as CSS custom properties on top of the shared `SLIDES_CSS`,
 * and slides render into a fixed 1920×1080 design canvas that is `transform:scale()`-ed to fit.
 *
 * When `deckView.print` is set, the page lays every slide out into the off-screen `.slides-print`
 * sheet and calls `window.print()` — that's the "导出 PDF" path (→ save as PDF).
 */
import * as echarts from 'echarts'
import type { Slide } from '../shared/ai/slides'
import { slideInnerHtml, SLIDES_CSS } from '../shared/ai/slidesExport'
import { getTheme, themeVars } from '../shared/ai/slidesThemes'
import type { SlideImage } from '../shared/ai/slidesImages'

interface DeckView {
  slides: Slide[]
  name: string
  /** Saved deck's theme id; resolves to a built-in SlideTheme whose tokens are injected as CSS vars. */
  themeId?: string
  /** Set by "导出 PDF" — render all slides to the print sheet and open the print dialog. */
  print?: boolean
  /** Image pool (Task 3+) used to resolve 【图n】 markers and image slots in slides. */
  images?: SlideImage[]
}

// Shared slide styles + the deck's theme tokens (injected AFTER so they win over the fallback :root).
const baseStyle = document.createElement('style')
baseStyle.textContent = SLIDES_CSS
document.head.appendChild(baseStyle)

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T | null
const stage = $<HTMLElement>('.slides-stage')!
const wrap = $<HTMLElement>('.slide-frame-wrap')!
const outer = $<HTMLElement>('.slide-frame-outer')!
const frame = $<HTMLElement>('.slide-frame')!
const countEl = $<HTMLElement>('.slides-count')!
const dotsEl = $<HTMLElement>('.slides-dots')!
const prevBtn = $<HTMLButtonElement>('.slides-prev')!
const nextBtn = $<HTMLButtonElement>('.slides-next')!
const playBtn = $<HTMLButtonElement>('.slides-play')!
const printEl = $<HTMLElement>('.slides-print')!

let slides: Slide[] = []
let images: SlideImage[] = []
let deckName = '演示文稿'
let cur = -1

/** Build a slide page wrapped in its `.slide` container, threading the SlideCtx
 *  (deck name + page index + total + image pool) so the auto footer renders and
 *  【图n】 markers resolve against the deck's image pool. */
function pageHtml(s: Slide, i: number): string {
  const ctx = { deckName, index: i, total: slides.length, images }
  return `<div class="slide slide--${s.layout || 'bullets'}">${slideInnerHtml(s, ctx)}</div>`
}

// Icons for the play/fullscreen button — swapped on state. currentColor inherits the button text
// color, matching the Feishu stroke-icon style used across the panel.
const ICON_FULLSCREEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'
const ICON_EXIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>'

function hydrateCharts(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.s-chart').forEach((ce) => {
    const raw = ce.dataset.chart
    if (!raw) return
    try { echarts.init(ce).setOption(JSON.parse(raw)) } catch { /* malformed option — leave the slot blank */ }
  })
}

/** Scale the 1920×1080 design canvas to fit the wrap (aspect preserved, no distortion). */
function fit(): void {
  const w = wrap.clientWidth, h = wrap.clientHeight
  if (!w || !h) return
  const s = Math.min(w / 1920, h / 1080)
  outer.style.width = `${1920 * s}px`
  outer.style.height = `${1080 * s}px`
  frame.style.transform = `scale(${s})`
}

function show(i: number): void {
  const nx = Math.max(0, Math.min(slides.length - 1, i))
  if (nx === cur) return
  cur = nx
  frame.innerHTML = pageHtml(slides[nx], nx)
  countEl.textContent = `${cur + 1} / ${slides.length}`
  Array.from(dotsEl.children).forEach((d, j) => d.classList.toggle('active', j === cur))
  hydrateCharts(frame)
}

function next(): void { show(cur + 1) }
function prev(): void { show(cur - 1) }
const inFullscreen = (): boolean => !!document.fullscreenElement
function syncPlayBtn(): void {
  playBtn.innerHTML = inFullscreen() ? ICON_EXIT : ICON_FULLSCREEN
  playBtn.title = inFullscreen() ? '退出全屏' : '全屏播放'
}
syncPlayBtn()
// Play = toggle fullscreen presentation. No autoplay — the user drives navigation
// (wheel / arrows / click); Esc exits natively and fullscreenchange re-syncs the icon.
function enterPresent(): void { stage.requestFullscreen?.().catch(() => { /* denied */ }) }
function exitPresent(): void { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { /* ignore */ }) }

prevBtn.onclick = () => prev()
nextBtn.onclick = () => next()
playBtn.onclick = () => { if (inFullscreen()) exitPresent(); else enterPresent() }
document.addEventListener('fullscreenchange', syncPlayBtn)
stage.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
  else if (e.key === 'Home') show(0)
  else if (e.key === 'End') show(slides.length - 1)
})
// Mouse wheel = prev/next while presenting.
let wheelLock = false
stage.addEventListener('wheel', (e) => {
  if (!inFullscreen() || wheelLock) return
  if (Math.abs(e.deltaY) < 12) return
  wheelLock = true
  if (e.deltaY > 0) next(); else prev()
  setTimeout(() => { wheelLock = false }, 350)
}, { passive: true })
// Click left/right half of the canvas to navigate (clientX vs the frame's visual midpoint).
frame.addEventListener('click', (e) => {
  const r = frame.getBoundingClientRect()
  if (e.clientX < r.left + r.width / 2) prev(); else next()
})

/** Lay every slide into the off-screen print sheet (sized so ECharts canvases render),
 *  hydrate its charts, then open the print dialog. */
async function printAll(): Promise<void> {
  printEl.innerHTML = slides.map((s, i) => pageHtml(s, i)).join('')
  printEl.classList.add('is-building')
  // Two frames so layout resolves and chart containers get real pixel sizes before init.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  hydrateCharts(printEl)
  // Some ECharts renders settle async; a microtask + frame is enough for setOption to draw.
  await new Promise((r) => setTimeout(r, 60))
  printEl.classList.remove('is-building')
  window.print()
}

void chrome.storage.session.get('deckView').then((res) => {
  const dv = res?.deckView as DeckView | undefined
  // Inject the deck's theme tokens + full per-theme stylesheet (after SLIDES_CSS → overrides baseline).
  const theme = getTheme(dv?.themeId)
  stage.dataset.theme = theme.id
  const themeStyle = document.createElement('style')
  themeStyle.textContent = `:root{${themeVars(theme)}}${theme.css ?? ''}`
  document.head.appendChild(themeStyle)

  if (!dv?.slides?.length) {
    frame.innerHTML = '<div class="muted center" style="font-size:24px">没有可显示的演示。请在「PPT 生成」里生成或从历史记录打开一份。</div>'
    fit()
    return
  }
  slides = dv.slides
  images = dv.images ?? []
  deckName = dv.name || '演示文稿'
  document.title = deckName
  dotsEl.innerHTML = Array.from({ length: slides.length }, () => '<button class="slides-dot" type="button"></button>').join('')
  Array.from(dotsEl.children).forEach((d, i) => {
    (d as HTMLElement).onclick = () => show(i)
  })
  new ResizeObserver(fit).observe(wrap)
  show(0)
  fit()
  stage.focus()
  if (dv.print) void printAll()
})
