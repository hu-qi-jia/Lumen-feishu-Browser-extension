// GitHub Trending fetcher. There is no official Trending API, and every third-party
// JSON mirror (gitterapp / huchen / a9sapp / heroku) has gone offline, so we parse the
// server-rendered HTML at https://github.com/trending. The HTML has been stable for
// years (article.Box-row structure); parsing is string/regex based so it works in the
// service worker where DOMParser is unavailable.
import type { GitHubSince, GitHubTrendingRepo } from './types'
import type { AppSettings } from '../types'
import { chatComplete } from '../ai/llm'

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
 * Batch-translate repo descriptions to Chinese via the user's configured LLM. Mutates repos
 * in place, setting `descriptionZh` on each. Non-fatal: on any failure (no API key, LLM
 * error, unparseable response) the descriptions are left untranslated and the UI falls back
 * to the original English. Called by the SW after a successful fetch.
 */
export async function translateDescriptions(
  settings: AppSettings,
  repos: GitHubTrendingRepo[],
): Promise<void> {
  // Only translate repos that have a description.
  const toTranslate = repos.filter((r) => r.description)
  if (toTranslate.length === 0) return

  // Build a compact index→description map so the LLM only sees the text, not the full repo
  // objects. The index lets us map translations back without relying on order stability.
  const lines = toTranslate.map((r, i) => `${i}: ${r.description}`)
  const prompt =
    `将以下 GitHub 项目描述翻译成简体中文，保持简洁准确，保留专有名词（如框架名、语言名）不翻译。\n` +
    `只返回一个 JSON 字符串数组，不要包含任何其他文字。数组长度必须等于输入条数，按输入顺序对应。\n` +
    `如果某条描述无需翻译（已经是中文或无意义），返回原文。\n\n` +
    lines.join('\n')

  let raw: string
  try {
    raw = await chatComplete(settings, prompt)
  } catch {
    return // LLM call failed — leave descriptions untranslated
  }

  // The LLM may wrap the array in ```json ... ``` or add prose. Extract the first JSON
  // array found in the response.
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return
  let translations: unknown
  try {
    translations = JSON.parse(jsonMatch[0])
  } catch {
    return
  }
  if (!Array.isArray(translations) || translations.length !== toTranslate.length) return

  toTranslate.forEach((r, i) => {
    const t = translations[i]
    if (typeof t === 'string' && t.trim()) r.descriptionZh = t.trim()
  })
}
