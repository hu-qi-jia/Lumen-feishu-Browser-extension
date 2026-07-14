import { useEffect, useRef } from 'react'
import './SettingsTabs.css'

interface TabDef {
  id: string
  label: string
}

interface Props {
  tabs: readonly TabDef[]
  active: string
  onChange: (id: string) => void
  /** Accessible label for the tablist; defaults to "设置分类". */
  ariaLabel?: string
  variant?: 'pill' | 'underline'
}

/** Horizontal tab bar — text labels with an active indicator. Reusable across panels. */
export default function SettingsTabs({ tabs, active, onChange, ariaLabel = '设置分类', variant = 'pill' }: Props) {
  const navRef = useRef<HTMLElement>(null)
  // React 18 attaches wheel/touch listeners as passive on the root, so preventDefault inside
  // onWheel is a no-op and logs a "Unable to preventDefault inside passive event listener"
  // warning. Use a native non-passive listener instead — mirrors BaseContextBadge.tsx.
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    function onWheel(e: WheelEvent) {
      // Scroll horizontally when the wheel is vertical and the tab bar overflows.
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        nav.scrollLeft += e.deltaY
      }
    }
    nav.addEventListener('wheel', onWheel, { passive: false })
    return () => nav.removeEventListener('wheel', onWheel)
  }, [])
  const navClass = `settings-tabs${variant === 'underline' ? ' settings-tabs--underline' : ''}`

  return (
    <nav ref={navRef} className={navClass} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const on = t.id === active
        const baseClass = variant === 'underline' ? 'settings-tab settings-tab--underline' : 'settings-tab'
        const activeClass = on
          ? variant === 'underline' ? 'settings-tab--underline-active' : 'settings-tab--active'
          : ''
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`${baseClass}${activeClass ? ` ${activeClass}` : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
