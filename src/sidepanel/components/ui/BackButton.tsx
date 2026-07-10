import { IconChevronLeft } from './icons'
import IconButton from './IconButton'

interface Props {
  onClick: () => void
}

export default function BackButton({ onClick }: Props) {
  return (
    <IconButton variant="ghost" onClick={onClick} aria-label="返回">
      <IconChevronLeft />
    </IconButton>
  )
}
