/**
 * "添加到会话" button injected INTO Feishu's native selection toolbar
 * (.docx-menu-container) as its last child. By living inside the toolbar's flex layout,
 * the button auto-aligns with the other menu items — no coordinate math, no animation drift.
 *
 * Shadow-DOM isolated so Feishu's page CSS can't reach in. On click, asks the background
 * to open the side panel + stage the selection as a chat chip.
 *
 * v1: docs only (docx / wiki). Sheets/base are out of scope (different selection semantics).
 */
import { parseFeishuContext } from '@/shared/feishu/pageUrl'

let host: HTMLDivElement | null = null   // shadow host (injected into toolbar)
let btn: HTMLButtonElement | null = null  // the button inside the shadow root
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let isDragging = false
// Cached toolbar container — `ensureButton` runs on every refresh() (which itself runs on
// every selectionchange). Skipping the `.docx-menu-container` querySelector + getComputedStyle
// when our button is already happily attached avoids per-event layout queries (forced reflow).
let cachedContainer: HTMLElement | null = null

/** 'doc' | 'wiki' on a doc/wiki page, else null. */
function docKind(): 'doc' | 'wiki' | null {
  const f = parseFeishuContext(location.href)
  if (!f) return null
  return f.kind === 'doc' || f.kind === 'wiki' ? f.kind : null
}

function currentSelection(): { text: string } | null {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!text || !sel || sel.rangeCount === 0) return null
  return { text }
}

/**
 * Inject the button into Feishu's native toolbar (.docx-menu-container) as its last child.
 * The toolbar is a flex row, so the button auto-aligns with the other menu items.
 * Returns the button, or null if the toolbar isn't available / visible yet.
 */
function ensureButton(): HTMLButtonElement | null {
  // Fast path: if our host is still attached inside the cached container, the button is
  // already visible — skip both the querySelector AND the getComputedStyle (which forces
  // layout reflow). This is the common case on every selectionchange while the toolbar is up.
  if (btn && host && cachedContainer && host.isConnected && cachedContainer.isConnected && cachedContainer.contains(host)) {
    return btn
  }

  const container = document.querySelector('.docx-menu-container') as HTMLElement | null
  if (!container) { cachedContainer = null; return null }
  // `offsetParent === null` is a cheap check that covers display:none + not-in-render-tree
  // WITHOUT forcing a full computed-style recalc. Only fall back to getComputedStyle for the
  // rarer visibility:hidden / opacity:0 cases when the element DOES have layout.
  if (container.offsetParent === null) {
    const cs = getComputedStyle(container)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) {
      cachedContainer = null
      return null
    }
  }
  cachedContainer = container

  // Clean up orphaned previous instance.
  if (host) { try { host.remove() } catch { /* detached */ } }
  host = null
  btn = null

  host = document.createElement('div')
  // flex-shrink:0 prevents the toolbar from compressing our button;
  // margin-left:8px matches the gap between the last native menu item and its predecessor.
  host.style.cssText = 'display:flex;align-items:center;margin-left:8px;flex-shrink:0;'
  const shadow = host.attachShadow({ mode: 'open' })

  btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = '添加到会话'
  // Blue CTA that matches the native menu item dimensions (24px high, 4px radius, 12px font)
  // so it sits naturally alongside the other .panel-menu-item children.
  btn.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;gap:4px;' +
    'padding:0 8px;border:none;border-radius:4px;' +
    'cursor:pointer;background:#4f6bff;color:#fff;' +
    "font:12px/1 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;white-space:nowrap;" +
    'height:24px;box-sizing:border-box;transition:background .15s ease;'
  const icon = document.createElement('span')
  icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
  btn.prepend(icon.firstChild as Node)
  btn.onclick = onClick

  const style = document.createElement('style')
  style.textContent = 'button:hover{background:#3f57e6}button:active{background:#3246c2}'
  shadow.appendChild(style)
  shadow.appendChild(btn)
  container.appendChild(host)
  return btn
}

// The live selection is captured the moment the button is shown. Clicking the button later
// collapses it (mousedown on a focusable element clears the document selection), so onClick
// must reuse this snapshot instead of re-reading window.getSelection() — which would be empty
// by then and silently bail. Standard selection-popover pattern (Medium / Notion / Slate).
let snapshot: {
  kind: 'doc' | 'wiki'
  docToken: string
  docTitle: string
  url: string
  selectedText: string
} | null = null

function onClick() {
  if (!snapshot) return
  const payload = { type: 'OPEN_SIDE_PANEL_WITH_SELECTION', payload: snapshot }
  chrome.runtime.sendMessage(payload).catch(() => { /* receiving end unavailable */ })
  // Don't hide or clear snapshot: the selection (and Feishu's toolbar) likely persists
  // after clicking a shadow-DOM button, so the button should stay visible. When the user
  // clicks elsewhere or the selection collapses, selectionchange → refresh() → hide()
  // will remove it naturally.
}

function show() { ensureButton() }
function hide() {
  if (host) { try { host.remove() } catch { /* detached */ } }
  host = null
  btn = null
  // Don't clear cachedContainer: the toolbar element may still be live in the DOM (just
  // our button removed). Re-injection next show() can still fast-path on offsetParent.
}

function refresh() {
  const kind = docKind()
  if (!kind) { snapshot = null; hide(); return }
  const sel = currentSelection()
  if (!sel) { snapshot = null; hide(); return }
  const f = parseFeishuContext(location.href)
  const docToken = (f?.kind === 'wiki' ? f.wikiToken : f?.documentId) ?? ''
  if (!docToken) { snapshot = null; hide(); return }
  // Snapshot NOW — the selection may be gone by the time the user clicks the button.
  snapshot = { kind, docToken, docTitle: document.title || '', url: location.href, selectedText: sel.text }
  show()
}

function scheduleRefresh(delay = 50) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(refresh, delay)
}

// Mouse drag: suppress intermediate selectionchange refreshes to avoid stutter/flicker.
// The final selection is handled by mouseup. Keyboard selection still refreshes via selectionchange.
document.addEventListener('mousedown', () => { isDragging = true })
document.addEventListener('mouseup', () => { isDragging = false; scheduleRefresh(60) })
document.addEventListener('selectionchange', () => {
  if (isDragging) return
  scheduleRefresh(50)
})
// Hide on scroll / resize so the button never drifts off the selection.
window.addEventListener('scroll', hide, { passive: true, capture: true })
window.addEventListener('resize', hide, { passive: true })
