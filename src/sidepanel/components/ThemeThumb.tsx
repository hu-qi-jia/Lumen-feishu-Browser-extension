import type { SlideTheme } from '../../shared/ai/slidesThemes'
import Tooltip from './Tooltip'
import './ThemeThumb.css'

interface Props {
  theme: SlideTheme
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}

const SYS_SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'

/** A theme picker tile. The 16:9 swatch is a per-theme mini composition (driven by `[data-theme]`
 *  in ThemeThumb.css) that mirrors each deck's real design language — so the grid reads like a PPT
 *  template gallery, not the same wireframe recolored. One static skeleton of mock parts; CSS
 *  shows/arranges a different subset per theme. Button chrome uses panel tokens; only the swatch
 *  inherits theme vars (a dark theme doesn't darken the surrounding name/border). */
export function ThemeThumb({ theme, selected, disabled, onSelect }: Props) {
  const p = theme.palette
  const button = (
    <button
      type="button"
      className={`sl-theme${selected ? ' sl-theme--active' : ''}`}
      onClick={onSelect}
      disabled={disabled}
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
          ['--card' as any]: p.card,
          ['--border' as any]: p.border,
          ['--font-display' as any]: theme.fontDisplay ?? SYS_SANS,
        }}
      >
        {/* Static skeleton of mock parts — CSS enables + positions a per-theme subset. */}
        <span className="m-glow" />
        <span className="m-topline" />
        <span className="m-rail" />
        <span className="m-eyebrow" />
        <span className="m-num">01</span>
        <span className="m-title" />
        <span className="m-sub" />
        <span className="m-accent" />
        <span className="m-lines">
          <span className="m-line" />
          <span className="m-line" />
          <span className="m-line" />
        </span>
        <span className="m-cards">
          <span className="m-card" />
          <span className="m-card" />
        </span>
        <span className="m-bento">
          <span className="m-b" />
          <span className="m-b" />
          <span className="m-b" />
          <span className="m-b" />
        </span>
      </span>
      <span className="sl-theme-name">{theme.name}</span>
    </button>
  )
  // Prefer the short `desc` for the hover tip (promptHint is a long LLM-tone hint that's too
  // verbose for a tooltip). Fall back to promptHint only if a theme has no desc.
  const tip = theme.desc ?? theme.promptHint
  return tip ? <Tooltip content={tip} position="top">{button}</Tooltip> : button
}
