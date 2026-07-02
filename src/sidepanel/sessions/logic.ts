/**
 * Pure reducers over SessionIndex — the trickiest part of session management
 * (find-or-create by document, byAppToken bookkeeping, delete fallback). Kept
 * side-effect-free so they can be unit-tested without React or chrome.storage.
 */
import type { ChatMessage, SessionIndex, SessionKind, SessionMeta } from '../../shared/types'

const now = () => Date.now()

/** Max conversation WINDOWS (sessions) kept; the oldest are evicted beyond this. Messages
 *  WITHIN a session are NOT capped — full history is preserved. */
export const MAX_SESSIONS = 20

/**
 * Keep at most MAX_SESSIONS conversation windows, evicting the OLDEST by `updatedAt`.
 * Never evicts the active session or `keepId` (the just-created/opened one). Returns the
 * trimmed index plus the removed session ids so the caller can drop their stored messages.
 */
export function capSessions(
  idx: SessionIndex,
  keepId: string | null = null,
  max: number = MAX_SESSIONS,
): { idx: SessionIndex; removed: string[] } {
  if (idx.sessions.length <= max) return { idx, removed: [] }
  const protectedIds = new Set([idx.activeId, keepId].filter(Boolean) as string[])
  const oldestFirst = [...idx.sessions].sort((a, b) => a.updatedAt - b.updatedAt)
  const removed: string[] = []
  let remaining = idx.sessions.length
  for (const s of oldestFirst) {
    if (remaining <= max) break
    if (protectedIds.has(s.id)) continue
    removed.push(s.id)
    remaining--
  }
  if (!removed.length) return { idx, removed: [] }
  const gone = new Set(removed)
  const sessions = idx.sessions.filter((s) => !gone.has(s.id))
  const byAppToken: Record<string, string> = {}
  for (const [k, v] of Object.entries(idx.byAppToken)) if (!gone.has(v)) byAppToken[k] = v
  const generalId = idx.generalId && gone.has(idx.generalId) ? null : idx.generalId
  return { idx: { ...idx, sessions, byAppToken, generalId }, removed }
}

export function emptyIndex(): SessionIndex {
  return { sessions: [], activeId: null, byAppToken: {}, generalId: null }
}

function meta(partial: Partial<SessionMeta> & { id: string; title: string; appToken: string | null }): SessionMeta {
  const t = now()
  return { createdAt: t, updatedAt: t, messageCount: 0, titleResolved: false, ...partial }
}

/**
 * Return the session bound to `appToken` (or the general session when null),
 * creating it if missing. `newId` lets tests inject deterministic ids. `kind`
 * (the Feishu resource type) is stamped onto a newly created session so the
 * history list can show the right doc icon immediately.
 */
export function ensureSession(
  idx: SessionIndex,
  appToken: string | null,
  newId: () => string,
  kind?: SessionKind,
): { idx: SessionIndex; id: string; created: boolean } {
  if (appToken) {
    const existing = idx.byAppToken[appToken]
    if (existing && idx.sessions.some((s) => s.id === existing)) {
      // Backfill the doc-type icon on a legacy session (created before `kind` existed) or
      // upgrade an unresolved 'wiki' session to its real type, now that we know it. Never
      // clobber a concrete kind with a conflicting one — an existing base/sheet/doc stays.
      if (kind) {
        const target = idx.sessions.find((s) => s.id === existing)
        if (target && (!target.kind || target.kind === 'wiki') && target.kind !== kind) {
          return {
            idx: { ...idx, sessions: idx.sessions.map((s) => (s.id === existing ? { ...s, kind } : s)) },
            id: existing,
            created: false,
          }
        }
      }
      return { idx, id: existing, created: false }
    }
    const m = meta({ id: newId(), title: `会话 ${appToken.slice(0, 8)}…`, appToken, kind })
    return {
      idx: { ...idx, sessions: [m, ...idx.sessions], byAppToken: { ...idx.byAppToken, [appToken]: m.id } },
      id: m.id,
      created: true,
    }
  }
  if (idx.generalId && idx.sessions.some((s) => s.id === idx.generalId)) {
    return { idx, id: idx.generalId, created: false }
  }
  const m = meta({ id: newId(), title: '通用会话', appToken: null, titleResolved: true })
  return { idx: { ...idx, sessions: [m, ...idx.sessions], generalId: m.id }, id: m.id, created: true }
}

