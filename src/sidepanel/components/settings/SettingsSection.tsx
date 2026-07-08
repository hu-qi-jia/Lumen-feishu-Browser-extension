import type { ReactNode } from 'react'

interface Props {
  /** Uppercase section heading. Omit for a title-less card. */
  title?: ReactNode
  children: ReactNode
  /** Extra className appended to the card (e.g. layout tweaks). */
  className?: string
  /** Optional control rendered at the far right of the title row (e.g. a switch). */
  action?: ReactNode
}

/**
 * The bordered card every settings section renders into.
 * Reused across all tabs so section styling stays in one place.
 */
export default function SettingsSection({ title, children, className, action }: Props) {
  const cls = className ? `settings-section ${className}` : 'settings-section'
  return (
    <section className={cls}>
      {title && (
        <h3 className="section-title">
          <span className="section-title-text">{title}</span>
          {action && <span className="section-title-action">{action}</span>}
        </h3>
      )}
      {children}
    </section>
  )
}
