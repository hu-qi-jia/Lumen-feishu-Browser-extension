interface Props {
  /** "empty" = no items yet; "error" = last refresh failed and no stale items to show. */
  variant?: 'empty' | 'error'
  error?: string
  onRetry?: () => void
}

/** Empty / error state for a news tab. Mirrors the inline-SVG icon style used by the
 *  not-feishu hint — no emoji. */
export default function NewsEmpty({ variant = 'empty', error, onRetry }: Props) {
  return (
    <div className="news-empty">
      <svg className="news-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {variant === 'error' ? (
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
      <div className="news-empty-title">
        {variant === 'error' ? '刷新失败' : '暂无数据'}
      </div>
      <div className="news-empty-sub">
        {variant === 'error'
          ? '未能获取最新榜单，稍后将自动重试。'
          : '点击右上角刷新按钮立即拉取，或等待下一次定时刷新。'}
      </div>
      {variant === 'error' && error && <div className="news-empty-err">{error}</div>}
      {onRetry && (
        <button className="btn-link" onClick={onRetry} style={{ marginTop: 4 }}>
          立即刷新
        </button>
      )}
    </div>
  )
}
