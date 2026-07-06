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
  TranslationEngine,
  WeiboHotSearch,
} from './types'
import { DEFAULT_NEWS_SETTINGS } from './types'

const CACHE_KEY = 'news_cache_v1'
const SETTINGS_KEY = 'news_settings_v1'
const TRANSLATION_CACHE_KEY = 'news_translation_cache_v1'
const TRANSLATION_CACHE_MAX = 2000

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
  const stored = await storageGet<Partial<NewsSettings> & { translateGithub?: boolean }>(SETTINGS_KEY)
  if (!stored) return { ...DEFAULT_NEWS_SETTINGS, enabled: { ...DEFAULT_NEWS_SETTINGS.enabled } }
  // Migrate the old `translateGithub: boolean` field → `translationEngine`.
  // Old `true` → 'bing' (user wanted translation; Bing is now the better default, not 'ai').
  // Old `false` → 'off'. If `translationEngine` is already set, it takes precedence.
  let engine: TranslationEngine = stored.translationEngine ?? DEFAULT_NEWS_SETTINGS.translationEngine
  if (stored.translationEngine == null && stored.translateGithub != null) {
    engine = stored.translateGithub ? 'bing' : 'off'
  }
  return {
    interval: stored.interval ?? DEFAULT_NEWS_SETTINGS.interval,
    githubSince: stored.githubSince ?? DEFAULT_NEWS_SETTINGS.githubSince,
    enabled: {
      github: stored.enabled?.github ?? DEFAULT_NEWS_SETTINGS.enabled.github,
      weibo: stored.enabled?.weibo ?? DEFAULT_NEWS_SETTINGS.enabled.weibo,
    },
    translationEngine: engine,
  }
}

export async function saveNewsSettings(s: NewsSettings): Promise<void> {
  await storageSet({ [SETTINGS_KEY]: s })
}

// ─── Translation cache ─────────────────────────────────────────────────────────
// Keyed by an FNV-1a hash of the source text. GitHub trending repos persist for days, so
// the cache hit rate after the first load is ~90%+, eliminating redundant Bing/LLM calls.
// Capped at TRANSLATION_CACHE_MAX entries with oldest-first eviction.

type TranslationCache = Record<string, { zh: string; ts: number }>

/** FNV-1a 32-bit hash — fast, no crypto dependency, works in SW. */
export function hashDescription(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export async function loadTranslationCache(): Promise<TranslationCache> {
  return (await storageGet<TranslationCache>(TRANSLATION_CACHE_KEY)) ?? {}
}

/** Merge new translations into the cache, evicting oldest entries if over the cap. */
export async function saveTranslationCache(updates: Record<string, string>): Promise<void> {
  if (Object.keys(updates).length === 0) return
  const existing = await loadTranslationCache()
  const now = Date.now()
  const merged: TranslationCache = { ...existing }
  for (const [hash, zh] of Object.entries(updates)) {
    merged[hash] = { zh, ts: now }
  }
  // Evict oldest entries if over the cap.
  const keys = Object.keys(merged)
  if (keys.length > TRANSLATION_CACHE_MAX) {
    const toRemove = keys
      .sort((a, b) => merged[a].ts - merged[b].ts)
      .slice(0, keys.length - TRANSLATION_CACHE_MAX)
    for (const k of toRemove) delete merged[k]
  }
  await storageSet({ [TRANSLATION_CACHE_KEY]: merged })
}
