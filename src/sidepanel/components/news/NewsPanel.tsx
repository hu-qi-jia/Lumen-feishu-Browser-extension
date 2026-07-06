import { useState } from 'react'
import SettingsTabs from '../SettingsTabs'
import GitHubTab from './GitHubTab'
import WeiboTab from './WeiboTab'
import NewsRefreshBar from './NewsRefreshBar'
import { useNewsData } from './useNewsData'
import './NewsPanel.css'

type NewsTabId = 'github' | 'weibo'

const NEWS_TABS = [
  { id: 'github', label: 'GitHub Trending' },
  { id: 'weibo', label: '微博热搜' },
] as const

/** News panel — mirrors Settings.tsx structure: header + tabs + refresh bar + body.
 *  The panel is a pure view of chrome.storage.local['news_cache_v1']; all fetching happens
 *  in the background SW. Manual refresh sends NEWS_REFRESH to the SW. */
export default function NewsPanel() {
  const { cache, settings, refreshing, refresh, updateSettings } = useNewsData()
  const [tab, setTab] = useState<NewsTabId>('github')

  const gh = cache.github
  const wb = cache.weibo
  // The bar shows the most recent successful refresh across both sources, and any error.
  const timestamps = [gh?.fetchedAt, wb?.fetchedAt].filter((t): t is number => typeof t === 'number')
  const lastUpdated = timestamps.length ? Math.max(...timestamps) : null
  const barError = (tab === 'github' ? gh?.error : wb?.error)

  const tabs = NEWS_TABS.filter((t) => {
    if (t.id === 'github') return settings.enabled.github
    return settings.enabled.weibo
  })

  // Ensure `tab` always points at an enabled source (e.g. after a settings change).
  const activeTab: NewsTabId = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id as NewsTabId ?? 'github')

  return (
    <div className="news">
      <div className="news-header">
        <h2>资讯</h2>
      </div>

      {tabs.length > 1 && (
        <SettingsTabs
          tabs={tabs}
          active={activeTab}
          onChange={(id) => setTab(id as NewsTabId)}
          ariaLabel="资讯分类"
        />
      )}

      <NewsRefreshBar
        refreshing={refreshing}
        lastUpdated={lastUpdated}
        error={barError}
        interval={settings.interval}
        onIntervalChange={(i) => updateSettings({ ...settings, interval: i })}
        onRefresh={refresh}
      />

      <div className="news-body">
        {activeTab === 'github' ? (
          <GitHubTab
            items={gh?.items ?? []}
            loading={refreshing && !gh}
            error={gh?.error}
            onRetry={refresh}
          />
        ) : (
          <WeiboTab
            items={wb?.items ?? []}
            loading={refreshing && !wb}
            error={wb?.error}
            onRetry={refresh}
          />
        )}
      </div>
    </div>
  )
}
