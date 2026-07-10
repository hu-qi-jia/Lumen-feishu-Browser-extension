import { useEscapeToClose } from '../ui/useEscapeToClose'
import Tooltip from '../ui/Tooltip'
import '../chat/ConfirmDialog.css'

interface Props {
  /** Title of the document the active tab just switched to. */
  toTitle: string
  /** 「新建会话」— open a fresh session bound to the target document. */
  onNew: () => void
  /** 「在当前会话继续」— re-bind the current session to the target document (keep its history). */
  onStay: () => void
  /** Dismiss (defaults to "stay" semantics for the tab-switch flow). */
  onCancel: () => void
}

/** Follow-mode tab-switch prompt: the active tab moved to a different doc mid-conversation.
 *  (The selection-driven cross-doc prompt uses SwitchSessionDialog instead.) */
export default function SwitchDocDialog({ toTitle, onNew, onStay, onCancel }: Props) {
  useEscapeToClose(onCancel)
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <Tooltip content="在当前会话继续" position="bottom">
          <button className="confirm-x" onClick={onCancel} type="button" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </Tooltip>
        <div className="confirm-icon"></div>
        <h3 className="confirm-title">切换工作文档？</h3>
        <p className="confirm-msg">当前标签页已切换到「<b>{toTitle}</b>」。是否为它新建一个会话？</p>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--primary" onClick={onNew} type="button">新建会话</button>
          <button className="confirm-btn confirm-btn--secondary" onClick={onStay} type="button">在当前会话继续</button>
        </div>
      </div>
    </div>
  )
}
