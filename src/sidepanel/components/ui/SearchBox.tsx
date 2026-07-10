import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { IconSearch, IconX } from './icons'
import IconButton from './IconButton'
import './SearchBox.css'

interface Props {
  value: string
  onChange: (v: string) => void
  onSearch?: () => void
  placeholder?: string
  autoFocus?: boolean
  /** 输入框的可访问名（placeholder 不算 accessible name，屏幕阅读器需要它）。 */
  ariaLabel?: string
  /** 由调用方持有 ref（如 Ctrl+K 聚焦）；不传则内部自持。 */
  inputRef?: React.Ref<HTMLInputElement>
  /** 输入框尾部附加节点（如独立提交按钮）。 */
  trailing?: ReactNode
}

export default function SearchBox({ value, onChange, onSearch, placeholder, autoFocus, ariaLabel, inputRef, trailing }: Props) {
  const innerRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? innerRef

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && onSearch) { e.preventDefault(); onSearch() }
  }

  return (
    <div className="search-box">
      <IconSearch className="search-box-icon" />
      <input
        ref={ref}
        className="search-box-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        spellCheck={false}
      />
      {value && (
        <IconButton className="search-box-clear" aria-label="清除" onClick={() => { onChange(''); if (typeof ref !== 'function') ref.current?.focus() }}>
          <IconX />
        </IconButton>
      )}
      {trailing}
    </div>
  )
}
