import type { WeiboHotSearch } from '@/shared/news/types'
import ListView from '../ui/ListView'

interface Props {
  items: WeiboHotSearch[]
  loading: boolean
  error?: string
  onRetry?: () => void
}

/** Format a hot value like 12,345,678 → 1234.5万 / 1.2亿. */
function formatHot(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万`
  return String(n)
}

/** Map a Weibo label to a color-tier key. 沸/爆 are the hottest (red), 热 is warm
 *  (orange), anything else falls back to a neutral muted style. */
function labelKind(label: string): 'hot' | 'warm' | 'muted' {
  if (label === '沸' || label === '爆') return 'hot'
  if (label === '热') return 'warm'
  return 'muted'
}

/** Weibo hot search tab — pure presentational; the parent owns fetch + retry.
 *  Shows rank, keyword, intensity label, hot value and category for each item. */
export default function WeiboTab({ items, loading, error, onRetry }: Props) {
  return (
    <ListView
      items={items}
      loading={loading}
      error={error}
      onRetry={onRetry}
      skeletonCount={8}
      emptyTitle="暂无数据"
      emptySubtitle="点击右上角刷新按钮立即拉取，或等待下一次定时刷新。"
      errorTitle="刷新失败"
      errorSubtitle="未能获取最新榜单，稍后将自动重试。"
      renderItem={(it) => (
        <a className="news-card-link" href={it.url} target="_blank" rel="noreferrer noopener">
          <span className={`news-rank${it.rank <= 3 ? ` news-rank--${it.rank}` : ''}`}>{it.rank}</span>
          <div className="news-card-body">
            <span className="news-card-title weibo-title">
              <span className="weibo-keyword">{it.keyword}</span>
              {it.labelName && it.labelName !== '新' && (
                <span className={`news-label-inline news-label-inline--${labelKind(it.labelName)}`}>
                  {it.labelName}
                </span>
              )}
              {it.hotValue > 0 && <span className="news-hot-value">{formatHot(it.hotValue)}</span>}
            </span>
            {it.category && (
              <div className="news-card-meta">
                <span>{it.category}</span>
              </div>
            )}
          </div>
        </a>
      )}
    />
  )
}
