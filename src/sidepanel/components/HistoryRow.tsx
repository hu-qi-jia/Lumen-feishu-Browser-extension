import { IconTrash } from './icons'
import './HistoryRow.css'

interface HistoryRowProps {
  name: string
  meta?: string
  active?: boolean
  onOpen: () => void
  onDelete?: () => void
  deleteDisabled?: boolean
  openDisabled?: boolean
  openTitle?: string
}

/** A single history row shared by the Slides + PDF history drawers: clickable name/meta on the
 *  left, hover-revealed delete (trash) on the right. Mirrors the prior .sl-deck markup, now used
 *  by both panels so the visuals stay identical. `.drawer-row-btn` comes from SessionDrawer.css. */
export default function HistoryRow({ name, meta, active, onOpen, onDelete, deleteDisabled, openDisabled, openTitle }: HistoryRowProps) {
  return (
    <div className={`hr-row${active ? ' hr-row--active' : ''}`}>
      <button className="hr-main" type="button" onClick={onOpen} disabled={openDisabled} title={openTitle}>
        <span className="hr-name">{name}</span>
        {meta && <span className="hr-meta">{meta}</span>}
      </button>
      {onDelete && (
        <span className="hr-actions">
          <button className="drawer-row-btn" type="button" aria-label="删除" onClick={onDelete} disabled={deleteDisabled}>
            <IconTrash />
          </button>
        </span>
      )}
    </div>
  )
}
