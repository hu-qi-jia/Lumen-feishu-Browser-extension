import { useEffect, useRef } from 'react'
import type { AppSettings, PageContext, SessionKind } from '@/shared/types'
import { resolveToken } from '@/shared/feishu/auth'
import { getDocumentMeta } from '@/shared/feishu/docx'
import { getSpreadsheet } from '@/shared/feishu/sheets'
import { getApp, getWikiNode } from '@/shared/feishu/api'
import { wikiToFeishu } from './useWikiResolve'
import type { RecentFile } from '../services/recentFiles'

interface Args {
  recentFiles: RecentFile[]
  /** True once the persisted list has loaded — don't backfill against a half-loaded list. */
  ready: boolean
  recordRecent: (token: string, title: string, kind: SessionKind) => void
  /** Drop an entry whose underlying resource no longer exists (404/permission). */
  removeFromRecent: (token: string) => void
  settings: AppSettings
  /** Shared wiki-resolution cache (App owns the ref). Backfill populates it for every wiki
   *  entry it resolves so subsequent recordRecent calls can normalize (token, kind) to the
   *  wiki form — without this, the dedup pass in recordRecent can't see the wiki→doc mapping
   *  for entries the user hasn't visited in this session. */
  wikiCacheRef: React.MutableRefObject<Map<string, NonNullable<PageContext['feishu']>>>
}

/** Result of a resource lookup — distinguishes "found with title" from "not found / gone"
 *  so the caller can prune deleted docs from the recent list instead of silently keeping
 *  stale entries that the agent can't operate on. */
type LookupResult = { found: true; title: string } | { found: false; gone: boolean }

/** Feishu error payload shape — code 1254030/1254040/1254043 etc. mean the resource is
 *  deleted/revoked/never-existed; network/auth errors are NOT "gone". */
function isGoneError(err: unknown): boolean {
  const code = (err as { code?: number })?.code
  if (typeof code !== 'number') return false
  // 1254xxx — doc/sheet/base not found / permission revoked / resource deleted
  // 1254030: doc not found; 1254040: doc deleted; 1254043: doc no permission
  // 1254036: sheet not found; 1254046: base not found
  return code === 1254030 || code === 1254040 || code === 1254043 || code === 1254036 || code === 1254046
}

/** Fetch the real title of a resource by token + kind, distinguishing "not found" (gone)
 *  from transient/network errors. All four are read-only GETs. For wiki entries, also
 *  populate the shared wiki cache with the resolved obj_type/obj_token so the caller's
 *  recordRecent can dedupe a legacy (docToken, 'doc') entry for the same resource. */
async function lookupResource(
  kind: SessionKind,
  token: string,
  userToken: string,
  wikiCacheRef: React.MutableRefObject<Map<string, NonNullable<PageContext['feishu']>>>,
): Promise<LookupResult> {
  try {
    if (kind === 'doc') {
      const m = await getDocumentMeta(userToken, token) as { document?: { title?: string } }
      const t = m?.document?.title?.trim()
      return t ? { found: true, title: t } : { found: false, gone: false }
    }
    if (kind === 'sheet') {
      const m = await getSpreadsheet(userToken, token) as { spreadsheet?: { title?: string } }
      const t = m?.spreadsheet?.title?.trim()
      return t ? { found: true, title: t } : { found: false, gone: false }
    }
    if (kind === 'base') {
      const m = await getApp(userToken, token) as { app?: { name?: string } }
      const t = m?.app?.name?.trim()
      return t ? { found: true, title: t } : { found: false, gone: false }
    }
    if (kind === 'wiki') {
      const r = await getWikiNode(userToken, token) as { node?: { title?: string; obj_type?: string; obj_token?: string } }
      const n = r?.node
      const t = n?.title?.trim()
      // Populate the shared wiki cache so recordRecent can normalize (docToken, 'doc') →
      // (wikiToken, 'wiki') for this resource, dropping any legacy duplicate.
      if (n?.obj_type && n?.obj_token) {
        const resolved = wikiToFeishu(n.obj_type, n.obj_token)
        if (resolved) wikiCacheRef.current.set(token, { ...resolved, wikiToken: token })
      }
      return t ? { found: true, title: t } : { found: false, gone: false }
    }
  } catch (err) {
    // "gone" (deleted/revoked/not-found) → caller prunes the entry.
    // other errors (network, 401, rate limit) → leave the entry as-is.
    if (isGoneError(err)) return { found: false, gone: true }
    return { found: false, gone: false }
  }
  return { found: false, gone: false }
}

/**
 * Two jobs, both bounded to once-per-token-per-session (doneRef):
 *
 * 1. **Backfill** unknown titles (title === '') — the closed-tab case, or a doc whose tab was
 *    reloaded mid-load so only the transient "飞书云文档" was ever seen. Fetch the real name
 *    from the Feishu API by token and record it.
 *
 * 2. **Prune** deleted resources — validate EVERY entry (not just empty-title ones) once per
 *    session. If the API returns a not-found/deleted code, drop the entry so the dropdown
 *    doesn't show stale "会话XXXXX" docs the agent can't operate on. Non-gone errors (network,
 *    auth) leave the entry untouched to avoid nuking the list on a transient blip.
 *
 * Side effect: resolving a wiki entry populates the shared wiki cache (wikiToken → resolved
 * feishu), so the subsequent recordRecent call normalizes to the wiki form AND drops any
 * legacy (docToken, 'doc') duplicate — the "same doc appears twice" fix for entries already
 * in storage before the recordRecent normalization landed.
 *
 * Bounded + safe: at most once per token per session, ≤ MAX_RECENT entries, read-only GETs.
 */
export function useRecentTitleBackfill({ recentFiles, ready, recordRecent, removeFromRecent, settings, wikiCacheRef }: Args) {
  const doneRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!ready) return
    // Validate every entry once per session — catches deleted docs whose titles were already
    // captured (the common "会话XXXXX" stale entry case), not just empty-title ones.
    const pending = recentFiles.filter((f) => !doneRef.current.has(f.token))
    if (!pending.length) return
    let cancelled = false
    void (async () => {
      const userToken = await resolveToken(settings).catch(() => undefined)
      if (!userToken || cancelled) return
      await Promise.all(pending.map(async (f) => {
        const r = await lookupResource(f.kind, f.token, userToken, wikiCacheRef)
        doneRef.current.add(f.token) // even on failure — don't retry all session
        if (cancelled) return
        if (r.found) {
          // Real title → upsert overwrites (also refreshes a renamed doc's title).
          // For wiki entries, lookupResource just populated the wiki cache, so recordRecent
          // can normalize (wikiToken, 'wiki') AND dedupe any (docToken, 'doc') duplicate.
          recordRecent(f.token, r.title, f.kind)
        } else if (r.gone) {
          // Resource deleted/revoked — prune so the dropdown stays clean.
          removeFromRecent(f.token)
        }
        // else: transient error (network/auth) — leave the entry as-is.
      }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentFiles, ready, settings.feishuAccessToken, recordRecent, removeFromRecent, wikiCacheRef])
}
