import { useState } from 'react'
import { IconCopy, IconRefresh, IconCheck } from '../ui/icons'
import IconButton from '../ui/IconButton'
import Tooltip from '../ui/Tooltip'
import './ReplyActions.css'

interface Props {
  /** Markdown text of the reply to copy (all rounds joined). */
  text: string
  /** Regenerate the turn. Omit/undefined → the retry button is hidden (only the last
   *  reply passes this; earlier replies get copy-only). */
  onRetry?: () => void
}

/**
 * Small action row under a completed agent reply — copy the answer and, on the latest
 * reply, retry/regenerate it. ChatGPT-style: subtle icon-only buttons with hover tooltips.
 * Copy is self-contained (navigator.clipboard, with a transient 已复制 confirmation);
 * retry is lifted to ChatPanel (it trims + re-runs the agent).
 */
export default function ReplyActions({ text, onRetry }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable (permissions / non-secure context) — silently no-op */
    }
  }

  return (
    <div className="reply-actions">
      <Tooltip content={copied ? '已复制' : '复制'} position="top">
        <IconButton
          className={`reply-action${copied ? ' reply-action--copied' : ''}`}
          onClick={handleCopy}
          aria-label="复制"
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </IconButton>
      </Tooltip>
      {onRetry && (
        <Tooltip content="重试" position="top">
          <IconButton className="reply-action" onClick={onRetry} aria-label="重试">
            <IconRefresh />
          </IconButton>
        </Tooltip>
      )}
    </div>
  )
}
