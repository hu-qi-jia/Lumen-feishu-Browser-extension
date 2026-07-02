import { useEscapeToClose } from './useEscapeToClose'
import './ConfirmDialog.css'

interface Props {
  /** Title of the document the active tab just switched to. */
  toTitle: string
  /** 「新建会话」— open a fresh session bound to the new document. */
  onNew: () => void
  /** 「在当前会话继续」— re-bind the current session to the new document (keep its history). */
  onStay: () => void
  /** Dismiss (Esc / overlay / 关闭). Defaults to "stay" — the tab is already on the new doc,
   *  so the non-destructive resolution is to keep the current thread following it. */
  onCancel: () => void
}

/**
 * Shown in "follow" mode when the active tab's document changes while the current session
 * already has a conversation. Asks whether to start a fresh session for the new document or
 * keep the current thread (re-bound to the new document). Auto-dismissed by the parent when
 * the user switches back to the original document.
 */
export default function SwitchDocDialog({ toTitle, onNew, onStay, onCancel }: Props) {
  useEscapeToClose(onCancel)
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <button className="confirm-x" onClick={onCancel} title="在当前会话继续" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="confirm-icon"></div>
        <h3 className="confirm-title">切换工作文档？</h3>
        <p className="confirm-msg">
          当前标签页已切换到「<b>{toTitle}</b>」。是否为它新建一个会话？
        </p>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--primary" onClick={onNew} type="button">新建会话</button>
          <button className="confirm-btn confirm-btn--secondary" onClick={onStay} type="button">在当前会话继续</button>
        </div>
      </div>
    </div>
  )
}
