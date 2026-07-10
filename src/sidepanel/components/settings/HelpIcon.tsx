import type { ReactNode } from 'react'
import Tooltip from '../primitives/Tooltip'

const HelpIconSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

/** Inline help (?) icon wrapped in a Tooltip. */
export function HelpIcon({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} position="bottom">
      <span className="help-icon" aria-label="帮助">
        <HelpIconSvg />
      </span>
    </Tooltip>
  )
}

/** Section title followed by a help icon — for SettingsSection `title` prop. */
export function TitleWithHelp({ title, tip }: { title: string; tip: string }): ReactNode {
  return (
    <>
      {title}
      <HelpIcon tip={tip} />
    </>
  )
}
