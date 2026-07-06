import type { WeiboHotSearch } from '../../../shared/news/types'
import NewsList from './NewsList'

interface Props {
  items: WeiboHotSearch[]
  loading: boolean
  error?: string
  onRetry?: () => void
}

/** Weibo hot search tab — pure presentational; the parent owns fetch + retry.
 *  Hides hot values and the "新" label per the design spec; keeps 沸/爆/热 badges. */
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
            <span className="news-card-title">{it.keyword}</span>
            <div className="news-card-meta">
              {it.labelName && it.labelName !== '新' && (
                <span className={`news-label${['沸', '爆'].includes(it.labelName) ? ' news-label--hot' : ''}`}>
                  {it.labelName}
                </span>
              )}
              {it.category && <span>{it.category}</span>}
            </div>
          </div>
        </a>
      )}
    />
  )
}
