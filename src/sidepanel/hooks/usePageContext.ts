import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '@/shared/types'
import { parseFeishuContext } from '@/shared/feishu/pageUrl'
import { resolveToken } from '@/shared/feishu/auth'
import { getDocumentMeta } from '@/shared/feishu/docx'
import { getSpreadsheet } from '@/shared/feishu/sheets'
import { getApp } from '@/shared/feishu/api'

export interface PageContextApi {
  ctx: PageContext
  setCtx: React.Dispatch<React.SetStateAction<PageContext>>
  /** Apply a context update, substituting an already-resolved wiki resource from the cache
   *  so refreshCtx (tab events) doesn't keep flipping wiki↔doc and thrash the bound session. */
  applyCtx: (next: PageContext) => void
  refreshCtx: (tabId?: number) => Promise<void>
}

/** Compare two feishu resource descriptors by their meaningful identity fields only
 *  (kind + all token variants + isBase + tableId). Reference-unequal but content-equal
 *  feishu objects are treated as equal so async enrichment (wiki resolve, title fetch)
 *  doesn't churn the ctx reference and propagate jitter to chatContext/ChatPanel. */
function feishuEqual(a: PageContext['feishu'], b: PageContext['feishu']): boolean {
  if (a === b) return true
  if (!a || !b) return a === b
  return a.kind === b.kind
    && a.isBase === b.isBase
    && a.appToken === b.appToken
    && a.spreadsheetToken === b.spreadsheetToken
    && a.documentId === b.documentId
    && a.wikiToken === b.wikiToken
    && a.slideToken === b.slideToken
    && a.whiteboardId === b.whiteboardId
    && a.tableId === b.tableId
}

/** Compare two PageContexts by meaningful fields. Used by the setCtx wrapper to skip
 *  reference-only updates (a new object with the same url/title/selectedText/feishu content)
 *  that would otherwise cascade through seenDocCtxRef → chatContext → ChatPanel and cause
 *  the tab-switch title/kind jitter. */
function pageContextEqual(a: PageContext, b: PageContext): boolean {
  return a.url === b.url
    && a.title === b.title
    && a.selectedText === b.selectedText
    && feishuEqual(a.feishu, b.feishu)
}

/**
 * The focused tab's Feishu page context: acquisition (tab/message listeners → ctx) and
 * enrichment (real doc/sheet titles via API, since the SPA document.title is unreliable on
 * private/on-prem deploys). Wiki RESOLUTION lives in useWikiResolve (it writes the shared
 * cache this hook reads via applyCtx). Extracted from App.
 */
