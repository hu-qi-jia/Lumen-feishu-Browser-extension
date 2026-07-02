import type { SlideTheme } from '../../shared/ai/slidesThemes'
import './ThemeThumb.css'

interface Props {
  theme: SlideTheme
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}

/** A pure-CSS/SVG motif per theme id, tinted by the theme's own palette via CSS vars. */
function Icon({ id, accent }: { id: string; accent: string }) {
  const common = { style: { color: accent }, 'data-theme': id }
  switch (id) {
    case 'editorial':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"><text x="6" y="30" fontFamily="Georgia,serif" fontSize="26" fill="currentColor" stroke="none">A</text><line x1="8" y1="36" x2="40" y2="36" /></svg></span>)
    case 'night':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none"><rect x="6" y="6" width="36" height="36" rx="6" fill="#0f1322" stroke="currentColor" strokeWidth="1.5" /><circle cx="34" cy="14" r="3" fill="currentColor" /></svg></span>)
    case 'minimal':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1"><line x1="8" y1="16" x2="40" y2="16" /><line x1="8" y1="24" x2="32" y2="24" /><line x1="8" y1="32" x2="36" y2="32" /></svg></span>)
    case 'vibrant':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none"><rect x="6" y="14" width="12" height="20" rx="3" fill="currentColor" opacity=".8" /><rect x="20" y="8" width="12" height="26" rx="3" fill="currentColor" opacity=".55" /><rect x="34" y="18" width="8" height="16" rx="3" fill="currentColor" /></svg></span>)
    case 'pitch':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none"><text x="11" y="34" fontFamily="system-ui,sans-serif" fontWeight="800" fontSize="28" fill="currentColor" stroke="none">1</text></svg></span>)
    case 'business':
    default:
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="8" y1="16" x2="34" y2="16" /><line x1="8" y1="24" x2="28" y2="24" /><line x1="8" y1="32" x2="22" y2="32" /><line x1="36" y1="32" x2="42" y2="32" /></svg></span>)
  }
}

export function ThemeThumb({ theme, selected, disabled, onSelect }: Props) {
  return (
    <button
      type="button"
      className={`sl-theme${selected ? ' sl-theme--active' : ''}`}
      onClick={onSelect}
      disabled={disabled}
      title={theme.promptHint}
      aria-pressed={selected}
      // ThemeThumb.css resolves --accent/--border/--bg/--fg from the theme's own palette, so each
      // thumb renders in its own accent (hover/selected border uses the theme accent, not a token).
      style={{
        ['--accent' as any]: theme.palette.accent,
        ['--border' as any]: theme.palette.border,
        ['--bg' as any]: theme.palette.bg,
        ['--fg' as any]: theme.palette.fg,
      }}
    >
      <Icon id={theme.id} accent={theme.palette.accent} />
      <span className="sl-theme-name">{theme.name}</span>
    </button>
  )
}
