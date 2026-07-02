import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageContext, SessionKind, SessionMeta } from '../../shared/types'
import { cleanDocTitle } from '../../shared/feishu/pageUrl'
import { resolveToken } from '../../shared/feishu/auth'
import * as API from '../../shared/feishu/api'
import { useSessions } from '../sessions/useSessions'
import type { SessionsApi } from '../sessions/useSessions'
import { wikiToFeishu } from './useWikiResolve'

export type AppTab = 'chat' | 'scenes' | 'clip' | 'settings'
export type DocMode = 'follow' | 'pin'
export interface PinnedDoc { token: string; title: string; kind: SessionKind }

/** Build a Feishu resource context for a pinned doc (the agent operates on it by token via
 *  the API even when its tab isn't the focused one). */
function pinnedFeishu(p: PinnedDoc): NonNullable<PageContext['feishu']> {
  if (p.kind === 'base') return { isBase: true, kind: 'base', appToken: p.token }
  if (p.kind === 'sheet') return { isBase: false, kind: 'sheet', spreadsheetToken: p.token }
  if (p.kind === 'wiki') return { isBase: false, kind: 'wiki', wikiToken: p.token }
  // ppt is parsed but not operable as a pinned work doc — fall back to doc.
  return { isBase: false, kind: 'doc', documentId: p.token }
}

interface Args {
  ctx: PageContext
  chatStreaming: boolean
  settings: import('../../shared/types').AppSettings
  wikiCacheRef: React.MutableRefObject<Map<string, NonNullable<PageContext['feishu']>>>
  resolveWikiKind: (wikiToken: string) => Promise<SessionKind | undefined>
  recordRecent: (token: string, title: string, kind: SessionKind) => void
  setTab: (t: AppTab) => void
  /** Set by App for one tick after a new session / follow-switch to suppress the auto-default
   *  yanking the user off chat. Owned by App (the auto-default effect reads it). */
  newSessionPinRef: React.MutableRefObject<boolean>
}

export interface DocBindingApi {
  docMode: DocMode
  pinned: PinnedDoc | null
  sessions: SessionsApi
  chatContext: PageContext
  pendingSwitch: { to: string } | null
  pendingSessionSwitch: SessionMeta | null
  setPendingSessionSwitch: React.Dispatch<React.SetStateAction<SessionMeta | null>>
  handleNewSession: () => void
  handleFollowTabs: () => void
  setWorkDoc: (token: string, title: string, kind: SessionKind) => void
  handleSwitchNew: () => void
  handleSwitchStay: () => void
  /** Pick a history session. Returns true when it switched straight in (same doc / general),
   *  false when it opened the cross-doc confirm dialog (App keeps the drawer open then). */
  handlePickSession: (session: SessionMeta) => boolean
  confirmSessionSwitch: () => Promise<void>
}

/**
 * The working-document state machine + the multi-session manager it drives.
 *
 * `follow` (default): the active session tracks the active tab. `pin`: lock onto one doc so
 * tab switches / "answer just finished" can't jump the conversation away.
 *
 * Owns `useSessions` (the effective resource it computes is what sessions follow), the
 * follow-mode hold effect, pinned-wiki resolution, and the cross-doc switch flow. Kept as one
 * cohesive hook because these are tightly cyclic: effectiveResource feeds useSessions, whose
 * active session feeds the hold effect, which feeds effectiveResource.
 */
