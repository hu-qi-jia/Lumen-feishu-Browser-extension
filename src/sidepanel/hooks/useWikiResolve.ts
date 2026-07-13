import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, PageContext, SessionKind } from '@/shared/types'
import { mergeResolvedWiki } from '../lib/wikiResolve'
import { resolveToken, isTokenExpiredError, forceRefreshUserToken } from '@/shared/feishu/auth'
import * as API from '@/shared/feishu/api'

/** Map a resolved wiki node's obj_type to a PageContext.feishu resource. */
export function wikiToFeishu(objType: string, objToken: string): PageContext['feishu'] | undefined {
  if (objType === 'bitable') return { isBase: true, kind: 'base', appToken: objToken }
  if (objType === 'sheet') return { isBase: false, kind: 'sheet', spreadsheetToken: objToken }
  if (objType === 'docx' || objType === 'doc') return { isBase: false, kind: 'doc', documentId: objToken }
  if (objType === 'board') return { isBase: false, kind: 'board', whiteboardId: objToken }
  return undefined
}

export interface WikiResolveApi {
  /** Resolve a wiki node to its real resource KIND (doc/sheet/base). Shared by the
   *  doc-selector dropdown + history drawer (display) and the cross-doc session switch
   *  (pin-kind detection). Reuses the shared cache. */
  resolveWikiKind: (wikiToken: string) => Promise<SessionKind | undefined>
  /** Resolve a wiki node to its real kind + obj_token (e.g. appToken / spreadsheetToken).
   *  Reuses the shared cache — no extra API call if already resolved by resolveWikiKind
   *  or the focused-tab effect. Used by the refdoc picker to skip the full
   *  resolveDocRefFromUrl round-trip for wiki-typed recent files. */
  resolveWikiNode: (wikiToken: string) => Promise<{ kind: SessionKind; docToken: string } | undefined>
  /** True when a Feishu call failed because the user session expired AND can't refresh. */
  authExpired: boolean
}

/**
 * Wiki-node → real-resource resolution for the FOCUSED tab (writes ctx via the shared
 * cache). The PINNED-wiki resolution lives in useDocBinding (it owns `pinned`). Extracted
 * from App; both paths share the wikiCacheRef created in App.
 */
export function useWikiResolve(
  settings: AppSettings,
  ctx: PageContext,
  setCtx: React.Dispatch<React.SetStateAction<PageContext>>,
  wikiCacheRef: React.MutableRefObject<Map<string, NonNullable<PageContext['feishu']>>>,
): WikiResolveApi {
  const [authExpired, setAuthExpired] = useState(false)
  // Re-authorizing (new token saved) clears the expired state.
  useEffect(() => { setAuthExpired(false) }, [settings.feishuAccessToken])

  const wikiToken = ctx.feishu?.kind === 'wiki' ? ctx.feishu.wikiToken : undefined
  useEffect(() => {
    if (!wikiToken) return
    const cached = wikiCacheRef.current.get(wikiToken)
    if (cached) { setCtx((c) => ({ ...c, feishu: cached })); return }
    let cancelled = false
    void (async () => {
      const resolveWith = async (token: string): Promise<void> => {
        const res = (await API.getWikiNode(token, wikiToken)) as {
          node?: { obj_type: string; obj_token: string; title?: string }
        }
        const n = res.node
        if (!n || cancelled) return
        const resolved = wikiToFeishu(n.obj_type, n.obj_token)
        if (!resolved) {
          // Unsupported wiki obj (mindnote / file / …) — drop to the general homepage.
          wikiCacheRef.current.set(wikiToken, { isBase: false })
          setCtx((c) => mergeResolvedWiki(c, wikiToken, undefined))
          return
        }
        // Keep wikiToken on the resolved resource → the session key stays the stable wikiToken.
        const withWiki = { ...resolved, wikiToken }
        wikiCacheRef.current.set(wikiToken, withWiki)
        setCtx((c) => mergeResolvedWiki(c, wikiToken, withWiki, n.title))
      }
      try {
        await resolveWith(await resolveToken(settings))
        if (!cancelled) setAuthExpired(false)
      } catch (e) {
        // Expired session is the common cause of a "stuck on 知识库" page. Try a forced
        // refresh once; if the refresh_token is also dead, raise the "登录已失效" banner.
        if (isTokenExpiredError(e)) {
          const fresh = await forceRefreshUserToken().catch(() => null)
          if (fresh) {
            try { await resolveWith(fresh); if (!cancelled) setAuthExpired(false); return } catch { /* still bad → expired */ }
          }
          if (!cancelled) setAuthExpired(true)
        }
        // Other errors (e.g. missing wiki scope) → leave as 知识库, unresolved.
      }
    })()
    return () => { cancelled = true }
  }, [wikiToken, settings, setCtx, wikiCacheRef])

  const resolveWikiKind = useCallback(async (wikiToken: string): Promise<SessionKind | undefined> => {
    const cached = wikiCacheRef.current.get(wikiToken)
    if (cached?.kind && cached.kind !== 'wiki') return cached.kind
    try {
      const res = (await API.getWikiNode(await resolveToken(settings), wikiToken)) as {
        node?: { obj_type: string; obj_token: string }
      }
      const n = res.node
      if (!n) return undefined
      const f = wikiToFeishu(n.obj_type, n.obj_token)
      if (!f) return undefined
      wikiCacheRef.current.set(wikiToken, { ...f, wikiToken })
      return f.kind
    } catch { return undefined }
  }, [settings, wikiCacheRef])

  const resolveWikiNode = useCallback(async (wikiToken: string): Promise<{ kind: SessionKind; docToken: string } | undefined> => {
    const cached = wikiCacheRef.current.get(wikiToken)
    if (cached?.kind && cached.kind !== 'wiki') {
      const tok = cached.kind === 'base' ? cached.appToken
        : cached.kind === 'sheet' ? cached.spreadsheetToken
        : cached.kind === 'board' ? cached.whiteboardId
        : cached.documentId
      if (tok) return { kind: cached.kind, docToken: tok }
    }
    try {
      const res = (await API.getWikiNode(await resolveToken(settings), wikiToken)) as {
        node?: { obj_type: string; obj_token: string }
      }
      const n = res.node
      if (!n) return undefined
      const f = wikiToFeishu(n.obj_type, n.obj_token)
      if (!f?.kind) return undefined
      wikiCacheRef.current.set(wikiToken, { ...f, wikiToken })
      const tok = f.kind === 'base' ? f.appToken
        : f.kind === 'sheet' ? f.spreadsheetToken
        : f.kind === 'board' ? f.whiteboardId
        : f.documentId
      return tok ? { kind: f.kind, docToken: tok } : undefined
    } catch { return undefined }
  }, [settings, wikiCacheRef])

  return { resolveWikiKind, resolveWikiNode, authExpired }
}
