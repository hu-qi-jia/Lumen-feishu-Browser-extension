import type { ReactNode } from 'react'
import { useEscapeToClose } from './useEscapeToClose'
import './ConfirmModal.css'

interface Props {
  open: boolean
  title: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Generic iOS-style confirmation modal for destructive or important actions.
 *  Reuses the same visual language as the agent ConfirmDialog. */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  useEscapeToClose(onCancel)

  if (!open) return null

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-body">
          <h3 className="confirm-title">{title}</h3>
          {message && <div className="confirm-msg">{message}</div>}
        </div>
        <div className="confirm-actions">
          <button
            className={`confirm-btn${danger ? ' confirm-btn--danger' : ' confirm-btn--primary'}`}
            onClick={onConfirm}
            type="button"
          >
            {confirmText}
          </button>
          <button className="confirm-btn confirm-btn--ghost" onClick={onCancel} type="button">
            {cancelText}
          </button>
        </div>
      </div>
    </div>
  )
}
