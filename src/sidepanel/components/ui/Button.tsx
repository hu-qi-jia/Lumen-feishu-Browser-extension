import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Stretch to full width of the container. */
  block?: boolean
  /** Optional icon rendered before the label. */
  icon?: ReactNode
  /** Show a spinner and disable interaction. */
  loading?: boolean
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  icon,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: Props) {
  const cls = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    block ? 'btn--block' : '',
    loading ? 'btn--loading' : '',
    className ?? '',
  ].filter(Boolean).join(' ')
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <svg className="btn-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : icon}
      {children && <span className="btn-label">{children}</span>}
    </button>
  )
}
