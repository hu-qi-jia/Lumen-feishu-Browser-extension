/**
 * Recently-opened Feishu resources for the doc-selector dropdown. Unlike the live
 * chrome.tabs enumeration (which only sees OPEN tabs), this list persists across tab
 * closes / panel reopens — so a doc you opened earlier is still one click away.
 *
 * A recent file stores the PIN kind, not the resolved kind: a wiki-wrapped resource is
 * stored as kind 'wiki' (token = wikiToken) so pinnedFeishu resolves it on pin. Its real
 * icon is resolved separately at display time (DocSelector → resolveWikiKind).
 */
import type { SessionKind } from '@/shared/types'
import { cleanDocTitle } from '@/shared/feishu/pageUrl'

const KEY = 'recentFiles_v1'

/** Max entries kept — the dropdown's "最近打开" section. */
export const MAX_RECENT = 10

export interface RecentFile {
  token: string
  title: string
  /** Pin kind — 'wiki' for a wiki-wrapped resource (token is its wikiToken). */
  kind: SessionKind
  /** Last time this resource was focused / pinned — drives ordering (newest first). */
  seen: number
}

/** The display name for a stored title: the cleaned real title, or a kind-based placeholder when
 *  the title is a placeholder/empty. Feishu's SPA briefly titles a loading page "飞书云文档" — that
 *  raw brand string must never reach the dropdown, so any title that doesn't survive cleaning
 *  falls back to a sensible "未命名…" per kind. Pure → unit-testable; the single place this rule
 *  lives, used both when RECORDING (so storage is always clean) and when DISPLAYING (so legacy
 *  raw entries render correctly without a migration). */
export function cleanRecentTitle(title: string, kind: SessionKind): string {
  return cleanDocTitle(title) || (kind === 'sheet' ? '未命名表格' : kind === 'base' ? '未命名多维表格' : '未命名文档')
}

/** Convenience: the display name of a whole recent-file row. */
export function displayName(r: RecentFile): string {
  return cleanRecentTitle(r.title, r.kind)
}

/** Titles that are our own kind-based fallback — they carry no real name. Legacy entries
 *  recorded before titles were cleaned centrally can hold one of these; treat them as
 *  "unknown" so the no-clobber rule + the API backfill can replace them with a real name. */
const PLACEHOLDER_TITLES = new Set(['未命名文档', '未命名表格', '未命名多维表格'])

/** The real, stable name hidden in a raw title — '' when it's empty, a Feishu brand/loading
 *  string, OR one of our own placeholders. This is what we STORE (real-or-''); displayName()
 *  re-adds the placeholder at render time. Keeping "unknown" as '' in storage (rather than
 *  baking the placeholder in) is what lets a later real title overwrite it instead of sticking
 *  — the fix for "doc name disappears and never comes back". */
export function realRecentTitle(title: string): string {
  const cleaned = cleanDocTitle(title)
  if (!cleaned || PLACEHOLDER_TITLES.has(cleaned.trim())) return ''
  return cleaned
}

/**
 * Upsert a resource: move it to the front (most-recent) and cap at MAX_RECENT. Returns
 * the SAME array reference when the entry is already the most-recent with an unchanged
 * title, so callers can skip persisting. Pure → unit-testable.
 */
export function upsertRecent(
  files: RecentFile[],
  entry: { token: string; title: string; kind: SessionKind },
  now: number = Date.now(),
): RecentFile[] {
  // entry.title is real-or-'' (callers clean via realRecentTitle). NEVER let an unknown title
  // ('' — a tab in its loading transient, or a tab that's since closed) clobber a real name we
  // already captured: that was the "doc name disappears after reload/close" bug. A real incoming
  // title still wins, so reopening a stuck doc recovers its name.
  const existing = files.find((f) => f.token === entry.token)
  const title = entry.title || existing?.title || ''
  if (files[0]?.token === entry.token && files[0]?.title === title) return files
  const rest = files.filter((f) => f.token !== entry.token)
  return [{ token: entry.token, title, kind: entry.kind, seen: now }, ...rest].slice(0, MAX_RECENT)
}

/** Drop the entry for `token` (the × on a recent row). Returns the same ref if absent. */
export function removeRecent(files: RecentFile[], token: string): RecentFile[] {
  if (!files.some((f) => f.token === token)) return files
  return files.filter((f) => f.token !== token)
}

export async function loadRecent(): Promise<RecentFile[]> {
  try {
    const raw = (await new Promise<RecentFile[] | undefined>((resolve) =>
      chrome.storage.local.get([KEY], (r) => resolve(r[KEY] as RecentFile[] | undefined)),
    )) ?? []
    // Normalize legacy entries: a stored "未命名文档" / raw brand title carries no real name →
    // collapse to '' so the backfill can recover it and the no-clobber rule can replace it.
    return raw.map((f) => ({ ...f, title: realRecentTitle(f.title) }))
  } catch {
    return []
  }
}

export function saveRecent(files: RecentFile[]): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ [KEY]: files }, () => resolve()))
}
