import './SettingsTabs.css'

interface TabDef {
  id: string
  label: string
}

interface Props {
  tabs: readonly TabDef[]
  active: string
  onChange: (id: string) => void
  /** Accessible label for the tablist; defaults to "设置分类". */
  ariaLabel?: string
  variant?: 'pill' | 'underline'
}

/** Horizontal tab bar — text labels with an active indicator. Reusable across panels. */
export default function SettingsTabs({ tabs, active, onChange, ariaLabel = '设置分类', variant = 'pill' }: Props) {
  const navClass = `settings-tabs${variant === 'underline' ? ' settings-tabs--underline' : ''}`

  return (
    <nav className={navClass} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const on = t.id === active
        const baseClass = variant === 'underline' ? 'settings-tab settings-tab--underline' : 'settings-tab'
        const activeClass = on
          ? variant === 'underline' ? 'settings-tab--underline-active' : 'settings-tab--active'
          : ''
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`${baseClass}${activeClass ? ` ${activeClass}` : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
