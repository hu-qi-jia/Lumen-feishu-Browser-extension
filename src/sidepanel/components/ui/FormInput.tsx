import { useState, type ChangeEvent, type KeyboardEvent } from 'react'
import './Form.css'

interface Props {
  type?: 'text' | 'url' | 'password'
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  /** `list` attribute for `<datalist>` binding (model suggestions, etc.). */
  list?: string
  disabled?: boolean
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}

/**
 * Standard text/password/url input styled with the `.form-input` class.
 * Use inside `<FormField>` for a complete labeled field.
 *
 * When `type="password"`, an eye-icon toggle is rendered inside the input to
 * reveal/hide the value — no extra wiring needed at call sites.
 */
export default function FormInput({ type = 'text', value, onChange, placeholder, list, disabled, onKeyDown }: Props) {
  const [visible, setVisible] = useState(false)
  const isPassword = type === 'password'
  const effectiveType = isPassword && visible ? 'text' : type

  if (!isPassword) {
    return (
      <input
        className="form-input"
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        list={list}
        disabled={disabled}
        onKeyDown={onKeyDown}
      />
    )
  }

  return (
    <div className="form-input-wrap">
      <input
        className="form-input form-input--with-toggle"
        type={effectiveType}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        list={list}
        disabled={disabled}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="form-input-toggle"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? '隐藏' : '显示'}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}
