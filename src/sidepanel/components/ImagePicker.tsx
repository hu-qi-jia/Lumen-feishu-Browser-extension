import { useRef, useState } from 'react'
import type { SlideImage } from '../../shared/ai/slidesImages'
import { compressImageToDataUrl } from '../../shared/attachments'
import './ImagePicker.css'

interface Props {
  images: SlideImage[]
  pageOf?: (id: string) => number | undefined
  onChange: (next: SlideImage[]) => void
  disabled?: boolean
  max?: number
}

const slug = (s: string) =>
  s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'img'

export function ImagePicker({ images, pageOf, onChange, disabled, max = 12 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return
    setBusy(true)
    try {
      const next = [...images]
      for (const f of Array.from(files)) {
        if (next.length >= max) break
        const dataUrl = await compressImageToDataUrl(f, { longEdge: 1024, quality: 0.8 })
        const base = slug(f.name.replace(/\.[^.]+$/, ''))
        let id = `upload-${base}`, k = 1
        while (next.some((i) => i.id === id)) id = `upload-${base}-${k++}`
        next.push({ id, source: 'upload', label: base, dataUrl })
      }
      onChange(next)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function rename(id: string, label: string) {
    onChange(images.map((i) => (i.id === id ? { ...i, label } : i)))
  }
  function remove(id: string) {
    onChange(images.filter((i) => i.id !== id))
  }

  return (
    <div className="sl-imgpicker">
      <div className="sl-imgpicker-grid">
        {images.map((i) => (
          <div className="sl-imgchip" key={i.id}>
            <img className="sl-imgchip-thumb" src={i.dataUrl} alt={i.label} />
            <input
              className="sl-imgchip-name"
              value={i.label}
              aria-label={`名称 ${i.label}`}
              onChange={(e) => rename(i.id, e.target.value)}
              disabled={disabled}
            />
            {pageOf
              ? pageOf(i.id) != null && (
                  <span className="sl-imgchip-page">P{pageOf(i.id)}</span>
                )
              : null}
            <button
              type="button"
              className="sl-imgchip-x"
              aria-label={`移除 ${i.label}`}
              onClick={() => remove(i.id)}
              disabled={disabled}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      {images.length < max && (
        <button
          type="button"
          className={`sl-imgpicker-drop${dragging ? ' is-drag' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (!disabled && !busy) onFiles(e.dataTransfer.files)
          }}
          disabled={disabled || busy}
          aria-label="上传图片，可点击或拖拽"
        >
          <svg className="sl-imgpicker-drop-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="sl-imgpicker-drop-main">{busy ? '处理中…' : '点击或拖拽上传图片'}</span>
          <span className="sl-imgpicker-drop-hint">可多选 · 最多 {max} 张</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
    </div>
  )
}

export default ImagePicker
