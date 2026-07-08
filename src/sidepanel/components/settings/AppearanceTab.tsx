import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../../../shared/theme'
import Tooltip from '../Tooltip'
import SettingsSection from './SettingsSection'

interface Props {
  accent: string
  onAccentChange: (hex: string) => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
}

/** 外观 tab：主题风格、主题颜色。 */
export default function AppearanceTab({ accent, onAccentChange, theme, onThemeChange }: Props) {
  const accentChanged = accent.toLowerCase() !== DEFAULT_ACCENT.toLowerCase()

  return (
    <>
      {/* ── 主题风格 ── */}
      <SettingsSection title="主题风格">
        <div className="appearance-modes" role="radiogroup" aria-label="主题风格">
          <ModeCard
            label="浅色模式"
            active={theme === 'light'}
            onClick={() => onThemeChange('light')}
            icon={<SunIcon />}
          />
          <ModeCard
            label="深色模式"
            active={theme === 'dark'}
            onClick={() => onThemeChange('dark')}
            icon={<MoonIcon />}
          />
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

function ModeCard({
  label,
  active,
  onClick,
  icon,
}: {
  label: string
  active: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`appearance-mode ${active ? 'appearance-mode--active' : ''}`}
      onClick={onClick}
      aria-checked={active}
      role="radio"
    >
      <span className="appearance-mode__icon">{icon}</span>
      <span className="appearance-mode__label">{label}</span>
      {active && <span className="appearance-mode__check"><CheckIcon /></span>}
    </button>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}
