import { type ChangeEvent, type TextareaHTMLAttributes } from 'react'
import './Form.css'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
  value: string
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  /** Accessible name (placeholder is not an accessible name). */
  ariaLabel?: string
}

/**
 * Multi-line textarea styled like `.form-input` — same border, hover, and
 * focus-border-color behavior — but taller and vertically resizable.
 * Use inside `<FormField>` for a complete labeled field. Extra props
 * (rows, disabled, data-testid, …) spread onto the underlying textarea.
 */
export default function FormTextArea({ value, onChange, ariaLabel, className, ...rest }: Props) {
  const cls = ['form-textarea', className].filter(Boolean).join(' ')
  return (
    <textarea
      className={cls}
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
      spellCheck={false}
      {...rest}
    />
  )
}
