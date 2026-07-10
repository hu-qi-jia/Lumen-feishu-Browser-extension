import { ACCENT_PRESETS, DEFAULT_ACCENT } from '@/shared/theme'
import Tooltip from '../primitives/Tooltip'
import SettingsSection from './SettingsSection'
import SettingsSelect from './SettingsSelect'

interface Props {
  accent: string
  onAccentChange: (hex: string) => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
}

const THEME_OPTIONS: { value: 'light' | 'dark'; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

/** 外观 tab：主题风格、主题颜色。 */
export default function AppearanceTab({ accent, onAccentChange, theme, onThemeChange }: Props) {
  const accentChanged = accent.toLowerCase() !== DEFAULT_ACCENT.toLowerCase()

  return (
    <>
      {/* ── 主题风格 ── */}
      <SettingsSection title="主题风格">
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">外观模式</span>
          </div>
          <span className="settings-row-control">
            <SettingsSelect
              options={THEME_OPTIONS}
              value={theme}
              onChange={(v) => onThemeChange(v as 'light' | 'dark')}
              ariaLabel="外观模式"
            />
          </span>
        </div>
      </SettingsSection>

      {/* ── 主题颜色 ── */}
      <SettingsSection title="主题颜色">
        <div className="accent-grid">
          {ACCENT_PRESETS.map((p) => (
            <Tooltip key={p.hex} content={p.name} position="bottom">
              <button
                className={`accent-swatch ${accent.toLowerCase() === p.hex.toLowerCase() ? 'accent-swatch--active' : ''}`}
                style={{ background: p.hex }}
                aria-label={p.name}
                onClick={() => onAccentChange(p.hex)}
              >
                {accent.toLowerCase() === p.hex.toLowerCase() && (
                  <span className="accent-check"><CheckIcon /></span>
                )}
              </button>
            </Tooltip>
          ))}
          <Tooltip content="自定义颜色" position="bottom">
            <label className="accent-custom" aria-label="自定义颜色">
              <input
                type="color"
                value={accent}
                onChange={(e) => onAccentChange(e.target.value)}
              />
            </label>
          </Tooltip>
        </div>
        {accentChanged && (
          <button className="btn-link" onClick={() => onAccentChange(DEFAULT_ACCENT)}>
            恢复默认
          </button>
        )}
      </SettingsSection>
    </>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
