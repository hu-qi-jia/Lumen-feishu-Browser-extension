// Background service worker.
//
// The side panel is available on EVERY tab (its default_path in manifest enables it
// globally). We deliberately do NOT gate it per-tab: the old per-tab enable/disable
// (a) tore the panel document down on tab switch — killing any in-flight task (e.g. a
// running clip write), and (b) could wedge a tab's panel "un-reopenable" until the
// extension was reinstalled. The React UI decides what to show per page (Feishu
// assistant / clip flow / a hint on other sites).
import { CLIP_ENABLED, NO_REMOTE_CODE } from '../shared/config'
import { captureClip, captureClipScrolling } from '../shared/clip/capture'
import { MAX_CLIP_CHARS } from '../shared/clip/types'
import type { ClipCapture } from '../shared/clip/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import type { AppSettings, DocSelectionPayload } from '../shared/types'
import { decryptField } from '../shared/crypto'
import { fetchVizData, fetchDocDatasets, docOf } from '../shared/dataviz/data'
import { loadVizList } from '../shared/dataviz/store'
import { loadDecks } from '../shared/ai/slidesStore'
import { resolveToken } from '../shared/feishu/auth'
import { batchUpdateRecords, getWikiNode } from '../shared/feishu/api'
import { applyInBatches } from '../shared/feishu/compose'
import { createTask } from '../shared/feishu/task'
import { fetchGitHubTrending } from '../shared/news/github'
import { translateDescriptions, applyTranslationCache } from '../shared/news/github'
import { fetchWeiboHotSearch } from '../shared/news/weibo'
import { loadNewsSettings, saveNewsCacheEntry, loadNewsCache } from '../shared/news/store'
import { NEWS_ALARM_NAME, syncNewsAlarm } from '../shared/news/alarm'
import type { NewsSourceId } from '../shared/news/types'
import {
  CLEANUP_ALARM,
  clearAllUserData,
  loadCleanupSettings,
  saveCleanupSettings,
  syncCleanupAlarm,
} from '../shared/dataCleanup'

// Clicking the toolbar icon opens the panel on any page (and closing with → clicking
// again reopens it). No per-tab state to get stuck.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

// ─── Web Clipper ───────────────────────────────────────────────────────────────

// One-shot stash bridging the open()→panel-mount gap: a freshly-opened panel pulls this
// via CLIP_REQUEST (the immediate CLIP_CAPTURE push below can race ahead of mount).
let lastClip: { payload?: ClipCapture; error?: string; at: number } | null = null

/**
 * Capture the active tab into the side panel. MUST run inside a user-gesture handler
 * (context menu / keyboard command): both `chrome.sidePanel.open()` and
 * `chrome.scripting.executeScript` under `activeTab` require a gesture.
 */
function clipActiveTab(tabId: number): void {
  if (!CLIP_ENABLED) return
  chrome.sidePanel.open({ tabId }).catch(() => {}) // already-open panels just no-op
  void runCapture(tabId)
}

async function runCapture(tabId: number): Promise<void> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: captureClip,
      args: [MAX_CLIP_CHARS],
    })
    const payload = res?.result as ClipCapture | undefined
    if (!payload) throw new Error('empty capture')
    lastClip = { payload, at: Date.now() }
    chrome.runtime.sendMessage({ type: 'CLIP_CAPTURE', payload }).catch(() => {})
  } catch {
    // Restricted pages (chrome://, the Web Store, other extensions, view-source) can't be
    // scripted even with activeTab — surface a friendly notice instead of failing silently.
    const message = '此页面不支持剪藏（浏览器限制了对该页的访问）'
    lastClip = { error: message, at: Date.now() }
    chrome.runtime.sendMessage({ type: 'CLIP_ERROR', message }).catch(() => {})
  }
}

// Full-table capture: auto-scroll a virtualized grid, accumulating all rows. Same
// activeTab/executeScript gesture model — no new permission. Bounded by maxSteps × delay.
const SCROLL_MAX_STEPS = 60
const SCROLL_STEP_DELAY_MS = 350

function scrollCaptureActiveTab(tabId: number): void {
  if (!CLIP_ENABLED) return
  chrome.sidePanel.open({ tabId }).catch(() => {})
  void runScrollCapture(tabId)
}

