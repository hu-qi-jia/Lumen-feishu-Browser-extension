import type { GitHubTrendingRepo } from '@/shared/news/types'
import NewsList from './NewsList'
import Tooltip from '../primitives/Tooltip'

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

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z" />
    </svg>
  )
}

function ForkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0zM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0z" />
    </svg>
  )
}

/** GitHub Trending tab — pure presentational; the parent owns fetch + retry.
 *  Layout: rank badge | owner/repo (hierarchical) + translated desc + star/fork meta. */
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
            <span className={`news-rank${r.rank <= 3 ? ` news-rank--${r.rank}` : ''}`}>{r.rank}</span>
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
              <div className="news-card-meta">
                <Tooltip content="Stars" position="top">
                  <span className="news-meta-stat">
                    <StarIcon />
                    {formatNum(r.stars)}
                  </span>
                </Tooltip>
                <Tooltip content="Forks" position="top">
                  <span className="news-meta-stat">
                    <ForkIcon />
                    {formatNum(r.forks)}
                  </span>
                </Tooltip>
              </div>
            </div>
          </a>
        )
      }}
    />
  )
}
