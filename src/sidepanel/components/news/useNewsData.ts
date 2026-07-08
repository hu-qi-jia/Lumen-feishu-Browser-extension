import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewsCache, NewsSettings, NewsSourceId } from '../../../shared/news/types'
import { DEFAULT_NEWS_SETTINGS } from '../../../shared/news/types'
import { loadNewsCache, loadNewsSettings, saveNewsSettings } from '../../../shared/news/store'

type RefreshResp = { ok: true; cache: NewsCache } | { ok: false }

/** Side-panel hook for the news feature. Reads the cache the background SW writes, subscribes
 *  to chrome.storage.onChanged so the alarm-driven refresh shows up live, and exposes a
 *  manual refresh action that messages the SW (NEWS_REFRESH). Pass a `source` to refresh
 *  only one list ('github' | 'weibo'); omit it to refresh both. Settings are persisted through
 *  the same store so the SW's storage.onChanged listener re-arms the alarm. */
export function useNewsData() {
  const [cache, setCache] = useState<NewsCache>({})
  const [settings, setSettings] = useState<NewsSettings>({ ...DEFAULT_NEWS_SETTINGS, enabled: { ...DEFAULT_NEWS_SETTINGS.enabled } })
  const [refreshing, setRefreshing] = useState<Record<NewsSourceId, boolean>>({ github: false, weibo: false })
  const [translating, setTranslating] = useState(false)
  // In-flight guard (ref, not state) so a double-click doesn't fire two SW messages.
  const inFlightRef = useRef<Record<NewsSourceId, boolean>>({ github: false, weibo: false })
  const translatingRef = useRef(false)

  const refresh = useCallback(async (source?: NewsSourceId) => {
    const targets: NewsSourceId[] = source ? [source] : ['github', 'weibo']
    // Skip any source already in flight; only fire for the rest.
    const pending = targets.filter((t) => !inFlightRef.current[t])
    if (!pending.length) return
    for (const t of pending) inFlightRef.current[t] = true
    setRefreshing((prev) => {
      const next = { ...prev }
      for (const t of pending) next[t] = true
      return next
    })
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'NEWS_REFRESH', source: pending.length === 1 ? pending[0] : undefined }) as RefreshResp
      if (resp?.ok && resp.cache) setCache(resp.cache)
    } catch { /* SW may be mid-startup; the alarm will catch up */ }
    finally {
      for (const t of pending) inFlightRef.current[t] = false
      setRefreshing((prev) => {
        const next = { ...prev }
        for (const t of pending) next[t] = false
        return next
      })
    }
  }, [])

  // Initial load: cache + settings. Also re-fetch any enabled source whose cache is older
  // than one interval (or missing) — chrome.alarms don't fire while Chrome is closed, so on
  // reopen the cache can be hours stale. This staleness check triggers a refresh so the user
  // sees fresh data without having to click the refresh button.
  useEffect(() => {
    let alive = true
    void (async () => {
      const [c, s] = await Promise.all([loadNewsCache(), loadNewsSettings()])
      if (!alive) return
      setCache(c)
      setSettings(s)
      const staleThreshold = s.interval * 60_000
      const staleSources = (['github', 'weibo'] as NewsSourceId[]).filter((src) => {
        if (src === 'github' && !s.enabled.github) return false
        if (src === 'weibo' && !s.enabled.weibo) return false
        const fetchedAt = c[src]?.fetchedAt
        return !fetchedAt || Date.now() - fetchedAt > staleThreshold
      })
      if (staleSources.length === 0) return
      // Refresh both at once when both are stale; otherwise just the stale one.
      void refresh(staleSources.length === 2 ? undefined : staleSources[0])
    })()
    return () => { alive = false }
  }, [refresh])

  // Live updates from the alarm (SW writes cache → storage.onChanged fires here).
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
    const handler = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return
      if (changes.news_cache_v1) setCache((prev) => ({ ...prev, ...(changes.news_cache_v1.newValue as NewsCache) }))
      if (changes.news_settings_v1) setSettings((prev) => ({ ...prev, ...(changes.news_settings_v1.newValue as NewsSettings) }))
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  const translate = useCallback(async () => {
    if (translatingRef.current) return
    translatingRef.current = true
    setTranslating(true)
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'NEWS_TRANSLATE' }) as RefreshResp
      if (resp?.ok && resp.cache) setCache(resp.cache)
    } catch { /* SW may be mid-startup */ }
    finally {
      translatingRef.current = false
      setTranslating(false)
    }
  }, [])

  const updateSettings = useCallback(async (next: NewsSettings) => {
    setSettings(next)
    await saveNewsSettings(next)
  }, [])

  return { cache, settings, refreshing, translating, refresh, translate, updateSettings }
}
