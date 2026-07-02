import React from 'react'
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
  return (
    <span className={`tooltip tooltip--${position}`}>
      {children}
      <span className="tooltip-text">{content}</span>
    </span>
  )
}
