import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PageContext, SessionKind, SessionMeta, DocSelectionPayload } from '@/shared/types'
import { cleanDocTitle } from '@/shared/feishu/pageUrl'
import { resolveToken } from '@/shared/feishu/auth'
import * as API from '@/shared/feishu/api'
import { getDocumentMeta } from '@/shared/feishu/docx'
import { getSpreadsheet } from '@/shared/feishu/sheets'
import { useSessions } from '../sessions/useSessions'
import type { SessionsApi } from '../sessions/useSessions'
import { wikiToFeishu } from './useWikiResolve'

export type AppTab = 'chat' | 'scenes' | 'news' | 'settings'
export type DocMode = 'follow' | 'pin'
export interface PinnedDoc { token: string; title: string; kind: SessionKind }

/** A doc selection that arrived while the work doc differs — drives the selection-variant
 *  SwitchDocDialog. docToken is already wiki-resolved (→ underlying doc). */
export interface SelectionSwitch {
  docToken: string
  docTitle: string
  payload: DocSelectionPayload
}

/** Build a Feishu resource context for a pinned doc (the agent operates on it by token via
 *  the API even when its tab isn't the focused one). */
function pinnedFeishu(p: PinnedDoc): NonNullable<PageContext['feishu']> {
  if (p.kind === 'base') return { isBase: true, kind: 'base', appToken: p.token }
  if (p.kind === 'sheet') return { isBase: false, kind: 'sheet', spreadsheetToken: p.token }
  if (p.kind === 'wiki') return { isBase: false, kind: 'wiki', wikiToken: p.token }
  // ppt is parsed but not operable as a pinned work doc — fall back to doc.
  return { isBase: false, kind: 'doc', documentId: p.token }
}

/** Build a Feishu resource context for a session's bound doc — used when the live tab isn't
 *  that doc (e.g. the user switched to a non-doc page while the session is held on it).
 *  Prefers the shared wiki cache so a wiki-wrapped doc resolves to its real kind/token. */
function sessionFeishu(
  token: string,
  kind: SessionKind | undefined,
  wikiCache: Map<string, NonNullable<PageContext['feishu']>>,
): NonNullable<PageContext['feishu']> {
  const cached = wikiCache.get(token)
  if (cached) return cached
  if (kind === 'base') return { isBase: true, kind: 'base', appToken: token }
  if (kind === 'sheet') return { isBase: false, kind: 'sheet', spreadsheetToken: token }
  if (kind === 'ppt') return { isBase: false, kind: 'ppt', slideToken: token }
  if (kind === 'doc') return { isBase: false, kind: 'doc', documentId: token }
  // wiki, or a legacy session with no kind — treat the token as a wiki node.
  return { isBase: false, kind: 'wiki', wikiToken: token }
}

interface Args {
  ctx: PageContext
  chatStreaming: boolean
  settings: import('@/shared/types').AppSettings
  wikiCacheRef: React.MutableRefObject<Map<string, NonNullable<PageContext['feishu']>>>
  resolveWikiKind: (wikiToken: string) => Promise<SessionKind | undefined>
  recordRecent: (token: string, title: string, kind: SessionKind) => void
  /** Drop a recent entry whose underlying resource no longer exists. */
  removeFromRecent: (token: string) => void
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
  pendingSelectionSwitch: SelectionSwitch | null
  triggerSwitchForSelection: (s: SelectionSwitch) => void
  /** 「切换工作文档」— pin the work doc to the selection's doc (not a new session). */
  handleSelectionSwitchConfirm: () => void
  handleSelectionSwitchCancel: () => void
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
  const { ctx, chatStreaming, settings, wikiCacheRef, resolveWikiKind, recordRecent, removeFromRecent, setTab, newSessionPinRef } = a
  const [docMode, setDocMode] = useState<DocMode>('follow')
  const [pinned, setPinned] = useState<PinnedDoc | null>(null)
  const [heldResource, setHeldResource] = useState<string | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<{ to: string } | null>(null)
  const [pendingSessionSwitch, setPendingSessionSwitch] = useState<SessionMeta | null>(null)
  const [pendingSelectionSwitch, setPendingSelectionSwitch] = useState<SelectionSwitch | null>(null)
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

