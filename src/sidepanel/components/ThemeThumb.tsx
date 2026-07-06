import type { SlideTheme } from '../../shared/ai/slidesThemes'
import './ThemeThumb.css'

interface Props {
  theme: SlideTheme
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}

const SYS_SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'

/** A theme picker tile: a 16:9 mini slide wireframe (unified cover-page mock) rendered in the
 *  theme's own palette, so the grid reads like a PPT template gallery — same composition every
 *  tile, each colored by its theme. The button chrome uses panel tokens; only the preview swatch
 *  inherits the theme vars (so a dark theme doesn't darken the surrounding name/border). */
export function ThemeThumb({ theme, selected, disabled, onSelect }: Props) {
  const p = theme.palette
  return (
    <button
      type="button"
      className={`sl-theme${selected ? ' sl-theme--active' : ''}`}
      onClick={onSelect}
      disabled={disabled}
      title={theme.promptHint}
      aria-pressed={selected}
      style={{ ['--accent' as any]: p.accent }}
    >
      <span
        className="sl-theme-preview"
        data-theme={theme.id}
        style={{
          ['--bg' as any]: p.bg,
          ['--fg' as any]: p.fg,
          ['--accent' as any]: p.accent,
          ['--muted' as any]: p.muted,
          ['--border' as any]: p.border,
          ['--font-display' as any]: theme.fontDisplay ?? SYS_SANS,
        }}
      >
        <span className="sl-tp-eyebrow" />
        <span className="sl-tp-title" />
        <span className="sl-tp-title sl-tp-title--sub" />
        <span className="sl-tp-accent" />
        <span className="sl-tp-lines">
          <span className="sl-tp-line" />
          <span className="sl-tp-line" />
        </span>
      </span>
      <span className="sl-theme-name">{theme.name}</span>
    </button>
  )
}
