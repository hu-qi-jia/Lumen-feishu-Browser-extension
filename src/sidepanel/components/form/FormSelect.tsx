import type { ChangeEvent, ReactNode } from 'react'

interface Props {
  value: string
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  /** `<option>` elements to render inside the select. */
  children: ReactNode
}

/**
 * Select dropdown styled with `.form-input`.
 * Use inside `<FormField>` for a complete labeled field.
 */
export default function FormSelect({ value, onChange, children }: Props) {
  return (
    <select className="form-input" value={value} onChange={onChange}>
      {children}
    </select>
  )
}
