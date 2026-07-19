/**
 * Floating launchers: a Feishu page can have SEVERAL saved dashboards bound to its resource.
 * Each gets its own pill (stacked bottom-left). Click a pill → expand that dashboard (its own
 * overlay window); click again → collapse it. Multiple dashboards can be open at once.
 *
 * PPT decks: click → open the standalone viewer page (deckViewer.html) in a new tab, matching
 * SlidesPanel's "查看 PPT" behavior. A × button on the right of the pill deletes the deck.
 */
import { parseFeishuContext } from '@/shared/feishu/pageUrl'
import { loadVizList } from '@/shared/dataviz/store'
import { loadDecks, deleteDeck, type SavedDeck } from '@/shared/ai/slidesStore'
import { ctxDocKey, deckScopeKey, savedVizMatchesCtx } from '@/shared/dataviz/scope'
import type { SavedViz } from '@/shared/dataviz/types'
import { isVizOpen, closeViz, customConfirm } from './viz-overlay'

let host: HTMLDivElement | null = null // shadow host (page-fixed anchor)
let bar: HTMLDivElement | null = null  // flex row INSIDE the shadow root (holds the pills)
// Monotonic guard: refreshLauncher is fired from several uncoordinated, un-debounced sites (SPA
// nav, storage.onChanged, initial load). Without this, a fast A→B table switch can let A's slower
// storage read resolve AFTER B's and repaint A's pills while the user is on B.
let runSeq = 0


function ensureBar(): HTMLDivElement {
  // Rebuild if the host was orphaned — Feishu's SPA can replace document.body, detaching our host;
  // without this check ensureBar would keep returning the stale (invisible) bar and pills vanish.
  if (bar && host?.isConnected) return bar
  if (host) { try { host.remove() } catch { /* already detached */ } }
  // Render INSIDE a Shadow DOM: the Feishu page's global CSS can't reach in, so our flex row
  // can't be reset/overridden — without this, page styles stacked the pills on top of each other
  // instead of laying them out in a row.
  host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:2147483600;'
  const shadow = host.attachShadow({ mode: 'open' })
  bar = document.createElement('div')
  // Horizontal row along the BOTTOM edge, wrapping upward only when there are many pills.
  bar.style.cssText =
    'display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;align-items:flex-end;max-width:calc(100vw - 40px);'
  shadow.appendChild(bar)
  document.body.appendChild(host)
  return bar
}
function clearBar() { if (host) { host.remove(); host = null; bar = null } }

const PILL_IDLE = '0.55'   // translucent at rest, so it barely obscures the document
const PILL_HOVER = '1'     // deepens to full color on hover

/**
 * Build a launcher pill. The pill itself is a <button>; when `onDelete` is provided, a ×
 * affordance is rendered as a sibling inside a wrapper <div> so the delete click never reaches
 * the pill's onClick (stopPropagation). Both share the pill's hover-opacity behavior.
 */
function makePill(label: string, title: string, onClick: () => void, onDelete?: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.style.cssText =
    'flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:6px;max-width:240px;padding:9px 14px;border:none;border-radius:999px;' +
    'cursor:pointer;background:#4f6bff;color:#fff;box-shadow:0 6px 24px rgba(79,107,255,.4);' +
    "font:13px/1.2 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;white-space:nowrap;" +
    'overflow:hidden;text-overflow:ellipsis;opacity:' + PILL_IDLE + ';transition:opacity .18s ease, box-shadow .18s ease;'
  b.textContent = label
  b.title = title
  // Dynamic transparency: faded while idle (doesn't block content), color deepens on hover.
  b.onmouseenter = () => { b.style.opacity = PILL_HOVER }
  b.onmouseleave = () => { b.style.opacity = PILL_IDLE }
  b.onclick = onClick
  if (onDelete) {
    const x = document.createElement('button')
    x.title = '删除'
    x.textContent = '×'
    x.style.cssText =
      'flex:0 0 auto;box-sizing:border-box;padding:0 4px;border:none;background:transparent;color:#fff;' +
      'font:16px/1 -apple-system,sans-serif;cursor:pointer;opacity:.7;transition:opacity .15s ease;'
    x.onmouseenter = () => { x.style.opacity = '1' }
    x.onmouseleave = () => { x.style.opacity = '.7' }
    x.onclick = (e) => { e.stopPropagation(); onDelete() }
    // Wrap pill + × in a row so they visually belong together
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:center;gap:2px;'
    // The wrapper inherits the pill's hover-opacity by listening on the wrapper itself.
    wrap.onmouseenter = () => { b.style.opacity = PILL_HOVER; x.style.opacity = '1' }
    wrap.onmouseleave = () => { b.style.opacity = PILL_IDLE; x.style.opacity = '.7' }
    wrap.appendChild(b)
    wrap.appendChild(x)
    // Return the button (for backwards-compat with callers that only need the clickable pill),
    // but the caller actually appends the wrapper — see makePillWrapper below.
    ;(b as HTMLButtonElement & { _wrapper?: HTMLDivElement })._wrapper = wrap
  }
  return b
}

