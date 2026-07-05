import type { ReactNode } from 'react'

interface Props {
  /** Uppercase section heading. Omit for a title-less card. */
  title?: string
  children: ReactNode
  /** Extra className appended to the card (e.g. layout tweaks). */
  className?: string
}

/**
 * The bordered card every settings section renders into.
 * Reused across all four tabs so section styling stays in one place.
 */
export default function SettingsSection({ title, children, className }: Props) {
  const cls = className ? `settings-section ${className}` : 'settings-section'
  return (
    <section className={cls}>
      {title && <h3 className="section-title">{title}</h3>}
      {children}
    </section>
  )
}
