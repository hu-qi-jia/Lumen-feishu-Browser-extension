import { useCallback, useEffect, useState } from 'react'
import type { PageContext, SessionKind } from '@/shared/types'
import { upsertRecent, removeRecent, loadRecent, saveRecent, realRecentTitle, type RecentFile } from '../services/recentFiles'

export interface RecentFilesApi {
  recentFiles: RecentFile[]
  /** True once the persisted list has loaded — gate for recorders that would otherwise race. */
  ready: boolean
  /** Upsert a resource to the top of the recent list + persist. Single source of truth —
   *  used by the focused-tab recorder, the pinned-doc recorder, and the pin picker. */
  recordRecent: (token: string, title: string, kind: SessionKind) => void
  /** Drop an entry (the × on a recent row) + persist. */
  removeFromRecent: (token: string) => void
}

/**
 * The 10 most recently opened Feishu resources (doc / sheet / base, incl. closed tabs),
 * persisted under `recentFiles_v1`. Recorded whenever a Feishu page is focused. The pinned-
 * work-doc recorder lives in App (it owns `pinned`); `recordRecent` centralizes the
 * upsert+save boilerplate that used to be copy-pasted in three places.
 *
 * Wiki-wrapped resources are stored as `(wikiToken, 'wiki')` so a later pin resolves them
 * via pinnedFeishu (the wiki URL is the canonical "shareable" form). The convention is
 * enforced HERE — callers may pass either the wikiToken or the underlying docToken (e.g.
 * a selection-switch passes the wiki-resolved docToken + kind 'doc'). Without this
 * normalization the SAME wiki-wrapped doc was recorded twice: once as `(wikiToken, 'wiki')`
 * from the focused-tab effect, and once as `(documentId, 'doc')` from setWorkDoc. The
 * wikiCacheRef lets us reverse-lookup the wikiToken for a given underlying docToken.
 */
export function useRecentFiles(
  feishu: PageContext['feishu'],
  title: string,
  wikiCacheRef: React.MutableRefObject<Map<string, NonNullable<PageContext['feishu']>>>,
): RecentFilesApi {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
  const [recentReady, setRecentReady] = useState(false)

  // Load the persisted list before enabling recording, so a ctx update that fires first
  // can't clobber the loaded list.
  useEffect(() => {
    void loadRecent().then((files) => { setRecentFiles(files); setRecentReady(true) })
  }, [])

  // Pull the underlying docToken out of a wiki-cached feishu resource (kind=doc/sheet/base
  // with a wikiToken attached). Returns undefined when the cache entry is missing or the
  // kind has no token field we recognize.
  function underlyingTokenOf(f: NonNullable<PageContext['feishu']> | undefined): string | undefined {
    if (!f?.wikiToken) return undefined
    if (f.kind === 'doc') return f.documentId
    if (f.kind === 'sheet') return f.spreadsheetToken
    if (f.kind === 'base') return f.appToken
    return undefined
  }

  /** Normalize a (token, kind) recording to the wiki form when the token is the underlying
   *  docToken of a wiki-wrapped resource in the cache. Returns the original input when not
   *  wiki-wrapped. Also returns the underlying docToken (when known) so the caller can drop
   *  any legacy duplicate stored under THAT token — the "same doc appears twice" fix. */
  const normalizeWiki = useCallback((token: string, kind: SessionKind): {
    token: string
    kind: SessionKind
    underlyingToken?: string
  } => {
    if (kind === 'wiki') {
      // Recording the wiki form directly — surface its underlying docToken (if cached) so
      // the caller can drop a legacy (docToken, 'doc') entry for the same resource.
      const cached = wikiCacheRef.current.get(token)
      return { token, kind, underlyingToken: underlyingTokenOf(cached) }
    }
    // Recording a non-wiki form — scan the cache for a wiki node whose underlying docToken
    // matches. If found, switch to the wiki form (the canonical recording convention).
    for (const [wt, f] of wikiCacheRef.current) {
      if (!f.wikiToken || f.kind !== kind) continue
      if (underlyingTokenOf(f) === token) return { token: wt, kind: 'wiki', underlyingToken: token }
    }
    return { token, kind }
  }, [wikiCacheRef])

  const recordRecent = useCallback((token: string, title: string, kind: SessionKind) => {
    const { token: normToken, kind: normKind, underlyingToken } = normalizeWiki(token, kind)
    setRecentFiles((prev) => {
      // Drop any legacy entry stored under the underlying docToken — that's the duplicate
      // we're eliminating. (Only relevant when normalizing to the wiki form.)
      let deduped = prev
      if (underlyingToken && underlyingToken !== normToken) {
        if (prev.some((f) => f.token === underlyingToken)) {
          deduped = prev.filter((f) => f.token !== underlyingToken)
        }
      }
      // Store the REAL title (or '' when unknown — a loading/closed tab). Never bake the
      // placeholder in: that way a later real title can replace an unknown one, and the
      // loading-transient can't clobber an already-captured name. displayName() re-adds the
      // placeholder at render time.
      const next = upsertRecent(deduped, { token: normToken, title: realRecentTitle(title), kind: normKind })
      if (deduped === prev && next === prev) return prev // no-op — top entry unchanged + no dedup
      void saveRecent(next)
      return next
    })
  }, [normalizeWiki])

  const removeFromRecent = useCallback((token: string) => {
    setRecentFiles((prev) => {
      const next = removeRecent(prev, token)
      if (next === prev) return prev
      void saveRecent(next)
      return next
    })
  }, [])

  // Record the focused Feishu resource (doc / sheet / base; an unresolved wiki is skipped so
  // its transient "知识库" title isn't recorded — wait for resolution). A wiki-wrapped
  // resource records kind 'wiki' (token = wikiToken) so a later pin resolves correctly.
  useEffect(() => {
    if (!recentReady) return
    const f = feishu
    if (!f?.kind || f.kind === 'ppt' || f.kind === 'wiki') return
    const token = f.wikiToken ?? f.appToken ?? f.spreadsheetToken ?? f.documentId
    if (!token) return
    const pinKind: SessionKind = f.wikiToken ? 'wiki' : f.kind
    recordRecent(token, title, pinKind)
  }, [feishu, title, recentReady, recordRecent])

  return { recentFiles, ready: recentReady, recordRecent, removeFromRecent }
}
