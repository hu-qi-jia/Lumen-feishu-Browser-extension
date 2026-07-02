import { useEscapeToClose } from './useEscapeToClose'
import './ConfirmDialog.css'

interface Props {
  /** Title of the target session's document. */
  docTitle: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Shown when the user picks a history session bound to a DIFFERENT document than the
 * current work doc. Without switching the work doc the chat can't follow the target
 * session (in follow mode the view reverts to the live tab; in pin mode the agent would
 * operate on the wrong doc). Confirm → pin the work doc to the session's doc + switch.
 * Reuses the iOS-style confirm-card styles (ConfirmDialog.css).
 */
export default function SwitchSessionDialog({ docTitle, onConfirm, onCancel }: Props) {
  useEscapeToClose(onCancel)
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-body">
          <h3 className="confirm-title">切换工作文档？</h3>
          <p className="confirm-msg">
            切换至该会话需要把工作文档切换为「<b>{docTitle}</b>」，是否继续？
          </p>
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--primary" onClick={onConfirm} type="button">切换</button>
          <button className="confirm-btn confirm-btn--ghost" onClick={onCancel} type="button">取消</button>
        </div>
      </div>
    </div>
  )
}
