import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, SessionIndex, SessionKind, SessionMeta } from '@/shared/types'
import * as store from './store'
import { emptyIndex, ensureSession as ensureSessionPure, removeSession as removeSessionPure, removeSessionsByAppToken as removeSessionsByAppTokenPure, capSessions, previewFromMessages, stampKind as stampKindPure, resolveSessionTitle as resolveSessionTitlePure } from './logic'

const uid = () => crypto.randomUUID()
const now = () => Date.now()
const FLUSH_MS = 800

type Updater = ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])

export interface SessionsApi {
  ready: boolean
  index: SessionIndex
  activeSession: SessionMeta | null
  messages: ChatMessage[]
  setMessages: (u: Updater) => void
  /** Write to a specific session (bind a streaming reply to the session it began in). */
  setMessagesFor: (sessionId: string, u: Updater) => void
  switchTo: (id: string) => void
  /** Start a fresh session. Binds to the active resource by default; pass `appToken` to bind
   *  it to a SPECIFIC resource (used by the switch-doc popup to open a new session for the
   *  tab the user just switched to, regardless of which session is currently held active). */
  createSession: (opts?: { appToken?: string; title?: string; kind?: SessionKind }) => void
  removeSession: (id: string) => void
  /** Remove EVERY session bound to `appToken` (document-level delete from the history
   *  drawer). `null` clears the general group. Drops each removed session's cached +
   *  stored messages and falls back to the general session if the active one was among
   *  them. Asks for confirmation in the UI before calling — this is destructive. */
  removeSessionsByAppToken: (appToken: string | null) => void
  renameSession: (id: string, title: string) => void
  /** Re-bind an existing session to a different resource, keeping its messages (the
   *  "在原会话中继续工作" choice on the switch-doc popup — follow the new tab without
   *  starting over). Updates `appToken` + the `byAppToken` shortcut map. */
  rebindSession: (sessionId: string, newAppToken: string, title?: string) => void
  /** Backfill a document session's placeholder title with the real Base name, and/or stamp
   *  its Feishu resource kind (for the doc icon in the history list). */
  resolveTitle: (appToken: string, title: string, kind?: SessionKind) => void
  /** Stamp a Feishu resource kind onto the session bound to `appToken` (no title change).
   *  Upgrades an unresolved 'wiki' session to its real type (base/sheet/doc) once resolved,
   *  so the history drawer can show the right doc-type icon without a visit. */
  stampKind: (appToken: string, kind: SessionKind) => void
  /** Toggle knowledge-base tools for a session (chat 工具下拉的「知识库」开关). */
  setKbEnabled: (sessionId: string, on: boolean) => void
}

/**
 * Multi-session manager. Sessions are persisted to chrome.storage.local; the one
 * shown follows the current document (appToken) — switching documents auto-opens
 * that document's recorded session. A general session covers non-Base pages.
 * Auto-switch is deferred while `streaming` so an in-flight reply finishes in its
 * own session before the view follows browser navigation.
 */
