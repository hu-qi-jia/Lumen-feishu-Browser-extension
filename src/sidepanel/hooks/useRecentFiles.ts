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
 */
export function useRecentFiles(
  feishu: PageContext['feishu'],
  title: string,
): RecentFilesApi {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
  const [recentReady, setRecentReady] = useState(false)

  // Load the persisted list before enabling recording, so a ctx update that fires first
  // can't clobber the loaded list.
  useEffect(() => {
    void loadRecent().then((files) => { setRecentFiles(files); setRecentReady(true) })
  }, [])

  const recordRecent = useCallback((token: string, title: string, kind: SessionKind) => {
    setRecentFiles((prev) => {
      // Store the REAL title (or '' when unknown — a loading/closed tab). Never bake the
      // placeholder in: that way a later real title can replace an unknown one, and the
      // loading-transient can't clobber an already-captured name. displayName() re-adds the
      // placeholder at render time.
      const next = upsertRecent(prev, { token, title: realRecentTitle(title), kind })
      if (next === prev) return prev // no-op — top entry unchanged
      void saveRecent(next)
      return next
    })
  }, [])

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
