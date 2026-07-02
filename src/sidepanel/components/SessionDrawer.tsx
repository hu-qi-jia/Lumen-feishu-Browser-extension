import { useState } from 'react'
import type { SessionMeta } from '../../shared/types'
import type { SessionsApi } from '../sessions/useSessions'
import SideDrawer from './SideDrawer'
import Tooltip from './Tooltip'
import './SessionDrawer.css'

interface Props {
  sessions: SessionsApi
  /** Disable switching/new while a reply is streaming (avoids cross-session writes). */
  busy: boolean
  onClose: () => void
}

export default function SessionDrawer({ sessions, busy, onClose }: Props) {
  const { index, switchTo, removeSession, renameSession } = sessions
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const ordered = [...index.sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  function commitRename(id: string) {
    if (draft.trim()) renameSession(id, draft)
    setEditingId(null)
  }

  return (
    <SideDrawer title="历史会话" onClose={onClose}>
      <div className="drawer-list">
        {ordered.map((s) => (
          <SessionRow
            key={s.id}
            meta={s}
            active={s.id === index.activeId}
            busy={busy}
            editing={editingId === s.id}
            draft={draft}
            onPick={() => { if (!busy) { switchTo(s.id); onClose() } }}
            onStartRename={() => { setEditingId(s.id); setDraft(s.title) }}
            onDraft={setDraft}
            onCommit={() => commitRename(s.id)}
            onCancelRename={() => setEditingId(null)}
            onDelete={() => removeSession(s.id)}
          />
        ))}
      </div>
      {busy && <p className="drawer-hint">回复进行中，暂不能切换会话</p>}
    </SideDrawer>
  )
}

function SessionRow({
  meta, active, busy, editing, draft,
  onPick, onStartRename, onDraft, onCommit, onCancelRename, onDelete,
}: {
  meta: SessionMeta
  active: boolean
  busy: boolean
  editing: boolean
  draft: string
  onPick: () => void
  onStartRename: () => void
  onDraft: (v: string) => void
  onCommit: () => void
  onCancelRename: () => void
  onDelete: () => void
}) {
  return (
    <div className={`drawer-row ${active ? 'drawer-row--active' : ''}`}>
      {editing ? (
        <input
          className="drawer-rename"
          autoFocus
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit()
            if (e.key === 'Escape') onCancelRename()
          }}
          onBlur={onCommit}
        />
      ) : (
        <button className="drawer-row-main" onClick={onPick} disabled={busy}>
          <span className="drawer-row-title">{meta.title}</span>
          <span className="drawer-row-meta">{meta.messageCount} 条 · {timeAgo(meta.updatedAt)}</span>
        </button>
      )}
      {!editing && (
        <span className="drawer-row-actions">
          <Tooltip content="重命名" position="left">
            <button className="drawer-row-btn" onClick={onStartRename} type="button" aria-label="重命名">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip content="删除" position="left">
            <button className="drawer-row-btn" onClick={onDelete} type="button" aria-label="删除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </Tooltip>
        </span>
      )}
    </div>
  )
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
