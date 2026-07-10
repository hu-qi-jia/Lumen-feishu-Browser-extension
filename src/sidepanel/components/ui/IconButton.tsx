import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './IconButton.css'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  /** Visual size. 'sm' matches chat-topbar-btn (28x28); 'md' matches input-bar tool buttons (30x30). */
  size?: 'sm' | 'md'
  /** Active/selected state (e.g. knowledge base enabled). */
  active?: boolean
  /** Variant. 'ghost' keeps the background transparent on hover (e.g. back button).
   *  'danger' shows a red icon but uses the same gray hover background as default. */
  variant?: 'default' | 'ghost' | 'danger'
}

export default function IconButton({
  children,
  size = 'sm',
  active,
  variant = 'default',
  className = '',
  ...rest
}: Props) {
  const sizeClass = size === 'md' ? ' icon-btn--md' : ''
  const activeClass = active ? ' icon-btn--active' : ''
  const variantClass = variant !== 'default' ? ` icon-btn--${variant}` : ''
  return (
    <button
      className={`icon-btn${sizeClass}${activeClass}${variantClass}${className ? ` ${className}` : ''}`}
      type="button"
      {...rest}
    >
      {children}
    </button>
  )
}
