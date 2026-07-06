import { useEffect, useRef, useState } from 'react'
import './Tooltip.css'

interface Props {
  /** The tooltip text to display on hover. */
  content: string
  /** The trigger element. */
  children: React.ReactNode
  /** Position relative to the trigger. Default: 'top'. */
  position?: 'top' | 'bottom' | 'left' | 'right'
}

export default function Tooltip({ content, children, position = 'top' }: Props) {
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [edge, setEdge] = useState<'none' | 'left' | 'right'>('none')

  // Detect viewport overflow and adjust alignment.
  useEffect(() => {
    const wrapper = wrapperRef.current
    const tooltip = tooltipRef.current
    if (!wrapper || !tooltip) return

    const checkOverflow = () => {
      const rect = wrapper.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()
      const vw = window.innerWidth

      // Only need to check horizontal overflow for top/bottom positions.
      if (position === 'top' || position === 'bottom') {
        const tooltipLeft = rect.left + rect.width / 2 - tooltipRect.width / 2
        const tooltipRight = tooltipLeft + tooltipRect.width

        if (tooltipLeft < 8) {
          setEdge('left')
        } else if (tooltipRight > vw - 8) {
          setEdge('right')
        } else {
          setEdge('none')
        }
      } else {
        setEdge('none')
      }
    }

    // Check on hover (when tooltip becomes visible).
    const onEnter = () => {
      // Wait for tooltip to be rendered before measuring.
      requestAnimationFrame(checkOverflow)
    }
    wrapper.addEventListener('mouseenter', onEnter)
    return () => wrapper.removeEventListener('mouseenter', onEnter)
  }, [position, content])

  const edgeClass = edge !== 'none' ? ` tooltip--edge-${edge}` : ''
  return (
    <span ref={wrapperRef} className={`tooltip tooltip--${position}${edgeClass}`}>
      {children}
      <span ref={tooltipRef} className="tooltip-text">{content}</span>
    </span>
  )
}