import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../../../shared/theme'
import { FormToggle } from '../form'
import Tooltip from '../Tooltip'
import SettingsSection from './SettingsSection'

interface Props {
  accent: string
  onAccentChange: (hex: string) => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
}

/** 外观 tab：主题色、外观模式。 */
export default function AppearanceTab({ accent, onAccentChange, theme, onThemeChange }: Props) {
  const accentChanged = accent.toLowerCase() !== DEFAULT_ACCENT.toLowerCase()

  return (
    <>
      {/* ── 主题色 ── */}
      <SettingsSection title="主题色">
        <div className="accent-row">
          {ACCENT_PRESETS.map((p) => (
            <Tooltip key={p.hex} content={p.name} position="bottom">
              <button
                className={`accent-swatch ${accent.toLowerCase() === p.hex.toLowerCase() ? 'accent-swatch--active' : ''}`}
                style={{ background: p.hex }}
                aria-label={p.name}
                onClick={() => onAccentChange(p.hex)}
              />
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

      {/* ── 外观模式 ── */}
      <SettingsSection title="外观模式">
        <FormToggle
          options={[
            { value: 'light', label: '亮色' },
            { value: 'dark', label: '深色' },
          ]}
          value={theme}
          onChange={(v) => onThemeChange(v as 'light' | 'dark')}
        />
      </SettingsSection>
    </>
  )
}
