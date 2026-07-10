import { useEffect, useRef, useState } from 'react'
import type { ClipCapture } from '@/shared/clip/types'
import { BUILD_CONFIG, HAS_NETWORK_RESTRICTION, HAS_BUILTIN_CREDS, CLIP_ENABLED } from '@/shared/config'
import { checkNetworkAccess } from '@/shared/network'
import { usingManagedLlm } from '@/shared/ai/llmConfig'
import { isFeishuConfigured, resolveToken } from '@/shared/feishu/auth'
import { rememberTenantOrigin } from '@/shared/feishu/tenant'
import { cleanDocTitle } from '@/shared/feishu/pageUrl'
import { autoRestoreOnceOnEmpty } from './services/cloudRestore'
import type { PageContext, DocSelectionPayload } from '@/shared/types'
import ChatPanel from './components/chat/ChatPanel'
import ClipPanel from './components/scenes/ClipPanel'
import Settings from './components/settings/Settings'
import NewsPanel from './components/news/NewsPanel'
import NetworkBlocked from './components/ui/NetworkBlocked'
import ScenarioPanel from './components/scenes/ScenarioPanel'
import SessionDrawer from './components/session/SessionDrawer'
import SwitchDocDialog from './components/session/SwitchDocDialog'
import SwitchSessionDialog from './components/session/SwitchSessionDialog'
import NavRail from './components/shell/NavRail'
import { getWikiNode } from '@/shared/feishu/api'
import { useThemeAccent } from './hooks/useThemeAccent'
import { useAppSettings } from './hooks/useAppSettings'
import { usePageContext } from './hooks/usePageContext'
import { useWikiResolve, wikiToFeishu } from './hooks/useWikiResolve'
import { useRecentFiles } from './hooks/useRecentFiles'
import { useRecentTitleBackfill } from './hooks/useRecentTitleBackfill'
import { useDocBinding, type AppTab } from './hooks/useDocBinding'
import { decideAutoDefault } from './lib/autoDefault'
import './App.css'
import './Scrollbar.css'

type NetworkState = 'checking' | 'allowed' | 'blocked'

