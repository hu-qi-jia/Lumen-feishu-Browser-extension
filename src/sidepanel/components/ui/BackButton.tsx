import { IconChevronLeft } from './icons'
import './BackButton.css'

interface Props {
  onClick: () => void
}

export default function BackButton({ onClick }: Props) {
  return (
    <button className="back-btn" onClick={onClick} type="button" aria-label="返回">
      <IconChevronLeft className="back-btn-icon" />
    </button>
  )
}
