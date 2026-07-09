import { useState } from 'react'

interface Props {
  /** 代码内容（原样展示，保留换行）。 */
  code: string
  /** 是否可滚动（内容较长时设为 true，固定高度 + 滚动条）。 */
  scrollable?: boolean
  /** 自定义类名。 */
  className?: string
}

/** 代码块 + 一键复制按钮。单行用作 URL 展示，多行用作 JSON 权限展示。 */
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
        aria-label="复制"
      >
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}