// Inline info icon for the setup/warning banners — keeps banners on the app's inline-SVG
// icon style (no emoji / text-as-icon).
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
  const { theme, setTheme, accent, setAccent } = useThemeAccent()
  const { settings, saveSettings } = useAppSettings()

  // Shared wiki-resolution cache — read by applyCtx (page context) + the wiki/pin resolution
  // effects, written by them. Created here so both hooks share one map.
  const wikiCacheRef = useRef<Map<string, NonNullable<PageContext['feishu']>>>(new Map())

  const { ctx, setCtx, applyCtx } = usePageContext(settings, wikiCacheRef)
  const { resolveWikiKind, authExpired } = useWikiResolve(settings, ctx, setCtx, wikiCacheRef)
  const { recentFiles, ready: recentReady, recordRecent, removeFromRecent } = useRecentFiles(ctx.feishu, ctx.title)
  // Recover real names for recent docs whose title is unknown (closed tab / reloaded mid-load):
  // fetch the name from the Feishu API by token so the dropdown never shows a blank/placeholder row.
  useRecentTitleBackfill({ recentFiles, ready: recentReady, recordRecent, settings })

  const [tab, setTab] = useState<AppTab>('chat')
  // Read the live tab inside the auto-default effect WITHOUT re-triggering it (no dep).
  const tabRef = useRef(tab); tabRef.current = tab

  const [clip, setClip] = useState<ClipCapture | null>(null)
  const [clipError, setClipError] = useState<string | null>(null)

  const [chatStreaming, setChatStreaming] = useState(false)
  const [scenarioBusy, setScenarioBusy] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Suppresses the auto-default yank for one tick after a new session / follow-switch (both
  // can flip the effective resource to an empty session on a non-supported page). Owned here
  // because the auto-default effect (below) reads it; useDocBinding writes it.
  const newSessionPinRef = useRef(false)

  const doc = useDocBinding({
    ctx, chatStreaming, settings, wikiCacheRef, resolveWikiKind, recordRecent, setTab, newSessionPinRef,
  })
  const { sessions, docMode, pinned, chatContext } = doc

  // Working doc's display name + session count for the chat topbar. The topbar shows the
  // DOCUMENT/TABLE name (never the session title); the count badge is how many sessions are
  // bound to this doc token. `activeDocToken` is reused for docActiveToken below (single source).
  const activeDocToken = docMode === 'pin' ? (pinned?.token ?? null) : (sessions.activeSession?.appToken ?? null)
  const docTitle = docMode === 'pin' && pinned
    ? pinned.title
    : chatContext.feishu
      ? (cleanDocTitle(chatContext.title) || '飞书文档')
      : (sessions.activeSession?.title || '新会话')
  const docSessionCount = activeDocToken
    ? sessions.index.sessions.filter((s) => s.appToken === activeDocToken).length
    : 0

  // A doc selection staged from the page (SELECTION_INCOMING) — consumed once by InputBar
  // (via ChatPanel) on the next send.
  const [stagedSelection, setStagedSelection] = useState<DocSelectionPayload | null>(null)

  // Working doc token, with wiki resolved to its underlying doc token first — so a wiki-wrapped
  // doc and the same doc opened directly don't get misjudged as "different docs" (which would
  // pop the cross-doc switch dialog for the same content). Also the gate InputBar uses to scope
  // selection chips to the current doc.
  function workDocResolvedToken(): string | null {
    const t = activeDocToken
    if (!t) return null
    return wikiCacheRef.current.get(t)?.documentId ?? t
  }
  const workDocToken = workDocResolvedToken()

  // wiki node → underlying doc token (mirrors useDocBinding's pinned-wiki resolution: shared
  // cache first, then getWikiNode + wikiToFeishu). Undefined when unresolvable.
  async function resolveWikiToDoc(wikiToken: string): Promise<string | undefined> {
    const cached = wikiCacheRef.current.get(wikiToken)
    if (cached?.documentId) return cached.documentId
    try {
      const token = await resolveToken(settings)
      const res = (await getWikiNode(token, wikiToken)) as { node?: { obj_type: string; obj_token: string } }
      const f = wikiToFeishu(res.node?.obj_type ?? '', res.node?.obj_token ?? '')
      return f?.documentId
    } catch { return undefined }
  }

  // A page selection arrived: resolve wiki → compare to the working doc → stage a chip directly,
  // or (different doc) trigger the selection-variant cross-doc switch dialog.
  async function handleSelectionIncoming(payload: DocSelectionPayload) {
    let docToken = payload.docToken
    let kind = payload.kind
    if (kind === 'wiki') {
      const real = await resolveWikiToDoc(payload.docToken)
      if (real) { docToken = real; kind = 'doc' }
    }
    const resolved: DocSelectionPayload = { ...payload, kind, docToken }
    if (docToken === workDocResolvedToken()) {
      setStagedSelection(resolved)
    } else {
      doc.triggerSwitchForSelection({ docToken, docTitle: payload.docTitle, payload: resolved })
    }
  }

  // Keep the latest handleSelectionIncoming in a ref so the mount-once runtime-message effect
  // (dep [applyCtx], which never re-runs since applyCtx is useCallback([stable wikiCacheRef])) can
  // invoke a FRESH closure every time — otherwise activeDocToken/settings captured at mount go
  // stale after the user switches the working doc, misfiring the cross-doc dialog. Mirrors the
  // contextRef / loadBaseCtxRef / hasConversationRef pattern used elsewhere in this file.
  const handleSelectionIncomingRef = useRef(handleSelectionIncoming)
  handleSelectionIncomingRef.current = handleSelectionIncoming

  // Ensure the pinned work doc is always in the recent list — a pin restored from storage on
  // mount (not via setWorkDoc→recordRecent) wouldn't be recorded otherwise, so it'd be missing
  // from the dropdown even though it's the active work doc.
  useEffect(() => {
    if (!recentReady || !pinned?.token) return
    recordRecent(pinned.token, pinned.title, pinned.kind)
  }, [recentReady, pinned?.token, pinned?.title, pinned?.kind, recordRecent])

  // Enterprise cloud backup: on a fresh/cleared/reinstalled device, pull the user's saved
  // artifacts back from the company cloud — ONCE per install. Re-runs when auth becomes
  // available (the user authorizes after first mount). Idempotent, so re-firing is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void autoRestoreOnceOnEmpty() }, [settings.feishuAccessToken, settings.feishuOwnerOpenId])

  // Belt-and-suspenders: persist the TENANT origin whenever the side panel sees a Feishu page.
  useEffect(() => { if (ctx.feishu) rememberTenantOrigin(ctx.url) }, [ctx.url, ctx.feishu])

  // Name Sheet/Doc sessions from the page title (Base sessions name from appName instead).
  const { ready: sessionsReady, resolveTitle } = sessions
  const activeSessionId = sessions.activeSession?.id
  useEffect(() => {
    const fz = ctx.feishu
    const token = fz?.wikiToken ?? fz?.spreadsheetToken ?? fz?.documentId
    if (!token || !ctx.title || !sessionsReady) return
    const name = cleanDocTitle(ctx.title)
    if (name) resolveTitle(token, name, fz?.kind)
  }, [ctx.feishu, ctx.title, sessionsReady, activeSessionId, resolveTitle])

  const pageSupported = !!ctx.feishu?.kind || (docMode === 'pin' && !!pinned)
  const ctxResolved = !!ctx.url
  const hasConversation = sessions.messages.length > 0
  const hasConversationRef = useRef(hasConversation)
  hasConversationRef.current = hasConversation

  // Default the view by page type ONCE on first context resolution — a supported Feishu
  // resource opens to 对话, an unsupported page to 首页 (scenes). After that one shot the latch
  // holds, so switching documents (which briefly churns the page context and can flip
  // pageSupported) can't yank the user off chat. Never yanks during an active conversation.
  const autoDefaultDoneRef = useRef(false)
  useEffect(() => {
    const d = decideAutoDefault({
      ctxResolved,
      pageSupported,
      hasConversation: hasConversationRef.current,
      currentTab: tabRef.current,
      clip: !!(clip || clipError),
      chatStreaming,
      scenarioBusy,
      newSessionPin: newSessionPinRef.current,
      alreadyDefaulted: autoDefaultDoneRef.current,
    })
    if (d.settled) autoDefaultDoneRef.current = true
    if (d.consumePin) newSessionPinRef.current = false
    if (d.tab) setTab(d.tab)
  }, [ctxResolved, pageSupported, chatStreaming, scenarioBusy, clip, clipError])

  // Network check + background-message routing (clip pushes + content-script context pushes).
  // Tab-follow listeners live in usePageContext; this only routes runtime messages.
  const [network, setNetwork] = useState<NetworkState>(HAS_NETWORK_RESTRICTION ? 'checking' : 'allowed')
  const [blockedIPs, setBlockedIPs] = useState<string[]>([])
  useEffect(() => {
    if (HAS_NETWORK_RESTRICTION) {
      checkNetworkAccess(BUILD_CONFIG.allowedCidrs).then((result) => {
        setBlockedIPs(result.localIPs)
        setNetwork(result.allowed ? 'allowed' : 'blocked')
      })
    }
    const onMsg = (
      msg: { type?: string; payload?: unknown; message?: string },
      sender: chrome.runtime.MessageSender,
    ) => {
      if (sender.id !== chrome.runtime.id) return
      if (msg.type === 'CLIP_CAPTURE') { setClipError(null); setClip(msg.payload as ClipCapture); setTab('clip'); return }
      if (msg.type === 'CLIP_ERROR') { setClip(null); setClipError(msg.message ?? '剪藏失败'); setTab('clip'); return }
      // A page selection landed (content-script button → background relay). Resolve wiki →
      // compare to the working doc → stage a chip or pop the cross-doc switch dialog.
      if (msg.type === 'SELECTION_INCOMING') {
        void handleSelectionIncomingRef.current(msg.payload as DocSelectionPayload)
        return
      }
      // Trust context updates only from our own content scripts, and ignore pushes from a
      // CONFIRMED-inactive (background) tab — those would scramble the conversation when
      // multiple Feishu tabs are open.
      if (msg.type !== 'PAGE_CONTEXT_UPDATE') return
      if (sender.tab?.active === false) return
      applyCtx(msg.payload as PageContext)
    }
    chrome.runtime.onMessage.addListener(onMsg)
    // A clip opens the panel async, so the CLIP_CAPTURE push can arrive before this listener
    // exists. Pull any pending clip the background stashed (one-shot, recent only).
    if (CLIP_ENABLED) {
      chrome.runtime.sendMessage({ type: 'CLIP_REQUEST' }).then((resp) => {
        const r = resp as { payload?: ClipCapture; error?: string; at?: number } | null
        if (!r || (r.at && Date.now() - r.at > 5_000)) return
        if (r.payload) { setClipError(null); setClip(r.payload); setTab('clip') }
        else if (r.error) { setClip(null); setClipError(r.error); setTab('clip') }
      }).catch(() => { /* no background / no pending clip */ })
    }
    // The selection button opens the panel async, so the SELECTION_INCOMING push can arrive
    // before this listener exists. Pull any pending selection the background stashed (one-shot,
    // 3s TTL — see background/index.ts).
    chrome.runtime.sendMessage({ type: 'SELECTION_REQUEST' }).then((resp) => {
      const p = resp as DocSelectionPayload | null
      if (p) void handleSelectionIncomingRef.current(p)
    }).catch(() => { /* no background / no pending selection */ })
    return () => { chrome.runtime.onMessage.removeListener(onMsg) }
  }, [applyCtx])

  async function onSaveSettings(s: typeof settings) {
    await saveSettings(s)
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

  const llmReady = usingManagedLlm(settings) ? isFeishuConfigured(settings) : !!settings.openaiApiKey
  const configured = llmReady && isFeishuConfigured(settings)

  const needsOwner = HAS_BUILTIN_CREDS
  const ownerConfigured = !!settings.feishuOwnerOpenId?.trim()
  const canOperate = configured && (ownerConfigured || !needsOwner)

  return (
    <div
      className="app"
    >
      <div className="app-body">
        <div className="nav-rail-float">
          <NavRail
            aria-label="主导航"
            activeId={tab === 'chat' || tab === 'scenes' || tab === 'news' || tab === 'settings' ? tab : undefined}
            onSelect={(id) => setTab(id as AppTab)}
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
                label: '应用',
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
                id: 'news',
                label: '资讯',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4z" />
                    <path d="M18 8h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" />
                    <line x1="8" y1="8" x2="14" y2="8" />
                    <line x1="8" y1="12" x2="14" y2="12" />
                    <line x1="8" y1="16" x2="12" y2="16" />
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
                  onSave={onSaveSettings}
                  onCancel={() => setTab('chat')}
                />
              ) : tab === 'clip' ? (
                <ClipPanel
                  settings={settings}
                  clip={clip}
                  error={clipError ?? undefined}
                  disabled={!canOperate}
                  onClose={() => { setClip(null); setClipError(null); setTab('chat') }}
                />
              ) : tab === 'news' ? (
                <NewsPanel />
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
                  onBaseName={(appToken, name) => sessions.resolveTitle(ctx.feishu?.wikiToken ?? appToken, name, 'base')}
                  docTitle={docTitle}
                  docSessionCount={docSessionCount}
                  onOpenSessions={() => setDrawerOpen(true)}
                  onNewSession={doc.handleNewSession}
                  chatBusy={chatStreaming}
                  docMode={docMode}
                  docActiveToken={activeDocToken}
                  onPickDoc={doc.setWorkDoc}
                  onFollowTabs={doc.handleFollowTabs}
                  resolveWikiKind={resolveWikiKind}
                  recentFiles={recentFiles}
                  onRemoveRecent={removeFromRecent}
                  stagedSelection={stagedSelection}
                  onStagedConsumed={() => setStagedSelection(null)}
                  workDocToken={workDocToken}
                  kbEnabled={sessions.activeSession?.kbEnabled !== false}
                  onToggleKb={(on: boolean) => {
                    const id = sessions.activeSession?.id
                    if (id) sessions.setKbEnabled(id, on)
                  }}
                />
              ) : (
                <ScenarioPanel settings={settings} context={ctx} disabled={!canOperate} onBusyChange={setScenarioBusy} recentFiles={recentFiles} onRemoveRecent={removeFromRecent} resolveWikiKind={resolveWikiKind} onGoToSettings={() => setTab('settings')} />
              )}
            </div>
          </main>

        </div>
      </div>

      {drawerOpen && (
        <SessionDrawer
          sessions={sessions}
          busy={chatStreaming}
          onClose={() => setDrawerOpen(false)}
          resolveWikiKind={resolveWikiKind}
          onPickSession={(session) => { if (doc.handlePickSession(session)) setDrawerOpen(false) }}
        />
      )}

      {/* Mutex: session-switch > selection-switch > follow-mode tab-switch — never stack them.
          In the selection branch, the handlers clear pendingSelectionSwitch internally, so the
          payload is captured into a local BEFORE calling them and then staged for InputBar. */}
      {doc.pendingSessionSwitch ? (
        <SwitchSessionDialog
          docTitle={doc.pendingSessionSwitch.title}
          onConfirm={() => { void doc.confirmSessionSwitch().then(() => setDrawerOpen(false)) }}
          onCancel={() => doc.setPendingSessionSwitch(null)}
        />
      ) : doc.pendingSelectionSwitch ? (
        <SwitchSessionDialog
          docTitle={doc.pendingSelectionSwitch.docTitle || '当前文档'}
          message={<>选区来自「<b>{doc.pendingSelectionSwitch.docTitle || '当前文档'}</b>」，与当前工作文档不同。</>}
          confirmLabel="切换工作文档"
          onConfirm={() => { const p = doc.pendingSelectionSwitch?.payload ?? null; doc.handleSelectionSwitchConfirm(); setStagedSelection(p) }}
          onCancel={doc.handleSelectionSwitchCancel}
        />
      ) : doc.pendingSwitch && !chatStreaming ? (
        <SwitchDocDialog
          toTitle={cleanDocTitle(ctx.title) || '当前文档'}
          onNew={doc.handleSwitchNew}
          onStay={doc.handleSwitchStay}
          onCancel={doc.handleSwitchStay}
        />
      ) : null}
    </div>
  )
}
