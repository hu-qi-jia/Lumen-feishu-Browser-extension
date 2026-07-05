import type { ChangeEvent, KeyboardEvent } from 'react'

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
 */
export default function FormInput({ type = 'text', value, onChange, placeholder, list, disabled, onKeyDown }: Props) {
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
