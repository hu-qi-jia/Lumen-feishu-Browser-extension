import { useCallback, useEffect, useState } from 'react'
import type { NewsCache, NewsSettings } from '../../../shared/news/types'
import { DEFAULT_NEWS_SETTINGS } from '../../../shared/news/types'
import { loadNewsCache, loadNewsSettings, saveNewsSettings } from '../../../shared/news/store'

type RefreshResp = { ok: true; cache: NewsCache } | { ok: false }

/** Side-panel hook for the news feature. Reads the cache the background SW writes, subscribes
 *  to chrome.storage.onChanged so the alarm-driven refresh shows up live, and exposes a
 *  manual refresh action that messages the SW (NEWS_REFRESH). Settings are persisted through
 *  the same store so the SW's storage.onChanged listener re-arms the alarm. */
export function useNewsData() {
  const [cache, setCache] = useState<NewsCache>({})
  const [settings, setSettings] = useState<NewsSettings>({ ...DEFAULT_NEWS_SETTINGS, enabled: { ...DEFAULT_NEWS_SETTINGS.enabled } })
  const [refreshing, setRefreshing] = useState(false)

  // Initial load: cache + settings.
  useEffect(() => {
    let alive = true
    void (async () => {
      const [c, s] = await Promise.all([loadNewsCache(), loadNewsSettings()])
      if (!alive) return
      setCache(c)
      setSettings(s)
    })()
    return () => { alive = false }
  }, [])

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

  const refresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'NEWS_REFRESH' }) as RefreshResp
      if (resp?.ok && resp.cache) setCache(resp.cache)
    } catch { /* SW may be mid-startup; the alarm will catch up */ }
    finally { setRefreshing(false) }
  }, [refreshing])

  const updateSettings = useCallback(async (next: NewsSettings) => {
    setSettings(next)
    await saveNewsSettings(next)
  }, [])

  return { cache, settings, refreshing, refresh, updateSettings }
}
