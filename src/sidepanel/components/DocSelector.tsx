import { useEffect, useRef, useState } from 'react'
import { parseFeishuContext, cleanDocTitle } from '../../shared/feishu/pageUrl'
import './DocSelector.css'

type FeishuKind = 'base' | 'sheet' | 'doc' | 'wiki' | 'ppt'

interface DocOption {
  token: string
  title: string
  kind: FeishuKind
}

interface Props {
  mode: 'follow' | 'pin'
  /** Title shown on the trigger (the active session's working doc). */
  currentTitle: string
  /** Active resource token — marks the selected option in the menu. */
  activeToken: string | null
  /** Pin a specific open document as the working doc. */
  onPickDoc: (token: string, title: string, kind: string) => void
  /** Switch to "follow the active tab" mode. */
  onFollow: () => void
}

// Map a Feishu resource to a single stable token (matches the session-binding key in App:
// wikiToken ?? appToken ?? spreadsheetToken ?? documentId ?? slideToken).
function resourceToken(f: ReturnType<typeof parseFeishuContext>): string | null {
  if (!f) return null
  return f.wikiToken ?? f.appToken ?? f.spreadsheetToken ?? f.documentId ?? f.slideToken ?? null
}

// Default label when a tab's title can't be cleaned (URL / placeholder) — kind-specific
// reads better than a generic "未命名文档" for every type.
function kindLabel(kind: FeishuKind): string {
  if (kind === 'sheet') return '未命名表格'
  if (kind === 'base') return '未命名多维表格'
  if (kind === 'ppt') return '未命名演示文稿'
  return '未命名文档'
}

// Category metadata: each FeishuKind maps to a labeled group so the dropdown reads as
// typed sections (文档 / 多维表格 / 表格 / 演示文稿) instead of a flat mixed list. Wiki
// wraps another type (usually a doc) → grouped under 文档.
const CATEGORY_ORDER: { label: string; kinds: FeishuKind[] }[] = [
  { label: '文档', kinds: ['doc', 'wiki'] },
  { label: '多维表格', kinds: ['base'] },
  { label: '表格', kinds: ['sheet'] },
  { label: '演示文稿', kinds: ['ppt'] },
]

// Distinct line icons per Feishu resource type, so sheet / base / doc / slides are scannable
// at a glance in the dropdown. Wiki wraps another type (usually a doc) → doc icon.
function KindIcon({ kind }: { kind: FeishuKind }) {
  if (kind === 'sheet') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
        <line x1="9" y1="3" x2="9" y2="21" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    )
  }
  if (kind === 'base') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 8h18" />
        <path d="M9 8v13" />
        <path d="M15 8v13" />
      </svg>
    )
  }
  if (kind === 'ppt') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M12 16v4" />
        <path d="M8 20h8" />
        <path d="M8 10l3 2 5-4" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
    </svg>
  )
}

/**
 * Working-document selector for the chat topbar. Shows the current working doc + binding mode,
 * and drops down to: pin any open Feishu tab as the working doc, or switch to "follow tabs".
 * Open tabs are enumerated live via chrome.tabs.query when the menu opens.
 */
export default function DocSelector({ mode, currentTitle, activeToken, onPickDoc, onFollow }: Props) {
  const [open, setOpen] = useState(false)
  const [docs, setDocs] = useState<DocOption[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)

  // Enumerate open Feishu tabs (current window) when the menu opens.
  useEffect(() => {
    if (!open) return
    if (!chrome.tabs?.query) return // dev/test runtime without the tabs API
    let cancelled = false
    void chrome.tabs.query({ currentWindow: true }).then((tabs) => {
      if (cancelled) return
      const seen = new Set<string>()
      const list: DocOption[] = []
      for (const t of tabs) {
        const f = parseFeishuContext(t.url ?? '')
        const token = resourceToken(f)
        if (!token || seen.has(token)) continue
        seen.add(token)
        const title = cleanDocTitle(t.title ?? '') || kindLabel(f?.kind ?? 'doc')
        list.push({ token, title, kind: (f?.kind ?? 'doc') as FeishuKind })
      }
      setDocs(list)
    }).catch(() => { /* no tabs access — show empty state */ })
    return () => { cancelled = true }
  }, [open])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="doc-selector" ref={wrapRef}>
      <button
        className={`doc-selector-trigger${open ? ' doc-selector-trigger--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        type="button"
        title={currentTitle}
      >
        <span className={`doc-selector-mode doc-selector-mode--${mode}`}>
          {mode === 'pin' ? '固定' : '跟随'}
        </span>
        <span className="doc-selector-title">{currentTitle}</span>
        <svg className={`doc-selector-chev${open ? ' doc-selector-chev--open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="doc-selector-menu" role="listbox">
          <button
            className={`doc-selector-item${mode === 'follow' ? ' doc-selector-item--active' : ''}`}
            onClick={() => { onFollow(); setOpen(false) }}
            type="button"
          >
            <span className="doc-selector-item-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </span>
            <span className="doc-selector-item-text">
              <span className="doc-selector-item-title">跟随标签页</span>
              <span className="doc-selector-item-sub">切换标签页时询问</span>
            </span>
          </button>

          {docs.length > 0 && <div className="doc-selector-sep" />}
          {CATEGORY_ORDER.map((cat) => {
            const items = docs.filter((d) => cat.kinds.includes(d.kind))
            if (items.length === 0) return null
            return (
              <div className="doc-selector-group" key={cat.label}>
                <div className="doc-selector-group-label">{cat.label}</div>
                {items.map((d) => {
                  const selected = mode === 'pin' && activeToken === d.token
                  return (
                    <button
                      key={d.token}
                      className={`doc-selector-item${selected ? ' doc-selector-item--active' : ''}`}
                      onClick={() => { onPickDoc(d.token, d.title, d.kind); setOpen(false) }}
                      type="button"
                      title={d.title}
                    >
                      <span className="doc-selector-item-icon" aria-hidden="true">
                        <KindIcon kind={d.kind} />
                      </span>
                      <span className="doc-selector-item-text">
                        <span className="doc-selector-item-title">{d.title}</span>
                      </span>
                      {selected && (
                        <svg className="doc-selector-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}

          {docs.length === 0 && (
            <div className="doc-selector-empty">没有打开的飞书文档</div>
          )}
        </div>
      )}
    </div>
  )
}
