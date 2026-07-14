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
  btn.style.cssText =
    'display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:none;border-radius:8px;' +
    'cursor:pointer;background:#4f6bff;color:#fff;box-shadow:0 2px 8px rgba(79,107,255,.35);' +
    "font:12px/1.2 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;white-space:nowrap;" +
    'height:30px;'
  const icon = document.createElement('span')
  icon.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
  btn.prepend(icon.firstChild as Node)
  btn.onclick = onClick
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
 * Detect Feishu's native selection toolbar (the floating bar with Copy/Bold/etc. buttons).
 * Probes upward from the selection rect using elementsFromPoint — the toolbar is an HTML
 * overlay rendered above the canvas editor, so it surfaces in the hit-test stack.
 * Returns the toolbar's rect, or null if not found (fallback to geometric positioning).
 */
function findNativeToolbar(selRect: DOMRect): DOMRect | null {
  const cx = (selRect.left + selRect.right) / 2
  // Scan upward from the selection top edge in 6px steps (toolbar usually sits 8-50px above).
  for (let dy = 6; dy <= 64; dy += 6) {
    const cy = selRect.top - dy
    if (cy < 0) break
    const els = document.elementsFromPoint(cx, cy)
    for (const el of els) {
      if (el === host || (host && host.contains(el))) continue
      if (el.tagName === 'CANVAS') continue
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      if (r.height > 50) continue // toolbars are slim
      // Must contain interactive elements (buttons / icons) to qualify as a toolbar
      const interactive = el.querySelectorAll('button, [role="button"], svg, [class*="tool"], [class*="icon"], [class*="btn"]')
      if (interactive.length === 0) continue
      return r
    }
  }
  return null
}

function position(rect: DOMRect) {
  if (!host) return
  const toolbar = findNativeToolbar(rect)
  if (toolbar) {
    // Snap to the right edge of the native toolbar, vertically centered.
    const left = Math.min(toolbar.right + 6, window.innerWidth - 150)
    const top = toolbar.top + (toolbar.height - 36) / 2 // 36 ≈ button height
    host.style.left = `${Math.max(left, 6)}px`
    host.style.top = `${Math.max(top, 6)}px`
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
