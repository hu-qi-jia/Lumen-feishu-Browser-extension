import { useEffect, useRef } from 'react'
import type { AppSettings, SessionKind } from '@/shared/types'
import { resolveToken } from '@/shared/feishu/auth'
import { getDocumentMeta } from '@/shared/feishu/docx'
import { getSpreadsheet } from '@/shared/feishu/sheets'
import { getApp, getWikiNode } from '@/shared/feishu/api'
import type { RecentFile } from '../lib/recentFiles'

interface Args {
  recentFiles: RecentFile[]
  /** True once the persisted list has loaded — don't backfill against a half-loaded list. */
  ready: boolean
  recordRecent: (token: string, title: string, kind: SessionKind) => void
  settings: AppSettings
}

/** Fetch the real title of a resource by token + kind. All four are read-only GETs whose
 *  response shapes are already exercised elsewhere (usePageContext resolves doc/sheet titles
 *  verbatim this way; getWikiNode powers wiki resolution; getApp the base app). Returns
 *  undefined on any failure — caller just leaves the entry unnamed. */
async function fetchResourceTitle(kind: SessionKind, token: string, userToken: string): Promise<string | undefined> {
  try {
    if (kind === 'doc') {
      const m = await getDocumentMeta(userToken, token) as { document?: { title?: string } }
      return m?.document?.title?.trim() || undefined
    }
    if (kind === 'sheet') {
      const m = await getSpreadsheet(userToken, token) as { spreadsheet?: { title?: string } }
      return m?.spreadsheet?.title?.trim() || undefined
    }
    if (kind === 'base') {
      const m = await getApp(userToken, token) as { app?: { name?: string } }
      return m?.app?.name?.trim() || undefined
    }
    if (kind === 'wiki') {
      const r = await getWikiNode(userToken, token) as { node?: { title?: string } }
      return r?.node?.title?.trim() || undefined
    }
  } catch {
    /* not authorized / network / not found — leave the entry unnamed */
  }
  return undefined
}

/**
 * Recover real names for recent files whose title is unknown (title === '') — the closed-tab
 * case, or a doc whose tab was reloaded mid-load so only the transient "飞书云文档" was ever
 * seen. The live tab is gone, so the only authoritative source of the name is the Feishu API
 * by token. Fetch it once per token per session and record it; the no-clobber rule then keeps
 * it forever.
 *
 * Bounded + safe: at most once per token per session (doneRef), only unknown-title entries
 * (≤ MAX_RECENT), read-only GETs, fully silent on failure.
 */
export function useRecentTitleBackfill({ recentFiles, ready, recordRecent, settings }: Args) {
  const doneRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!ready) return
    const pending = recentFiles.filter((f) => !f.title && !doneRef.current.has(f.token))
    if (!pending.length) return
    let cancelled = false
    void (async () => {
      const userToken = await resolveToken(settings).catch(() => undefined)
      if (!userToken || cancelled) return
      await Promise.all(pending.map(async (f) => {
        const t = await fetchResourceTitle(f.kind, f.token, userToken)
        doneRef.current.add(f.token) // even on failure — don't retry a 404/403 all session
        if (cancelled || !t) return
        recordRecent(f.token, t, f.kind) // real title → upsert overwrites the '' entry
      }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentFiles, ready, settings.feishuAccessToken, recordRecent])
}
