import { IconChevronLeft } from './icons'
import IconButton from './IconButton'
import './BackButton.css'

interface Props {
  onClick: () => void
}

export default function BackButton({ onClick }: Props) {
  return (
    <IconButton className="back-btn" onClick={onClick} aria-label="返回">
      <IconChevronLeft />
    </IconButton>
  )
}
