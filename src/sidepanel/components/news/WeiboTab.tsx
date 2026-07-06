import type { WeiboHotSearch } from '../../../shared/news/types'
import NewsList from './NewsList'

interface Props {
  items: WeiboHotSearch[]
  loading: boolean
  error?: string
  onRetry?: () => void
}

/** Weibo hot search tab — pure presentational; the parent owns fetch + retry.
 *  Hides hot values and the "新" label per the design spec. The label (沸/爆/热/…) is
 *  shown INLINE after the keyword, color-coded by intensity:
 *    沸/爆 → red, 热 → orange, others → muted text. */
export default function WeiboTab({ items, loading, error, onRetry }: Props) {
  return (
    <NewsList
      items={items}
      loading={loading}
      error={error}
      onRetry={onRetry}
      skeletonCount={8}
      renderItem={(it) => (
        <a key={it.url} className="news-card" href={it.url} target="_blank" rel="noreferrer noopener">
          <span className={`news-rank${it.rank <= 3 ? ' news-rank--top' : ''}`}>{it.rank}</span>
          <div className="news-card-body">
            <span className="news-card-title">
              {it.keyword}
              {it.labelName && it.labelName !== '新' && (
                <span className={`news-label-inline news-label-inline--${labelKind(it.labelName)}`}>
                  {it.labelName}
                </span>
              )}
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

/** Map a Weibo label to a color-tier key. 沸/爆 are the hottest (red), 热 is warm
 *  (orange), anything else falls back to a neutral muted style. */
function labelKind(label: string): 'hot' | 'warm' | 'muted' {
  if (label === '沸' || label === '爆') return 'hot'
  if (label === '热') return 'warm'
  return 'muted'
}
