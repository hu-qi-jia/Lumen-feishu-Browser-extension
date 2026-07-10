import React from 'react'
import './HubCard.css'

interface Props {
  icon: React.ReactNode
  title: string
  desc: string
  onClick?: () => void
  dimmed?: boolean
  /** Optional badge shown next to the title (e.g. requirement hint). */
  badge?: string
}

export default function HubCard({ icon, title, desc, onClick, dimmed, badge }: Props) {
  const isButton = !!onClick
  const Tag = isButton ? 'button' : 'div'
  return (
    <Tag
      className={`hub-card${isButton ? ' hub-card--clickable' : ''}${dimmed ? ' hub-card--dim' : ''}`}
      onClick={isButton ? onClick : undefined}
      type={isButton ? 'button' : undefined}
    >
      <span className="hub-card-icon">{icon}</span>
      <span className="hub-card-body">
        <span className="hub-card-title">
          {title}
          {badge && <span className="hub-card-badge">{badge}</span>}
        </span>
        <span className="hub-card-desc">{desc}</span>
      </span>
    </Tag>
  )
}
