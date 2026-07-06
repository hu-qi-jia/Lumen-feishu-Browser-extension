import type { GitHubTrendingRepo } from '../../../shared/news/types'
import NewsList from './NewsList'

interface Props {
  items: GitHubTrendingRepo[]
  loading: boolean
  error?: string
  onRetry?: () => void
}

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** Split "owner/repo" into [owner, repo] for visual hierarchy. */
function splitFullName(full: string): [string, string] {
  const i = full.indexOf('/')
  if (i < 0) return ['', full]
  return [full.slice(0, i), full.slice(i + 1)]
}

/** GitHub Trending tab — pure presentational; the parent owns fetch + retry.
 *  Layout: rank badge | owner/repo (hierarchical) + translated desc + meta. */
export default function GitHubTab({ items, loading, error, onRetry }: Props) {
  return (
    <NewsList
      items={items}
      loading={loading}
      error={error}
      onRetry={onRetry}
      skeletonCount={6}
      renderItem={(r) => {
        const [owner, repo] = splitFullName(r.fullName)
        return (
          <a key={r.url} className="news-card" href={r.url} target="_blank" rel="noreferrer noopener">
            <span className={`news-rank${r.rank <= 3 ? ' news-rank--top' : ''}`}>{r.rank}</span>
            <div className="news-card-body">
              <span className="news-card-title">
                {owner && <span className="news-card-owner">{owner} / </span>}
                <span className="news-card-repo">{repo}</span>
              </span>
              {r.descriptionZh ? (
                <span className="news-card-desc">{r.descriptionZh}</span>
              ) : r.description ? (
                <span className="news-card-desc">{r.description}</span>
              ) : null}
              {r.descriptionZh && r.description && (
                <span className="news-card-desc-en" title={r.description}>{r.description}</span>
              )}
              <div className="news-card-meta">
                {r.language && (
                  <span className="news-meta-lang">
                    <span className="news-lang-dot" style={{ background: r.languageColor || '#888' }} />
                    {r.language}
                  </span>
                )}
                <span>{formatNum(r.stars)} stars</span>
                <span>{formatNum(r.forks)} forks</span>
                {r.starsSince > 0 && (
                  <span className="news-meta-since">+{formatNum(r.starsSince)} {r.sinceLabel}</span>
                )}
              </div>
            </div>
          </a>
        )
      }}
    />
  )
}