async function runScrollCapture(tabId: number): Promise<void> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: captureClipScrolling,
      args: [MAX_CLIP_CHARS, SCROLL_MAX_STEPS, SCROLL_STEP_DELAY_MS],
    })
    const payload = res?.result as ClipCapture | undefined
    if (!payload) throw new Error('empty capture')
    lastClip = { payload, at: Date.now() }
    chrome.runtime.sendMessage({ type: 'CLIP_CAPTURE', payload }).catch(() => {})
  } catch {
    const message = '此页面无法滚动抓取（浏览器限制了对该页的访问）'
    lastClip = { error: message, at: Date.now() }
    chrome.runtime.sendMessage({ type: 'CLIP_ERROR', message }).catch(() => {})
  }
}

// Screenshot the visible tab → side panel runs vision OCR on it. captureVisibleTab is
// covered by `activeTab` under the gesture — no new permission. Visible viewport only.
function screenshotActiveTab(tab: chrome.tabs.Tab): void {
  if (!CLIP_ENABLED || tab.id == null) return
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
  void runScreenshot(tab)
}

async function runScreenshot(tab: chrome.tabs.Tab): Promise<void> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    if (!dataUrl) throw new Error('empty shot')
    const payload: ClipCapture = {
      url: tab.url ?? '', title: tab.title ?? '', selectedText: '',
      content: '', imageDataUrl: dataUrl, capturedAt: Date.now(), truncated: false,
    }
    lastClip = { payload, at: Date.now() }
    chrome.runtime.sendMessage({ type: 'CLIP_CAPTURE', payload }).catch(() => {})
  } catch {
    const message = '此页面不支持截图（浏览器限制了对该页的访问）'
    lastClip = { error: message, at: Date.now() }
    chrome.runtime.sendMessage({ type: 'CLIP_ERROR', message }).catch(() => {})
  }
}

if (CLIP_ENABLED) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create(
      { id: 'clip-to-base', title: '剪藏到飞书', contexts: ['selection', 'page', 'link', 'image'] },
      () => void chrome.runtime.lastError, // ignore "duplicate id" on SW restart
    )
    chrome.contextMenus.create(
      { id: 'scroll-clip-to-base', title: '剪藏整张表（滚动加载全部行）', contexts: ['page'] },
      () => void chrome.runtime.lastError,
    )
    chrome.contextMenus.create(
      { id: 'screenshot-to-base', title: '截图识别到飞书（视觉模型）', contexts: ['page', 'image'] },
      () => void chrome.runtime.lastError,
    )
  })
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'clip-to-base' && tab?.id != null) clipActiveTab(tab.id)
    else if (info.menuItemId === 'scroll-clip-to-base' && tab?.id != null) scrollCaptureActiveTab(tab.id)
    else if (info.menuItemId === 'screenshot-to-base' && tab) screenshotActiveTab(tab)
  })
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'clip_to_base' && tab?.id != null) clipActiveTab(tab.id)
  })
  // Panel pulls the pending clip on mount (handles the open→message race), one-shot.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'CLIP_REQUEST') {
      sendResponse(lastClip)
      lastClip = null
      return false
    }
    return undefined
  })
}

// ─── Saved-viz launcher (background renders, since it holds Feishu host access) ──

async function loadSettingsBg(): Promise<AppSettings | null> {
  const r = await chrome.storage.local.get(['settings_v2'])
  const s = r.settings_v2 as Record<string, string> | undefined
  if (!s) return null
  return {
    ...DEFAULT_SETTINGS,
    openaiBaseUrl: s.openaiBaseUrl ?? DEFAULT_SETTINGS.openaiBaseUrl,
    openaiModel: s.openaiModel ?? DEFAULT_SETTINGS.openaiModel,
    openaiApiKey: await decryptField(s.openaiApiKey ?? ''),
    feishuAccessToken: await decryptField(s.feishuAccessToken ?? ''),
    feishuOwnerOpenId: s.feishuOwnerOpenId ?? '',
  }
}

// The launcher pill (content script) asks the background to open a saved viz: fetch LIVE
// data (no LLM) and render the saved code in the page overlay.
// Resolve a Wiki node → its real resource (Base/Sheet/Doc) for the page launcher. A content
// script can't do this (it has no token), so on a Base/Sheet opened via 知识库(Wiki) the launcher
// only sees a 'wiki' URL and shows NO saved-site pills. We resolve here so it can match.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'RESOLVE_PAGE_RESOURCE' || !msg.wikiToken) return undefined
  void (async () => {
    let resolved: unknown = null
    try {
      const settings = await loadSettingsBg()
      if (settings) {
        const token = await resolveToken(settings)
        const res = (await getWikiNode(token, msg.wikiToken as string)) as { node?: { obj_type: string; obj_token: string } }
        const n = res.node
        if (n?.obj_type === 'bitable') resolved = { kind: 'base', appToken: n.obj_token }
        else if (n?.obj_type === 'sheet') resolved = { kind: 'sheet', spreadsheetToken: n.obj_token }
        else if (n?.obj_type === 'docx' || n?.obj_type === 'doc') resolved = { kind: 'doc', documentId: n.obj_token }
      }
    } catch { /* leave null → launcher keeps treating it as wiki (no pills), retries next time */ }
    try { sendResponse(resolved) } catch { /* channel closed */ }
  })()
  return true // async sendResponse
})

