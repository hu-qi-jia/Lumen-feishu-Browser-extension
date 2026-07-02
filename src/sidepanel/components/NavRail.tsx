import React from 'react'
import Tooltip from './Tooltip'
import './NavRail.css'

export interface NavItem {
  id: string
  icon: React.ReactNode
  label: string
  disabled?: boolean
  disabledReason?: string
}

interface Props {
  items: NavItem[]
  bottomItems?: NavItem[]
  activeId?: string
  onSelect?: (id: string) => void
  'aria-label'?: string
}

/**
 * Fixed left icon rail — a slim, always-visible vertical navigation.
 * (Previously a floating horizontal pill that expanded on hover; the narrow
 * extension panel made a permanent left column the clearer choice.)
 */
export default function NavRail({
  items,
  bottomItems = [],
  activeId,
  onSelect,
  'aria-label': ariaLabel,
}: Props) {
  return (
    <nav className="nav-rail" aria-label={ariaLabel}>
      <ul className="nav-rail-list">
        {items.map((item) => (
          <li key={item.id}>
            <NavRailButton
              item={item}
              active={activeId === item.id}
              onClick={() => onSelect?.(item.id)}
            />
          </li>
        ))}
      </ul>

      {bottomItems.length > 0 && (
        <ul className="nav-rail-list nav-rail-list--bottom">
          {bottomItems.map((item) => (
            <li key={item.id}>
              <NavRailButton item={item} active={false} onClick={() => onSelect?.(item.id)} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}

function NavRailButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  return (
    <Tooltip content={item.disabled ? (item.disabledReason ?? item.label) : item.label} position="right">
      <button
        type="button"
        className={`nav-rail-item ${active ? 'nav-rail-item--active' : ''}`}
        onClick={onClick}
        disabled={item.disabled}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
      >
        <span className="nav-rail-icon">{item.icon}</span>
      </button>
    </Tooltip>
  )
}
