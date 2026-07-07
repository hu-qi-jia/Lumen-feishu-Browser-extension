import { useEffect, useRef } from 'react'
import type { FieldCtx } from '../../shared/feishu/context'
import Tooltip from './Tooltip'
import './FieldChips.css'

interface Props {
  /** Current table's fields (header tags). Empty list → render nothing. */
  fields: FieldCtx[]
  /** Drop the chosen field into the input box. */
  onPick: (text: string) => void
}

/**
 * Horizontally-scrolling field chips shown above the input on a Feishu Base page. Base grids
 * are canvas-rendered (no DOM text to select), so we surface the current table's fields as
 * clickable chips — click one to drop it into the input, then describe the edit.
 *
 * The scrollbar is hidden (the row is meant to read as a static strip). To still reach chips
 * that overflow, a vertical mouse-wheel is translated into horizontal scroll. The wheel is
 * only hijacked when the row actually has sideways overflow AND the next scroll would stay
 * in-bounds — otherwise the event passes through so the message list keeps scrolling normally
 * (no scroll-trap on a short row, no dead stop at the row's edges).
 */
export default function FieldChips({ fields, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const node: HTMLDivElement = el // narrowed const — closures below see it as non-null
    function onWheel(e: WheelEvent) {
      if (e.deltaY === 0) return
      if (node.scrollWidth <= node.clientWidth) return // nothing to scroll sideways
      const maxLeft = node.scrollWidth - node.clientWidth
      const goingRight = e.deltaY > 0
      // Only consume the wheel while there's room in the scrolled direction; let it pass at
      // the edges so vertical page-scroll resumes instead of trapping the pointer.
      if ((goingRight && node.scrollLeft >= maxLeft) || (!goingRight && node.scrollLeft <= 0)) return
      e.preventDefault()
      node.scrollLeft += e.deltaY
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [fields.length])

  if (!fields.length) return null

  return (
    <div className="field-chips" ref={ref} aria-label="点击字段插入到输入框，再描述要做的修改">
      {fields.map((f) => (
        <Tooltip
          key={f.fieldId}
          content={`${f.fieldName}（${f.typeName}）· ${f.fieldId}`}
          position="bottom"
        >
          <button
            className="field-chip"
            onClick={() => onPick(`${f.fieldName} (id:${f.fieldId})`)}
            type="button"
          >
            {f.fieldName}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}