export function usePageContext(
  settings: AppSettings,
  wikiCacheRef: React.MutableRefObject<Map<string, NonNullable<PageContext['feishu']>>>,
): PageContextApi {
  const [ctx, setCtxRaw] = useState<PageContext>({ url: '', title: '', selectedText: '' })

  // Idempotent setCtx wrapper: skip the update when the next ctx is meaningfully equal to
  // the prev (same url/title/selectedText/feishu identity fields). Without this, the tab-
  // switch enrichment chain (applyCtx → wiki resolve → doc/sheet/base title fetch) creates
  // a new ctx reference on every step even when nothing meaningful changed, and each new
  // reference cascades through seenDocCtxRef → chatContext useMemo → ChatPanel/DocSelector
  // re-renders — the visible "title flickers between two values" jitter. Returning the SAME
  // prev reference makes React bail out of the state update entirely.
  const setCtx = useCallback<React.Dispatch<React.SetStateAction<PageContext>>>((updater) => {
    setCtxRaw((prev) => {
      const next = typeof updater === 'function'
        ? (updater as (c: PageContext) => PageContext)(prev)
        : updater
      if (next === prev) return prev
      if (pageContextEqual(next, prev)) return prev
      return next
    })
  }, [])

  // Real titles of /docx/ and /sheets/ pages — cached per id for an instant apply, with a
  // fresh fetch on each visit so a rename syncs in.
  const docTitleCacheRef = useRef<Map<string, string>>(new Map())

  const applyCtx = useCallback((next: PageContext) => {
    let feishu = next.feishu
    if (feishu?.kind === 'wiki' && feishu.wikiToken) {
      const cached = wikiCacheRef.current.get(feishu.wikiToken)
      if (cached) feishu = cached
    }
    setCtx({ ...next, feishu })
  }, [wikiCacheRef, setCtx])

  const refreshCtx = useCallback(async (tabId?: number) => {
    try {
      // Prefer the EXACT tab from the event (onActivated/onUpdated). `currentWindow` is
      // unreliable from a side panel — it can resolve to the wrong window.
      let tab: chrome.tabs.Tab | undefined
      if (tabId != null) tab = await chrome.tabs.get(tabId).catch(() => undefined)
      if (!tab) { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); tab = t }
      if (!tab?.id) return
      try {
        const resp = (await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' })) as PageContext | undefined
        if (resp) {
          // A stale content script may not detect Sheets/Docs — always (re)derive from URL.
          const url = resp.url || tab.url || ''
          applyCtx({ ...resp, feishu: resp.feishu ?? parseFeishuContext(url) })
          return
        }
      } catch { /* content script not injected yet — fall back to URL parsing */ }
      const url = tab.url ?? ''
      applyCtx({ url, title: tab.title ?? '', selectedText: '', feishu: parseFeishuContext(url) })
    } catch { /* tab without access */ }
  }, [applyCtx])

  // Follow tab switches (exact tab id), SPA navigation, and window focus.
  useEffect(() => {
    void refreshCtx()
    const onActivated = (info: chrome.tabs.TabActiveInfo) => void refreshCtx(info.tabId)
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (info.status === 'complete' || info.url)) void refreshCtx(_id)
    }
    const onFocus = (windowId: number) => { if (windowId !== chrome.windows.WINDOW_ID_NONE) void refreshCtx() }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.windows?.onFocusChanged?.addListener(onFocus)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.windows?.onFocusChanged?.removeListener(onFocus)
    }
  }, [refreshCtx])

  const docId = ctx.feishu?.kind === 'doc' ? ctx.feishu.documentId : undefined
  useEffect(() => {
    if (!docId) return
    const applyTitle = (t: string) => setCtx((c) =>
      c.feishu?.kind === 'doc' && c.feishu.documentId === docId ? { ...c, title: t } : c)
    const cached = docTitleCacheRef.current.get(docId)
    if (cached) applyTitle(cached)
    let cancelled = false
    void (async () => {
      try {
        const meta = await getDocumentMeta(await resolveToken(settings), docId)
        const t = meta?.document?.title?.trim()
        if (t && !cancelled) { docTitleCacheRef.current.set(docId, t); applyTitle(t) }
      } catch { /* keep document.title fallback */ }
    })()
    return () => { cancelled = true }
  }, [docId, settings])

  const sheetToken = ctx.feishu?.kind === 'sheet' ? ctx.feishu.spreadsheetToken : undefined
  useEffect(() => {
    if (!sheetToken) return
    const cacheKey = 'sheet:' + sheetToken
    const applyTitle = (t: string) => setCtx((c) =>
      c.feishu?.kind === 'sheet' && c.feishu.spreadsheetToken === sheetToken ? { ...c, title: t } : c)
    const cached = docTitleCacheRef.current.get(cacheKey)
    if (cached) applyTitle(cached)
    let cancelled = false
    void (async () => {
      try {
        const meta = (await getSpreadsheet(await resolveToken(settings), sheetToken)) as { spreadsheet?: { title?: string } }
        const t = meta?.spreadsheet?.title?.trim()
        if (t && !cancelled) { docTitleCacheRef.current.set(cacheKey, t); applyTitle(t) }
      } catch { /* keep document.title fallback */ }
    })()
    return () => { cancelled = true }
  }, [sheetToken, settings])

  // Base (多维表格) — same enrichment as doc/sheet: the SPA tab.title is "Name - 多维表格 - 飞书云文档"
  // and only half-cleans to "Name - 多维表格" via cleanDocTitle. The bitable API returns the real
  // app.name, which then propagates to the recent-files list via the useRecentFiles title-dep effect.
  const appToken = ctx.feishu?.kind === 'base' ? ctx.feishu.appToken : undefined
  useEffect(() => {
    if (!appToken) return
    const cacheKey = 'base:' + appToken
    const applyTitle = (t: string) => setCtx((c) =>
      c.feishu?.kind === 'base' && c.feishu.appToken === appToken ? { ...c, title: t } : c)
    const cached = docTitleCacheRef.current.get(cacheKey)
    if (cached) applyTitle(cached)
    let cancelled = false
    void (async () => {
      try {
        const meta = (await getApp(await resolveToken(settings), appToken)) as { app?: { name?: string } }
        const t = meta?.app?.name?.trim()
        if (t && !cancelled) { docTitleCacheRef.current.set(cacheKey, t); applyTitle(t) }
      } catch { /* keep document.title fallback */ }
    })()
    return () => { cancelled = true }
  }, [appToken, settings])

  return { ctx, setCtx, applyCtx, refreshCtx }
}