export function useDocBinding(a: Args): DocBindingApi {
  const { ctx, chatStreaming, settings, wikiCacheRef, resolveWikiKind, recordRecent, setTab, newSessionPinRef } = a
  const [docMode, setDocMode] = useState<DocMode>('follow')
  const [pinned, setPinned] = useState<PinnedDoc | null>(null)
  const [heldResource, setHeldResource] = useState<string | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<{ to: string } | null>(null)
  const [pendingSessionSwitch, setPendingSessionSwitch] = useState<SessionMeta | null>(null)
  // A pinned wiki-wrapped doc's real type isn't readable from /wiki/{token} — resolve it once
  // so pin mode shows the right context bar + presets. null while resolving / not a wiki.
  const [pinnedResolved, setPinnedResolved] = useState<NonNullable<PageContext['feishu']> | null>(null)

  useEffect(() => {
    chrome.storage.local.get('docBinding_v1', (r) => {
      const b = r.docBinding_v1 as { mode?: DocMode; pinned?: PinnedDoc } | undefined
      if (b?.mode) setDocMode(b.mode)
      if (b?.pinned?.token) setPinned(b.pinned)
    })
  }, [])

  const applyDocBinding = useCallback((mode: DocMode, pin: PinnedDoc | null) => {
    setDocMode(mode); setPinned(pin)
    chrome.storage.local.set({ docBinding_v1: { mode, pinned: pin } })
  }, [])

  // The live tab's resource token, debounced — a tab switch / wiki resolution / remount
  // briefly churns ctx (often through a transient null), which would flip the conversation
  // to the general session and back. Settle first, then switch once.
  const rawResource =
    ctx.feishu?.wikiToken ?? ctx.feishu?.appToken ?? ctx.feishu?.spreadsheetToken ?? ctx.feishu?.documentId ?? ctx.feishu?.slideToken ?? null
  const [liveResource, setLiveResource] = useState<string | null>(rawResource)
  useEffect(() => {
    const t = setTimeout(() => setLiveResource(rawResource), 250)
    return () => clearTimeout(t)
  }, [rawResource])

  // What we tell useSessions: in pin mode the pinned doc; in follow mode the live tab, unless
  // a switch is pending (then hold the session's own resource).
  const effectiveResource =
    docMode === 'pin' ? (pinned?.token ?? liveResource) : (heldResource ?? liveResource)

  const resolvedDocKind: SessionKind | undefined =
    docMode === 'pin' ? (pinnedResolved?.kind ?? pinned?.kind) : ctx.feishu?.kind

  const sessions = useSessions(effectiveResource, chatStreaming, resolvedDocKind)
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions

  // In pin mode the assistant operates on the PINNED doc, not the focused tab — synthesize
  // the agent-facing context.
  const chatContext: PageContext =
    docMode === 'pin' && pinned
      ? pinned.kind === 'wiki'
        ? { url: '', title: pinned.title, selectedText: '', feishu: pinnedResolved ?? { isBase: false, kind: 'wiki', wikiToken: pinned.token } }
        : { url: '', title: pinned.title, selectedText: '', feishu: pinnedFeishu(pinned) }
      : ctx

  // follow mode: HOLD the session on its current doc when the live tab differs, so the
  // auto-switch can't yank it back. `justFollowedRef` suppresses the hold for one cycle after
  // an explicit follow-switch — otherwise switching to follow on a tab whose doc differs
  // from the active session loops heldResource↔liveResource (the "title flips between two
  // docs" oscillation); with the suppress, follow mode follows the live tab as intended.
  const prevLiveRef = useRef<string | null>(liveResource)
  const justFollowedRef = useRef(false)
  useEffect(() => {
    if (docMode !== 'follow') { justFollowedRef.current = false; setHeldResource(null); setPendingSwitch(null); prevLiveRef.current = liveResource; return }
    if (justFollowedRef.current) {
      justFollowedRef.current = false
      setHeldResource(null); setPendingSwitch(null); prevLiveRef.current = liveResource; return
    }
    const sess = sessionsRef.current
    const sessionTok = sess.activeSession?.appToken ?? null
    const liveChanged = liveResource !== prevLiveRef.current
    prevLiveRef.current = liveResource
    if (!sessionTok || liveResource === sessionTok) { setHeldResource(null); setPendingSwitch(null); return }
    if (liveChanged && sess.messages.length === 0) { setHeldResource(null); setPendingSwitch(null); return }
    setHeldResource(sessionTok)
    if (!liveChanged || !liveResource || chatStreaming) { setPendingSwitch(null); return }
    setPendingSwitch({ to: liveResource })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveResource, docMode, chatStreaming, sessions.activeSession?.appToken])

  // Pin mode: resolve a pinned wiki node to its real resource. Reuses the shared cache.
  useEffect(() => {
    if (docMode !== 'pin' || !pinned || pinned.kind !== 'wiki') { setPinnedResolved(null); return }
    const wikiToken = pinned.token
    const cached = wikiCacheRef.current.get(wikiToken)
    if (cached) { setPinnedResolved(cached); return }
    let cancelled = false
    setPinnedResolved(null)
    void (async () => {
      try {
        const res = (await API.getWikiNode(await resolveToken(settings), wikiToken)) as {
          node?: { obj_type: string; obj_token: string; title?: string }
        }
        const n = res.node
        if (!n || cancelled) return
        const resolved = wikiToFeishu(n.obj_type, n.obj_token)
        if (!resolved || cancelled) return
        const withWiki = { ...resolved, wikiToken }
        wikiCacheRef.current.set(wikiToken, withWiki)
        if (!cancelled) setPinnedResolved(withWiki)
      } catch { /* leave as unresolved wiki — opening the tab (follow mode) will resolve it */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docMode, pinned?.kind, pinned?.token, settings.feishuAccessToken])

  const setWorkDoc = useCallback((token: string, title: string, kind: SessionKind) => {
    applyDocBinding('pin', { token, title, kind })
    setHeldResource(null); setPendingSwitch(null)
    recordRecent(token, title, kind)
  }, [applyDocBinding, recordRecent])

  const handleFollowTabs = useCallback(() => {
    applyDocBinding('follow', null)
    setHeldResource(null); setPendingSwitch(null)
    newSessionPinRef.current = true
    // Only relevant when transitioning pin→follow: suppress the hold for one cycle so follow
    // mode follows the LIVE tab, not the previously-pinned session's doc (which caused the
    // "title flips between two docs" oscillation).
    if (docMode === 'pin') justFollowedRef.current = true
  }, [applyDocBinding, newSessionPinRef, docMode])

  const handleNewSession = useCallback(() => {
    if (chatStreaming) return
    const kind: SessionKind | undefined = docMode === 'pin' ? pinned?.kind : ctx.feishu?.kind
    sessions.createSession({ kind })
    setTab('chat')
    newSessionPinRef.current = true
  }, [chatStreaming, sessions, docMode, pinned?.kind, ctx.feishu?.kind, setTab, newSessionPinRef])

  // Switch-doc popup (follow mode). 「新建会话」opens a fresh session for the new doc;
  // 「在当前会话继续」re-binds the active session to it, keeping the thread.
  function handleSwitchNew() {
    const to = pendingSwitch?.to ?? liveResource
    const title = cleanDocTitle(ctx.title) || undefined
    setHeldResource(null); setPendingSwitch(null)
    if (to) sessions.createSession({ appToken: to, title, kind: ctx.feishu?.kind })
  }
  function handleSwitchStay() {
    const to = pendingSwitch?.to ?? liveResource
    const sid = sessions.activeSession?.id
    const title = cleanDocTitle(ctx.title) || undefined
    setHeldResource(null); setPendingSwitch(null)
    if (to && sid) sessions.rebindSession(sid, to, title)
  }

  // History-drawer session pick.
  const switchSession = sessions.switchTo
  const handlePickSession = useCallback((session: SessionMeta): boolean => {
    // rawResource (not the debounced liveResource) so a pick right after a tab switch reads
    // the current doc, not the 250ms-stale one.
    const workToken = docMode === 'pin' ? (pinned?.token ?? null) : rawResource
    if (!session.appToken || session.appToken === workToken) {
      switchSession(session.id)
      return true // switched straight in — App closes the drawer
    }
    setPendingSessionSwitch(session)
    return false // cross-doc → App keeps the drawer open, shows the confirm dialog
  }, [docMode, pinned?.token, rawResource, switchSession])

  const confirmSessionSwitch = useCallback(async () => {
    const s = pendingSessionSwitch
    setPendingSessionSwitch(null)
    if (!s?.appToken) return
    // A wikiToken must pin as 'wiki' (so pinnedFeishu resolves it). A session upgraded by
    // stampKind keeps kind=doc/sheet/base while its appToken is still a wikiToken — detect
    // via the cache, else (truly-unknown legacy session) resolve to tell wiki from direct.
    const cached = wikiCacheRef.current.get(s.appToken)
    let pinKind: SessionKind
    if (cached || s.kind === 'wiki') pinKind = 'wiki'
    else if (s.kind) pinKind = s.kind
    else {
      const real = await resolveWikiKind(s.appToken)
      pinKind = real ? 'wiki' : 'doc'
    }
    switchSession(s.id)
    setWorkDoc(s.appToken, s.title, pinKind)
  }, [pendingSessionSwitch, switchSession, setWorkDoc, resolveWikiKind, wikiCacheRef])

  return {
    docMode, pinned, sessions, chatContext,
    pendingSwitch, pendingSessionSwitch, setPendingSessionSwitch,
    handleNewSession, handleFollowTabs, setWorkDoc, handleSwitchNew, handleSwitchStay,
    handlePickSession, confirmSessionSwitch,
  }
}
