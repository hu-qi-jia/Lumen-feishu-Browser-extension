import './Form.css'

interface Props {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Pill-style segmented button group.
 * Replaces both theme toggle (GeneralTab) and managed/manual LLM toggle (AiTab).
 */
export default function FormToggle({ options, value, onChange, disabled }: Props) {
  return (
    <div className="form-toggle">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`form-toggle-btn${value === opt.value ? ' form-toggle-btn--active' : ''}`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