/**
 * Remove a session and compute the fallback active id. If the removed session was
 * active, fall back to the current document's session (recreated if needed) or the
 * general session.
 */
export function removeSession(
  idx: SessionIndex,
  id: string,
  currentAppToken: string | null,
  newId: () => string
): { idx: SessionIndex; activeId: string | null } {
  const target = idx.sessions.find((s) => s.id === id)
  if (!target) return { idx, activeId: idx.activeId }

  const byAppToken = { ...idx.byAppToken }
  if (target.appToken) delete byAppToken[target.appToken]
  let next: SessionIndex = {
    ...idx,
    sessions: idx.sessions.filter((s) => s.id !== id),
    byAppToken,
    generalId: idx.generalId === id ? null : idx.generalId,
  }

  let activeId = idx.activeId
  if (activeId === id) {
    const ensured = ensureSession(next, currentAppToken, newId)
    next = ensured.idx
    activeId = ensured.id
  }
  return { idx: { ...next, activeId }, activeId }
}

// ── History drawer support ────────────────────────────────────────────────────

/** Truncate the first user message into a one-line preview (powers the row subtitle
 *  + search). Returns undefined when there's no user text yet. */
export function previewFromMessages(msgs: ChatMessage[]): string | undefined {
  const first = msgs.find((m) => m.role === 'user' && m.content != null && m.content.trim() !== '')
  const text = first?.content?.trim()
  return text ? text.slice(0, 60) : undefined
}

// A title that's a generated placeholder, not a real doc/user name — the group header
// should prefer a resolved name or the first-message preview over these.
function isPlaceholderTitle(title: string): boolean {
  return title === '新会话' || title === '通用会话' || /^会话\s.+…$/.test(title)
}

/** Key for the catch-all group holding sessions with no bound document. */
export const GENERAL_GROUP_KEY = '__general__'

export interface SessionGroup {
  /** appToken, or GENERAL_GROUP_KEY for unbound sessions. */
  key: string
  /** Best available label (resolved doc name > preview > placeholder). */
  label: string
  /** Feishu resource kind shared by the group's sessions, if any is known. */
  kind?: SessionKind
  /** Sessions within the group, newest first. */
  sessions: SessionMeta[]
  /** Most recent activity across the group (drives group ordering). */
  updatedAt: number
}

/**
 * Bucket sessions by bound document so the history drawer reads as typed sections
 * (one per doc) instead of one flat mixed list. Pure + side-effect-free → unit-testable.
 */
export function groupSessions(sessions: SessionMeta[]): SessionGroup[] {
  const byKey = new Map<string, SessionMeta[]>()
  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const key = s.appToken ?? GENERAL_GROUP_KEY
    const arr = byKey.get(key)
    if (arr) arr.push(s)
    else byKey.set(key, [s])
  }
  const groups: SessionGroup[] = []
  for (const [key, sess] of byKey) {
    const latest = sess[0]
    const resolved = sess.find((s) => s.titleResolved && !isPlaceholderTitle(s.title))
    const label =
      key === GENERAL_GROUP_KEY
        ? '通用会话'
        : (resolved?.title
          ?? (latest && !isPlaceholderTitle(latest.title) ? latest.title : latest?.preview)
          ?? latest?.title
          ?? '未命名文档')
    const kind = sess.find((s) => s.kind)?.kind
    groups.push({ key, label, kind, sessions: sess, updatedAt: latest.updatedAt })
  }
  return groups.sort((a, b) => b.updatedAt - a.updatedAt)
}