function pill(v: SavedViz): HTMLButtonElement {
  return makePill(v.name, '点击展开/收起「' + v.name + '」', () => {
    if (isVizOpen(v.id)) closeViz(v.id) // collapse
    else { try { chrome.runtime.sendMessage({ type: 'DATAVIZ_OPEN_SAVED', vizId: v.id }) } catch { /* */ } }
  })
}

/**
 * PPT deck pill: click → open the standalone viewer page (deckViewer.html) in a new tab via
 * the background, matching SlidesPanel's "查看 PPT". A × button deletes the deck after confirm.
 *
 * Why not the page overlay like 看板/图表? The overlay path (DATAVIZ_OPEN_DECK → background →
 * DATAVIZ_RENDER → sandbox iframe) is fragile on Feishu pages (z-index fights, sandbox CSP,
 * message routing). The standalone viewer is page-independent and the same code path the
 * sidebar uses, so it's the reliable choice for "click → see my PPT".
 */
function deckPill(d: SavedDeck): HTMLButtonElement {
  return makePill(d.name, '点击查看「' + d.name + '」演示', () => {
    // Fire-and-forget: the background opens the standalone viewer page. Content scripts can't
    // open extension URLs directly (chrome.tabs is unavailable here), so route via background.
    // .catch swallows the "no receiver" rejection when the SW is asleep — the pill stays, retry on next click.
    void chrome.runtime.sendMessage({ type: 'OPEN_DECK_VIEWER', deckId: d.id }).catch(() => {})
  }, () => {
    void customConfirm(`确认删除「${d.name}」？此操作不可撤销。`).then((ok) => {
      if (ok) deleteDeck(d.id).then(() => refreshLauncher()).catch(() => {})
    })
  })
}

type Ctx = ReturnType<typeof parseFeishuContext>
// A Base/Sheet opened via 知识库(Wiki) has a wiki URL the content script can't resolve (no token),
// so ctxDocKey would be null and NO saved-site pills would ever show. Resolve via the background
// (cached per wiki token) so the launcher can match the underlying Base/Sheet.
const wikiResolveCache = new Map<string, NonNullable<Ctx>>()
async function resolvePage(): Promise<Ctx> {
  const f = parseFeishuContext(location.href)
  if (f?.kind !== 'wiki' || !f.wikiToken) return f
  const cached = wikiResolveCache.get(f.wikiToken)
  if (cached) return cached
  try {
    const r = await chrome.runtime.sendMessage({ type: 'RESOLVE_PAGE_RESOURCE', wikiToken: f.wikiToken })
    if (r) { wikiResolveCache.set(f.wikiToken, r as NonNullable<Ctx>); return r as Ctx }
  } catch { /* background unavailable → stay wiki, retry next refresh */ }
  return f
}

/** Re-evaluate which launcher pills to show for the current page resource. */
export async function refreshLauncher() {
  const myRun = ++runSeq
  const f = await resolvePage()
  // Per data-table (vizMatchesCtx); ctxDocKey just gates "on a Base/Sheet page at all".
  const matches = ctxDocKey(f)
    ? (await loadVizList()).filter((v) => savedVizMatchesCtx(v, f))
    : []
  // Saved PPT decks live in a SEPARATE store — surface them as pills too, so图表/看板/PPT
  // all get a one-click launcher on the page (not "open the matching extension tab"). Decks are
  // scoped by srcKey (= ctxScopeKey), matching how SlidesPanel filters its list.
  const deckKey = deckScopeKey(f)
  const decks = deckKey ? (await loadDecks()).filter((d) => d.srcKey === deckKey) : []
  if (myRun !== runSeq) return // a newer refresh started during the await — let it win (guards clearBar too)
  if (!matches.length && !decks.length) { clearBar(); return }
  const c = ensureBar()
  c.innerHTML = ''
  for (const v of matches) {
    const p = pill(v)
    // pill() never passes onDelete → no wrapper; append the button directly.
    c.appendChild(p)
  }
  for (const d of decks) {
    const p = deckPill(d)
    // deckPill() passes onDelete → the button carries a _wrapper div (pill + ×); append that.
    const wrap = (p as HTMLButtonElement & { _wrapper?: HTMLDivElement })._wrapper
    c.appendChild(wrap ?? p)
  }
}

// Saving/deleting a viz OR a slides deck updates storage → refresh pills without a page reload.
// Debounce 150ms: a single save may emit multiple onChanged events (dataviz_v1 + slides_decks_v1
// if a flow touches both), and rapid add/delete bursts would otherwise fire several async
// refreshLauncher runs (each does 2 storage reads). refreshLauncher's runSeq guard keeps the
// result correct, but the debounce avoids the wasted work entirely.
let refreshTimer: ReturnType<typeof setTimeout> | null = null
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || (!changes.dataviz_v1 && !changes.slides_decks_v1)) return
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { refreshTimer = null; void refreshLauncher() }, 150)
  })
} catch { /* no storage here */ }
