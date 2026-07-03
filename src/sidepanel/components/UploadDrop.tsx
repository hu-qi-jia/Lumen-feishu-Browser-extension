import { useRef, useState, type ReactNode } from 'react'
import './UploadDrop.css'

interface Props {
  busy: boolean
  disabled?: boolean
  max: number
  count: number
  onFiles: (files: FileList) => void
  /** Called when the button is clicked — the parent should trigger its hidden <input type="file">. */
  onTrigger: () => void
  /** Override the main label (defaults to the image-upload copy for back-compat with ImagePicker). */
  mainText?: string
  /** Override the hint line (defaults to "可多选 · 最多 {max} 张"). */
  hintText?: string
  /** When set, the dropzone renders in "filled" mode showing the selected file (single-file use
   *  case, e.g. PDF). Click/drag still replace. ImagePicker does not pass this → unaffected. */
  selectedName?: string
  /** Icon node shown in filled mode (defaults to nothing — caller passes e.g. <IconFileText/>). */
  selectedIcon?: ReactNode
}

/** A standalone file-upload dropzone (click or drag). White background, stopPropagation
 *  on drag events to prevent Feishu's page-level "剪藏到飞书" handler from intercepting. */
export function UploadDrop({ busy, disabled, max, count, onFiles, onTrigger, mainText, hintText, selectedName, selectedIcon }: Props) {
  const [dragging, setDragging] = useState(false)
  const dragCounter = useRef(0)

  const remaining = max - count
  if (!selectedName && remaining <= 0) return null

  // Drag events MUST call stopPropagation — otherwise Feishu's document-level drag listener
  // (the "剪藏到飞书" clip-to-feishu feature) shows its own "松手导入文件" overlay.
  function enter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    setDragging(true)
  }
  function over(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }
  function leave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragging(false)
    }
  }
  function drop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setDragging(false)
    if (!disabled && !busy) {
      const files = e.dataTransfer.files
      if (files?.length) onFiles(files)
    }
  }

  return (
    <button
      type="button"
      className={`sl-upload-drop${dragging ? ' is-drag' : ''}${selectedName ? ' is-filled' : ''}`}
      onClick={onTrigger}
      onDragEnter={enter}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
      disabled={disabled || busy}
      aria-label={selectedName ? `已上传 ${selectedName}，点击或拖入新文件替换` : '上传文件，可点击或拖拽'}
    >
      {selectedName ? (
        <>
          <span className="sl-upload-drop-ic">{selectedIcon}</span>
          <span className="sl-upload-drop-text">
            <span className="sl-upload-drop-main">{selectedName}</span>
            <span className="sl-upload-drop-hint">{hintText ?? '点击或拖入新文件替换'}</span>
          </span>
        </>
      ) : (
        <>
          <svg
            className="sl-upload-drop-ic"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="sl-upload-drop-main">{busy ? '处理中…' : (mainText ?? '点击或拖拽上传图片')}</span>
          <span className="sl-upload-drop-hint">{hintText ?? `可多选 · 最多 ${max} 张`}</span>
        </>
      )}
    </button>
  )
}

export default UploadDrop
