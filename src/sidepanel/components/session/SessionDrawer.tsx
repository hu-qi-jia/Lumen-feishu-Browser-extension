import { useEffect, useMemo, useState } from 'react'
import type { SessionKind, SessionMeta } from '@/shared/types'
import type { SessionsApi } from '../../sessions/useSessions'
import { groupSessions, GENERAL_GROUP_KEY, type SessionGroup } from '../../sessions/logic'
import { KindIcon, GeneralIcon, IconTrash } from '../primitives/icons'
import SideDrawer from '../primitives/SideDrawer'
import SearchBox from '../primitives/SearchBox'
import Tooltip from '../primitives/Tooltip'
import ConfirmDialog from '../chat/ConfirmDialog'
import './SessionDrawer.css'

interface Props {
  sessions: SessionsApi
  /** Disable switching/new while a reply is streaming (avoids cross-session writes). */
  busy: boolean
  onClose: () => void
  /** Resolve a wiki-bound session to its real kind so its group header shows the right icon. */
  resolveWikiKind?: (wikiToken: string) => Promise<SessionKind | undefined>
  /** Pick a session — App decides whether to switch directly (same doc) or prompt to switch
   *  the work doc first (cross-doc). The drawer doesn't switch/close itself anymore. */
  onPickSession: (session: SessionMeta) => void
}

export default function SessionDrawer({ sessions, busy, onClose, resolveWikiKind, onPickSession }: Props) {
  const { index, removeSession, removeSessionsByAppToken, renameSession, stampKind } = sessions
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // A pending delete awaiting the ConfirmDialog. Both the session-row trash and the
  // document-group trash route here first — nothing is deleted until the user confirms.
  const [confirm, setConfirm] = useState<
    | { kind: 'session'; id: string }
    | { kind: 'group'; appToken: string | null; title: string; count: number }
    | null
  >(null)
  const askDeleteSession = (id: string) => setConfirm({ kind: 'session', id })
  const askDeleteGroup = (g: SessionGroup) =>
    setConfirm({ kind: 'group', appToken: g.key === GENERAL_GROUP_KEY ? null : g.key, title: g.label, count: g.sessions.length })
  const confirmSummary = !confirm
    ? ''
    : confirm.kind === 'session'
      ? '删除该会话？删除后无法恢复。'
      : `删除「${confirm.title}」下的全部会话（${confirm.count} 个）？删除后无法恢复。`

  // On open, upgrade unresolved 'wiki' sessions to their real type (base/sheet/doc) so each
  // group header shows the right doc-type icon. A wiki session's appToken is its wikiToken,
  // and its kind stays 'wiki' until the focused-tab resolution path touches it — so a wiki-
  // Base you haven't revisited still reads correctly here. Bounded by the wiki-session count.
  useEffect(() => {
    if (!resolveWikiKind) return
    const wikiSessions = index.sessions.filter((s) => s.kind === 'wiki' && s.appToken)
    for (const s of wikiSessions) {
      const tok = s.appToken as string
      void resolveWikiKind(tok).then((kind) => {
        if (kind && kind !== 'wiki') stampKind(tok, kind)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One-shot init: collapse every group EXCEPT the active session's, so opening the
  // drawer lands on the relevant doc and the rest wait behind their headers. The drawer
  // is conditionally rendered ({drawerOpen && …}), so it remounts each open → this
  // re-runs and re-targets the now-active group.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const active = index.sessions.find((s) => s.id === index.activeId)
    const activeKey = active?.appToken ?? GENERAL_GROUP_KEY
    const out = new Set<string>()
    for (const s of index.sessions) {
      const k = s.appToken ?? GENERAL_GROUP_KEY
      if (k !== activeKey) out.add(k)
    }
    return out
  })

  const groups = useMemo(() => groupSessions(index.sessions), [index.sessions])

  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const flatResults = useMemo(
    () =>
      searching
        ? [...index.sessions]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .filter((s) => s.title.toLowerCase().includes(q) || (s.preview ?? '').toLowerCase().includes(q))
        : [],
    [index.sessions, q, searching],
  )

  // Doc name per group key — used as a badge on flat search rows (which lost their group
  // header when the query flattened the list).
  const labelByKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of groups) m.set(g.key, g.label)
    return m
  }, [groups])

  function commitRename(id: string) {
    if (draft.trim()) renameSession(id, draft)
    setEditingId(null)
  }

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const pick = (session: SessionMeta) => { if (!busy) onPickSession(session) }

  return (
    <SideDrawer title="历史会话" onClose={onClose}>
      <div className="drawer-search-wrap">
        <SearchBox
          value={query}
          onChange={(v) => setQuery(v)}
          placeholder="搜索会话标题或内容"
          ariaLabel="搜索会话"
        />
      </div>

      <div className="drawer-list">
        {searching ? (
          flatResults.length === 0 ? (
            <div className="drawer-empty">没有匹配「{query.trim()}」的会话</div>
          ) : (
            flatResults.map((s) => (
              <SessionRow
                key={s.id}
                meta={s}
                docBadge={labelByKey.get(s.appToken ?? GENERAL_GROUP_KEY)}
                active={s.id === index.activeId}
                busy={busy}
                editing={editingId === s.id}
                draft={draft}
                onPick={() => pick(s)}
                onStartRename={() => { setEditingId(s.id); setDraft(s.title) }}
                onDraft={setDraft}
                onCommit={() => commitRename(s.id)}
                onCancelRename={() => setEditingId(null)}
                onDelete={() => askDeleteSession(s.id)}
              />
            ))
          )
        ) : groups.length === 0 ? (
          <div className="drawer-empty">还没有会话</div>
        ) : (
          groups.map((g) => (
            <SessionGroupView
              key={g.key}
              group={g}
              collapsed={collapsed.has(g.key)}
              activeId={index.activeId}
              busy={busy}
              editingId={editingId}
              draft={draft}
              onToggle={() => toggle(g.key)}
              onPick={pick}
              onStartRename={(id, title) => { setEditingId(id); setDraft(title) }}
              onDraft={setDraft}
              onCommit={commitRename}
              onCancelRename={() => setEditingId(null)}
              onDelete={askDeleteSession}
              onDeleteGroup={() => askDeleteGroup(g)}
            />
          ))
        )}
      </div>
      {busy && <p className="drawer-hint">回复进行中，暂不能切换会话</p>}
      {confirm && (
        <ConfirmDialog
          req={{ kind: 'delete', summary: confirmSummary }}
          onChoose={(c) => {
            if (c === 'confirm') {
              if (confirm.kind === 'session') removeSession(confirm.id)
              else removeSessionsByAppToken(confirm.appToken)
            }
            setConfirm(null)
          }}
        />
      )}
    </SideDrawer>
  )
}

