/**
 * Floating "添加到会话" button shown next to a text selection in Feishu DOC/WIKI pages.
 * Shadow-DOM isolated (mirrors viz-launcher) so Feishu's page CSS can't reach in. On click,
 * asks the background to open the side panel + stage the selection as a chat chip.
 *
 * v1: docs only (docx / wiki). Sheets/base are out of scope (different selection semantics).
 */
import { parseFeishuContext } from '@/shared/feishu/pageUrl'

let host: HTMLDivElement | null = null   // shadow host (page-fixed)
let btn: HTMLButtonElement | null = null  // the button inside the shadow root
let refreshTimer: ReturnType<typeof setTimeout> | undefined

/** 'doc' | 'wiki' on a doc/wiki page, else null. */
function docKind(): 'doc' | 'wiki' | null {
  const f = parseFeishuContext(location.href)
  if (!f) return null
  return f.kind === 'doc' || f.kind === 'wiki' ? f.kind : null
}

function currentSelection(): { text: string; rect: DOMRect } | null {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!text || !sel || sel.rangeCount === 0) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return null // collapsed / hidden
  return { text, rect }
}

function ensureButton(): HTMLButtonElement {
  // Rebuild if the host was orphaned — Feishu's SPA can replace document.body (mirrors viz-launcher).
  if (btn && host?.isConnected) return btn
  if (host) { try { host.remove() } catch { /* detached */ } }
  host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483600;display:none;'
  const shadow = host.attachShadow({ mode: 'open' })
  btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = '添加到会话'
  // Blue CTA button that matches the native toolbar height (40px), font size (14px)
  // and uses the same shadow as .docx-menu-wrapper: 0 4px 8px rgba(31,35,41,.1).
  btn.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;gap:5px;' +
    'padding:0 12px;border:none;border-radius:6px;' +
    'cursor:pointer;background:#4f6bff;color:#fff;' +
    'box-shadow:0 4px 8px rgba(31,35,41,.1);' +
    "font:14px/1 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;white-space:nowrap;" +
    'height:40px;box-sizing:border-box;transition:background .15s ease,box-shadow .15s ease;'
  const icon = document.createElement('span')
  icon.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
  btn.prepend(icon.firstChild as Node)
  btn.onclick = onClick
  const style = document.createElement('style')
  style.textContent = 'button:hover{background:#3f57e6;box-shadow:0 6px 12px rgba(31,35,41,.12)}button:active{background:#3246c2}'
  shadow.appendChild(style)
  shadow.appendChild(btn)
  document.body.appendChild(host)
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
  if (!snapshot) { hide(); return }
  const payload = { type: 'OPEN_SIDE_PANEL_WITH_SELECTION', payload: snapshot }
  snapshot = null
  chrome.runtime.sendMessage(payload).catch(() => { /* receiving end unavailable */ })
  hide()
}

/**
 * Locate Feishu's native selection toolbar (`.docx-menu-container`) — the floating bar with
 * Copy/Bold/etc. buttons that appears above a text selection. Direct class lookup is reliable
 * here: the class name is stable across Feishu builds, and the element is rendered as
 * `position: static` (NOT fixed/absolute), so the previous `elementsFromPoint` heuristic that
 * filtered by computed position would never match it. Returns the toolbar's rect, or null when
 * absent / hidden (fallback to geometric positioning).
 */
function findNativeToolbar(): DOMRect | null {
  // The visual toolbar card is .docx-menu-wrapper (white bg, border, shadow, height 42px);
  // .docx-menu-container is the inner flex row (height 40px, transparent). Anchor to the
  // wrapper so the button aligns with the actual visible card.
  const wrapper = document.querySelector('.docx-menu-wrapper')
  const el = wrapper || document.querySelector('.docx-menu-container')
  if (!el) return null
  // Skip containers that are present in the DOM but not actually shown (e.g. between selections).
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return r
}

function position(rect: DOMRect) {
  if (!host) return
  const toolbar = findNativeToolbar()
  if (toolbar) {
    // Match the button height to the actual visible toolbar card (.docx-menu-wrapper, 42px)
    // and align top-edge to top-edge for a seamless look.
    if (btn) btn.style.height = `${toolbar.height}px`
    const gap = 6
    const minBtnWidth = 100
    const roomRight = window.innerWidth - toolbar.right
    let left: number
    if (roomRight >= minBtnWidth + gap) {
      left = toolbar.right + gap
    } else if (toolbar.left >= minBtnWidth + gap) {
      left = toolbar.left - minBtnWidth - gap
    } else {
      // No room on either side: center above the toolbar as last resort.
      left = Math.max(6, (window.innerWidth - minBtnWidth) / 2)
    }
    host.style.left = `${left}px`
    host.style.top = `${Math.max(toolbar.top, 6)}px`
    return
  }
  // Fallback: top-right of the selection rect, clamped into the viewport.
  const left = Math.min(Math.max(rect.right - 60, 6), window.innerWidth - 140)
  const top = Math.max(rect.top - 40, 6)
  host.style.left = `${left}px`
  host.style.top = `${top}px`
}

function show(rect: DOMRect) { ensureButton(); position(rect); if (host) host.style.display = '' }
function hide() { if (host) host.style.display = 'none' }

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
  show(sel.rect)
}

// selectionchange covers both mouse-drag and keyboard selection; debounce (fires often mid-drag).
document.addEventListener('selectionchange', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150) })
// Some selections finalize on mouseup without a trailing selectionchange beat.
// Use 250ms delay so Feishu's native toolbar has time to render before we probe for it.
document.addEventListener('mouseup', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250) })
// Hide on scroll / resize so the button never drifts off the selection.
window.addEventListener('scroll', hide, { passive: true, capture: true })
window.addEventListener('resize', hide, { passive: true })
