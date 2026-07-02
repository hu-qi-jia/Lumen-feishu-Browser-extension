import './BackButton.css'

interface Props {
  onClick: () => void
}

export default function BackButton({ onClick }: Props) {
  return (
    <button className="back-btn" onClick={onClick} type="button" aria-label="返回">
      <svg className="back-btn-icon" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  )
}
