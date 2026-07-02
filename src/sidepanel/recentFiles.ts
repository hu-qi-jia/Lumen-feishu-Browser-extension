/**
 * Recently-opened Feishu resources for the doc-selector dropdown. Unlike the live
 * chrome.tabs enumeration (which only sees OPEN tabs), this list persists across tab
 * closes / panel reopens — so a doc you opened earlier is still one click away.
 *
 * A recent file stores the PIN kind, not the resolved kind: a wiki-wrapped resource is
 * stored as kind 'wiki' (token = wikiToken) so pinnedFeishu resolves it on pin. Its real
 * icon is resolved separately at display time (DocSelector → resolveWikiKind).
 */
import type { SessionKind } from '../shared/types'

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
  if (files[0]?.token === entry.token && files[0]?.title === entry.title) return files
  const rest = files.filter((f) => f.token !== entry.token)
  return [{ token: entry.token, title: entry.title, kind: entry.kind, seen: now }, ...rest].slice(0, MAX_RECENT)
}

export async function loadRecent(): Promise<RecentFile[]> {
  try {
    return (await new Promise<RecentFile[] | undefined>((resolve) =>
      chrome.storage.local.get([KEY], (r) => resolve(r[KEY] as RecentFile[] | undefined)),
    )) ?? []
  } catch {
    return []
  }
}

export function saveRecent(files: RecentFile[]): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ [KEY]: files }, () => resolve()))
}
