import { useEffect, useRef, useState } from 'react'
import type { SessionKind } from '../../shared/types'
import type { RecentFile } from '../recentFiles'
import './DocSelector.css'

interface Props {
  mode: 'follow' | 'pin'
  /** Title shown on the trigger (the active session's working doc). */
  currentTitle: string
  /** Active resource token — marks the selected option in the menu. */
  activeToken: string | null
  /** Pin a specific document as the working doc. */
  onPickDoc: (token: string, title: string, kind: string) => void
  /** Switch to "follow the active tab" mode. */
  onFollow: () => void
  /** The most recently opened Feishu resources (doc / sheet / base, incl. closed tabs).
   *  Persisted across tab closes — this is what the dropdown lists instead of live tabs. */
  recentFiles: RecentFile[]
  /** Resolve a wiki-wrapped resource to its real kind so its icon is right (a wiki-Base
   *  shows the base icon). The pin still uses 'wiki' so pinnedFeishu resolves it on pin. */
  resolveWikiKind?: (wikiToken: string) => Promise<SessionKind | undefined>
}

// Distinct line icons per Feishu resource type, so sheet / base / doc are scannable at a
// glance. Wiki wraps another type (usually a doc) → its real icon is resolved at render
// for display, but defaults to the doc icon here. Exported — the session history drawer
// reuses these to group by document.
export function KindIcon({ kind }: { kind: SessionKind }) {
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
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
    </svg>
  )
}

/**
 * Working-document selector for the chat topbar. Shows the current working doc + binding
 * mode, and drops down to: pin any recently-opened Feishu resource as the working doc,
 * or switch to "follow tabs". The recent list persists across tab closes (unlike a live
 * chrome.tabs query), so closed docs stay reachable.
 */
export default function DocSelector({ mode, currentTitle, activeToken, onPickDoc, onFollow, recentFiles, resolveWikiKind }: Props) {
  const [open, setOpen] = useState(false)
  // Real kind of wiki-typed recent files, resolved for the ICON only (a wiki-Base shows
  // the base icon). The pin still uses 'wiki' (the stored kind) so it resolves on pin.
  const [wikiKinds, setWikiKinds] = useState<Record<string, SessionKind>>({})
  const wrapRef = useRef<HTMLDivElement>(null)

  // Resolve wiki display kinds when the menu opens. Bounded by the wiki-typed recent
  // count (usually 0–2); resolveWikiKind serves from the follow-mode cache when possible.
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

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const displayKind = (d: RecentFile): SessionKind =>
    d.kind === 'wiki' ? (wikiKinds[d.token] ?? 'doc') : d.kind

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

          {recentFiles.length > 0 && <div className="doc-selector-sep" />}
          {recentFiles.length > 0 && (
            <div className="doc-selector-group">
              <div className="doc-selector-group-label">最近打开</div>
              {recentFiles.map((d) => {
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
                      <KindIcon kind={displayKind(d)} />
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
          )}

          {recentFiles.length === 0 && (
            <div className="doc-selector-empty">打开飞书文档后会显示在这里</div>
          )}
        </div>
      )}
    </div>
  )
}