  // chatContext drives the ChatPanel workspace (topbar title, Base badge, MessageList kind,
  //  InputBar resourceKind) AND the agent's doc target. It follows the EFFECTIVE
  //  resource — the doc the active session is bound to — not the raw live tab. In follow mode
  //  that's heldResource ?? liveResource: when the user switches to a non-Feishu tab,
  //  liveResource settles to null and heldResource is cleared (hold effect below), so
  //  effectiveResource becomes null → the workspace shows the general session. On a Feishu
  //  doc, effectiveResource is that doc's token → the workspace shows its cached ctx. During
  //  a doc→doc switch the hold keeps effectiveResource on the OLD doc so the workspace stays
  //  put until the SwitchDocDialog confirms the new one. Tracking the effective resource (not
  //  the live tab, which flips immediately on tab switch) is what stops the title/kind/
  //  examples from jittering between the old doc and the general session.
  const seenDocCtxRef = useRef<Map<string, PageContext>>(new Map())
  if (rawResource) {
    // Before caching, if ctx is wiki-typed, substitute the resolved feishu from the shared
    // wikiCacheRef. This ensures the cached ctx always carries the RESOLVED kind (doc/base/
    // sheet) whenever the wiki has been resolved before — preventing the wiki→doc kind flicker
    // when useWikiResolve's async setCtx lands. On first visit (wikiCacheRef empty) the ctx is
    // cached as-is (kind=wiki); on every subsequent visit the cache holds the resolved kind
    // from the start, so chatContext returns a stable kind with NO flicker.
    let ctxToCache = ctx
    if (ctx.feishu?.kind === 'wiki' && ctx.feishu.wikiToken) {
      const resolved = wikiCacheRef.current.get(ctx.feishu.wikiToken)
      if (resolved && resolved.kind !== 'wiki') {
        ctxToCache = { ...ctx, feishu: resolved }
      }
    }
    // Only (re)cache when a meaningful field changed — title or any feishu identity token.
    // Reference-only churn is already filtered by the idempotent setCtx wrapper in
    // usePageContext; this gate is a second line of defense.
    const prev = seenDocCtxRef.current.get(rawResource)
    if (!prev
        || prev.title !== ctxToCache.title
        || prev.feishu?.kind !== ctxToCache.feishu?.kind
        || prev.feishu?.documentId !== ctxToCache.feishu?.documentId
        || prev.feishu?.appToken !== ctxToCache.feishu?.appToken
        || prev.feishu?.spreadsheetToken !== ctxToCache.feishu?.spreadsheetToken
        || prev.feishu?.wikiToken !== ctxToCache.feishu?.wikiToken
        || prev.feishu?.slideToken !== ctxToCache.feishu?.slideToken) {
      seenDocCtxRef.current.set(rawResource, ctxToCache)
    }
  }
  // Stable fallback for the "no effective resource" branch. During a tab switch, ctx thrashes
  // (onActivated → onUpdated loading → complete → async title API), and using ctx directly
  // here made the topbar title/identity flicker. Keep the LAST effectiveResource's context
  // until liveResource (debounced) confirms the tab really left Feishu — only then fall back
  // to the general-session context. This breaks the ctx→chatContext jitter path.
  const lastStableCtxRef = useRef<PageContext | null>(null)
  if (effectiveResource) {
    const stable = seenDocCtxRef.current.get(effectiveResource)
    if (stable) lastStableCtxRef.current = stable
  }
  // When the debounced liveResource confirms the tab really left Feishu (stayed null),
  // drop the stale stable ctx so the topbar falls through to the general-session context.
  useEffect(() => {
    if (liveResource === null) lastStableCtxRef.current = null
  }, [liveResource])
  // Memoize chatContext so the downstream ChatPanel/docTitle don't re-render on every ctx
  // mutation (title API callback, onUpdated re-fire, etc.) when the effective resource and
  // its cached context haven't actually changed. Keyed on primitive identity fields.
  const ctxTitle = ctx.title
  const ctxFeishuKind = ctx.feishu?.kind
  const ctxFeishuToken = ctx.feishu?.kind === 'doc' ? ctx.feishu.documentId
    : ctx.feishu?.kind === 'sheet' ? ctx.feishu.spreadsheetToken
    : ctx.feishu?.kind === 'base' ? ctx.feishu.appToken
    : ctx.feishu?.kind === 'wiki' ? ctx.feishu.wikiToken
    : ctx.feishu?.kind === 'ppt' ? ctx.feishu.slideToken
    : undefined
  const chatContext: PageContext = useMemo(() => {
    if (docMode === 'pin' && pinned) {
      if (pinned.kind === 'wiki') {
        return { url: '', title: pinned.title, selectedText: '', feishu: pinnedResolved ?? { isBase: false, kind: 'wiki', wikiToken: pinned.token } }
      }
      return { url: '', title: pinned.title, selectedText: '', feishu: pinnedFeishu(pinned) }
    }
    if (effectiveResource) {
      const cached = seenDocCtxRef.current.get(effectiveResource)
      if (cached) return cached
      return {
        url: '', title: sessions.activeSession?.title || '飞书文档', selectedText: '',
        feishu: sessionFeishu(effectiveResource, sessions.activeSession?.kind, wikiCacheRef.current),
      }
    }
    // effectiveResource is null — hold the last stable ctx until liveResource confirms null.
    if (liveResource === null && lastStableCtxRef.current === null) return ctx
    return lastStableCtxRef.current ?? ctx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docMode, pinned, pinnedResolved, effectiveResource, liveResource,
      sessions.activeSession?.title, sessions.activeSession?.kind,
      ctxTitle, ctxFeishuKind, ctxFeishuToken])

