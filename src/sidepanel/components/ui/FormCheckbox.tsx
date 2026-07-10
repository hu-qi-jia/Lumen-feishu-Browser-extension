import type { ReactNode } from 'react'
import './Form.css'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Optional hint rendered below the checkbox row (supports JSX). */
  hint?: ReactNode
  /** Inline style color for the hint. */
  hintColor?: string
  /** Label text/content — supports JSX for inline bold/links. */
  children: ReactNode
}

/**
 * Feishu-style checkbox: a rounded square box with an animated checkmark.
 * The native input is visually hidden but remains accessible.
 */
export default function FormCheckbox({ checked, onChange, disabled, hint, hintColor, children }: Props) {
  return (
    <div className="form-checkbox-group">
      <label className="form-checkbox">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="form-checkbox-box" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <span className="form-checkbox-label">{children}</span>
      </label>
      {hint && (
        <p className="form-field-hint" style={hintColor ? { color: hintColor } : undefined}>
          {hint}
        </p>
      )}
    </div>
  )
}
