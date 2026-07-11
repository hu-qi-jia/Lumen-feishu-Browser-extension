import { useState } from 'react'
import SettingsTabs from '../settings/SettingsTabs'
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
 *  in the background SW. The refresh bar refreshes ONLY the active tab's source — switch
 *  tabs to refresh the other one. */
export default function NewsPanel() {
  const { cache, settings, refreshing, translating, translateError, translateSuccess, refresh, translate, updateSettings } = useNewsData()
  const [tab, setTab] = useState<NewsTabId>('github')

  const gh = cache.github
  const wb = cache.weibo

  const tabs = NEWS_TABS.filter((t) => {
    if (t.id === 'github') return settings.enabled.github
    return settings.enabled.weibo
  })

  // Ensure `tab` always points at an enabled source (e.g. after a settings change).
  const activeTab: NewsTabId = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id as NewsTabId ?? 'github')
  const activeSource = activeTab === 'github' ? 'github' : 'weibo'
  const activeEntry = activeTab === 'github' ? gh : wb
  const lastUpdated = activeEntry?.fetchedAt ?? null
  const barError = activeEntry?.error

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
          variant="underline"
        />
      )}

      <NewsRefreshBar
        refreshing={refreshing[activeSource]}
        lastUpdated={lastUpdated}
        error={barError}
        interval={settings.interval}
        onIntervalChange={(i) => updateSettings({ ...settings, interval: i })}
        onRefresh={() => refresh(activeSource)}
        showTranslate={activeTab === 'github' && settings.translationEngine !== 'off'}
        translating={translating}
        translateError={translateError}
        translateSuccess={translateSuccess}
        onTranslate={translate}
      />

      <div className="news-body">
        {activeTab === 'github' ? (
          <GitHubTab
            items={gh?.items ?? []}
            loading={refreshing.github && !gh}
            error={gh?.error}
            onRetry={() => refresh('github')}
          />
        ) : (
          <WeiboTab
            items={wb?.items ?? []}
            loading={refreshing.weibo && !wb}
            error={wb?.error}
            onRetry={() => refresh('weibo')}
          />
        )}
      </div>
    </div>
  )
}
