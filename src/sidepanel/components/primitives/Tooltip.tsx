import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

interface Props {
  /** The tooltip text to display on hover. */
  content: string
  /** The trigger element. */
  children: React.ReactNode
  /** Position relative to the trigger. Default: 'top'. */
  position?: 'top' | 'bottom' | 'left' | 'right'
}

const MARGIN = 8

/**
 * Tooltip rendered via Portal to document.body so it is never clipped by an ancestor's
 * `overflow: hidden` or shifted by a transformed ancestor (backdrop-filter / filter / transform
 * all create a new containing block that breaks `position: fixed`). On hover we measure the
 * trigger + tip and compute a fixed placement, flipping to the opposite side when there isn't
 * room, clamping into the viewport, and aligning the arrow to the trigger center so a clamped
 * tip still points at its trigger.
 */
export default function Tooltip({ content, children, position = 'top' }: Props) {
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [placed, setPlaced] = useState(position)
  const [style, setStyle] = useState<React.CSSProperties>({})

  useLayoutEffect(() => {
    if (!visible) return
    const wrapper = wrapperRef.current
    const tip = tipRef.current
    if (!wrapper || !tip) return

    const place = () => {
      const r = wrapper.getBoundingClientRect()
      const t = tip.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      let pos = position
      // Flip when there isn't room on the preferred side.
      if (pos === 'top' && r.top - t.height - MARGIN < MARGIN) pos = 'bottom'
      else if (pos === 'bottom' && r.bottom + t.height + MARGIN > vh - MARGIN) pos = 'top'
      else if (pos === 'left' && r.left - t.width - MARGIN < MARGIN) pos = 'right'
      else if (pos === 'right' && r.right + t.width + MARGIN > vw - MARGIN) pos = 'left'

      let left = 0
      let top = 0
      if (pos === 'top') {
        left = r.left + r.width / 2 - t.width / 2
        top = r.top - t.height - MARGIN
      } else if (pos === 'bottom') {
        left = r.left + r.width / 2 - t.width / 2
        top = r.bottom + MARGIN
      } else if (pos === 'left') {
        left = r.left - t.width - MARGIN
        top = r.top + r.height / 2 - t.height / 2
      } else {
        left = r.right + MARGIN
        top = r.top + r.height / 2 - t.height / 2
      }
      const clampedLeft = Math.max(MARGIN, Math.min(left, vw - t.width - MARGIN))
      const clampedTop = Math.max(MARGIN, Math.min(top, vh - t.height - MARGIN))

      // Align the arrow with the trigger center so a clamped tip still points correctly.
      let arrowOffset: number
      if (pos === 'top' || pos === 'bottom') {
        const x = r.left + r.width / 2 - clampedLeft
        arrowOffset = Math.max(14, Math.min(x, t.width - 14))
      } else {
        const y = r.top + r.height / 2 - clampedTop
        arrowOffset = Math.max(14, Math.min(y, t.height - 14))
      }

      setPlaced(pos)
      setStyle({
        left: clampedLeft,
        top: clampedTop,
        ['--arrow-offset' as any]: `${arrowOffset}px`,
      })
    }

    // Wait a frame so the tip has been laid out before we measure it.
    const raf = requestAnimationFrame(place)
    return () => cancelAnimationFrame(raf)
  }, [visible, position, content])

  // Hide on scroll / resize so the tip never floats stale while the page moves underneath.
  useEffect(() => {
    if (!visible) return
    const hide = () => setVisible(false)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [visible])

  return (
    <span
      ref={wrapperRef}
      className="tooltip"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {createPortal(
        <span
          ref={tipRef}
          className={`tooltip-text tooltip-text--${placed}${visible ? ' is-visible' : ''}`}
          style={style}
          role="tooltip"
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  )
}