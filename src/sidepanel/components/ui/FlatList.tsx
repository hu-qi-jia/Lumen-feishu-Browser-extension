import type { ReactNode } from 'react'
import './FlatList.css'

export interface FlatListItem {
  /** Unique key for this row. */
  id: string
  /** Primary title text. */
  title: string
  /** Secondary description shown beneath the title. */
  subtitle?: string
  /** Optional icon rendered before the title. */
  icon?: ReactNode
  /** Right-aligned metadata (e.g. relative time). */
  meta?: ReactNode
  /** Right-aligned action buttons (toggle, edit, delete, …). */
  actions?: ReactNode
  /** Click handler for the main row area. Omit for non-interactive rows. */
  onClick?: () => void
  /** aria-label for the row button. Defaults to the title. */
  ariaLabel?: string
}

interface FlatListProps {
  items: FlatListItem[]
  /** Optional content when the list is empty. */
  empty?: ReactNode
}

/**
 * Flat vertical list with border-separated rows.
 * Used by the knowledge base notes list and the skill library list.
 */
export default function FlatList({ items, empty }: FlatListProps) {
  if (items.length === 0 && empty) {
    return <div className="flat-list-empty">{empty}</div>
  }
  return (
    <div className="flat-list" role="list">
      {items.map((item) => {
        const main = (
          <>
            {item.icon && <span className="flat-list-row-icon">{item.icon}</span>}
            <span className="flat-list-row-meta">
              <span className="flat-list-row-title">{item.title}</span>
              {item.subtitle && <span className="flat-list-row-sub">{item.subtitle}</span>}
            </span>
          </>
        )
        return (
          <div className="flat-list-row" key={item.id} role="listitem">
            {item.onClick ? (
              <button
                className="flat-list-row-main"
                type="button"
                onClick={item.onClick}
                aria-label={item.ariaLabel ?? item.title}
              >
                {main}
              </button>
            ) : (
              <div className="flat-list-row-main">{main}</div>
            )}
            {(item.meta || item.actions) && (
              <div className="flat-list-row-side">
                {item.meta}
                {item.actions}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
