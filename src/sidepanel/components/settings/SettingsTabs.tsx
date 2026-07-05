import type { SettingsTabId } from './types'

interface TabDef {
  id: SettingsTabId
  label: string
}

const TABS: readonly TabDef[] = [
  { id: 'general', label: '偏好' },
  { id: 'ai', label: '模型配置' },
  { id: 'feishu', label: '飞书配置' },
  { id: 'backup', label: '备份' },
] as const

interface Props {
  active: SettingsTabId
  onChange: (id: SettingsTabId) => void
}

/** Top horizontal tab bar — text labels with an active underline. */
export default function SettingsTabs({ active, onChange }: Props) {
  return (
    <nav className="settings-tabs" role="tablist" aria-label="设置分类">
      {TABS.map((t) => {
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