  // follow mode: HOLD the session on its current doc when the live tab moves away from it, so
  // the resource-driven auto-switch in useSessions can't yank the conversation away before the
  // user confirms (the SwitchDocDialog asks whether to follow). `justFollowedRef` suppresses
  // the hold for one cycle after an explicit follow-switch (pin→follow) so follow mode follows
  // the LIVE tab instead of holding the previously-pinned session.
  //
  // WHY this is a useLayoutEffect and WHY sessions.activeSession?.appToken is NOT a dep:
  // The hold reads the active session's token (sessionsRef) and writes heldResource →
  // effectiveResource → useSessions' auto-switch effect → the active session's token. That's a
  // feedback loop. An earlier version listed sessions.activeSession?.appToken as a dep, so this
  // effect re-fired every time the auto-switch (which runs AFTER commit) changed it. The
  // one-render lag between effectiveResource and the activeSession.appToken it just produced
  // made the effect read a STALE token and flip heldResource A→null→A…, oscillating
  // effectiveResource between the old and new doc — the topbar title flickered continuously
  // ("来回切换"). Depending only on liveResource/docMode/chatStreaming fires the effect on the
  // real trigger (the tab change) and reads the pre-switch session ONCE, breaking the loop.
  // useLayoutEffect runs before paint AND before useSessions' passive auto-switch, so the held
  // value lands in the same commit — no one-frame flash of the new doc's title either.
  const prevLiveRef = useRef<string | null>(liveResource)
  const justFollowedRef = useRef(false)
  useLayoutEffect(() => {
    if (docMode !== 'follow') { justFollowedRef.current = false; setHeldResource(null); setPendingSwitch(null); prevLiveRef.current = liveResource; return }
    if (justFollowedRef.current) {
      justFollowedRef.current = false
      setHeldResource(null); setPendingSwitch(null); prevLiveRef.current = liveResource; return
    }
    // Non-Feishu tab (liveResource is null after the debounce): don't hold the session on its
    // doc — let effectiveResource fall to null so the workspace switches to the general session
    // (the user's expectation: a non-doc tab means "back to general").
    if (!liveResource) { setHeldResource(null); setPendingSwitch(null); prevLiveRef.current = liveResource; return }
    const sess = sessionsRef.current
    const sessionTok = sess.activeSession?.appToken ?? null
    const liveChanged = liveResource !== prevLiveRef.current
    prevLiveRef.current = liveResource
    if (!sessionTok || liveResource === sessionTok) { setHeldResource(null); setPendingSwitch(null); return }
    if (liveChanged && sess.messages.length === 0) { setHeldResource(null); setPendingSwitch(null); return }
    setHeldResource(sessionTok)
    if (!liveChanged || chatStreaming) { setPendingSwitch(null); return }
    setPendingSwitch({ to: liveResource })
  }, [liveResource, docMode, chatStreaming])

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
    // Validate the resource still exists before binding — a deleted doc's stale entry in the
    // recent list would otherwise pin a dead token the agent can't operate on. On "gone"
    // (404/revoked) prune the entry and bail; transient errors fall through optimistically.
    void (async () => {
      try {
        const userToken = await resolveToken(settings).catch(() => undefined)
        if (!userToken) { applyAndRecord(); return }
        if (kind === 'doc') await getDocumentMeta(userToken, token)
        else if (kind === 'sheet') await getSpreadsheet(userToken, token)
        else if (kind === 'base') await API.getApp(userToken, token)
        else if (kind === 'wiki') await API.getWikiNode(userToken, token)
        applyAndRecord()
      } catch (err) {
        const code = (err as { code?: number })?.code
        // 1254xxx: not-found / deleted / revoked. Drop the stale entry so the dropdown self-cleans.
        if (typeof code === 'number' && [1254030, 1254040, 1254043, 1254036, 1254046].includes(code)) {
          removeFromRecent(token)
          return
        }
        // Transient (network/auth) — bind optimistically; agent will surface the error if real.
        applyAndRecord()
      }
    })()
    function applyAndRecord() {
      applyDocBinding('pin', { token, title, kind })
      setHeldResource(null); setPendingSwitch(null)
      recordRecent(token, title, kind)
    }
  }, [applyDocBinding, recordRecent, removeFromRecent, settings])

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

  // Selection-driven cross-doc switch (SwitchSessionDialog). 「切换工作文档」pins the work doc
  // to the selection's doc — NOT a new session: if a session for that doc exists useSessions
  // activates it, otherwise it gets a fresh one. App stages the selection chip AFTER this runs
  // (the chip is input-local, session-agnostic).
  function triggerSwitchForSelection(s: SelectionSwitch) { setPendingSelectionSwitch(s) }
  function handleSelectionSwitchConfirm() {
    const s = pendingSelectionSwitch
    setPendingSelectionSwitch(null)
    if (s) setWorkDoc(s.docToken, s.docTitle, 'doc')
  }
  function handleSelectionSwitchCancel() { setPendingSelectionSwitch(null) }

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
    pendingSelectionSwitch, triggerSwitchForSelection,
    handleSelectionSwitchConfirm, handleSelectionSwitchCancel,
    handleNewSession, handleFollowTabs, setWorkDoc, handleSwitchNew, handleSwitchStay,
    handlePickSession, confirmSessionSwitch,
  }
}