// ─── Selection → side panel: open the panel + stash the payload so the panel can pull it on
// mount (mirrors the CLIP_REQUEST pattern — covers the open→message race where the panel
// isn't listening yet). The button click is the user gesture MV3 requires for sidePanel.open.
let pendingSelection: { payload: DocSelectionPayload; at: number } | null = null
const SELECTION_TTL_MS = 3000

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'OPEN_SIDE_PANEL_WITH_SELECTION') return undefined
  const payload = msg.payload as DocSelectionPayload | undefined
  if (!payload?.docToken || !payload?.selectedText) return undefined
  pendingSelection = { payload, at: Date.now() }
  const tabId = sender.tab?.id
  if (tabId != null) chrome.sidePanel.open({ tabId }).catch(() => {})
  // Best-effort push to an already-open panel (no-op if none listening yet — the pull covers it).
  try { chrome.runtime.sendMessage({ type: 'SELECTION_INCOMING', payload }) } catch { /* panel not open */ }
  return undefined
})

// Panel pulls the pending selection on mount (handles the open→message race), one-shot + TTL.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'SELECTION_REQUEST') return undefined
  const s = pendingSelection
  pendingSelection = null
  if (s && Date.now() - s.at > SELECTION_TTL_MS) { sendResponse(null); return false } // stale → drop
  sendResponse(s?.payload ?? null)
  return false
})

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'DATAVIZ_OPEN_SAVED' || sender.tab?.id == null) return undefined
  const tabId = sender.tab.id
  void (async () => {
    try {
      const settings = await loadSettingsBg()
      if (!settings) return
      const viz = (await loadVizList()).find((v) => v.id === msg.vizId)
      if (!viz) return
      // Multi-sheet site → re-fetch ALL sub-tables; otherwise just the one source.
      let dataRows: unknown[]
      let datasets: Record<string, unknown[]> | undefined
      let fieldTypes: Record<string, string> | undefined
      if (viz.multi) {
        const ds = await fetchDocDatasets(settings, docOf(viz.source), 1000)
        dataRows = ds[0]?.rows ?? []
        datasets = Object.fromEntries(ds.map((d) => [d.name, d.rows]))
      } else {
        const vd = await fetchVizData(settings, viz.source, 2000)
        dataRows = vd.rows
        // Column types so edited cells coerce to the right write-back type (else batch rejected).
        fieldTypes = vd.schema.length ? Object.fromEntries(vd.schema.map((f) => [f.name, f.type])) : undefined
      }
      // Single-table Base saved site → pass source so the overlay enables editable write-back.
      const source = !viz.multi && viz.source.kind === 'base' ? viz.source : undefined
      chrome.tabs.sendMessage(tabId, { type: 'DATAVIZ_RENDER', vizId: viz.id, code: viz.code, spec: viz.spec, data: dataRows, datasets, name: viz.name, theme: 'light', source, fieldTypes: source ? fieldTypes : undefined }).catch(() => {})
    } catch { /* surfaced as no overlay; the pill stays */ }
  })()
  return undefined
})

// Launcher pill for a saved PPT deck → render the slides in the page overlay. Mirrors
// SlidesPanel.showDeck: embed (看板) slides re-fetch their table rows live; others are self-contained.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'DATAVIZ_OPEN_DECK' || sender.tab?.id == null) return undefined
  const tabId = sender.tab.id
  void (async () => {
    try {
      const settings = await loadSettingsBg()
      if (!settings) return
      const deck = (await loadDecks()).find((d) => d.id === msg.deckId)
      if (!deck) return
      const hasEmbed = deck.slides.some((s) => s.layout === 'embed')
      const rows = hasEmbed && deck.source ? (await fetchVizData(settings, deck.source, 2000)).rows : []
      const payload = NO_REMOTE_CODE
        ? { spec: { kind: 'slides', slides: deck.slides }, data: rows }
        : {
            code: hasEmbed ? "ui.slides(container, data, (datasets && datasets['默认']) || [])" : 'ui.slides(container, data)',
            data: deck.slides, datasets: hasEmbed ? { 默认: rows } : undefined,
          }
      chrome.tabs.sendMessage(tabId, { type: 'DATAVIZ_RENDER', vizId: deck.id, name: deck.name, theme: 'light', ...payload }).catch(() => {})
    } catch { /* no overlay; the pill stays */ }
  })()
  return undefined
})

