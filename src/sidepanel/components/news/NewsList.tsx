import type { ReactNode } from 'react'
import { Skeleton } from '../ui/Skeleton'
import NewsEmpty from './NewsEmpty'

interface Props<T> {
  items: T[]
  loading: boolean
  error?: string
  onRetry?: () => void
  /** Number of skeleton rows to show on first load. */
  skeletonCount?: number
  /** Render one skeleton row (uses Skeleton internally). Defaults to a title-only row. */
  renderSkeleton?: (i: number) => ReactNode
  /** Render one list item. The caller wraps it in an <a>/card. */
  renderItem: (item: T, index: number) => ReactNode
}

/** Reusable ranked-list container for the news panel. Owns the three states every news
 *  source shares — first-load skeleton, empty/error, and the populated list — so each tab
 *  only has to supply its item renderer. Generic over the item type so GitHubTab and
 *  WeiboTab stay strongly typed without a shared base. */
export default function NewsList<T>({
  items,
  loading,
  error,
  onRetry,
  skeletonCount = 6,
  renderSkeleton,
  renderItem,
}: Props<T>) {
  if (loading && items.length === 0) {
    return (
      <div className="news-list">
        {Array.from({ length: skeletonCount }).map((_, i) =>
          renderSkeleton ? renderSkeleton(i) : (
            <div key={i} className="news-card news-card--skeleton">
              <Skeleton width={22} height={13} />
              <div className="news-card-body">
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
    return <NewsEmpty variant={error ? 'error' : 'empty'} error={error} onRetry={onRetry} />
  }
  return <div className="news-list">{items.map((item, i) => renderItem(item, i))}</div>
}
