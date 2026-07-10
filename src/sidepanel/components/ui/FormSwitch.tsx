import type { ReactNode } from 'react'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Label text/content next to the switch. */
  children?: ReactNode
  /** Optional hint rendered below the switch row (supports JSX). */
  hint?: ReactNode
  /** Inline style color for the hint. */
  hintColor?: string
}

/**
 * Single on/off switch (iOS-style flat pill) with inline label.
 * Distinct from FormToggle (multi-option segmented control) — use this for
 * boolean preferences where a checkbox felt too utilitarian.
 */
export default function FormSwitch({ checked, onChange, disabled, hint, hintColor, children }: Props) {
  return (
    <div className="form-switch-group">
      <div className="form-switch-row">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          className={`form-switch${checked ? ' form-switch--on' : ''}`}
          disabled={disabled}
          onClick={() => !disabled && onChange(!checked)}
        >
          <span className="form-switch-thumb" />
        </button>
        {children && <span className="form-switch-label">{children}</span>}
      </div>
      {hint && (
        <p className="form-field-hint" style={hintColor ? { color: hintColor } : undefined}>
          {hint}
        </p>
      )}
    </div>
  )
}
