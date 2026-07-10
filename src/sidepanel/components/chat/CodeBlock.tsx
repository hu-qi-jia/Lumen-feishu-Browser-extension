import { useState } from 'react'

interface Props {
  /** 代码内容（原样展示，保留换行）。 */
  code: string
  /** 是否可滚动（内容较长时设为 true，固定高度 + 滚动条）。 */
  scrollable?: boolean
  /** 自定义类名。 */
  className?: string
}

/** 代码块 + 一键复制按钮。黑色背景，复制图标按钮绝对定位在右上角，不占用滚动条空间。 */
export default function CodeBlock({ code, scrollable = false, className }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable — silently no-op */
    }
  }

  return (
    <div className={`code-block${scrollable ? ' code-block--scroll' : ''}${className ? ` ${className}` : ''}`}>
      <pre className="code-block__pre">{code}</pre>
      <button
        type="button"
        className="code-block__copy"
        onClick={() => void handleCopy()}
        aria-label={copied ? '已复制' : '复制'}
        title={copied ? '已复制' : '复制'}
      >
        {copied ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  )
}
