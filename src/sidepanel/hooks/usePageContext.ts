import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '@/shared/types'
import { parseFeishuContext } from '@/shared/feishu/pageUrl'
import { resolveToken } from '@/shared/feishu/auth'
import { getDocumentMeta } from '@/shared/feishu/docx'
import { getSpreadsheet } from '@/shared/feishu/sheets'

export interface PageContextApi {
  ctx: PageContext
  setCtx: React.Dispatch<React.SetStateAction<PageContext>>
  /** Apply a context update, substituting an already-resolved wiki resource from the cache
   *  so refreshCtx (tab events) doesn't keep flipping wiki↔doc and thrash the bound session. */
  applyCtx: (next: PageContext) => void
  refreshCtx: (tabId?: number) => Promise<void>
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
  const [ctx, setCtx] = useState<PageContext>({ url: '', title: '', selectedText: '' })

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
  }, [wikiCacheRef])

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

  return { ctx, setCtx, applyCtx, refreshCtx }
}
