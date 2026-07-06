import { useEffect, useRef, useState } from 'react'
import type { ClipCapture } from '../shared/clip/types'
import { BUILD_CONFIG, HAS_NETWORK_RESTRICTION, HAS_BUILTIN_CREDS, CLIP_ENABLED } from '../shared/config'
import { checkNetworkAccess } from '../shared/network'
import { usingManagedLlm } from '../shared/ai/llmConfig'
import { isFeishuConfigured } from '../shared/feishu/auth'
import { rememberTenantOrigin } from '../shared/feishu/tenant'
import { cleanDocTitle } from '../shared/feishu/pageUrl'
import { autoRestoreOnceOnEmpty } from './cloudRestore'
import type { PageContext } from '../shared/types'
import ChatPanel from './components/ChatPanel'
import ClipPanel from './components/ClipPanel'
import Settings from './components/Settings'
import NewsPanel from './components/news/NewsPanel'
import NetworkBlocked from './components/NetworkBlocked'
import ScenarioPanel from './components/ScenarioPanel'
import DemoPanel from './components/DemoPanel'
import SessionDrawer from './components/SessionDrawer'
import SwitchDocDialog from './components/SwitchDocDialog'
import SwitchSessionDialog from './components/SwitchSessionDialog'
import NavRail from './components/NavRail'
import { useThemeAccent } from './hooks/useThemeAccent'
import { useAppSettings } from './hooks/useAppSettings'
import { usePageContext } from './hooks/usePageContext'
import { useWikiResolve } from './hooks/useWikiResolve'
import { useRecentFiles } from './hooks/useRecentFiles'
import { useDocBinding, type AppTab } from './hooks/useDocBinding'
import { decideAutoDefault } from './autoDefault'
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
  const [showDemo, setShowDemo] = useState(false)

  // Shared wiki-resolution cache — read by applyCtx (page context) + the wiki/pin resolution
  // effects, written by them. Created here so both hooks share one map.
  const wikiCacheRef = useRef<Map<string, NonNullable<PageContext['feishu']>>>(new Map())

  const { ctx, setCtx, applyCtx } = usePageContext(settings, wikiCacheRef)
  const { resolveWikiKind, authExpired } = useWikiResolve(settings, ctx, setCtx, wikiCacheRef)
  const { recentFiles, ready: recentReady, recordRecent, removeFromRecent } = useRecentFiles(ctx.feishu, ctx.title)

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

  // The assistant only operates on Feishu pages. On any other site we show a hint. null = unknown.
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
              ) : showDemo ? (
                <DemoPanel settings={settings} onBack={() => setShowDemo(false)} />
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
                />
              ) : (
                <ScenarioPanel settings={settings} context={ctx} disabled={!canOperate} onBusyChange={setScenarioBusy} recentFiles={recentFiles} onRemoveRecent={removeFromRecent} />
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

      {/* Mutex: the cross-doc session-switch dialog takes precedence over the follow-mode
          tab-switch dialog — both can't be resolved at once and stacking them is confusing. */}
      {doc.pendingSessionSwitch ? (
        <SwitchSessionDialog
          docTitle={doc.pendingSessionSwitch.title}
          onConfirm={() => { void doc.confirmSessionSwitch().then(() => setDrawerOpen(false)) }}
          onCancel={() => doc.setPendingSessionSwitch(null)}
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
