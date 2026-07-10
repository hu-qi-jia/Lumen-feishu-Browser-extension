import type { ReactNode } from 'react'
import './Form.css'

interface Props {
  /** Label text shown above the control. */
  label: string
  /** Optional hint/help text rendered below the control (supports JSX). */
  hint?: ReactNode
  /** Inline style color for the hint (e.g. error red, warning orange). */
  hintColor?: string
  /** The form control (input, select, etc.). */
  children: ReactNode
  /** Extra content rendered after the hint (e.g. action buttons). */
  footer?: ReactNode
}

/**
 * Labeled form-field wrapper — vertical layout: label → control → hint → footer.
 * Replaces the repeated `<label className="field-label">...</label>` +
 * `<p className="field-hint">...</p>` pattern across settings tabs.
 */
export default function FormField({ label, hint, hintColor, children, footer }: Props) {
  return (
    <div className="form-field">
      <label className="form-field-label">{label}</label>
      {children}
      {hint && (
        <p className="form-field-hint" style={hintColor ? { color: hintColor } : undefined}>
          {hint}
        </p>
      )}
      {footer}
    </div>
  )
}
