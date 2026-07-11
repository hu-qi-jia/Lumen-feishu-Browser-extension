import { useState } from 'react'
import Dropdown from '../ui/Dropdown'
import Tooltip from '../ui/Tooltip'
import type { NewsInterval } from '@/shared/news/types'

interface Props {
  refreshing: boolean
  /** Epoch ms of the most recent successful refresh. Shown in the refresh button tooltip. */
  lastUpdated: number | null
  /** Last error when the most recent refresh failed. Shown in the refresh button tooltip. */
  error?: string
  interval: NewsInterval
  onIntervalChange: (i: NewsInterval) => void
  onRefresh: () => void
  /** Show the translate button (GitHub tab + translation not disabled). */
  showTranslate?: boolean
  translating?: boolean
  /** Last translate error message; shown as the tooltip until cleared. */
  translateError?: string | null
  /** Last translate success message; shown as the tooltip until cleared. */
  translateSuccess?: string | null
  onTranslate?: () => void
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

const INTERVAL_OPTIONS: { value: NewsInterval; label: string }[] = [
  { value: 10, label: '10 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
]

/** Top bar of the news panel: interval dropdown (left) + refresh button (right, tooltip
 *  shows last-updated time) + translate button (right of refresh, GitHub only). Reuses
 *  the Dropdown component (the same popup used by DocSelector in the chat topbar). */
export default function NewsRefreshBar({
  refreshing, lastUpdated, error, interval, onIntervalChange, onRefresh,
  showTranslate = false, translating = false, translateError, translateSuccess, onTranslate,
}: Props) {
  const [open, setOpen] = useState(false)
  const currentLabel = INTERVAL_OPTIONS.find((o) => o.value === interval)?.label ?? `${interval} 分钟`
  const refreshTip = error ? `刷新失败：${error}` : `更新于 ${relativeTime(lastUpdated)}`

  return (
    <div className="news-bar">
      <Dropdown
        className="news-bar-select"
        open={open}
        onOpenChange={setOpen}
        align="left"
        menuClassName="news-interval-menu"
        trigger={
          <Tooltip content="刷新频率" position="bottom">
            <button
              type="button"
              className={`news-interval-trigger${open ? ' is-open' : ''}`}
              onClick={() => setOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={open}
            >
              <span className="news-interval-label">{currentLabel}</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </Tooltip>
        }
      >
        {INTERVAL_OPTIONS.map((o) => {
          const selected = o.value === interval
          return (
            <button
              key={o.value}
              type="button"
              className={`news-interval-item${selected ? ' is-active' : ''}`}
              onClick={() => { onIntervalChange(o.value); setOpen(false) }}
            >
              <span className="news-interval-item-label">{o.label}</span>
              {selected && (
                <svg className="news-interval-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          )
        })}
      </Dropdown>

      <div className="news-bar-actions">
        <Tooltip content={refreshTip} position="bottom">
          <button
            type="button"
            className={`news-refresh-btn${refreshing ? ' is-refreshing' : ''}`}
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="刷新"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </Tooltip>
        {showTranslate && onTranslate && (
          <Tooltip
            content={
              translating ? '翻译中…'
                : translateError ? `翻译失败：${translateError}`
                : translateSuccess ?? '翻译项目描述'
            }
            position="bottom"
          >
            <button
              type="button"
              className={`news-translate-btn${translating ? ' is-translating' : ''}${translateError ? ' has-error' : ''}`}
              onClick={onTranslate}
              disabled={translating}
              aria-label="翻译项目描述"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
