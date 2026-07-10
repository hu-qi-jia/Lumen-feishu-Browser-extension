import type { ReactNode } from 'react'
import { Skeleton } from './Skeleton'
import './ListView.css'

export interface ListViewProps<T> {
  items: T[]
  loading?: boolean
  error?: string
  onRetry?: () => void
  /** Number of skeleton rows to show on first load. */
  skeletonCount?: number
  /** Render one skeleton row. Defaults to a title + subtitle skeleton. */
  renderSkeleton?: (index: number) => ReactNode
  /** Render the content of one list item. The row wrapper (hover border etc.) is provided by ListView. */
  renderItem: (item: T, index: number) => ReactNode
  /** Stable key for each item. Falls back to index. */
  keyExtractor?: (item: T, index: number) => string | number
  emptyTitle?: string
  emptySubtitle?: string
  errorTitle?: string
  errorSubtitle?: string
  className?: string
}

/** Generic ranked-list container extracted from the news panel.
 *  Owns first-load skeleton, empty/error states, and the shared row hover style
 *  (blue left border) so every consumer looks consistent. */
export default function ListView<T>({
  items,
  loading = false,
  error,
  onRetry,
  skeletonCount = 6,
  renderSkeleton,
  renderItem,
  keyExtractor,
  emptyTitle = '暂无数据',
  emptySubtitle = '当前列表为空。',
  errorTitle = '加载失败',
  errorSubtitle = '未能加载列表，请稍后重试。',
  className,
}: ListViewProps<T>) {
  if (loading && items.length === 0) {
    return (
      <div className={`list-view${className ? ` ${className}` : ''}`}>
        {Array.from({ length: skeletonCount }).map((_, i) =>
          renderSkeleton ? (
            renderSkeleton(i)
          ) : (
            <div key={i} className="list-view-row list-view-row--skeleton">
              <Skeleton width={22} height={13} />
              <div className="list-view-row__body">
                <Skeleton width="70%" height={13} />
                <Skeleton width="95%" height={11} style={{ marginTop: 4 }} />
              </div>
            </div>
          ),
        )}
      </div>
    )
  }

  if (items.length === 0) {
    const isError = Boolean(error)
    return (
      <div className={`list-empty${className ? ` ${className}` : ''}`}>
        <svg className="list-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {isError ? (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </>
          ) : (
            <>
              <path d="M3 3v18h18" />
              <path d="M7 14l4-4 4 4 6-6" />
            </>
          )}
        </svg>
        <div className="list-empty-title">{isError ? errorTitle : emptyTitle}</div>
        <div className="list-empty-sub">{isError ? errorSubtitle : emptySubtitle}</div>
        {isError && error !== errorSubtitle && <div className="list-empty-err">{error}</div>}
        {onRetry && (
          <button className="btn-link" onClick={onRetry} type="button" style={{ marginTop: 4 }}>
            立即刷新
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`list-view${className ? ` ${className}` : ''}`}>
      {items.map((item, i) => (
        <div key={keyExtractor?.(item, i) ?? i} className="list-view-row">
          {renderItem(item, i)}
        </div>
      ))}
    </div>
  )
}
