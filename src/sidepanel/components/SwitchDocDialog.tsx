import { useEscapeToClose } from './useEscapeToClose'
import Tooltip from './Tooltip'
import './ConfirmDialog.css'

interface Props {
  /** Title of the document the active tab just switched to (tab-switch) OR the doc the
   *  selection came from (selection). */
  toTitle: string
  /** 「新建会话」— open a fresh session bound to the target document. */
  onNew: () => void
  /** 「在当前会话继续」— re-bind the current session to the target document (keep its history). */
  onStay: () => void
  /** Dismiss. tab-switch defaults to "stay"; selection defaults to "cancel/drop". */
  onCancel: () => void
  /** Copy variant. 'tab-switch' (default) = follow-mode tab navigation; 'selection' = a doc
   *  selection arrived while the work doc differs. Button semantics are identical. */
  variant?: 'tab-switch' | 'selection'
}

export default function SwitchDocDialog({ toTitle, onNew, onStay, onCancel, variant = 'tab-switch' }: Props) {
  useEscapeToClose(onCancel)
  const msg = variant === 'selection' ? (
    <>选区来自「<b>{toTitle}</b>」，但当前工作文档不同。是否切换工作文档？</>
  ) : (
    <>当前标签页已切换到「<b>{toTitle}</b>」。是否为它新建一个会话？</>
  )
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <Tooltip content={variant === 'selection' ? '取消，不添加' : '在当前会话继续'} position="bottom">
          <button className="confirm-x" onClick={onCancel} type="button" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </Tooltip>
        <div className="confirm-icon"></div>
        <h3 className="confirm-title">切换工作文档？</h3>
        <p className="confirm-msg">{msg}</p>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--primary" onClick={onNew} type="button">新建会话</button>
          <button className="confirm-btn confirm-btn--secondary" onClick={onStay} type="button">在当前会话继续</button>
        </div>
      </div>
    </div>
  )
}