export function useSessions(activeAppToken: string | null, streaming: boolean, activeKind?: SessionKind): SessionsApi {
  const [index, setIndex] = useState<SessionIndex>(emptyIndex())
  const [messages, setMessagesState] = useState<ChatMessage[]>([])
  const [ready, setReady] = useState(false)

  const indexRef = useRef(index)
  indexRef.current = index
  // Latest known doc kind for the active resource — read via ref so `ensureSession` stays a
  // stable callback (its callers pin deps to [activeAppToken], not this) while still stamping
  // the current kind onto the active/created session.
  const activeKindRef = useRef(activeKind)
  activeKindRef.current = activeKind
  const activeIdRef = useRef<string | null>(null)
  const cache = useRef<Map<string, ChatMessage[]>>(new Map())
  const flushTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const persistIndex = useCallback((idx: SessionIndex) => {
    indexRef.current = idx
    setIndex(idx)
    void store.saveIndex(idx)
  }, [])

  // Persist an index but first cap the number of conversation WINDOWS (keeping the
  // active/just-opened one), dropping the evicted sessions' stored messages.
  const persistCapped = useCallback((idx: SessionIndex, keepId: string | null) => {
    const { idx: capped, removed } = capSessions(idx, keepId)
    persistIndex(capped)
    for (const id of removed) {
      // Cancel any pending debounced flush — else it fires up to FLUSH_MS later and re-creates
      // the just-deleted blob (an orphan with no index entry, never swept).
      const t = flushTimers.current.get(id)
      if (t) { clearTimeout(t); flushTimers.current.delete(id) }
      cache.current.delete(id)
      void store.removeMessages(id)
    }
  }, [persistIndex])

  // Synchronously persist every session with a pending debounced write (final streamed reply
  // is otherwise only saved 800ms after the last chunk — closing the panel in that window loses
  // it). Best-effort on teardown (storage.set is async), but strictly better than zero attempts.
  const flushAll = useCallback(() => {
    const timers = flushTimers.current
    if (!timers.size) return
    const flushed = [...timers.keys()]
    for (const [sessionId, t] of timers) {
      clearTimeout(t)
      void store.saveMessages(sessionId, cache.current.get(sessionId) ?? [])
    }
    timers.clear()
    const idx = indexRef.current
    const sessions = idx.sessions.map((s) => {
      if (!flushed.includes(s.id)) return s
      const msgs = cache.current.get(s.id) ?? []
      return { ...s, updatedAt: now(), messageCount: msgs.length, preview: s.preview ?? previewFromMessages(msgs) }
    })
    persistIndex({ ...idx, sessions })
  }, [persistIndex])

  const loadInto = useCallback(async (id: string) => {
    activeIdRef.current = id
    const cached = cache.current.get(id)
    if (cached) { setMessagesState(cached); return }
    const msgs = await store.loadMessages(id) // full history — no per-session message cap
    cache.current.set(id, msgs)
    if (activeIdRef.current === id) setMessagesState(msgs)
  }, [])

  const ensureSession = useCallback(
    (idx: SessionIndex, appToken: string | null) => ensureSessionPure(idx, appToken, uid, activeKindRef.current),
    []
  )

  // Initial load — restore the index and open the session for the current context.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded = (await store.loadIndex()) ?? emptyIndex()
      if (cancelled) return
      const { idx, id } = ensureSession(loaded, activeAppToken)
      persistCapped({ ...idx, activeId: id }, id)
      await loadInto(id)
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-switch when the EFFECTIVE document changes — but NEVER as a side-effect of a reply
  // finishing. `streaming` is deliberately OMITTED from the deps: with it included, this effect
  // re-ran at every stream-end and, whenever the active session wasn't the live tab's (chatting
  // in the general session on a doc page, or a session picked from history), ensureSession()
  // yanked the view off the session the reply just landed in — the "生成回答后会切换会话" bug.
  // The mid-stream `streaming` guard still prevents switching DURING a reply; a navigation that
  // happens mid-stream simply isn't followed until the next genuine document change. Doc-to-doc
  // following is driven by the SwitchDocDialog (pendingSwitch) in useDocBinding, not this effect.
  useEffect(() => {
    if (!ready || streaming) return
    const { idx, id } = ensureSession(indexRef.current, activeAppToken)
    if (idx !== indexRef.current || idx.activeId !== id) persistCapped({ ...idx, activeId: id }, id)
    void loadInto(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAppToken, ready])

  useEffect(() => { activeIdRef.current = index.activeId }, [index.activeId])

  // Flush pending writes when the panel is hidden/closed (the MV3 side panel tears down its JS
  // context on close), and immediately when a streamed turn finishes (the most important write).
  const prevStreaming = useRef(streaming)
  useEffect(() => {
    if (prevStreaming.current && !streaming) flushAll()
    prevStreaming.current = streaming
  }, [streaming, flushAll])
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushAll() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushAll)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushAll)
    }
  }, [flushAll])

  // Write to a SPECIFIC session — the source of truth is the per-session cache, so a
  // streaming reply always lands in the session it started in (bind at send time),
  // never the currently-active one if it switched mid-stream. Each session flushes
  // on its own debounce timer.
  const setMessagesFor = useCallback((sessionId: string, u: Updater) => {
    const prev = cache.current.get(sessionId) ?? []
    // Full history kept — no per-session message cap (windows are capped instead).
    const next = typeof u === 'function' ? (u as (p: ChatMessage[]) => ChatMessage[])(prev) : u
    cache.current.set(sessionId, next)

    const timers = flushTimers.current
    const existing = timers.get(sessionId)
    if (existing) clearTimeout(existing)
    timers.set(sessionId, setTimeout(() => {
      void store.saveMessages(sessionId, next)
      const idx = indexRef.current
      const sessions = idx.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, updatedAt: now(), messageCount: next.length, preview: s.preview ?? previewFromMessages(next) }
          : s
      )
      persistIndex({ ...idx, sessions })
      timers.delete(sessionId)
    }, FLUSH_MS))

    if (sessionId === activeIdRef.current) setMessagesState(next)
  }, [persistIndex])

  const setMessages = useCallback((u: Updater) => {
    const id = activeIdRef.current
    if (id) setMessagesFor(id, u)
  }, [setMessagesFor])

  // Switch the active session to `id` and load its messages. A manual switch (history
  // drawer) must land and STICK — App's hold effect engages `heldResource` so follow-mode's
  // auto-switch can't yank the view back to the live tab's session on the next ctx refresh.
  const switchTo = useCallback((id: string) => {
    const idx = indexRef.current
    if (!idx.sessions.some((s) => s.id === id)) return // unknown id — no-op
    if (idx.activeId !== id) persistIndex({ ...idx, activeId: id })
    void loadInto(id)
  }, [persistIndex, loadInto])

  // A new session binds to the CURRENT resource (or becomes the general session) so the
  // resource-driven auto-switch agrees it's the active one. With appToken:null the
  // auto-switch effect (which re-runs when streaming ends) would resolve the OLD
  // resource-bound session and jump the view back to it — the "new session jumps away
  // after I send" bug. An explicit `appToken` overrides the binding (switch-doc popup).
  const createSession = useCallback((opts?: { appToken?: string; title?: string; kind?: SessionKind }) => {
    const token = opts?.appToken ?? activeAppToken
    const id = uid()
    const meta: SessionMeta = {
      id, title: opts?.title ?? '新会话', appToken: token, kind: opts?.kind,
      createdAt: now(), updatedAt: now(), messageCount: 0, titleResolved: true,
    }
    cache.current.set(id, [])
    activeIdRef.current = id
    setMessagesState([])
    const prev = indexRef.current
    const byAppToken = token ? { ...prev.byAppToken, [token]: id } : prev.byAppToken
    const generalId = token ? prev.generalId : id
    persistCapped({ ...prev, sessions: [meta, ...prev.sessions], byAppToken, generalId, activeId: id }, id)
  }, [persistCapped, activeAppToken])

  const removeSession = useCallback((id: string) => {
    const { idx, activeId } = removeSessionPure(indexRef.current, id, uid)
    if (idx === indexRef.current) return // nothing removed
    persistIndex(idx)
    const t = flushTimers.current.get(id)
    if (t) { clearTimeout(t); flushTimers.current.delete(id) } // don't let a pending flush re-create the deleted blob
    cache.current.delete(id)
    void store.removeMessages(id)
    if (activeId) void loadInto(activeId)
  }, [persistIndex, loadInto])

  // Document-level delete: drop every session under one appToken (null = the general
  // group). Mirrors removeSession's cleanup per id, then loads the fallback active session.
  const removeSessionsByAppToken = useCallback((appToken: string | null) => {
    const { idx, activeId, removed } = removeSessionsByAppTokenPure(indexRef.current, appToken, uid)
    if (idx === indexRef.current) return // nothing removed
    persistIndex(idx)
    for (const id of removed) {
      const t = flushTimers.current.get(id)
      if (t) { clearTimeout(t); flushTimers.current.delete(id) }
      cache.current.delete(id)
      void store.removeMessages(id)
    }
    if (activeId) void loadInto(activeId)
  }, [persistIndex, loadInto])

  const renameSession = useCallback((id: string, title: string) => {
    const t = title.trim()
    if (!t) return
    const idx = indexRef.current
    persistIndex({
      ...idx,
      // titleCustom marks a hand-set name — later auto-sync (a doc rename) must not overwrite it.
      sessions: idx.sessions.map((s) => (s.id === id ? { ...s, title: t, titleResolved: true, titleCustom: true } : s)),
    })
  }, [persistIndex])

  const rebindSession = useCallback((sessionId: string, newAppToken: string, title?: string) => {
    const idx = indexRef.current
    const target = idx.sessions.find((s) => s.id === sessionId)
    if (!target) return
    if (target.appToken === newAppToken && (!title || target.titleResolved)) return
    const byAppToken = { ...idx.byAppToken }
    // drop the OLD shortcut only if it still points here (another session may have taken it)
    if (target.appToken && byAppToken[target.appToken] === sessionId) delete byAppToken[target.appToken]
    byAppToken[newAppToken] = sessionId
    const sessions = idx.sessions.map((s) => s.id === sessionId
      ? { ...s, appToken: newAppToken, title: title && !s.titleResolved ? title : s.title }
      : s)
    persistIndex({ ...idx, sessions, byAppToken })
  }, [persistIndex])

  const resolveTitle = useCallback((appToken: string, title: string, kind?: SessionKind) => {
    persistIndex(resolveSessionTitlePure(indexRef.current, appToken, title, kind))
  }, [persistIndex])

  const stampKind = useCallback((appToken: string, kind: SessionKind) => {
    persistIndex(stampKindPure(indexRef.current, appToken, kind))
  }, [persistIndex])

  const setKbEnabled = useCallback((sessionId: string, on: boolean) => {
    const idx = indexRef.current
    persistIndex({
      ...idx,
      sessions: idx.sessions.map((s) => (s.id === sessionId ? { ...s, kbEnabled: on } : s)),
    })
  }, [persistIndex])

  const activeSession = index.sessions.find((s) => s.id === index.activeId) ?? null

  return {
    ready, index, activeSession, messages,
    setMessages, setMessagesFor, switchTo, createSession, removeSession, removeSessionsByAppToken, renameSession, rebindSession, resolveTitle, stampKind, setKbEnabled,
  }
}
