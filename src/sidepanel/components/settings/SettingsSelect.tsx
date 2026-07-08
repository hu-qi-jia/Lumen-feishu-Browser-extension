import { useState } from 'react'
import Dropdown from '../Dropdown'

interface Option {
  value: string
  label: string
}

interface Props {
  options: Option[]
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
}

/**
 * 通用设置下拉。触发器 + 列表 + 选中勾，受控 open / value。
 * 供「翻译引擎」「自动清理」等离散选项复用。
 */
export default function SettingsSelect({ options, value, onChange, ariaLabel, className }: Props) {
  const [open, setOpen] = useState(false)
  const currentLabel = options.find((o) => o.value === value)?.label ?? ''
  return (
    <Dropdown
      className={className ? `engine-dropdown ${className}` : 'engine-dropdown'}
      open={open}
      onOpenChange={setOpen}
      align="left"
      trigger={
        <button
          type="button"
          className={`engine-trigger${open ? ' is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
        >
          <span className="engine-trigger-label">{currentLabel}</span>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      }
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            className={`engine-item${selected ? ' is-active' : ''}`}
            onClick={() => { onChange(o.value); setOpen(false) }}
          >
            <span className="engine-item-label">{o.label}</span>
            {selected && (
              <svg className="engine-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        )
      })}
    </Dropdown>
  )
}
