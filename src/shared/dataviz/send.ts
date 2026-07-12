import { isFeishuOutboundAllowed } from '../config'

/**
 * Deliver a DATAVIZ_RENDER to the active tab's content script (which hosts the overlay).
 *
 * Chrome throws "Could not establish connection. Receiving end does not exist." when the
 * tab has no live content script — typically because the page was open BEFORE the extension
 * was (re)loaded, orphaning its content script. We recover by injecting the content script
 * on demand (we hold host permission for Feishu pages) and retrying; if that still fails,
 * we surface an actionable "refresh the page" error.
 */
export async function sendVizToActiveTab(payload: {
  /** Legacy LLM-generated JS (self-distribution builds). One of code/spec is present. */
  code?: string
  /** Plan B declarative spec (store / no-remote-code builds). */
  spec?: import('./spec').VizSpec
  data: unknown[]
  /** Optional named sub-tables (multi-sheet sites) — the render gets them as the `datasets` map. */
  datasets?: Record<string, unknown[]>
  name: string
  theme: 'light' | 'dark'
  /** Set only for a single-table Base site → enables editable cells / write-back in the overlay. */
  source?: { kind: 'base'; appToken: string; tableId: string }
  /** fieldName → Feishu typeName (with `source`) so edited cells are coerced to the right type. */
  fieldTypes?: Record<string, string>
}): Promise<void> {
  // `lastFocusedWindow` is more reliable than `currentWindow` from the side panel: the
  // side panel can itself steal window focus and resolve the wrong tab.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id) throw new Error('找不到当前标签页。')

  const url = tab.url ?? ''
  if (url && !isFeishuOutboundAllowed(url)) {
    throw new Error('请切换到飞书页面后再生成看板。')
  }

  // Generated/preview renders use a stable 'preview' window (re-generate/adjust updates it
  // in place); saved dashboards open their own window keyed by their id (via the background).
  const msg = { type: 'DATAVIZ_RENDER', vizId: 'preview', ...payload }

  async function trySend(): Promise<void> {
    await chrome.tabs.sendMessage(tab.id!, msg)
  }

  async function injectAndSend(delay = 200): Promise<void> {
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['src/content/index.js'] })
    await new Promise((r) => setTimeout(r, delay)) // let the script register its listener
    await chrome.tabs.sendMessage(tab.id!, msg)
  }

  try {
    await trySend()
    return
  } catch {
    // No live content script — inject it and retry.
  }
  try {
    await injectAndSend(200)
    return
  } catch {
    // Still failing (orphaned script / tab still loading) — one more attempt with a longer wait.
  }
  try {
    await injectAndSend(500)
    return
  } catch {
    throw new Error('无法连接当前页面。请刷新这个飞书页面后重试（扩展更新后，更新前已打开的页面需要刷新一次）。')
  }
}
