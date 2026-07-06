import { useEffect, useRef, type ReactNode } from 'react'
import './Dropdown.css'

interface Props {
  /** Controlled open state. Caller manages it via onOpenChange. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Trigger element. Click handling is left to the caller (so a trigger can also
   *  be a div, an icon button, etc.). Common pattern: onClick={() => onOpenChange(!open)}. */
  trigger: ReactNode
  /** Menu content. Rendered inside .dropdown-menu when open. */
  children: ReactNode
  /** Horizontal alignment of the menu relative to the trigger. Default 'left'. */
  align?: 'left' | 'right'
  /** Extra class on the wrapper. */
  className?: string
  /** Extra class on the menu element. */
  menuClassName?: string
  /** Max width of the menu (px). Default 280. */
  maxWidth?: number
}

/**
 * Reusable dropdown popup — wraps a trigger + an absolutely-positioned menu.
 * Owns: outside-click close, positioning wrapper, open animation.
 * Caller owns: open state and menu contents.
 *
 * Extracted from DocSelector so the news refresh bar can reuse the same popup
 * mechanism for its interval picker.
 */
export default function Dropdown({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'left',
  className,
  menuClassName,
  maxWidth = 280,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onOpenChange])

  return (
    <div className={`dropdown${className ? ` ${className}` : ''}`} ref={wrapRef}>
      {trigger}
      {open && (
        <div
          className={`dropdown-menu${align === 'right' ? ' dropdown-menu--right' : ''}${menuClassName ? ` ${menuClassName}` : ''}`}
          style={{ maxWidth }}
          role="listbox"
        >
          {children}
        </div>
      )}
    </div>
  )
}
