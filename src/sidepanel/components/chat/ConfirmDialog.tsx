import type { ConfirmRequest, ConfirmChoice } from '@/shared/ai/agent'
import { useEscapeToClose } from '../ui/useEscapeToClose'
import './ConfirmDialog.css'

interface Props {
  req: ConfirmRequest
  onChoose: (choice: ConfirmChoice) => void
}

/** Minimal iOS-style confirmation alert. Handles delete / write / create_base uniformly.
 *  Esc + overlay click = cancel. No close (×) button — pick a button or cancel. */
export default function ConfirmDialog({ req, onChoose }: Props) {
  useEscapeToClose(() => onChoose('cancel'))

  if (req.kind === 'delete' || req.kind === 'write') {
    const isDelete = req.kind === 'delete'
    return (
      <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={() => onChoose('cancel')}>
        <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
          <div className="confirm-body">
            <h3 className="confirm-title">{isDelete ? '确认删除' : '确认执行'}</h3>
            {(req.summary || req.toolName) && <p className="confirm-msg">{req.summary || req.toolName}</p>}
          </div>
          <div className="confirm-actions">
            <button className="confirm-btn confirm-btn--danger" onClick={() => onChoose('confirm')} type="button">
              {isDelete ? '删除' : '确认'}
            </button>
            <button className="confirm-btn confirm-btn--ghost" onClick={() => onChoose('cancel')} type="button">
              取消
            </button>
          </div>
        </div>
      </div>
    )
  }

  // create_base
  const hasCurrent = !!req.currentApp
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={() => onChoose('cancel')}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-body">
          <h3 className="confirm-title">要新建一个 Base 吗？</h3>
          <p className="confirm-msg">
            助手准备新建独立的 Base「<b>{req.appName}</b>」。
            {hasCurrent && (
              <>
                <br />
                当前页面是 Base「{req.currentBaseName || '未命名'}」—— 也可以把表加到这里。
              </>
            )}
          </p>
          {req.ownerConfigured === false && (
            <p className="confirm-warn">
              你尚未授权账号（未配置 open_id）。新建的 Base 将归应用所有，
              <b>你只能查看、不能编辑</b>。建议先到「设置 → 飞书鉴权」用飞书账号授权。
            </p>
          )}
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--primary" onClick={() => onChoose('new')} type="button">
            新建独立 Base
          </button>
          {hasCurrent && (
            <button className="confirm-btn confirm-btn--secondary" onClick={() => onChoose('current')} type="button">
              加到当前 Base
            </button>
          )}
          <button className="confirm-btn confirm-btn--ghost" onClick={() => onChoose('cancel')} type="button">
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
