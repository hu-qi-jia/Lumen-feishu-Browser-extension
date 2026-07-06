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
}

/** Horizontal tab bar — text labels with an active underline. Reusable across panels. */
export default function SettingsTabs({ tabs, active, onChange, ariaLabel = '设置分类' }: Props) {
  return (
    <nav className="settings-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`settings-tab${on ? ' settings-tab--active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
