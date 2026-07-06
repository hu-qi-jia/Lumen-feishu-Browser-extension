import FormSelect from '../form/FormSelect'
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

/** Top bar of the news panel: icon refresh button + last-updated stamp + interval dropdown.
 *  Reuses FormSelect (project's standard dropdown) for the frequency picker. */
export default function NewsRefreshBar({ refreshing, lastUpdated, error, interval, onIntervalChange, onRefresh }: Props) {
  return (
    <div className="news-bar">
      <button
        type="button"
        className={`news-refresh-btn${refreshing ? ' is-refreshing' : ''}`}
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="刷新"
        title="刷新"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
      <div className="news-bar-meta">
        <span className={`updated${error ? ' updated-err' : ''}`}>
          {error ? `刷新失败：${error}` : `更新于 ${relativeTime(lastUpdated)}`}
        </span>
      </div>
      <div className="news-bar-select">
        <FormSelect
          value={String(interval)}
          onChange={(e) => onIntervalChange(Number(e.target.value) as NewsInterval)}
        >
          <option value="10">10 分钟</option>
          <option value="30">30 分钟</option>
          <option value="60">1 小时</option>
        </FormSelect>
      </div>
    </div>
  )
}
