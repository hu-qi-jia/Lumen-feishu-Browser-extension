// Weibo hot search fetcher. Uses weibo.com's own H5 internal endpoint (no login, returns
// JSON). The endpoint requires Referer: https://weibo.com — a forbidden fetch header that
// the extension cannot set directly, so a declarativeNetRequest static rule adds it for
// weibo.com/ajax/* requests (see rules/news_referer.json + manifest). The browser's
// auto-added Origin: chrome-extension://… is accepted by Weibo (verified).
import type { WeiboHotSearch } from './types'

const HOTSEARCH_URL = 'https://weibo.com/ajax/side/hotSearch'

interface RawRealtimeItem {
  realpos?: number
  word?: string
  num?: number
  label_name?: string
  word_scheme?: string
  category?: string
  small_icon_desc?: string
}

function toSearchUrl(word: string): string {
  // Weibo search uses the #hashtag# form; encodeURIComponent keeps the # safe in the query.
  return `https://s.weibo.com/weibo?q=%23${encodeURIComponent(word)}%23`
}

/**
 * Parse the hotSearch JSON into a ranked list. Defensive: skips entries without a word,
 * and falls back to index+1 when realpos is missing.
 */
export function parseWeiboHotSearch(json: string): WeiboHotSearch[] {
  let data: unknown
  try { data = JSON.parse(json) } catch { return [] }
  const realtime = (data as { data?: { realtime?: RawRealtimeItem[] } })?.data?.realtime
  if (!Array.isArray(realtime)) return []
  const items: WeiboHotSearch[] = []
  for (const it of realtime) {
    const word = (it.word ?? '').trim()
    if (!word) continue
    const rank = it.realpos ?? items.length + 1
    items.push({
      rank,
      keyword: word,
      hotValue: typeof it.num === 'number' ? it.num : 0,
      labelName: (it.label_name ?? '').trim(),
      category: (it.category ?? '').trim(),
      url: toSearchUrl(word),
    })
    if (items.length >= 50) break
  }
  return items
}

/** Fetch + parse Weibo hot search. Throws on network/HTTP failure. */
export async function fetchWeiboHotSearch(): Promise<WeiboHotSearch[]> {
  const res = await fetch(HOTSEARCH_URL, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  })
  if (!res.ok) throw new Error(`Weibo hot search HTTP ${res.status}`)
  const text = await res.text()
  const items = parseWeiboHotSearch(text)
  if (!items.length) throw new Error('Weibo hot search returned no entries')
  return items
}
