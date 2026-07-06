import Button from '../Button'
import FormToggle from '../form/FormToggle'
import type { NewsInterval } from '../../../shared/news/types'

interface Props {
  refreshing: boolean
  /** Epoch ms of the most recent successful refresh, across both sources. */
  lastUpdated: number | null
  /** Last error (any source) when the most recent refresh failed. */
  error?: string
  interval: NewsInterval
  onIntervalChange: (i: NewsInterval) => void
  onRefresh: () => void
}

function relativeTime(ts: number | null): string {
  if (!ts) return '尚未刷新'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return `${d} 天前`
}

/** Top bar of the news panel: refresh button + last-updated stamp + interval picker.
 *  Reuses Button (loading prop) and FormToggle (segmented pill) — no new primitives. */
export default function NewsRefreshBar({ refreshing, lastUpdated, error, interval, onIntervalChange, onRefresh }: Props) {
  return (
    <div className="news-bar">
      <Button variant="secondary" size="sm" loading={refreshing} onClick={onRefresh}>
        刷新
      </Button>
      <div className="news-bar-meta">
        <span className={`updated${error ? ' updated-err' : ''}`}>
          {error ? `刷新失败：${error}` : `更新于 ${relativeTime(lastUpdated)}`}
        </span>
      </div>
      <div className="news-bar-interval">
        <span>频率</span>
        <FormToggle
          value={String(interval)}
          onChange={(v) => onIntervalChange(Number(v) as NewsInterval)}
          options={[
            { value: '10', label: '10min' },
            { value: '30', label: '30min' },
            { value: '60', label: '1h' },
          ]}
        />
      </div>
    </div>
  )
}
