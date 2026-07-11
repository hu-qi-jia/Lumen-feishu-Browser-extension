import { useEffect, useRef, useState } from 'react'
import type { AppSettings, Attachment, ChatMessage, DocSelectionPayload, PageContext, SessionKind } from '@/shared/types'
import type { BaseCtx } from '@/shared/feishu/context'
import { fetchBaseCtx } from '@/shared/feishu/context'
import { resolveToken } from '@/shared/feishu/auth'
import { HAS_BUILTIN_CREDS } from '@/shared/config'
import { runAgent } from '@/shared/ai/agent'
import type { ConfirmRequest, ConfirmChoice } from '@/shared/ai/agent'
import { fetchVizData } from '@/shared/dataviz/data'
import { sendVizToActiveTab } from '@/shared/dataviz/send'
import type { VizSource } from '@/shared/dataviz/types'
import MessageList from './MessageList'
import UndoBar from './UndoBar'
import ImageExportCard from './ImageExportCard'
import { loadDeleteUndo } from '@/shared/feishu/undo'
import { reloadActiveTab } from '../../services/tabReload'
import InputBar from './InputBar'
import type { InputBarHandle } from './InputBar'
import BaseContextBadge from './BaseContextBadge'
import FieldChips from './FieldChips'
import ConfirmDialog from './ConfirmDialog'
import DocSelector from './DocSelector'
import type { RecentFile } from '../../services/recentFiles'
import { messagesForRetry } from '../../sessions/logic'
import SkillSuggest from './SkillSuggest'
import Tooltip from '../ui/Tooltip'
import IconButton from '../ui/IconButton'
import './ChatPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  /** A doc selection staged from the page (SELECTION_INCOMING) — consumed once by InputBar. */
  stagedSelection?: DocSelectionPayload | null
  onStagedConsumed?: () => void
  /** Wiki-resolved working-doc token — gates which selection chips InputBar shows/sends. */
  workDocToken?: string | null
  /** Active session's messages + setter (lifted to App for persistence/switching). */
  messages: ChatMessage[]
  setMessages: (u: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  /** Write to a specific session — used to bind a streaming reply to the session it began in. */
  setMessagesFor: (sessionId: string, u: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  activeSessionId?: string
  /** Report streaming state up (App defers session auto-switch while streaming). */
  onStreamingChange?: (streaming: boolean) => void
  /** Backfill the document session title once the Base name is known. */
  onBaseName?: (appToken: string, name: string) => void
  /** Working DOCUMENT/TABLE name to display in the topbar (never the session title). */
  docTitle?: string
  /** How many sessions live under the current doc — shown as a badge after the title. */
  docSessionCount?: number
  /** Opener for the session drawer. */
  onOpenSessions?: () => void
  /** Create a new session from the chat header. */
  onNewSession?: () => void
  /** True while a reply is streaming — disables the new-session button. */
  chatBusy?: boolean
  /** Working-document binding shown in the topbar dropdown. */
  docMode: 'follow' | 'pin'
  docActiveToken: string | null
  onPickDoc: (token: string, title: string, kind: SessionKind) => void
  onFollowTabs: () => void
  /** Resolve a wiki-wrapped tab to its real kind (doc/base/sheet) so the doc-selector
   *  dropdown can classify it under the right category. Undefined when not resolvable. */
  resolveWikiKind?: (wikiToken: string) => Promise<SessionKind | undefined>
  /** Persisted recently-opened Feishu resources — the dropdown's "最近打开" list. */
  recentFiles?: RecentFile[]
  /** Remove a file from the recent list (the × on a row). */
  onRemoveRecent?: (token: string) => void
  /** Whether the active session's knowledge-base toggle is on (controls a chat tool gate). */
  kbEnabled: boolean
  /** Toggle the active session's knowledge-base flag. */
  onToggleKb: (on: boolean) => void
}

export default function ChatPanel({
  settings, context, disabled, stagedSelection, onStagedConsumed, workDocToken,
  messages, setMessages, setMessagesFor, activeSessionId,
  onStreamingChange, onBaseName, docTitle, docSessionCount, onOpenSessions, onNewSession, chatBusy,
  docMode, docActiveToken, onPickDoc, onFollowTabs, resolveWikiKind, recentFiles, onRemoveRecent,
  kbEnabled, onToggleKb,
}: Props) {
  const [streaming, setStreaming] = useState(false)
  useEffect(() => { onStreamingChange?.(streaming) }, [streaming, onStreamingChange])

  // Cancels the in-flight turn only when a NEW send supersedes it. We deliberately do
  // NOT abort on unmount: the agent writes to App-level session state (setMessagesFor),
  // so a view switch (tab change / non-Feishu placeholder) that unmounts this panel must
  // NOT kill a running turn — doing so silently stranded the agent mid-task (e.g. after
  // a confirm dialog). The browser tears down the fetch when the panel closes.
  const abortRef = useRef<AbortController | null>(null)

  // Interactive confirmation (e.g. before creating a new Base). The agent loop
  // awaits the promise; the dialog buttons resolve it.
  const [pendingConfirm, setPendingConfirm] = useState<
    { req: ConfirmRequest; resolve: (c: ConfirmChoice) => void } | null
  >(null)

  // Image export card state (set from onToolMessage when __image_export marker detected)
  const [imageExport, setImageExport] = useState<{
    images: Array<{ name: string; context: string; dataUrl: string }>
    docTitle: string
  } | null>(null)

  function requestConfirmation(req: ConfirmRequest): Promise<ConfirmChoice> {
    return new Promise((resolve) => setPendingConfirm({ req, resolve }))
  }

  const inputRef = useRef<InputBarHandle>(null)

  // Base context (loaded when on a Feishu Base page)
  const [baseCtx, setBaseCtx] = useState<BaseCtx | null>(null)
  const [ctxLoading, setCtxLoading] = useState(false)
  const [ctxError, setCtxError] = useState('')
  // User-picked table within the current Base (overrides the URL-derived current table).
  // Lifted here so the BaseContextBadge popover and the FieldChips above the input agree.
  const [selectedTableId, setSelectedTableId] = useState<string>('')
  const lastLoadedApp = useRef<string>('')
  // Latest Base whose context load was REQUESTED — fetchBaseCtx is multi-request and un-aborted,
  // so on a fast A→B switch A can resolve last and clobber B; commits below skip unless still latest.
  const latestReqApp = useRef<string>('')
  // Always-current context + loadBaseCtx for the debounced structural-refresh (replaces a stale
  // window-global timer whose callback closed over the Base that was active when it was scheduled).
  const contextRef = useRef(context); contextRef.current = context
  const loadBaseCtxRef = useRef<() => void>(() => {})
  const ctxRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (ctxRefreshTimer.current) clearTimeout(ctxRefreshTimer.current) }, [])

  // Auto-load Base context when URL changes to a Base page
  useEffect(() => {
    const appToken = context.feishu?.appToken
    if (!appToken || !context.feishu?.isBase) {
      setBaseCtx(null)
      setSelectedTableId('')
      return
    }
    if (appToken === lastLoadedApp.current && baseCtx) return
    // New Base (or first load) → clear any table pick carried over from the previous Base.
    setSelectedTableId('')
    loadBaseCtx()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.feishu?.appToken, context.feishu?.isBase])

  async function loadBaseCtx() {
    const appToken = context.feishu?.appToken
    if (!appToken) return
    if (!settings.feishuAccessToken && !HAS_BUILTIN_CREDS) return

    latestReqApp.current = appToken
    setCtxLoading(true)
    setCtxError('')
    try {
      const token = await resolveToken(settings)
      const ctx = await fetchBaseCtx(token, appToken, context.feishu?.tableId)
      if (latestReqApp.current !== appToken) return // a newer Base load superseded this one
      setBaseCtx(ctx)
      lastLoadedApp.current = appToken
      if (ctx.appName) onBaseName?.(appToken, ctx.appName)
    } catch (err) {
      if (latestReqApp.current !== appToken) return // stale failure — don't clobber the newer Base
      setCtxError(err instanceof Error ? err.message : String(err))
    } finally {
      if (latestReqApp.current === appToken) setCtxLoading(false)
    }
  }
  loadBaseCtxRef.current = loadBaseCtx

  // Refresh context on demand (also re-fetches after structural changes)
  function refreshCtx() {
    lastLoadedApp.current = ''
    setBaseCtx(null)
    loadBaseCtx()
  }

  // Core of a single agent turn: stream a reply into the given session from the given
  // history (which must end with the user message to answer). Shared by send + retry so the
  // streaming lifecycle (abort, finalize, undo-reload) stays identical. The caller owns the
  // streaming guard and the history assembly (appending a new user msg vs. trimming to retry).
  async function runAgentTurn(history: ChatMessage[], turnId: string | undefined) {
    const setTurn = (u: ChatMessage[] | ((p: ChatMessage[]) => ChatMessage[])) =>
      turnId ? setMessagesFor(turnId, u) : setMessages(u)
    const appendTurn = (msg: ChatMessage) =>
      setTurn((prev) => {
        const i = prev.findIndex((m) => m.id === msg.id)
        if (i === -1) return [...prev, msg]
        const next = [...prev]; next[i] = msg; return next
      })

    setStreaming(true)

    // New turn → cancel any still-running prior turn, then bind this turn's signal.
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    // Each agentic ROUND gets its own assistant bubble, in order. A tool call ends
    // the current round's bubble so the next round's text starts a NEW bubble BELOW
    // the tool result — instead of all rounds appending to the first bubble.
    let streamId: string | null = null

    // Snapshot the undo stash timestamp BEFORE the turn — we reload the Feishu page only if a delete
    // THIS turn advanced it (vs the old 15s-recency guess that fired on follow-up non-delete turns).
    const undoAtBefore = (await loadDeleteUndo())?.at ?? 0

    try {
      await runAgent(history, settings, context, {
        onChunk(chunk) {
          if (!streamId) {
            streamId = crypto.randomUUID()
            appendTurn({ id: streamId, role: 'assistant', content: chunk, createdAt: Date.now(), isStreaming: true })
          } else {
            const id = streamId
            setTurn(prev => prev.map(m => m.id === id ? { ...m, content: (m.content ?? '') + chunk } : m))
          }
        },
        onAssistantMessage(msg) {
          if (streamId) {
            // Finalize the bubble we streamed into (keep its position + id).
            const id = streamId
            setTurn(prev => prev.map(m => m.id === id ? { ...msg, id, isStreaming: false } : m))
            streamId = null
          } else if (msg.content) {
            // A round produced text without chunked streaming — append it as its own bubble.
            appendTurn({ ...msg, id: crypto.randomUUID(), isStreaming: false })
          }
          // tool-only round (no content) → nothing here; the tool indicator shows it
        },
        onToolStart(name, args) {
          streamId = null // current round's text is done; next text → new bubble below
          appendTurn({
            id: `tc-start-${name}-${Date.now()}`,
            role: 'assistant',
            content: null,
            tool_calls: [{ id: `tmp-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
            createdAt: Date.now(),
          })
        },
        onToolEnd(toolCallId, _result, isError) {
          if (!isError) refreshCtxIfStructuralChange(toolCallId)
        },
        onToolMessage: (msg) => {
          appendTurn(msg)
          // render_data_app returns a marker → pull live data + render in the page overlay.
          if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.includes('__dataviz')) {
            try {
              const p = JSON.parse(msg.content) as { __dataviz?: boolean; name: string; code: string; source: VizSource }
              if (p?.__dataviz) void renderDataVizResult(p, appendTurn)
            } catch { /* not a dataviz result */ }
          }
          // export_doc_images returns a marker → render image gallery card
          if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.includes('__image_export')) {
            try {
              const p = JSON.parse(msg.content) as { __image_export?: boolean; images: Array<{ name: string; context: string; dataUrl: string }>; docTitle: string }
              if (p?.__image_export && Array.isArray(p.images)) {
                setImageExport({ images: p.images, docTitle: p.docTitle })
              }
            } catch { /* not an image export result */ }
          }
        },
        requestConfirmation,
      }, baseCtx ?? undefined, ac.signal, kbEnabled)
      // A deletion this turn left the Feishu page stale (it caches) — reload it so the result shows
      // without a manual refresh. Only when the undo stash advanced THIS turn (a delete happened).
      void loadDeleteUndo().then((u) => { if (u && u.at !== undoAtBefore) reloadActiveTab() })
    } catch (err) {
      // Cancelled turn (unmount / superseded by a new send) — not a real error.
      const aborted = ac.signal.aborted || (err instanceof Error && err.name === 'AbortError')
      if (!aborted) {
        appendTurn({
          id: crypto.randomUUID(), role: 'assistant',
          content: `错误：${err instanceof Error ? err.message : String(err)}`, createdAt: Date.now(),
        })
      }
    } finally {
      // Only the current turn owns the streaming flag; a superseded turn must not
      // flip it off under the newer one. The streamed bubble is this turn's own → always finalize.
      if (abortRef.current === ac) { abortRef.current = null; setStreaming(false) }
      if (streamId) {
        const id = streamId
        setTurn(p => p.map(m => m.id === id ? { ...m, isStreaming: false } : m))
      }
    }
  }

  async function handleSend(text: string, attachments: Attachment[] = []) {
    if ((!text.trim() && !attachments.length) || streaming) return

    // Bind this whole turn to the session that's active NOW — so the streamed reply
    // always lands here even if the user navigates / the active session switches.
    const turnId = activeSessionId

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim() || null,
      attachments: attachments.length ? attachments.map((a) => ({ ...a })) : undefined,
      createdAt: Date.now(),
    }
    // Derive the agent history from the session's CURRENT messages, not the render
    // snapshot `messages`. setMessagesFor's updater runs synchronously against the session
    // cache (useSessions), so any write that landed since the last render is included —
    // and we append (not clobber) so we never overwrite newer state with a stale array.
    let history: ChatMessage[] = [...messages, userMsg]
    const setTurn = (u: ChatMessage[] | ((p: ChatMessage[]) => ChatMessage[])) =>
      turnId ? setMessagesFor(turnId, u) : setMessages(u)
    setTurn((prev) => {
      history = [...prev, userMsg]
      return history
    })

    await runAgentTurn(history, turnId)
  }

  // Retry (regenerate) the last agent reply — the "重试" action under the latest answer.
  // Drops the assistant turn after the most recent user message, then re-runs so a fresh
  // answer replaces the old one. No-op while a turn is streaming or with no user message.
  async function handleRetry() {
    if (streaming) return
    const turnId = activeSessionId
    const setTurn = (u: ChatMessage[] | ((p: ChatMessage[]) => ChatMessage[])) =>
      turnId ? setMessagesFor(turnId, u) : setMessages(u)
    let history: ChatMessage[] = []
    setTurn((prev) => {
      history = messagesForRetry(prev)
      return history
    })
    if (!history.some((m) => m.role === 'user')) return
    await runAgentTurn(history, turnId)
  }

  // render_data_app result → pull the live full dataset and render it in the page overlay.
  // `append` is the turn-bound writer (setMessagesFor(turnId, …)) so a failure lands in the
  // conversation it belongs to — not whatever session happens to be active now (fetchVizData is
  // a network round-trip; the user may have switched sessions while it was in flight).
  async function renderDataVizResult(p: { name: string; code: string; source: VizSource }, append: (m: ChatMessage) => void) {
    try {
      const full = await fetchVizData(settings, p.source, 2000)
      const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
      await sendVizToActiveTab({ code: p.code, data: full.rows, name: p.name, theme })
    } catch (e) {
      // Surface a connection/render failure as a chat message instead of silently dropping it.
      append({
        id: crypto.randomUUID(), role: 'assistant',
        content: `可视化没能显示：${e instanceof Error ? e.message : String(e)}`, createdAt: Date.now(),
      })
    }
  }

  // Silently refresh context after field/table edits. Debounced on a per-instance ref timer
  // (cleared on unmount) and reading the LATEST context/loadBaseCtx via refs — the old
  // window-global timer's callback closed over the Base active when it was scheduled, so a tool
  // finishing on Base A after the user navigated to B would re-load A and overwrite B's context.
  function refreshCtxIfStructuralChange(_toolCallId: string) {
    if (ctxRefreshTimer.current) clearTimeout(ctxRefreshTimer.current)
    ctxRefreshTimer.current = setTimeout(() => {
      if (contextRef.current.feishu?.appToken) {
        lastLoadedApp.current = ''
        loadBaseCtxRef.current()
      }
    }, 1500)
  }

  // Abort the in-flight turn — called by the send button's stop state. The agent loop's
  // catch block treats AbortError as a clean cancel (no error bubble), and the finally
  // block clears `streaming` + finalizes the streamed bubble.
  function handleStop() {
    abortRef.current?.abort()
  }

  return (
    <div className="chat-panel">
      {/* Top action row — working-doc dropdown (left) + new/history buttons (top-right) */}
      <div className="chat-topbar">
        <DocSelector
          mode={docMode}
          currentTitle={docTitle || '飞书文档'}
          sessionCount={docSessionCount}
          activeToken={docActiveToken}
          onPickDoc={onPickDoc}
          onFollow={onFollowTabs}
          resolveWikiKind={resolveWikiKind}
          recentFiles={recentFiles ?? []}
          onRemoveRecent={onRemoveRecent}
        />
        <div className="chat-topbar-actions">
          <Tooltip content="新建会话" position="left">
            <IconButton onClick={onNewSession} disabled={chatBusy} aria-label="新建会话">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
                <path d="M8 12h8" />
                <path d="M12 8v8" />
              </svg>
            </IconButton>
          </Tooltip>
          <Tooltip content="历史会话" position="left">
            <IconButton onClick={onOpenSessions} aria-label="历史会话">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l4 2" />
              </svg>
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {/* Base (多维表格) context bar — its own row directly under the topbar (the topbar
          row itself is left untouched). Sheet/doc pages render nothing here. */}
      {context.feishu?.isBase && (
        <BaseContextBadge
          ctx={baseCtx}
          loading={ctxLoading}
          error={ctxError}
          settings={settings}
          onRefresh={refreshCtx}
          selectedTableId={selectedTableId}
          onSelectTable={setSelectedTableId}
        />
      )}

      <MessageList
        messages={messages}
        onExample={disabled || streaming ? undefined : handleSend}
        onRetry={handleRetry}
        kind={context.feishu?.kind}
        streaming={streaming}
      />

      {/* One-click 撤销 for the assistant's last record deletion — shown right here in the
          conversation flow (under the delete), reading the undo the agent stashed. */}
      <UndoBar settings={settings} />

      {/* Image export gallery — shown when export_doc_images tool completes */}
      {imageExport && (
        <ImageExportCard
          images={imageExport.images}
          docTitle={imageExport.docTitle}
          onClose={() => setImageExport(null)}
        />
      )}

      {/* Field picker — Feishu Base grids are canvas-rendered (no DOM text to select), so
          we list the selected table's fields from the structure we already read. Click a
          field → it drops into the input for a precise edit. The selected table mirrors the
          popover's table switcher (lifted state), so chips and popover always agree. The row
          hides its scrollbar and scrolls sideways on vertical wheel (see FieldChips). */}
      {(() => {
        if (!baseCtx?.tables?.length) return null
        const tid = selectedTableId || baseCtx.currentTableId
        const table = baseCtx.tables.find((t) => t.tableId === tid) ?? baseCtx.tables[0]
        const fields = table?.fields ?? []
        if (!fields.length) return null
        return <FieldChips fields={fields} onPick={(t) => inputRef.current?.insert(t)} />
      })()}

      {/* 主动推送：新会话时把社区高分做法做成 chip，点一下填进输入框（复核后再发）。
          enterprise+proxy 才会有数据；store/BYO 无 proxy → 永远空 → 不渲染。 */}
      <SkillSuggest
        resourceKind={context.feishu?.kind ?? 'general'}
        show={!disabled && !streaming && messages.length === 0}
        onPick={(t) => inputRef.current?.insert(t)}
      />

      <InputBar
        ref={inputRef}
        onSend={handleSend}
        disabled={disabled}
        busy={streaming}
        onStop={handleStop}
        selection={context.selectedText}
        resourceKind={context.feishu?.kind ?? 'general'}
        stagedSelection={stagedSelection}
        onStagedConsumed={onStagedConsumed}
        workDocToken={workDocToken}
        kbEnabled={kbEnabled}
        onToggleKb={onToggleKb}
        recentFiles={recentFiles}
        resolveWikiKind={resolveWikiKind}
        settings={settings}
      />

      {pendingConfirm && (
        <ConfirmDialog
          req={pendingConfirm.req}
          onChoose={(choice) => { pendingConfirm.resolve(choice); setPendingConfirm(null) }}
        />
      )}
    </div>
  )
}
