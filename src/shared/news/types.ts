// News feature — shared types. The side panel reads cached entries written by the
// background service worker (alarm-triggered fetch); the panel is a pure view of the cache.

export type GitHubSince = 'daily' | 'weekly' | 'monthly'

export interface GitHubTrendingRepo {
  rank: number
  /** "owner/repo" */
  fullName: string
  /** "https://github.com/owner/repo" */
  url: string
  description: string
  /** Chinese translation of `description`, filled in by the SW after fetch when the user
   *  has an LLM configured and `translateGithub` is on. Undefined = not translated. */
  descriptionZh?: string
  /** Empty string when no language is set. */
  language: string
  /** Language swatch color hex (e.g. "#dea584"); empty when unknown. */
  languageColor: string
  /** Total stars. */
  stars: number
  /** Total forks. */
  forks: number
  /** Stars gained in the selected window. */
  starsSince: number
  /** "today" | "this week" | "this month" — mirrors the since filter. */
  sinceLabel: string
}

export interface WeiboHotSearch {
  rank: number
  keyword: string
  /** Hot value (raw count). */
  hotValue: number
  /** Short label like "新" / "热" / "沸" / "爆"; empty when none. */
  labelName: string
  /** Category hint like "文娱"; empty when none. */
  category: string
  /** Search URL for the keyword. */
  url: string
}

export type NewsSourceId = 'github' | 'weibo'

/** Fetch interval in minutes. The three options the user picks from. */
export type NewsInterval = 10 | 30 | 60

/** Translation engine for GitHub repo descriptions. */
export type TranslationEngine = 'off' | 'bing' | 'ai'

export interface NewsSettings {
  interval: NewsInterval
  githubSince: GitHubSince
  /** Per-source enable. A disabled source is skipped by the alarm and hidden in the UI. */
  enabled: { github: boolean; weibo: boolean }
  /** How GitHub repo descriptions are translated to Chinese. 'bing' uses the free Bing
   *  Translator endpoint (no key needed, ~1-2s for 25 items); 'ai' uses the user's
   *  configured LLM in parallel batches (slower, needs API key); 'off' skips translation. */
  translationEngine: TranslationEngine
}

export interface NewsCacheEntry<T> {
  items: T[]
  /** Date.now() when the cache entry was written. */
  fetchedAt: number
  /** Set when the last fetch failed (items may be stale-from-prior-success). */
  error?: string
}

export interface NewsCache {
  github?: NewsCacheEntry<GitHubTrendingRepo>
  weibo?: NewsCacheEntry<WeiboHotSearch>
}

export const DEFAULT_NEWS_SETTINGS: NewsSettings = {
  interval: 30,
  githubSince: 'daily',
  enabled: { github: true, weibo: true },
  translationEngine: 'bing',
}
