// GitHub Trending fetcher. There is no official Trending API, and every third-party
// JSON mirror (gitterapp / huchen / a9sapp / heroku) has gone offline, so we parse the
// server-rendered HTML at https://github.com/trending. The HTML has been stable for
// years (article.Box-row structure); parsing is string/regex based so it works in the
// service worker where DOMParser is unavailable.
import type { GitHubSince, GitHubTrendingRepo, TranslationEngine } from './types'
import type { AppSettings } from '../types'
import { translateViaBing, translateViaAI } from './translate'
import { hashDescription, loadTranslationCache, saveTranslationCache } from './store'

const TRENDING_URL = 'https://github.com/trending'

const SINCE_LABEL: Record<GitHubSince, string> = {
  daily: 'today',
  weekly: 'this week',
  monthly: 'this month',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
}

function parseCount(s: string | undefined): number {
  if (!s) return 0
  const n = parseInt(s.replace(/[, ]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Parse the GitHub Trending HTML into a ranked repo list. Pure string parsing — no
 * DOMParser dependency — so it runs in the service worker. Returns [] on any structural
 * mismatch (the caller surfaces a friendly error instead of crashing).
 */
export function parseGitHubTrending(html: string, since: GitHubSince = 'daily'): GitHubTrendingRepo[] {
  const sinceLabel = SINCE_LABEL[since]
  const chunks = html.split('<article class="Box-row">').slice(1)
  const repos: GitHubTrendingRepo[] = []
  for (const raw of chunks) {
    const chunk = raw.split('</article>')[0] ?? raw
    // Repo path: first href inside <h2 ...> — "/owner/repo". Stargazers/forks hrefs come
    // later and carry extra path segments, so anchoring on <h2 keeps us on the repo link.
    const h2 = chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"/)
    if (!h2) continue
    const path = h2[1]
    // Defensive: a repo path has exactly two segments and no query/hash.
    if (!/^[^/\s]+\/[^/\s]+$/.test(path)) continue
    const fullName = path

    const desc = chunk.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)
    const lang = chunk.match(/itemprop="programmingLanguage">([^<]+)</)
    const langColor = chunk.match(/repo-language-color"[^>]*background-color:\s*([^;"']+)/)

    // Stars / forks: the count trails the closing </svg> of the octicon inside the link.
    const starsMatch = chunk.match(/\/stargazers"[\s\S]*?<\/svg>\s*([\d,]+)/)
    const forksMatch = chunk.match(/\/forks"[\s\S]*?<\/svg>\s*([\d,]+)/)

    // "1,409 stars today" | "1,409 stars this week" | "1,409 stars this month"
    const sinceMatch = chunk.match(/([\d,]+)\s+stars\s+(today|this week|this month)/)

    repos.push({
      rank: repos.length + 1,
      fullName,
      url: 'https://github.com/' + path,
      description: desc ? stripTags(desc[1]) : '',
      language: lang ? lang[1].trim() : '',
      languageColor: langColor ? langColor[1].trim() : '',
      stars: parseCount(starsMatch?.[1]),
      forks: parseCount(forksMatch?.[1]),
      starsSince: parseCount(sinceMatch?.[1]),
      sinceLabel: sinceMatch ? sinceMatch[2] : sinceLabel,
    })
    if (repos.length >= 25) break
  }
  return repos
}

/** Fetch + parse GitHub Trending. Throws on network/HTTP failure (caller caches the error). */
export async function fetchGitHubTrending(since: GitHubSince = 'daily'): Promise<GitHubTrendingRepo[]> {
  const url = `${TRENDING_URL}?since=${encodeURIComponent(since)}`
  const res = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    credentials: 'omit',
  })
  if (!res.ok) throw new Error(`GitHub trending HTTP ${res.status}`)
  const html = await res.text()
  const items = parseGitHubTrending(html, since)
  if (!items.length) throw new Error('GitHub trending returned no parseable entries')
  return items
}

/**
 * Apply cached translations to repos in place. No API call — just a hash lookup. Called
 * during refresh so previously-translated descriptions show up instantly without waiting
 * for the user to click the translate button.
 */
export async function applyTranslationCache(repos: GitHubTrendingRepo[]): Promise<void> {
  const cache = await loadTranslationCache()
  for (const r of repos) {
    if (r.description && !r.descriptionZh) {
      const hit = cache[hashDescription(r.description)]
      if (hit?.zh) r.descriptionZh = hit.zh
    }
  }
}

/**
 * Translate repo descriptions to Chinese using the selected engine, with a hash-based
 * cache so repeat refreshes skip the network for ~90%+ of items. Mutates repos in place,
 * setting `descriptionZh` on each. Non-fatal: on any failure the descriptions are left
 * untranslated and the UI falls back to the original English. Called by the SW when the
 * user clicks the translate button.
 *
 * Engines:
 * - 'bing': free Bing Translator endpoint (~1-2s for 25 items, no key needed)
 * - 'ai': user's LLM in parallel batches of 5 (~5s, needs API key)
 * - 'off': no-op
 */
export async function translateDescriptions(
  engine: TranslationEngine,
  repos: GitHubTrendingRepo[],
  settings?: AppSettings,
): Promise<void> {
  if (engine === 'off') return
  const toTranslate = repos.filter((r) => r.description && !r.descriptionZh)
  if (toTranslate.length === 0) return

  // Partition into cached (skip) vs uncached (translate).
  const cache = await loadTranslationCache()
  const uncached: GitHubTrendingRepo[] = []
  for (const r of toTranslate) {
    const hit = cache[hashDescription(r.description)]
    if (hit?.zh) {
      r.descriptionZh = hit.zh
    } else {
      uncached.push(r)
    }
  }
  if (uncached.length === 0) return // all cache hits

  const texts = uncached.map((r) => r.description)
  let translations: (string | undefined)[]
  try {
    if (engine === 'bing') {
      translations = await translateViaBing(texts)
    } else if (engine === 'ai' && settings) {
      translations = await translateViaAI(settings, texts)
    } else {
      return
    }
  } catch {
    return // engine failed — leave descriptions untranslated
  }

  // Apply translations + write back to cache.
  const cacheUpdates: Record<string, string> = {}
  uncached.forEach((r, i) => {
    const t = translations[i]
    if (typeof t === 'string' && t.trim()) {
      r.descriptionZh = t.trim()
      cacheUpdates[hashDescription(r.description)] = t.trim()
    }
  })
  await saveTranslationCache(cacheUpdates).catch(() => {})
}