// Write-back: the overlay's 提交 button (already user-confirmed) sends staged edits here; we
// batch_update the Base table AS THE USER, then report back so the overlay can clear drafts.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'DATAVIZ_WRITE_BACK' || sender.tab?.id == null) return undefined
  const tabId = sender.tab.id
  const vizId = msg.vizId ?? 'preview'
  void (async () => {
    let result: { ok: boolean; done?: number; failed?: string; remaining?: number; note?: string }
    try {
      const settings = await loadSettingsBg()
      if (!settings) throw new Error('未配置 API Key / 飞书授权')
      const token = await resolveToken(settings)
      const src = msg.source as { appToken: string; tableId: string }
      const edits = (msg.edits ?? []) as Array<{ record_id: string; fields: Record<string, unknown> }>
      if (!src?.appToken || !src?.tableId || !edits.length) throw new Error('没有可写回的修改')
      const w = await applyInBatches(edits, (b) => batchUpdateRecords(token, src.appToken, src.tableId, b))
      result = { ok: !w.failed, done: w.done, failed: w.failed, remaining: w.remaining, note: w.failed ? undefined : `已写回 ${w.done} 行` }
    } catch (e) {
      result = { ok: false, failed: e instanceof Error ? e.message : String(e) }
    }
    chrome.tabs.sendMessage(tabId, { type: 'DATAVIZ_WRITE_RESULT', vizId, ...result }).catch(() => {})
  })()
  return undefined
})

// Per-row quick action (建任务) from a generated site → run as the user, report back. NOTE the
// `rowAction: true` marker on the result: this path shares DATAVIZ_WRITE_RESULT with write-back,
// but the overlay must NOT clear staged cell-edit drafts when a row-action succeeds.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'DATAVIZ_ROW_ACTION' || sender.tab?.id == null) return undefined
  const tabId = sender.tab.id
  const vizId = msg.vizId ?? 'preview'
  void (async () => {
    let result: { ok: boolean; failed?: string; note?: string }
    try {
      const settings = await loadSettingsBg()
      if (!settings) throw new Error('未配置 API Key / 飞书授权')
      const token = await resolveToken(settings)
      const action = (msg.action ?? {}) as { kind?: string; summary?: string }
      if (action.kind === 'task' && action.summary?.trim()) {
        await createTask(token, action.summary.trim())
        result = { ok: true, note: '已创建任务' }
      } else {
        throw new Error('不支持的操作')
      }
    } catch (e) {
      result = { ok: false, failed: e instanceof Error ? e.message : String(e) }
    }
    chrome.tabs.sendMessage(tabId, { type: 'DATAVIZ_WRITE_RESULT', vizId, rowAction: true, ...result }).catch(() => {})
  })()
  return undefined
})

// ─── News refresh (GitHub Trending + Weibo hot search) ─────────────────────────
//
// The side panel is a pure view of chrome.storage.local['news_cache_v1']; all fetching
// happens here in the SW (alarms wake a stopped SW, the panel doesn't). The alarm fires
// on install and on every interval tick; the panel can also request an immediate refresh
// via NEWS_REFRESH (manual refresh button). GitHub uses plain host_permissions CORS;
// Weibo needs the declarativeNetRequest Referer rule (see rules/news_referer.json).

async function refreshNewsSource(source: NewsSourceId): Promise<void> {
  const settings = await loadNewsSettings()
  if (source === 'github' && !settings.enabled.github) return
  if (source === 'weibo' && !settings.enabled.weibo) return
  try {
    if (source === 'github') {
      const items = await fetchGitHubTrending(settings.githubSince)
      // Apply cached translations (instant — no API call) so previously-translated
      // descriptions show up on refresh. The user clicks the translate button for new ones.
      await applyTranslationCache(items).catch(() => {})
      await saveNewsCacheEntry('github', { items, fetchedAt: Date.now() })
    } else {
      const items = await fetchWeiboHotSearch()
      await saveNewsCacheEntry('weibo', { items, fetchedAt: Date.now() })
    }
  } catch (e) {
    // Record the error but keep the last successful list (stale) so the UI doesn't go blank.
    const failed = e instanceof Error ? e.message : String(e)
    const prev = (await loadNewsCache())[source]
    await saveNewsCacheEntry(source, {
      items: prev?.items ?? [],
      fetchedAt: prev?.fetchedAt ?? Date.now(),
      error: failed,
    })
  }
}

