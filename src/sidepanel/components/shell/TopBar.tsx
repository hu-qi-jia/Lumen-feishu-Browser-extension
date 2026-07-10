import BackButton from '../ui/BackButton'
import './TopBar.css'

interface Props {
  title: string
  onBack: () => void
  /** Optional action button on the right side of the bar. */
  rightAction?: React.ReactNode
}

export default function TopBar({ title, onBack, rightAction }: Props) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <BackButton onClick={onBack} />
        <span className="topbar-title">{title}</span>
      </div>
      {rightAction && <div className="topbar-right">{rightAction}</div>}
    </div>
  )
}