// A doc bucket: a collapsible header (icon + doc name + session count) over its sessions.
// Collapsed by default except the active session's group (see one-shot init above).
function SessionGroupView({
  group, collapsed, activeId, busy, editingId, draft,
  onToggle, onPick, onStartRename, onDraft, onCommit, onCancelRename, onDelete, onDeleteGroup,
}: {
  group: SessionGroup
  collapsed: boolean
  activeId: string | null
  busy: boolean
  editingId: string | null
  draft: string
  onToggle: () => void
  onPick: (session: SessionMeta) => void
  onStartRename: (id: string, title: string) => void
  onDraft: (v: string) => void
  onCommit: (id: string) => void
  onCancelRename: () => void
  onDelete: (id: string) => void
  onDeleteGroup: () => void
}) {
  const isGeneral = group.key === GENERAL_GROUP_KEY
  return (
    <div className="drawer-group">
      <div className="drawer-group-head">
        <button className="drawer-group-toggle" onClick={onToggle} type="button" aria-expanded={!collapsed}>
          <span className="drawer-group-icon" aria-hidden="true">
            {isGeneral ? <GeneralIcon /> : <KindIcon kind={group.kind ?? 'doc'} />}
          </span>
          <span className="drawer-group-label">{group.label}</span>
          <span className="drawer-group-count">{group.sessions.length}</span>
          <svg className={`drawer-group-chev${collapsed ? '' : ' drawer-group-chev--open'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <span className="drawer-group-actions">
          <Tooltip content="删除该文档全部会话" position="left">
            <button className="drawer-row-btn" onClick={onDeleteGroup} type="button" aria-label="删除该文档全部会话">
              <IconTrash />
            </button>
          </Tooltip>
        </span>
      </div>
      {!collapsed && (
        <div className="drawer-group-body">
          {group.sessions.map((s) => (
            <SessionRow
              key={s.id}
              meta={s}
              active={s.id === activeId}
              busy={busy}
              editing={editingId === s.id}
              draft={draft}
              onPick={() => onPick(s)}
              onStartRename={() => onStartRename(s.id, s.title)}
              onDraft={onDraft}
              onCommit={() => onCommit(s.id)}
              onCancelRename={onCancelRename}
              onDelete={() => onDelete(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionRow({
  meta, active, busy, editing, draft, docBadge,
  onPick, onStartRename, onDraft, onCommit, onCancelRename, onDelete,
}: {
  meta: SessionMeta
  active: boolean
  busy: boolean
  editing: boolean
  draft: string
  /** Doc name — shown as a muted subtitle when there's no first-message preview
   *  (only on flat search rows, which lost their group header). */
  docBadge?: string
  onPick: () => void
  onStartRename: () => void
  onDraft: (v: string) => void
  onCommit: () => void
  onCancelRename: () => void
  onDelete: () => void
}) {
  return (
    <div className={`drawer-row${active ? ' drawer-row--active' : ''}`}>
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
          <span className="drawer-row-sub">
            {meta.preview ? (
              <span className="drawer-row-preview">{meta.preview}</span>
            ) : docBadge ? (
              <span className="drawer-row-preview drawer-row-preview--muted">{docBadge}</span>
            ) : null}
            <span className="drawer-row-time">{timeAgo(meta.updatedAt)}</span>
          </span>
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
              <IconTrash />
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
