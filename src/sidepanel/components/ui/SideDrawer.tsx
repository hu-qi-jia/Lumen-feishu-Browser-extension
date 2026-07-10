import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import IconButton from './IconButton'
import Tooltip from './Tooltip'
import './SideDrawer.css'

interface Props {
  title: string
  onClose: () => void
  /** Drawer body — the caller owns the row/list markup (the shell only renders overlay + head). */
  children: ReactNode
}

const SLIDE_MS = 220

/**
 * Right-side slide-in drawer shell — the浮层 chat's history popup and the slides history
 * drawer share. Owns the enter/exit animation so callers just conditionally render it
 * (`{open && <SideDrawer .../../>}`) and pass their list as children.
 */
export default function SideDrawer({ title, onClose, children }: Props) {
  // Slide-in / slide-out animation state, fully internal so the parent's
  // conditional rendering needs no changes.
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Trigger the enter transition on the next frame so the browser paints the
  // initial translateX(100%) before we move to translateX(0). Without rAF the
  // two states coalesce into a single paint and the transition never fires.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => {
      cancelAnimationFrame(raf)
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  const requestClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    closeTimer.current = setTimeout(onClose, SLIDE_MS)
  }, [closing, onClose])

  const open = mounted && !closing

  return (
    <div className={`drawer-overlay${open ? ' drawer-overlay--open' : ''}`} onClick={requestClose}>
      <div className={`drawer${open ? ' drawer--open' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="drawer-title">{title}</span>
          <Tooltip content="关闭" position="bottom">
            <IconButton className="drawer-x" onClick={requestClose} aria-label="关闭">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>
          </Tooltip>
        </div>
        {children}
      </div>
    </div>
  )
}
