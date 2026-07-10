import type { ChangeEvent, ReactNode } from 'react'
import './Form.css'

interface Props {
  value: string
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  /** `<option>` elements to render inside the select. */
  children: ReactNode
}

/**
 * Native `<select>` styled with `.form-input`.
 * Use for short, static option lists (e.g. model provider dropdown) inside
 * `<FormField>`. For richer dropdown UI (icons, checkmarks, search) use
 * `SettingsSelect` which wraps the `Dropdown` component instead.
 */
export default function FormSelect({ value, onChange, children }: Props) {
  return (
    <select className="form-input" value={value} onChange={onChange}>
      {children}
    </select>
  )
}
