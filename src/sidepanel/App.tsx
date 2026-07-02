import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext, SessionKind } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import { mergeResolvedWiki } from './wikiResolve'

/** Map a resolved wiki node's obj_type to a PageContext.feishu resource. */
function wikiToFeishu(objType: string, objToken: string): PageContext['feishu'] | undefined {
  if (objType === 'bitable') return { isBase: true, kind: 'base', appToken: objToken }
  if (objType === 'sheet') return { isBase: false, kind: 'sheet', spreadsheetToken: objToken }
  if (objType === 'docx' || objType === 'doc') return { isBase: false, kind: 'doc', documentId: objToken }
  return undefined
}

/** Build a Feishu resource context for a pinned doc (the agent operates on it by token via
 *  the API even when its tab isn't the focused one). */
function pinnedFeishu(p: { token: string; kind: string }): NonNullable<PageContext['feishu']> {
  if (p.kind === 'base') return { isBase: true, kind: 'base', appToken: p.token }
  if (p.kind === 'sheet') return { isBase: false, kind: 'sheet', spreadsheetToken: p.token }
  if (p.kind === 'wiki') return { isBase: false, kind: 'wiki', wikiToken: p.token }
  if (p.kind === 'ppt') return { isBase: false, kind: 'ppt', slideToken: p.token }
  return { isBase: false, kind: 'doc', documentId: p.token }
}
import { isFeishuConfigured, resolveToken, isTokenExpiredError, forceRefreshUserToken } from '../shared/feishu/auth'
import * as API from '../shared/feishu/api'
import { getDocumentMeta } from '../shared/feishu/docx'
import { rememberTenantOrigin } from '../shared/feishu/tenant'
import { getSpreadsheet } from '../shared/feishu/sheets'
import { encryptField, decryptField } from '../shared/crypto'
import { checkNetworkAccess } from '../shared/network'
import { BUILD_CONFIG, HAS_NETWORK_RESTRICTION, HAS_BUILTIN_CREDS, CLIP_ENABLED, HAS_ENTERPRISE_POLICY } from '../shared/config'
import { usingManagedLlm } from '../shared/ai/llmConfig'
import { fetchPolicy, loadPolicy, applyPolicy, FAILCLOSED_POLICY } from '../shared/enterprisePolicy'
import { autoRestoreOnceOnEmpty } from './cloudRestore'
import { deriveAccent, DEFAULT_ACCENT, ACCENT_VAR_NAMES } from '../shared/theme'
import { parseFeishuContext, cleanDocTitle } from '../shared/feishu/pageUrl'
import type { ClipCapture } from '../shared/clip/types'
import { fileToClip } from '../shared/clip/file'
import ChatPanel from './components/ChatPanel'
import ClipPanel from './components/ClipPanel'
import Settings from './components/Settings'
import NetworkBlocked from './components/NetworkBlocked'
import ScenarioPanel from './components/ScenarioPanel'
import DemoPanel from './components/DemoPanel'
import SessionDrawer from './components/SessionDrawer'
import SwitchDocDialog from './components/SwitchDocDialog'
import NavRail from './components/NavRail'
import { useSessions } from './sessions/useSessions'
import './App.css'

type Tab = 'chat' | 'scenes' | 'clip' | 'settings'

type NetworkState = 'checking' | 'allowed' | 'blocked'

