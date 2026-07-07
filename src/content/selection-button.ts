/**
 * Floating "添加到会话" button shown next to a text selection in Feishu DOC/WIKI pages.
 * Shadow-DOM isolated (mirrors viz-launcher) so Feishu's page CSS can't reach in. On click,
 * asks the background to open the side panel + stage the selection as a chat chip.
 *
 * v1: docs only (docx / wiki). Sheets/base are out of scope (different selection semantics).
 */
import { parseFeishuContext } from '../shared/feishu/pageUrl'

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
    'cursor:pointer;background:#4f6bff;color:#fff;box-shadow:0 4px 14px rgba(79,107,255,.4);' +
    "font:12px/1 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;white-space:nowrap;"
  const icon = document.createElement('span')
  icon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
  btn.prepend(icon.firstChild as Node)
  btn.onclick = onClick
  shadow.appendChild(btn)
  document.body.appendChild(host)
  return btn
}

function onClick() {
  const kind = docKind()
  const sel = currentSelection()
  if (!kind || !sel) { hide(); return }
  const f = parseFeishuContext(location.href)
  const docToken = (f?.kind === 'wiki' ? f.wikiToken : f?.documentId) ?? ''
  if (!docToken) { hide(); return }
  const payload = {
    type: 'OPEN_SIDE_PANEL_WITH_SELECTION',
    payload: { kind, docToken, docTitle: document.title || '', url: location.href, selectedText: sel.text },
  }
  chrome.runtime.sendMessage(payload).catch(() => { /* receiving end unavailable */ })
  hide()
}

function position(rect: DOMRect) {
  if (!host) return
  // Top-right of the selection rect, clamped into the viewport (avoid the native toolbar's
  // usual top/left spot). A 40px offset puts it just above the selection.
  const left = Math.min(Math.max(rect.right - 60, 6), window.innerWidth - 140)
  const top = Math.max(rect.top - 40, 6)
  host.style.left = `${left}px`
  host.style.top = `${top}px`
}

function show(rect: DOMRect) { ensureButton(); position(rect); if (host) host.style.display = '' }
function hide() { if (host) host.style.display = 'none' }

function refresh() {
  if (!docKind()) { hide(); return }
  const sel = currentSelection()
  if (!sel) { hide(); return }
  show(sel.rect)
}

// selectionchange covers both mouse-drag and keyboard selection; debounce (fires often mid-drag).
document.addEventListener('selectionchange', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150) })
// Some selections finalize on mouseup without a trailing selectionchange beat.
document.addEventListener('mouseup', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150) })
// Hide on scroll / resize so the button never drifts off the selection.
window.addEventListener('scroll', hide, { passive: true, capture: true })
window.addEventListener('resize', hide, { passive: true })
