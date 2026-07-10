import { useEffect, useRef, useState } from 'react'
import type { SessionKind } from '@/shared/types'
import { displayName, type RecentFile } from '../../services/recentFiles'
import { KindIcon, IconX } from '../ui/icons'
import IconButton from '../ui/IconButton'

interface Props {
  /** Controlled field text — a typed/pasted link, or whatever the caller fills (e.g. a picked
   *  doc's title). The field never parses this itself; the caller decides what typing means. */
  value: string
  onValueChange: (v: string) => void
  recentFiles: RecentFile[]
  /** Pick a recent doc from the dropdown. The caller decides what to do — fill the field, add
   *  it as a source, etc. DocLinkField closes the dropdown after a pick. */
  onPickRecent: (f: RecentFile) => void
  onRemoveRecent?: (token: string) => void
  placeholder?: string
  disabled?: boolean
  /** Fire on Enter (optional) — e.g. SlidesPanel submits the typed link as a source. */
  onSubmit?: () => void
  /** Resolve a wiki-wrapped resource to its real kind so its icon is right (a wiki-Base shows the
   *  base icon). Optional — when absent, wiki entries fall back to the doc icon. */
  resolveWikiKind?: (wikiToken: string) => Promise<SessionKind | undefined>
}

/**
 * The shared "paste a link OR pick a recent doc" combobox input — a text field with a chevron
 * that drops down the recent-docs list (filtered by what's typed) plus a clear button. It owns
 * only the open/close + outside-click behavior; it has NO confirm button and NO target model.
 *
 * `DocCombobox` composes this + a 写入 button and a single-target state (PDF → 写入文档);
 * `SlidesPanel` composes this + an 添加 button and multi-source chips (PPT → 加参考素材).
 * The `.dc-*` class names + testids are shared with the old monolithic DocCombobox so its test
 * keeps passing and the two panels read as the same control.
 */
export default function DocLinkField({ value, onValueChange, recentFiles, onPickRecent, onRemoveRecent, placeholder, disabled, onSubmit, resolveWikiKind }: Props) {
  const [open, setOpen] = useState(false)
  // Real kind of wiki-typed recent files, resolved for the ICON only (a wiki-Base shows the base
  // icon). The pick still uses the stored 'wiki' kind so resolveSource re-resolves it on add.
  const [wikiKinds, setWikiKinds] = useState<Record<string, SessionKind>>({})
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click. Kept here (not in a caller) so every consumer gets it for free.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Resolve wiki display kinds when the dropdown opens (bounded by the wiki-typed recent count,
  // usually 0–2). Mirrors DocSelector so a knowledge-base-wrapped Base/Sheet shows the right icon.
  useEffect(() => {
    if (!open) return
    const wikiTokens = recentFiles.filter((d) => d.kind === 'wiki').map((d) => d.token)
    if (!wikiTokens.length || !resolveWikiKind) return
    let cancelled = false
    void Promise.all(wikiTokens.map(async (tok) => {
      const real = await resolveWikiKind(tok)
      return real && real !== 'wiki' ? ([tok, real] as const) : null
    })).then((entries) => {
      if (cancelled) return
      const m: Record<string, SessionKind> = {}
      for (const e of entries) if (e) m[e[0]] = e[1]
      setWikiKinds(m)
    }).catch(() => { /* leave wiki icons as the doc fallback */ })
    return () => { cancelled = true }
  }, [open, recentFiles, resolveWikiKind])

  const displayKind = (f: RecentFile): SessionKind =>
    f.kind === 'wiki' ? (wikiKinds[f.token] ?? 'doc') : f.kind

  const q = value.trim().toLowerCase()
  const filtered = q
    ? recentFiles.filter((f) => f.title.toLowerCase().includes(q) || f.token.toLowerCase().includes(q))
    : recentFiles

  return (
    <div className="dc-input-wrap" ref={rootRef}>
      <input
        className="field-input dc-input" data-testid="dc-input"
        value={value} placeholder={placeholder ?? '粘贴文档链接或选择最近文档'} disabled={disabled}
        onFocus={() => setOpen(true)} onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) { e.preventDefault(); onSubmit() } }}
      />
      <IconButton
        className="dc-chevron" disabled={disabled}
        onClick={() => setOpen((o) => !o)} aria-label="展开最近文档" aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </IconButton>
      {value && (
        <IconButton className="dc-clear" data-testid="dc-clear" aria-label="清除" onClick={() => onValueChange('')}><IconX /></IconButton>
      )}
      {open && filtered.length > 0 && (
        <div className="dc-dropdown" data-testid="dc-dropdown">
          {filtered.map((f) => {
            const k = displayKind(f)
            return (
            <div key={f.token} className="dc-row" onClick={() => { onPickRecent(f); setOpen(false) }}>
              <span className={`dc-row-icon dc-row-icon--${k}`}><KindIcon kind={k} /></span>
              <span className="dc-row-title">{displayName(f)}</span>
              {onRemoveRecent && (
                <IconButton className="dc-row-x" aria-label="移除"
                  onClick={(e) => { e.stopPropagation(); onRemoveRecent(f.token) }}>
                  <IconX />
                </IconButton>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
