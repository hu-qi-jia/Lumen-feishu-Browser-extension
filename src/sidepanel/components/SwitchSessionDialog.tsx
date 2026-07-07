import type { ReactNode } from 'react'
import { useEscapeToClose } from './useEscapeToClose'
import './ConfirmDialog.css'

interface Props {
  /** Title of the target session's document. */
  docTitle: string
  onConfirm: () => void
  onCancel: () => void
  /** Override the body message (defaults to the session-pick wording). */
  message?: ReactNode
  /** Override the confirm button label (default 「切换」). */
  confirmLabel?: string
}

/**
 * The "切换工作文档？" prompt — a clean iOS-style confirm (title + message + 切换/取消).
 * Used in two flows that both boil down to "pin the work doc to a different document":
 *  - picking a history session bound to another doc (default message)
 *  - a page selection arriving from a different doc than the work doc (selection message)
 * Reuses the confirm-card styles (ConfirmDialog.css).
 */
export default function SwitchSessionDialog({ docTitle, onConfirm, onCancel, message, confirmLabel = '切换' }: Props) {
  useEscapeToClose(onCancel)
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-body">
          <h3 className="confirm-title">切换工作文档？</h3>
          <p className="confirm-msg">
            {message ?? (<>切换至该会话需要把工作文档切换为「<b>{docTitle}</b>」，是否继续？</>)}
          </p>
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--primary" onClick={onConfirm} type="button">{confirmLabel}</button>
          <button className="confirm-btn confirm-btn--ghost" onClick={onCancel} type="button">取消</button>
        </div>
      </div>
    </div>
  )
}
