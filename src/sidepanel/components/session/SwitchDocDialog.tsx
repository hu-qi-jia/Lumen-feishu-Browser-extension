import ConfirmModal from '../ui/ConfirmModal'
import FormCheckbox from '../ui/FormCheckbox'

interface Props {
  /** Title of the document the active tab just switched to. */
  toTitle: string
  /** Current value of the "don't ask again" setting (drives the checkbox). */
  dontAsk: boolean
  /** Persist the "don't ask again" toggle. */
  onDontAskChange: (checked: boolean) => void
  /** 「新建会话」— open a fresh session bound to the target document. */
  onNew: () => void
  /** 「在当前会话继续」— re-bind the current session to the target document (keep its history).
   *  Also fires on overlay click / Esc (same "stay" semantics for the tab-switch flow). */
  onCancel: () => void
}

/** Follow-mode tab-switch prompt: the active tab moved to a different doc mid-conversation.
 *  Reuses the generic ConfirmModal (confirm = 新建会话, cancel = 在当前会话继续). The
 *  selection-driven cross-doc prompt uses SwitchSessionDialog instead. */
export default function SwitchDocDialog({ toTitle, dontAsk, onDontAskChange, onNew, onCancel }: Props) {
  return (
    <ConfirmModal
      open
      title="切换工作文档？"
      message={
        <>
          当前标签页已切换到「<b>{toTitle}</b>」。是否为它新建一个会话？
          <div className="confirm-options">
            <FormCheckbox checked={dontAsk} onChange={onDontAskChange}>不再询问</FormCheckbox>
          </div>
        </>
      }
      confirmText="新建会话"
      cancelText="在当前会话继续"
      onConfirm={onNew}
      onCancel={onCancel}
    />
  )
}
