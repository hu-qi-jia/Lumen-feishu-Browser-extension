import { useEffect, useRef, useState } from 'react'
import type { RecentFile } from '../recentFiles'
import { parseDocTokenFromUrl } from '../../shared/feishu/parseDocRef'
import { KindIcon, IconX } from './icons'
import Button from './Button'
import './DocCombobox.css'

export interface DocTarget { token: string; title: string }

interface Props {
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
  target: DocTarget | null
  onTargetChange: (t: DocTarget | null) => void
  onConfirm: () => void
  writing?: boolean
}

export default function DocCombobox({ recentFiles, onRemoveRecent, target, onTargetChange, onConfirm, writing }: Props) {
  const [text, setText] = useState(target?.title ?? '')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setText(target?.title ?? '') }, [target])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function onText(v: string) {
    setText(v)
    const parsed = parseDocTokenFromUrl(v)
    onTargetChange(parsed ? { token: parsed.token, title: v } : null)
  }
  function pick(f: RecentFile) {
    onTargetChange({ token: f.token, title: f.title })
    setText(f.title)
    setOpen(false)
  }
  const q = text.trim().toLowerCase()
  const filtered = q ? recentFiles.filter((f) => f.title.toLowerCase().includes(q) || f.token.toLowerCase().includes(q)) : recentFiles

  return (
    <div className="dc-combobox" ref={rootRef}>
      <div className="dc-input-wrap">
        <input
          className="field-input dc-input" data-testid="dc-input"
          value={text} placeholder="粘贴文档链接或选择最近文档"
          onFocus={() => setOpen(true)} onChange={(e) => onText(e.target.value)}
        />
        <button type="button" className="dc-chevron" onClick={() => setOpen((o) => !o)} aria-label="展开最近文档">▾</button>
        {open && filtered.length > 0 && (
          <div className="dc-dropdown" data-testid="dc-dropdown">
            {filtered.map((f) => (
              <div key={f.token} className="dc-row" onClick={() => pick(f)}>
                <span className="dc-row-icon"><KindIcon kind={f.kind} /></span>
                <span className="dc-row-title">{f.title}</span>
                {onRemoveRecent && (
                  <button type="button" className="dc-row-x" aria-label="移除"
                    onClick={(e) => { e.stopPropagation(); onRemoveRecent(f.token) }}>
                    <IconX />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <Button variant="primary" onClick={onConfirm} disabled={writing} loading={writing}>添加到文档</Button>
    </div>
  )
}
