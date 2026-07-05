import type { ReactNode } from 'react'

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
 * Checkbox with inline label — horizontal row: ☑ label text.
 * Replaces the repeated `<label className="field-label" style={{flexDirection:'row'...}}>`
 * pattern across settings tabs.
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
