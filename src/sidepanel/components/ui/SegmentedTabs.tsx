import './SegmentedTabs.css'

export interface SegmentedTabsOption<T extends string = string> {
  value: T
  label: string
}

interface SegmentedTabsProps<T extends string> {
  options: SegmentedTabsOption<T>[]
  value: T
  onChange: (value: T) => void
}

/** 紧凑的 segmented control，用于「最近 / 搜索」等二态切换。 */
export default function SegmentedTabs<T extends string>({ options, value, onChange }: SegmentedTabsProps<T>) {
  return (
    <div className="segmented-tabs" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`segmented-tab${value === opt.value ? ' segmented-tab--active' : ''}`}
          onClick={() => onChange(opt.value)}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
