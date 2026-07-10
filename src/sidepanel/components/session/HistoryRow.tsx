import { IconTrash } from '../ui/icons'
import IconButton from '../ui/IconButton'
import Tooltip from '../ui/Tooltip'
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
  const main = (
    <button className="hr-main" type="button" onClick={onOpen} disabled={openDisabled}>
      <span className="hr-name">{name}</span>
      {meta && <span className="hr-meta">{meta}</span>}
    </button>
  )
  return (
    <div className={`hr-row${active ? ' hr-row--active' : ''}`}>
      {openTitle ? <Tooltip content={openTitle} position="right">{main}</Tooltip> : main}
      {onDelete && (
        <span className="hr-actions">
          <IconButton variant="danger" aria-label="删除" onClick={onDelete} disabled={deleteDisabled}>
            <IconTrash />
          </IconButton>
        </span>
      )}
    </div>
  )
}
