import { IconSparkle } from './icons'
import './Avatar.css'

interface Props {
  /** Whose avatar: the assistant (brand sparkle) or the user (person glyph). */
  role: 'user' | 'assistant'
  /** Edge length in px. Defaults to 24 — small, per the chat design. */
  size?: number
  /** Extra class on the root span. */
  className?: string
}

/**
 * Small circular chat avatar — independent of any bubble so it can sit beside a
 * user bubble, an assistant reply block, or the transient thinking indicator.
 * Pure inline SVG (no emoji, per project convention): a filled sparkle on the
 * brand gradient for the assistant, a person glyph on a neutral chip for the user.
 */
export default function Avatar({ role, size = 24, className }: Props) {
  return (
    <span
      className={`avatar avatar--${role}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {role === 'assistant' ? (
        <IconSparkle />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )}
    </span>
  )
}
