import Button from '../ui/Button'
import DocCombobox, { type DocTarget } from '../session/DocCombobox'
import { KindIcon } from '../ui/icons'
import type { RecentFile } from '../../services/recentFiles'
import './WriteTargetSection.css'

export type NewKind = 'doc' | 'base' | 'sheet'

interface Props {
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
  target: DocTarget | null
  onTargetChange: (t: DocTarget | null) => void
  /** 写入已选文档（DocCombobox 的主按钮）。 */
  onConfirm: () => void
  writing?: boolean
  /** 新建文档 / 多维表格 / 电子表格（直插，不走 AI）。base/sheet 可选。 */
  onNewDoc: () => void
  onNewBase?: () => void
  onNewSheet?: () => void
  /** 要展示的新建选项，默认三项全开。单列时按钮整行等宽。 */
  kinds?: NewKind[]
  /** 新建进行中——禁用新建按钮，避免并发。 */
  busy?: boolean
  label?: string
}

const KIND_META: Record<NewKind, { label: string; icon: 'doc' | 'base' | 'sheet' }> = {
  doc: { label: '文档', icon: 'doc' },
  base: { label: '多维表格', icon: 'base' },
  sheet: { label: '电子表格', icon: 'sheet' },
}

/** 写入目标区 —— 文件导入 / PDF 转写共用。
 *  上方 DocCombobox 选已有文档直接插入；下方「或新建一个」按 kinds 渲染等宽 Button（公共组件）。
 *  新建为直插式（不整理、不优化），结果在下方内联展示，不跳转。 */
export default function WriteTargetSection({
  recentFiles, onRemoveRecent, target, onTargetChange, onConfirm, writing,
  onNewDoc, onNewBase, onNewSheet, kinds = ['doc', 'base', 'sheet'], busy, label = '目标文档',
}: Props) {
  const handlers: Record<NewKind, (() => void) | undefined> = { doc: onNewDoc, base: onNewBase, sheet: onNewSheet }
  const visible = kinds.filter((k) => handlers[k])
  return (
    <div className="sc-field">
      <label className="sc-field-label">{label}</label>
      <DocCombobox recentFiles={recentFiles} onRemoveRecent={onRemoveRecent}
        target={target} onTargetChange={onTargetChange} onConfirm={onConfirm} writing={writing} />
      {visible.length > 0 && (
        <>
          <div className="wt-divider"><span>或新建一个</span></div>
          <div className="wt-new-grid">
            {visible.map((k) => (
              <Button key={k} variant="secondary" className="wt-new-btn" icon={<KindIcon kind={KIND_META[k].icon} />} onClick={handlers[k]!} disabled={busy}>
                {KIND_META[k].label}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
