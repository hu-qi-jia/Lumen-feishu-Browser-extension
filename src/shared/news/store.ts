// chrome.storage.local persistence for the news feature: cached fetch results (written
// by the SW alarm, read by the side panel) + user settings (interval + per-source enable).
// Mirrors the dataviz/store.ts pattern: callback-style storage wrapped in promises, with
// typeof-chrome guards so the module loads in tests and the sandbox without crashing.
import type {
  GitHubTrendingRepo,
  NewsCache,
  NewsCacheEntry,
  NewsSettings,
  NewsSourceId,
  WeiboHotSearch,
} from './types'
import { DEFAULT_NEWS_SETTINGS } from './types'

const CACHE_KEY = 'news_cache_v1'
const SETTINGS_KEY = 'news_settings_v1'

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) { res(undefined); return }
      chrome.storage.local.get([key], (r) => res(r?.[key] as T | undefined))
    } catch { res(undefined) }
  })
}

function storageSet(obj: Record<string, unknown>): Promise<void> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) { res(); return }
      chrome.storage.local.set(obj, () => res())
    } catch { res() }
  })
}

// ─── Cache ─────────────────────────────────────────────────────────────────────

export async function loadNewsCache(): Promise<NewsCache> {
  return (await storageGet<NewsCache>(CACHE_KEY)) ?? {}
}

// Serialize cache writes so concurrent refreshNewsSource('github') and ('weibo') don't
// race on the read-modify-write inside saveNewsCacheEntry (the second write would
// otherwise clobber the first's source entry). A module-level promise chain is safe
// because the SW is single-threaded; this just orders the async writes.
let cacheWriteChain: Promise<unknown> = Promise.resolve()

export function saveNewsCacheEntry<S extends NewsSourceId>(
  source: S,
  entry: NewsCacheEntry<S extends 'github' ? GitHubTrendingRepo : WeiboHotSearch>,
): Promise<NewsCache> {
  const run = cacheWriteChain.then(async () => {
    const cache = await loadNewsCache()
    const next: NewsCache = { ...cache, [source]: entry }
    await storageSet({ [CACHE_KEY]: next })
    return next
  })
  // Swallow rejections on the chain itself so one failed write doesn't block the next;
  // the caller still sees the real result (or error) via `run`.
  cacheWriteChain = run.catch(() => {})
  return run
}

// ─── Settings ──────────────────────────────────────────────────────────────────

export async function loadNewsSettings(): Promise<NewsSettings> {
  const stored = await storageGet<Partial<NewsSettings>>(SETTINGS_KEY)
  if (!stored) return { ...DEFAULT_NEWS_SETTINGS, enabled: { ...DEFAULT_NEWS_SETTINGS.enabled } }
  return {
    interval: stored.interval ?? DEFAULT_NEWS_SETTINGS.interval,
    githubSince: stored.githubSince ?? DEFAULT_NEWS_SETTINGS.githubSince,
    enabled: {
      github: stored.enabled?.github ?? DEFAULT_NEWS_SETTINGS.enabled.github,
      weibo: stored.enabled?.weibo ?? DEFAULT_NEWS_SETTINGS.enabled.weibo,
    },
    translateGithub: stored.translateGithub ?? DEFAULT_NEWS_SETTINGS.translateGithub,
  }
}

export async function saveNewsSettings(s: NewsSettings): Promise<void> {
  await storageSet({ [SETTINGS_KEY]: s })
}
