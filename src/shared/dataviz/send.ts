import { isFeishuOutboundAllowed } from '../config'

/**
 * Deliver a DATAVIZ_RENDER to the active tab's content script (which hosts the overlay).
 *
 * DATAVIZ_RENDER is fire-and-forget — the content script renders synchronously and does NOT
 * call sendResponse. On some Chrome versions `chrome.tabs.sendMessage` rejects with
 * "The message port closed before a response was received" in that case, even though the
 * message was delivered fine. We distinguish that from a genuine "no content script"
 * failure ("Could not establish connection. Receiving end does not exist.") so the user
 * never sees a false "无法连接当前页面" error.
 *
 * If the content script truly doesn't exist (extension was reloaded after the page opened),
 * we recover by injecting it on demand (we hold host permission for Feishu pages) and
 * retrying; if that still fails, we surface an actionable "refresh the page" error.
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

  const msg = { type: 'DATAVIZ_RENDER', vizId: 'preview', ...payload }

  /** Send a fire-and-forget message. Returns true if delivered (or delivered-but-no-response),
   *  false only if no content script exists ("Receiving end does not exist"). */
  async function deliver(): Promise<boolean> {
    try {
      await chrome.tabs.sendMessage(tab.id!, msg)
      return true
    } catch (e) {
      const s = e instanceof Error ? e.message : String(e)
      // "Receiving end does not exist." → no content script on this tab.
      if (s.includes('Receiving end does not exist')) return false
      // "The message port closed before a response was received." → the message WAS delivered
      // to the content script, but it didn't call sendResponse (fire-and-forget). NOT a failure.
      return true
    }
  }

  // 1) Try sending to the existing content script.
  if (await deliver()) return

  // 2) No content script (extension reloaded / page not refreshed) — inject on demand.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['src/content/index.js'] })
    await new Promise((r) => setTimeout(r, 300)) // let the script register its listener
    if (await deliver()) return
  } catch { /* executeScript failed (permissions / tab closed) — fall through */ }

  // 3) One more attempt with a longer wait (slow page / SPA still loading).
  try {
    await new Promise((r) => setTimeout(r, 400))
    if (await deliver()) return
  } catch { /* final fall-through */ }

  throw new Error('无法连接当前页面。请刷新这个飞书页面后重试（扩展更新后，更新前已打开的页面需要刷新一次）。')
}