async function refreshAllNews(): Promise<void> {
  await Promise.allSettled([refreshNewsSource('github'), refreshNewsSource('weibo')])
}

// On install / SW startup: re-arm based on stored settings. chrome.runtime.onInstalled
// fires once per install/update; for a fresh install the default settings (interval 30,
// both sources on) are used and the first fetch fires after one interval.
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const s = await loadNewsSettings()
    syncNewsAlarm(s.enabled, s.interval)
    syncCleanupAlarm((await loadCleanupSettings()).intervalDays)
  })()
})

// Alarm tick. Each feature owns one alarm name; route by name. Use Promise.allSettled for
// news so a single source failing (e.g. Weibo 5xx) doesn't block the other from caching.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NEWS_ALARM_NAME) {
    void refreshAllNews()
    return
  }
  if (alarm.name === CLEANUP_ALARM) {
    // 定期清理：清掉除配置/凭证外的全部用户数据（会话/PPT/建站/PDF/图片/经验/缓存），不可逆。
    void (async () => {
      await clearAllUserData()
      const cs = await loadCleanupSettings()
      await saveCleanupSettings({ ...cs, lastCleanedAt: Date.now() })
    })()
  }
})

// Manual refresh from the side panel (no LLM, no auth — straight fetch). The panel sends
// NEWS_REFRESH with an optional `source` ('github' | 'weibo') so only the visible list is
// re-fetched; omit `source` to refresh both (alarm path). Responds with the freshly-written
// cache so the panel doesn't have to re-read storage on the round trip.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'NEWS_REFRESH') return undefined
  const source = msg?.source as NewsSourceId | undefined
  void (async () => {
    if (source === 'github' || source === 'weibo') {
      await refreshNewsSource(source)
    } else {
      await refreshAllNews()
    }
    try { sendResponse({ ok: true, cache: await loadNewsCache() }) } catch { sendResponse({ ok: false }) }
  })()
  return true // async sendResponse
})

// Manual translate button: translate GitHub descriptions via the selected engine.
// Unlike NEWS_REFRESH, this calls the translation API (Bing or AI) for descriptions not
// yet in the cache. The panel shows a loading state on the translate icon while this runs.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'NEWS_TRANSLATE') return undefined
  void (async () => {
    const settings = await loadNewsSettings()
    if (settings.translationEngine === 'off') {
      try { sendResponse({ ok: true, cache: await loadNewsCache() }) } catch { sendResponse({ ok: false }) }
      return
    }
    const newsCache = await loadNewsCache()
    const gh = newsCache.github
    if (gh?.items.length) {
      const app = settings.translationEngine === 'ai' ? await loadSettingsBg() : null
      await translateDescriptions(settings.translationEngine, gh.items, app ?? undefined).catch(() => {})
      await saveNewsCacheEntry('github', { items: gh.items, fetchedAt: gh.fetchedAt })
    }
    try { sendResponse({ ok: true, cache: await loadNewsCache() }) } catch { sendResponse({ ok: false }) }
  })()
  return true // async sendResponse
})

// When the user changes news settings in the panel: re-arm the alarm to match.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes.news_settings_v1) {
    const next = changes.news_settings_v1.newValue as { enabled?: { github?: boolean; weibo?: boolean }; interval?: number } | undefined
    if (next) {
      syncNewsAlarm(
        { github: !!next.enabled?.github, weibo: !!next.enabled?.weibo },
        (next.interval ?? 30) as 10 | 30 | 60,
      )
    }
  }
  // Data-cleanup interval changed → re-arm the cleanup alarm to match. lastCleanedAt-only
  // writes also land here; re-arming just restarts the countdown (a no-op when interval is 0).
  if (changes.cleanup_settings_v1) {
    const next = changes.cleanup_settings_v1.newValue as { intervalDays?: number } | undefined
    syncCleanupAlarm((next?.intervalDays ?? 0) as 0 | 3 | 7 | 30)
  }
})