// Inline info icon for the setup/warning banners — replaces the old "<span>!</span>" text
// placeholder, keeping banners on the app's inline-SVG icon style (no emoji / text-as-icon).
function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [showDemo, setShowDemo] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('fa-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.rev = '9f4b7e2a'
    try { localStorage.setItem('fa-theme', theme) } catch { /* ignore */ }
  }, [theme])
  const [accent, setAccent] = useState<string>(() => {
    try { return localStorage.getItem('fa-accent') || DEFAULT_ACCENT } catch { return DEFAULT_ACCENT }
  })
  useEffect(() => {
    const root = document.documentElement
    if (accent === DEFAULT_ACCENT) {
      // Use the hand-tuned CSS defaults — clear any runtime overrides.
      for (const name of ACCENT_VAR_NAMES) root.style.removeProperty(name)
    } else {
      const vars = deriveAccent(accent, theme === 'dark')
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
    }
    try { localStorage.setItem('fa-accent', accent) } catch { /* ignore */ }
  }, [accent, theme])
  const [ctx, setCtx] = useState<PageContext>({ url: '', title: '', selectedText: '' })
  const [tab, setTab] = useState<Tab>('chat')
  // Read the live tab inside the auto-switch effect WITHOUT re-triggering it (no dep) — so the
  // effect can respect that the user is currently on 场景 and not yank them back to 对话.
  const tabRef = useRef(tab); tabRef.current = tab
  // Web Clipper: a capture (or a capture error) pushed from the background → opens the
  // clip view. Null clip + null error = no active clip.
  const [clip, setClip] = useState<ClipCapture | null>(null)
  const [clipError, setClipError] = useState<string | null>(null)
  // Drag-to-import: a file dropped on the panel is parsed locally into the same clip flow.
  const [dragging, setDragging] = useState(false)

  function onFileDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    fileToClip(file)
      .then((c) => { setClipError(null); setClip(c); setTab('clip') })
      .catch((err) => { setClip(null); setClipError(err instanceof Error ? err.message : String(err)); setTab('clip') })
  }
  function onDragOver(e: React.DragEvent) {
    if (!CLIP_ENABLED) return
    if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setDragging(true) }
  }
  const [chatStreaming, setChatStreaming] = useState(false)
  // A template build is in-flight in ScenarioPanel — freeze nav that would unmount it mid-build
  // (always cleared because runTemplate always settles, even if the panel unmounted meanwhile).
  const [scenarioBusy, setScenarioBusy] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Bind the session to whichever Feishu resource is open (Base / Sheet / Doc). A wiki
  // node counts as its own resource until it resolves, so switching to a wiki doc doesn't
  // momentarily fall back to the general session.
  // Prefer wikiToken when present so a wiki-opened resource keeps ONE stable session key
  // across resolution — wiki→doc/base no longer flips the key and abandons the conversation
  // in a new empty session (the "会话没有了" after switching back).
  const rawResource =
    ctx.feishu?.wikiToken ?? ctx.feishu?.appToken ?? ctx.feishu?.spreadsheetToken ?? ctx.feishu?.documentId ?? ctx.feishu?.slideToken ?? null
  // Debounce it: a tab switch / wiki resolution / panel remount briefly churns the context
  // (often through a transient null), which otherwise flips the conversation to the general
  // session and back — looking "scrambled". Settle first, then switch sessions once.
  const [liveResource, setLiveResource] = useState<string | null>(rawResource)
  useEffect(() => {
    const t = setTimeout(() => setLiveResource(rawResource), 250)
    return () => clearTimeout(t)
  }, [rawResource])

  // ── Working-document binding ───────────────────────────────────────────────
  // `follow` (default): the active session tracks the active tab. `pin`: lock onto one doc
  // so neither tab switches nor "answer just finished" can jump the conversation away — the
  // root cause of the task-2 "回答时跳到新会话" bug (the session auto-switched to whatever
  // tab was focused when streaming ended). Persisted under `docBinding_v1`.
  const [docMode, setDocMode] = useState<'follow' | 'pin'>('follow')
  const [pinned, setPinned] = useState<{ token: string; title: string; kind: string } | null>(null)
  // While a follow-mode tab switch is pending a user decision, hold the session on its
  // current resource (don't auto-switch) until they pick new-session vs continue.
  const [heldResource, setHeldResource] = useState<string | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<{ to: string } | null>(null)

  useEffect(() => {
    chrome.storage.local.get('docBinding_v1', (r) => {
      const b = r.docBinding_v1 as
        | { mode?: 'follow' | 'pin'; pinned?: { token: string; title: string; kind: string } }
        | undefined
      if (b?.mode) setDocMode(b.mode)
      if (b?.pinned?.token) setPinned(b.pinned)
    })
  }, [])
  const applyDocBinding = useCallback(
    (mode: 'follow' | 'pin', pin: { token: string; title: string; kind: string } | null) => {
      setDocMode(mode); setPinned(pin)
      chrome.storage.local.set({ docBinding_v1: { mode, pinned: pin } })
    },
    [],
  )

  // What we tell useSessions: in pin mode the pinned doc; in follow mode the live tab,
  // unless a switch is pending (then hold the session's own resource).
  const effectiveResource =
    docMode === 'pin' ? (pinned?.token ?? liveResource) : (heldResource ?? liveResource)

  const sessions = useSessions(effectiveResource, chatStreaming)
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions

  // follow mode: when the active tab drifts to a DIFFERENT doc than the active session is
  // bound to, HOLD the session and prompt instead of silently jumping. The hold must apply
  // EVEN while streaming — otherwise the moment streaming ends, useSessions' auto-switch
  // fires on the new tab before this effect re-runs to hold it (the task-2 jump). The prompt
  // itself is deferred until the reply finishes. Empty sessions follow silently; switching
  // back to the session's own doc clears the hold (popup auto-dismiss).
  useEffect(() => {
    if (docMode !== 'follow') { setHeldResource(null); setPendingSwitch(null); return }
    const sess = sessionsRef.current
    const sessionTok = sess.activeSession?.appToken ?? null
    if (!sessionTok || liveResource === sessionTok) {
      setHeldResource(null); setPendingSwitch(null); return
    }
    if (sess.messages.length === 0) { setHeldResource(null); setPendingSwitch(null); return }
    setHeldResource(sessionTok)
    // Off a Feishu page, or mid-reply → hold silently, don't prompt yet.
    if (!liveResource || chatStreaming) { setPendingSwitch(null); return }
    setPendingSwitch({ to: liveResource })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveResource, docMode, chatStreaming])
  const [network, setNetwork] = useState<NetworkState>(HAS_NETWORK_RESTRICTION ? 'checking' : 'allowed')
  const [blockedIPs, setBlockedIPs] = useState<string[]>([])

  // Suppress the auto-default effect for one tick after the user explicitly starts a new
  // session OR switches the doc-binding mode — both can flip effectiveResource to a tab
  // whose session is empty on a non-supported page, which the auto-default would otherwise
  // read as "leave chat for 场景". The user acted deliberately; don't yank them off chat.
  const newSessionPinRef = useRef(false)

  // Start a fresh chat session from the header button. createSession() already
  // clears messages, switches the active id, and persists — no extra cleanup
  // needed here. Guarded against streaming to avoid cross-session writes.
  const handleNewSession = useCallback(() => {
    if (chatStreaming) return
    // createSession binds to effectiveResource — in pin mode that's the pinned doc, so a new
    // session stays in that doc ("若固定工作文档，新建会话也是在该文档中工作").
    const kind: SessionKind | undefined = docMode === 'pin' ? (pinned?.kind as SessionKind | undefined) : ctx.feishu?.kind
    sessions.createSession({ kind })
    setTab('chat')
    newSessionPinRef.current = true
  }, [chatStreaming, sessions, docMode, pinned, ctx.feishu?.kind])

  // In pin mode the assistant must operate on the PINNED doc, not the focused tab — synthesize
  // the agent-facing context. Live `ctx` (selected text etc.) isn't available for a doc whose
  // tab isn't open; the agent still reaches it by token via the API.
  const chatContext: PageContext =
    docMode === 'pin' && pinned
      ? { url: '', title: pinned.title, selectedText: '', feishu: pinnedFeishu(pinned) }
      : ctx

  const handlePickDoc = useCallback((token: string, title: string, kind: string) => {
    applyDocBinding('pin', { token, title, kind })
    setHeldResource(null); setPendingSwitch(null)
  }, [applyDocBinding])
  const handleFollowTabs = useCallback(() => {
    applyDocBinding('follow', null)
    setHeldResource(null); setPendingSwitch(null)
    // Switching to follow can land on a non-Feishu tab (effectiveResource → null → empty
    // session → pageSupported=false); the auto-default would then jump to 场景. The user
    // picked follow deliberately — suppress that yank for one tick (same guard as new-session).
    newSessionPinRef.current = true
  }, [applyDocBinding])

  // Switch-doc popup (follow mode). 「新建会话」opens a fresh session for the new doc;
  // 「在当前会话继续」re-binds the active session to it, keeping the thread. Cancel/Esc/overlay
  // = continue (the tab is already on the new doc, so keeping the thread is the safe default).
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

  // Resolve a wiki node to its real resource (doc / sheet / base). Cached per token.
  // Needs the app's wiki scope; without it the page stays a generic "知识库".
  const wikiCacheRef = useRef<Map<string, NonNullable<PageContext['feishu']>>>(new Map())
  // Real titles of direct /docx/ pages, fetched via API (the SPA's document.title is unreliable
  // on some private/on-prem deploys — it can even be the raw URL). Cached per documentId.
  const docTitleCacheRef = useRef<Map<string, string>>(new Map())
  // True when a Feishu call failed because the user session is expired AND can't be refreshed
  // (the refresh_token is dead → needs manual re-auth). Drives the "登录已失效" banner so the
  // user isn't left staring at a misleading "正在解析知识库…" / "请先打开表格" hint.
  const [authExpired, setAuthExpired] = useState(false)
  // Re-authorizing (new token saved) clears the expired state.
  useEffect(() => { setAuthExpired(false) }, [settings.feishuAccessToken])

  // Enterprise cloud backup: on a fresh/cleared/reinstalled device (local empty), pull the user's
  // own saved artifacts back from the company cloud — ONCE per install. Total no-op off proxy.
  // Re-runs when auth becomes available (token/open_id change): on a fresh device the user authorizes
  // AFTER first mount, so a bare [] dep would miss the restore window. autoRestoreOnceOnEmpty is
  // idempotent (own once-flag; bails without setting it when no token yet), so re-firing is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void autoRestoreOnceOnEmpty() }, [settings.feishuAccessToken, settings.feishuOwnerOpenId])

  // Set context, but if it's an already-resolved wiki, substitute the cached real
  // resource — so refreshCtx (tab events) doesn't keep flipping wiki↔doc, which
  // would thrash the bound session and mix conversations up.
  const applyCtx = useCallback((next: PageContext) => {
    let feishu = next.feishu
    if (feishu?.kind === 'wiki' && feishu.wikiToken) {
      const cached = wikiCacheRef.current.get(feishu.wikiToken)
      if (cached) feishu = cached
    }
    setCtx({ ...next, feishu })
  }, [])

  const wikiToken = ctx.feishu?.kind === 'wiki' ? ctx.feishu.wikiToken : undefined
  useEffect(() => {
    if (!wikiToken) return
    const cached = wikiCacheRef.current.get(wikiToken)
    if (cached) { setCtx((c) => ({ ...c, feishu: cached })); return }
    let cancelled = false
    void (async () => {
      // Resolve the wiki node with a given token; throws on a Feishu error (expiry/scope/…).
      const resolveWith = async (token: string): Promise<void> => {
        const res = (await API.getWikiNode(token, wikiToken)) as {
          node?: { obj_type: string; obj_token: string; title?: string }
        }
        const n = res.node
        if (!n || cancelled) return
        const resolved = wikiToFeishu(n.obj_type, n.obj_token)
        if (!resolved) {
          // Unsupported wiki obj (mindnote / file / …) — drop to the general homepage.
          wikiCacheRef.current.set(wikiToken, { isBase: false })
          // Stale-guard: only apply if still on this wiki node (user may have moved on).
          setCtx((c) => mergeResolvedWiki(c, wikiToken, undefined))
          return
        }
        // Keep wikiToken on the resolved resource → the session key stays the stable wikiToken.
        const withWiki = { ...resolved, wikiToken }
        wikiCacheRef.current.set(wikiToken, withWiki)
        setCtx((c) => mergeResolvedWiki(c, wikiToken, withWiki, n.title))
      }
      try {
        await resolveWith(await resolveToken(settings))
        if (!cancelled) setAuthExpired(false)
      } catch (e) {
        // Expired session is the common cause of a "stuck on 知识库" page. Try a forced refresh
        // once; if the refresh_token is also dead, raise the "登录已失效" banner instead of
        // silently leaving it unresolved (which read as a misleading "请先打开表格").
        if (isTokenExpiredError(e)) {
          const fresh = await forceRefreshUserToken().catch(() => null)
          if (fresh) {
            try { await resolveWith(fresh); if (!cancelled) setAuthExpired(false); return } catch { /* still bad → expired */ }
          }
          if (!cancelled) setAuthExpired(true)
        }
        // Other errors (e.g. missing wiki scope) → leave as 知识库, unresolved (prior behavior).
      }
    })()
    return () => { cancelled = true }
  }, [wikiToken, settings])

  // Direct /docx/ pages (no wiki): fetch the REAL doc title via API and use it as the name —
  // mirrors how Base pages resolve appName. Without this, the doc name falls back to the SPA's
  // document.title, which on some private/on-prem deploys is the raw URL (the "name = full URL"
  // bug). Wiki-resolved docs already get their title from getWikiNode, so skip those.
  const docId = ctx.feishu?.kind === 'doc' && !ctx.feishu.wikiToken ? ctx.feishu.documentId : undefined
  useEffect(() => {
    if (!docId) return
    const cached = docTitleCacheRef.current.get(docId)
    const applyTitle = (t: string) => setCtx((c) =>
      c.feishu?.kind === 'doc' && c.feishu.documentId === docId ? { ...c, title: t } : c)
    if (cached) { applyTitle(cached); return }
    let cancelled = false
    void (async () => {
      try {
        const meta = await getDocumentMeta(await resolveToken(settings), docId)
        const t = meta?.document?.title?.trim()
        if (t && !cancelled) { docTitleCacheRef.current.set(docId, t); applyTitle(t) }
      } catch { /* keep document.title fallback */ }
    })()
    return () => { cancelled = true }
  }, [docId, settings])

  // Spreadsheet pages: fetch the real title via API too (same reason as docx — the SPA
  // document.title is unreliable on private/on-prem deploys). Cached under a 'sheet:' key.
  const sheetToken = ctx.feishu?.kind === 'sheet' ? ctx.feishu.spreadsheetToken : undefined
  useEffect(() => {
    if (!sheetToken) return
    const cacheKey = 'sheet:' + sheetToken
    const cached = docTitleCacheRef.current.get(cacheKey)
    const applyTitle = (t: string) => setCtx((c) =>
      c.feishu?.kind === 'sheet' && c.feishu.spreadsheetToken === sheetToken ? { ...c, title: t } : c)
    if (cached) { applyTitle(cached); return }
    let cancelled = false
    void (async () => {
      try {
        const meta = (await getSpreadsheet(await resolveToken(settings), sheetToken)) as { spreadsheet?: { title?: string } }
        const t = meta?.spreadsheet?.title?.trim()
        if (t && !cancelled) { docTitleCacheRef.current.set(cacheKey, t); applyTitle(t) }
      } catch { /* keep document.title fallback */ }
    })()
    return () => { cancelled = true }
  }, [sheetToken, settings])

  // Belt-and-suspenders: persist the TENANT origin whenever the side panel sees a Feishu page
  // (the content script does this too, but it may not have run yet for a freshly-reloaded build).
  // rememberTenantOrigin only stores REAL tenant subdomains — never the bare base domain.
  useEffect(() => { if (ctx.feishu) rememberTenantOrigin(ctx.url) }, [ctx.url, ctx.feishu])

  // Default the view by page type: a supported Feishu resource opens to 对话, an
  // unsupported page opens to 首页 (scenes). This only sets the DEFAULT for a fresh
  // session — it must never yank the user out of an active conversation (e.g. after the
  // agent creates a new doc, page context can flip but the chat must stay).
  const pageSupported = !!ctx.feishu?.kind || (docMode === 'pin' && !!pinned)
  // ctx.url is empty until refreshCtx resolves the active tab. The auto-default below waits
  // for it so first entry doesn't lock in a default off stale "no page yet" state — which
  // raced first-mount straight to 场景 even on a Feishu page (ctx briefly empty → pageSupported
  // false → set 'scenes' → pinned by the 'scenes' guard once the real context arrived).
  const ctxResolved = !!ctx.url
  const hasConversation = sessions.messages.length > 0
  const hasConversationRef = useRef(hasConversation)
  hasConversationRef.current = hasConversation
  useEffect(() => {
    if (!ctxResolved) return             // page context not resolved yet — hold the initial tab ('chat')
    if (clip || clipError) return        // a clip is open — never yank away from it
    if (chatStreaming) return            // don't switch mid-turn (would unmount ChatPanel)
    if (scenarioBusy) return             // don't switch mid-build (would lose the progress screen)
    if (tabRef.current === 'scenes') return // user is in 场景 (e.g. AI建站) — don't pull them to 对话
    if (hasConversationRef.current) return // keep the user in their active conversation
    if (newSessionPinRef.current) { newSessionPinRef.current = false; return } // user just started a new session — stay in chat
    setTab(pageSupported ? 'chat' : 'scenes')
  // hasConversation deliberately excluded from deps — it's a guard, not a trigger.
  // Including it would fire the effect on every session switch, yanking the user to
  // 场景 when switching to an empty session on a non-supported page.
  }, [ctxResolved, pageSupported, chatStreaming, scenarioBusy, clip, clipError])

  // Name Sheet/Doc sessions from the page title — once the session is ready, so it
  // doesn't fire before the session exists (Base sessions name from appName instead).
  const { ready: sessionsReady, resolveTitle } = sessions
  const activeSessionId = sessions.activeSession?.id
  useEffect(() => {
    const fz = ctx.feishu
    const token = fz?.wikiToken ?? fz?.spreadsheetToken ?? fz?.documentId
    if (!token || !ctx.title || !sessionsReady) return
    const name = cleanDocTitle(ctx.title)
    if (name) resolveTitle(token, name, fz?.kind)
  }, [ctx.feishu, ctx.title, sessionsReady, activeSessionId, resolveTitle])

  useEffect(() => {
    // ── Network check ────────────────────────────────────────────────────────
    if (HAS_NETWORK_RESTRICTION) {
      checkNetworkAccess(BUILD_CONFIG.allowedCidrs).then((result) => {
        setBlockedIPs(result.localIPs)
        setNetwork(result.allowed ? 'allowed' : 'blocked')
      })
    }

    // ── Load settings (decrypt sensitive fields) ──────────────────────────
    chrome.storage.local.get(['settings_v2'], async (r) => {
      const stored = r.settings_v2 as Record<string, string> | undefined
      if (!stored) return
      const token = await decryptField(stored.feishuAccessToken ?? '')
      const apiKey = await decryptField(stored.openaiApiKey ?? '')
      const loaded: AppSettings = {
        ...DEFAULT_SETTINGS,
        openaiBaseUrl: stored.openaiBaseUrl ?? DEFAULT_SETTINGS.openaiBaseUrl,
        openaiModel: stored.openaiModel ?? DEFAULT_SETTINGS.openaiModel,
        openaiApiKey: apiKey,
        feishuAccessToken: token,
        feishuOwnerOpenId: stored.feishuOwnerOpenId ?? '',
        templateRegistryUrl: stored.templateRegistryUrl ?? '',
        learnFromHistory: (stored.learnFromHistory as unknown as boolean | undefined) !== false,
        voiceInput: (stored.voiceInput as unknown as boolean | undefined) !== false,
        autoConfirm: (stored.autoConfirm as unknown as boolean | undefined) === true,
        llmSource: (stored.llmSource as AppSettings['llmSource']) ?? undefined,
      }
      // Enterprise central policy (applied over the just-loaded base). FAIL-CLOSED: on a policy build,
      // until the real policy is known (no cache / proxy down) we force the conservative default
      // (no auto-confirm of deletes) — a proxy outage must never loosen the enterprise's controls.
      const eff = (p: Awaited<ReturnType<typeof loadPolicy>>) =>
        applyPolicy(loaded, p ?? (HAS_ENTERPRISE_POLICY ? FAILCLOSED_POLICY : null))
      setSettings(eff(await loadPolicy()))
      void fetchPolicy(loaded).then((fresh) => setSettings(eff(fresh)))
    })

    // ── Tab/context listeners (named so they can be cleaned up — avoids duplicate
    //    registration under React 18 StrictMode's double-invoke in dev). ─────────────
    refreshCtx()
    const onMsg = (
      msg: { type?: string; payload?: unknown; message?: string },
      sender: chrome.runtime.MessageSender,
    ) => {
      if (sender.id !== chrome.runtime.id) return
      // Web Clipper pushes (from the background, for an already-open panel).
      if (msg.type === 'CLIP_CAPTURE') { setClipError(null); setClip(msg.payload as ClipCapture); setTab('clip'); return }
      if (msg.type === 'CLIP_ERROR') { setClip(null); setClipError(msg.message ?? '剪藏失败'); setTab('clip'); return }
      // Trust context updates only from our own content scripts, and ignore pushes from a
      // CONFIRMED-inactive (background) tab — those would scramble the conversation when
      // multiple Feishu tabs are open. The active tab (incl. its field-selection pushes)
      // still gets through. (We don't gate on windowId — chrome.windows.getCurrent() is
      // unreliable in a side panel and was wrongly dropping legit pushes.)
      if (msg.type !== 'PAGE_CONTEXT_UPDATE') return
      if (sender.tab?.active === false) return
      applyCtx(msg.payload as PageContext)
    }
    // Follow tab switches (use the EXACT activated tab id — no ambiguous window query),
    // SPA navigation (info.url), and WINDOW switches (onFocusChanged).
    const onActivated = (info: chrome.tabs.TabActiveInfo) => void refreshCtx(info.tabId)
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (info.status === 'complete' || info.url)) void refreshCtx(id)
    }
    const onFocus = (windowId: number) => { if (windowId !== chrome.windows.WINDOW_ID_NONE) void refreshCtx() }
    chrome.runtime.onMessage.addListener(onMsg)
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.windows?.onFocusChanged?.addListener(onFocus)

    // A clip opens the panel async, so the CLIP_CAPTURE push above can arrive before this
    // listener exists. Pull any pending clip the background stashed (one-shot, recent only).
    if (CLIP_ENABLED) {
      chrome.runtime.sendMessage({ type: 'CLIP_REQUEST' }).then((resp) => {
        const r = resp as { payload?: ClipCapture; error?: string; at?: number } | null
        // Short window: only covers the genuine open→mount race (sub-second). 30s let an
        // already-handled clip (delivered live via the CLIP_CAPTURE push) re-open on a panel
        // remount within the window — a stale replay of a clip the user already dealt with.
        if (!r || (r.at && Date.now() - r.at > 5_000)) return
        if (r.payload) { setClipError(null); setClip(r.payload); setTab('clip') }
        else if (r.error) { setClip(null); setClipError(r.error); setTab('clip') }
      }).catch(() => { /* no background / no pending clip */ })
    }

    return () => {
      chrome.runtime.onMessage.removeListener(onMsg)
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.windows?.onFocusChanged?.removeListener(onFocus)
    }
  }, [])

  async function refreshCtx(tabId?: number) {
    try {
      // Prefer the EXACT tab from the event (onActivated/onUpdated). `currentWindow` is
      // unreliable from a side panel — it can resolve to the wrong window, so a tab switch
      // would read the wrong page and the panel wouldn't follow (and the session would thrash).
      let tab: chrome.tabs.Tab | undefined
      if (tabId != null) tab = await chrome.tabs.get(tabId).catch(() => undefined)
      if (!tab) { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); tab = t }
      if (!tab?.id) return
      try {
        // Preferred: ask the content script (also gives selectedText).
        const resp = (await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' })) as PageContext | undefined
        if (resp) {
          // A stale content script (old build, page not refreshed) may not detect
          // Sheets/Docs. Always (re)derive the resource from the URL so detection
          // doesn't depend on the content script version.
          const url = resp.url || tab.url || ''
          applyCtx({ ...resp, feishu: resp.feishu ?? parseFeishuContext(url) })
          return
        }
      } catch {
        // Content script not injected yet — fall back to parsing the tab URL.
      }
      const url = tab.url ?? ''
      applyCtx({ url, title: tab.title ?? '', selectedText: '', feishu: parseFeishuContext(url) })
    } catch { /* tab without access */ }
  }

  async function saveSettings(s: AppSettings) {
    // Encrypt sensitive fields before persisting
    const [encToken, encApiKey] = await Promise.all([
      encryptField(s.feishuAccessToken),
      encryptField(s.openaiApiKey),
    ])
    chrome.storage.local.set({
      settings_v2: {
        openaiBaseUrl: s.openaiBaseUrl,
        openaiModel: s.openaiModel,
        openaiApiKey: encApiKey,
        feishuAccessToken: encToken,
        // Not sensitive — persist as-is (these were silently dropped before).
        feishuOwnerOpenId: s.feishuOwnerOpenId,
        templateRegistryUrl: s.templateRegistryUrl,
        learnFromHistory: s.learnFromHistory !== false,
        voiceInput: s.voiceInput !== false,
        autoConfirm: s.autoConfirm === true,
        llmSource: s.llmSource, // managed/manual choice must persist (was dropped → switch never stuck)
      },
    })
    setSettings(s)
    setTab('chat')
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (network === 'checking') {
    return (
      <div className="app">
        <div className="app-splash">
          <div className="splash-spinner" />
          <span>检查网络访问权限…</span>
        </div>
      </div>
    )
  }

  if (network === 'blocked') {
    return (
      <div className="app">
        <NetworkBlocked localIPs={blockedIPs} />
      </div>
    )
  }

  // In enterprise managed-LLM mode the key comes from the proxy after Feishu auth (no per-user
  // openaiApiKey); else the user must have entered their own. Both still need Feishu configured.
  const llmReady = usingManagedLlm(settings) ? isFeishuConfigured(settings) : !!settings.openaiApiKey
  const configured = llmReady && isFeishuConfigured(settings)

  // The assistant only operates on Feishu pages. On any other site we show nothing but a
  // hint (and keep the header so Settings stays reachable). null = URL not known yet.
  const onFeishuPage: boolean | null = (() => {
    if (!ctx.url) return null
    try {
      const host = new URL(ctx.url).hostname.toLowerCase()
      const d = BUILD_CONFIG.feishuBaseDomain
      return host === d || host.endsWith('.' + d)
    } catch {
      return false
    }
  })()

  // New Bases are created with the app (tenant) identity → app-owned, so an open_id
  // is required to transfer them to the user before allowing create/operate.
  const needsOwner = HAS_BUILTIN_CREDS
  const ownerConfigured = !!settings.feishuOwnerOpenId?.trim()
  const canOperate = configured && (ownerConfigured || !needsOwner)

  return (
    <div
      className="app"
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onFileDrop}
    >
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <svg className="drop-overlay-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <div>松手导入文件</div>
            <div className="drop-overlay-sub">支持 CSV / TSV / 文本 → AI 整理写入飞书</div>
          </div>
        </div>
      )}
      <div className="app-body">
        <div className="nav-rail-float">
          <NavRail
            aria-label="主导航"
            activeId={tab === 'chat' || tab === 'scenes' || tab === 'settings' ? tab : undefined}
            onSelect={(id) => setTab(id as Tab)}
            items={[
              {
                id: 'chat',
                label: '对话',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
                  </svg>
                ),
                disabled: scenarioBusy,
                disabledReason: '正在创建，请稍候…',
              },
              {
                id: 'scenes',
                label: '场景',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                ),
              },
              {
                id: 'settings',
                label: '设置',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                ),
              },
            ]}
          />
        </div>

        <div className="app-content">
          {!configured && tab !== 'settings' && (
            <button className="setup-banner" onClick={() => setTab('settings')}>
              <InfoIcon />
              <span>请先配置 API 密钥</span>
              <span>→</span>
            </button>
          )}

          {configured && needsOwner && !ownerConfigured && tab !== 'settings' && (
            <button className="setup-banner" onClick={() => setTab('settings')}>
              <InfoIcon />
              <span>请先用飞书账号授权（获取 open_id），否则无法新建/操作内容</span>
              <span>→</span>
            </button>
          )}

          {authExpired && tab !== 'settings' && (
            <button className="setup-banner" onClick={() => setTab('settings')}>
              <InfoIcon />
              <span>飞书登录已失效，请重新登录后再使用</span>
              <span>→</span>
            </button>
          )}

          <main className="app-main">
        <div className="app-view view-enter" key={tab}>
          {tab === 'settings' ? (
            <Settings
              settings={settings}
              accent={accent}
              onAccentChange={setAccent}
              theme={theme}
              onThemeChange={setTheme}
              onSave={saveSettings}
              onCancel={() => setTab('chat')}
            />
          ) : showDemo ? (
            <DemoPanel settings={settings} onBack={() => setShowDemo(false)} />
          ) : tab === 'clip' ? (
            <ClipPanel
              settings={settings}
              clip={clip}
              error={clipError ?? undefined}
              disabled={!canOperate}
              onClose={() => { setClip(null); setClipError(null); setTab(pageSupported ? 'chat' : 'scenes') }}
            />
          ) : onFeishuPage === false && docMode !== 'pin' && !chatStreaming && !hasConversation ? (
            <div className="not-feishu">
              <svg className="not-feishu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="14" y2="17" />
              </svg>
              <div className="not-feishu-title">请在飞书页面使用</div>
              <div className="not-feishu-sub">
                打开飞书多维表格 / 文档 / 电子表格，本助手会自动识别并协助你。
                <br />当前不是飞书页面，已暂停显示。
                {CLIP_ENABLED && <><br /><br />也可以把 <b>CSV / 表格文件</b>拖进来,AI 整理后写入飞书。</>}
              </div>
              <button className="not-feishu-demo" onClick={() => setTab('scenes')} style={{ marginTop: 16 }}>
                前往「场景」— AI 建站 / 数据报告
              </button>
              <button className="not-feishu-demo" onClick={() => setShowDemo(true)} style={{ marginTop: 8 }}>
                体验示例（无需飞书登录）
              </button>
            </div>
          ) : tab === 'chat' ? (
            <ChatPanel
              settings={settings}
              context={chatContext}
              disabled={!canOperate}
              messages={sessions.messages}
              setMessages={sessions.setMessages}
              setMessagesFor={sessions.setMessagesFor}
              activeSessionId={sessions.activeSession?.id}
              onStreamingChange={setChatStreaming}
              onBaseName={(appToken, name) => sessions.resolveTitle(appToken, name, 'base')}
              sessionTitle={docMode === 'pin' && pinned ? pinned.title : sessions.activeSession?.title}
              onOpenSessions={() => setDrawerOpen(true)}
              onNewSession={handleNewSession}
              chatBusy={chatStreaming}
              docMode={docMode}
              docActiveToken={docMode === 'pin' ? pinned?.token ?? null : sessions.activeSession?.appToken ?? null}
              onPickDoc={handlePickDoc}
              onFollowTabs={handleFollowTabs}
            />
          ) : (
            <ScenarioPanel settings={settings} context={ctx} disabled={!canOperate} onBusyChange={setScenarioBusy} />
          )}
        </div>
      </main>

        </div>
      </div>

      {drawerOpen && (
        <SessionDrawer sessions={sessions} busy={chatStreaming} onClose={() => setDrawerOpen(false)} />
      )}

      {pendingSwitch && !chatStreaming && (
        <SwitchDocDialog
          toTitle={cleanDocTitle(ctx.title) || '当前文档'}
          onNew={handleSwitchNew}
          onStay={handleSwitchStay}
          onCancel={handleSwitchStay}
        />
      )}
    </div>
  )
}
