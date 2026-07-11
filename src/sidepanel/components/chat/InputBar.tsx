import { forwardRef, useEffect, useImperativeHandle, useRef, useState, KeyboardEvent, DragEvent, ChangeEvent } from 'react'
import type { AppSettings, Attachment, DocRefAttachmentData, DocSelectionPayload, SessionKind } from '@/shared/types'
import { fileToAttachment, validateAttachmentCount, tryAddSelectionAttachment, previewSelectionText, tryAddDocRefAttachment, resolveDocRefFromUrl } from '@/shared/attachments'
import { preloadSkills, type Skill } from '@/shared/ai/skills'
import { loadUserSkills, type UserSkill } from '@/shared/ai/userSkills'
import { HAS_KNOWLEDGE_BASE } from '@/shared/config'
import { buildFeishuUrl } from '@/shared/feishu/pageUrl'
import type { RecentFile } from '../../services/recentFiles'
import { displayName } from '../../services/recentFiles'
import Tooltip from '../ui/Tooltip'
import Dropdown from '../ui/Dropdown'
import { IconPlus, IconUpload, IconBook, IconSparkle, IconTools, IconLink, KindIcon } from '../ui/icons'
import IconButton from '../ui/IconButton'
import './InputBar.css'

/** Draft key used when no working doc is resolved (e.g. a non-doc page). Keeps text typed in
 *  that state isolated rather than shared with every doc — mirrors how selection chips are keyed
 *  by the resolved doc token. */
const DRAFT_NO_DOC = '__no_doc__'

/** Imperative handle so parents (e.g. a field picker) can drop text into the box. */
export interface InputBarHandle {
  insert: (t: string) => void
  /** Stage a doc-selection chip programmatically. Returns false if rejected (cap/dup). */
  addSelection: (payload: DocSelectionPayload) => boolean
}

interface Props {
  onSend: (text: string, attachments?: Attachment[]) => void
  disabled: boolean
  /** True while the AI is generating a reply — shows "生成中……" placeholder + blocks input. */
  busy?: boolean
  /** Abort the in-flight generation. Send button flips to a stop icon while busy. */
  onStop?: () => void
  /** The user's current page selection — auto-filled into the box so they can describe an
   *  edit right after selecting a field/cell. */
  selection?: string
  /** Resource kind for skill preloading. */
  resourceKind?: string
  /** A doc selection staged for the next send (App drives this on SELECTION_INCOMING). Consumed once. */
  stagedSelection?: DocSelectionPayload | null
  /** Fired after stagedSelection is consumed (added or rejected) so App can clear it. */
  onStagedConsumed?: () => void
  /** Wiki-resolved token of the current working doc. Selection chips whose source doc differs
   *  are hidden AND excluded from sends — a reference staged from doc A is only relevant while
   *  the work doc is A; it reappears when the user switches back. Images/files are doc-agnostic. */
  workDocToken?: string | null
  /** 本会话知识库开关态（来自 active session.kbEnabled）。 */
  kbEnabled: boolean
  /** 切换本会话知识库。 */
  onToggleKb: (on: boolean) => void
  /** Persisted recently-opened Feishu resources — the "引用文档" picker's recent list. */
  recentFiles?: RecentFile[]
  /** Resolve a wiki-wrapped resource to its real kind so its icon is right. */
  resolveWikiKind?: (wikiToken: string) => Promise<SessionKind | undefined>
  /** App settings — needed to resolve the user token for link → title lookups. */
  settings: AppSettings
}

const InputBar = forwardRef<InputBarHandle, Props>(function InputBar(
  { onSend, disabled, busy, onStop, selection, resourceKind, stagedSelection, onStagedConsumed, workDocToken, kbEnabled, onToggleKb, recentFiles, resolveWikiKind, settings },
  ref,
) {
  // Per-doc draft: typed text is scoped to the working doc, mirroring how selection chips are
  // filtered by docToken. Switching the working doc swaps the draft (and switching back restores
  // it), so instructions typed for doc A can never be sent against doc B. Keyed by the
  // wiki-resolved token; the DRAFT_NO_DOC sentinel covers the no-doc case so that text is still
  // isolated rather than shared across every doc.
  const draftKey = workDocToken ?? DRAFT_NO_DOC
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const text = drafts[draftKey] ?? ''
  const setText = (t: string) =>
    setDrafts((prev) => (prev[draftKey] === t ? prev : { ...prev, [draftKey]: t }))
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [plusOpen, setPlusOpen] = useState(false)
  const [userSkills, setUserSkills] = useState<UserSkill[]>([])
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const [selectedSkills, setSelectedSkills] = useState<UserSkill[]>([])
  // ── Reference-document picker state ──
  const [refDocOpen, setRefDocOpen] = useState(false)
  const [refDocInput, setRefDocInput] = useState('')
  const [refDocLoading, setRefDocLoading] = useState(false)
  const [refDocError, setRefDocError] = useState('')
  const [wikiKinds, setWikiKinds] = useState<Record<string, SessionKind>>({})
  const refDocInputRef = useRef<HTMLInputElement>(null)
  const refDocPopupRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef('')
  textRef.current = text
  const lastInsertedRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preload skills when resource kind changes
  useEffect(() => {
    if (!resourceKind) return
    preloadSkills(resourceKind).then(setSkills)
  }, [resourceKind])

  // Load user skills once for the "/" picker
  useEffect(() => { loadUserSkills().then(setUserSkills).catch(() => {}) }, [])

  const blocked = disabled || !!busy

  // Selection chips are scoped to the working doc: a reference staged from doc A is hidden (and
  // not sent) while the work doc is B, then reappears when the user switches back to A. Images
  // and uploaded files are doc-agnostic, so they always show. Send + the send-enabled check both
  // use this filtered list — otherwise a hidden doc-A chip could leak into a doc-B send.
  const visibleAttachments = attachments.filter(
    (a) => a.type !== 'selection' || (workDocToken != null && a.selection?.docToken === workDocToken),
  )

  const placeholder = disabled
    ? '请先在设置中完成配置'
    : busy
      ? '生成中…'
      : '描述你想做的事，输入 / 调用技能'

  function resize() {
    const el = textareaRef.current
    if (!el) return
    // Empty input → clear any inline height and let CSS min-height (one line) rule. Reading
    // scrollHeight right after height='auto' on a freshly-mounted textarea can misreport on
    // some engines (it returns the rendered height), which made the empty box jump tall on
    // first entry.
    if (!text) { el.style.height = ''; return }
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }
  useEffect(() => { resize() }, [text])

  // Auto-fill the page selection into the box — but ONLY for base/sheet, where fields/cells are
  // clicked (getSelection stays empty, so the content script reports the clicked label) and there
  // is no "添加到会话" button. On doc/wiki the button is the entry point; auto-filling there made
  // the selection dump straight into the box, then flicker away when the button staged a chip.
  useEffect(() => {
    const sel = (selection ?? '').trim()
    if (!sel) return
    if (resourceKind === 'doc' || resourceKind === 'wiki') return
    const filled = sel + ' '
    if (textRef.current === '' || textRef.current === lastInsertedRef.current) {
      lastInsertedRef.current = filled
      setText(filled)
      textareaRef.current?.focus()
    }
  }, [selection, resourceKind])

  function insert(t: string) {
    const s = t.trim()
    if (!s) return
    const cur = textRef.current
    setText(cur.trim() ? cur.trimEnd() + ' ' + s + ' ' : s + ' ')
    textareaRef.current?.focus()
  }

  function addSelection(payload: DocSelectionPayload): boolean {
    const r = tryAddSelectionAttachment(attachments, payload)
    if (!r.added) return false
    setAttachments(r.attachments)
    textareaRef.current?.focus()
    return true
  }

  // Parent-driven insert (field picker) + selection staging (App)
  useImperativeHandle(ref, () => ({ insert, addSelection }), [insert, addSelection])

  // Consume an App-staged doc selection (SELECTION_INCOMING) → push a selection chip once.
  useEffect(() => {
    if (!stagedSelection) return
    addSelection(stagedSelection)
    onStagedConsumed?.()
  }, [stagedSelection])

  function submit() {
    const t = text.trim()
    if ((!t && visibleAttachments.length === 0 && selectedSkills.length === 0) || blocked) return
    // 若选定了 skill，在消息前拼接调用指令，引导 agent 使用对应 skill__ 工具
    const skillPrefix = selectedSkills.length
      ? selectedSkills.map((s) => `请使用技能「${s.name}」(skill__${s.slug})`).join('；') + '\n'
      : ''
    onSend(skillPrefix + t, visibleAttachments.length ? visibleAttachments : undefined)
    setText('')
    setSelectedSkills([])
    // Drop what we just sent (current-doc chips + images/files). KEEP selection chips staged for
    // OTHER docs so they reappear when the user switches back to them.
    setAttachments((prev) =>
      prev.filter(
        (a) => a.type === 'selection' && !(workDocToken != null && a.selection?.docToken === workDocToken),
      ),
    )
  }

  // ── Slash command detection ──
  const enabledUserSkills = userSkills.filter((s) => s.enabled)
  const filteredSlashSkills = slashQuery
    ? enabledUserSkills.filter((s) =>
        s.name.toLowerCase().includes(slashQuery.toLowerCase()) ||
        s.description.toLowerCase().includes(slashQuery.toLowerCase()),
      )
    : enabledUserSkills

  function onTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setText(val)
    // 检测 "/" 命令：仅当 "/" 是第一个字符时触发
    if (val.startsWith('/')) {
      setSlashOpen(true)
      setSlashQuery(val.slice(1))
      setSlashIndex(0)
    } else {
      setSlashOpen(false)
    }
  }

  function selectSkill(skill: UserSkill) {
    setSelectedSkills((prev) =>
      prev.some((s) => s.id === skill.id) ? prev : [...prev, skill],
    )
    // 清除 "/" + query 文本
    const rest = text.replace(/^\/\S*\s?/, '')
    setText(rest)
    setSlashOpen(false)
    textareaRef.current?.focus()
  }

  function removeSkill(id: string) {
    setSelectedSkills((prev) => prev.filter((s) => s.id !== id))
  }

  // ── Reference-document picker ──
  function openRefDocPicker() {
    setPlusOpen(false)
    setRefDocOpen(true)
    setRefDocInput('')
    setRefDocError('')
    // Focus the input after the popup mounts
    setTimeout(() => refDocInputRef.current?.focus(), 0)
  }

  function closeRefDocPicker() {
    setRefDocOpen(false)
    setRefDocInput('')
    setRefDocError('')
    setRefDocLoading(false)
  }

  function addDocRef(data: DocRefAttachmentData): boolean {
    const r = tryAddDocRefAttachment(attachments, data)
    if (!r.added) return false
    setAttachments(r.attachments)
    return true
  }

  function pickRecentDoc(f: RecentFile) {
    const url = buildFeishuUrl(f.kind, f.token) || ''
    const added = addDocRef({ kind: f.kind, docToken: f.token, docTitle: displayName(f), url })
    if (added) closeRefDocPicker()
    textareaRef.current?.focus()
  }

  async function handleRefDocSubmit() {
    const url = refDocInput.trim()
    if (!url || refDocLoading) return
    setRefDocLoading(true)
    setRefDocError('')
    try {
      const data = await resolveDocRefFromUrl(url, settings)
      if (!data) {
        setRefDocError('无法识别该链接，请粘贴飞书文档/表格/多维表格链接')
        return
      }
      // Backfill a display title from the recent list when the API returned none.
      if (!data.docTitle) {
        const match = (recentFiles ?? []).find((f) => f.token === data.docToken)
        if (match) data.docTitle = displayName(match)
      }
      const added = addDocRef(data)
      if (!added) {
        setRefDocError('该文档已添加，或引用数量已达上限')
        return
      }
      closeRefDocPicker()
      textareaRef.current?.focus()
    } catch {
      setRefDocError('解析链接失败，请检查链接是否正确')
    } finally {
      setRefDocLoading(false)
    }
  }

  function onRefDocInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleRefDocSubmit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeRefDocPicker()
    }
  }

  // Resolve wiki display kinds when the ref-doc popup opens (icons only).
  useEffect(() => {
    if (!refDocOpen) return
    const wikiTokens = (recentFiles ?? []).filter((d) => d.kind === 'wiki').map((d) => d.token)
    if (!wikiTokens.length || !resolveWikiKind) return
    let cancelled = false
    void Promise.all(wikiTokens.map(async (tok) => {
      const real = await resolveWikiKind(tok)
      return real && real !== 'wiki' ? ([tok, real] as const) : null
    })).then((entries) => {
      if (cancelled) return
      const m: Record<string, SessionKind> = {}
      for (const e of entries) if (e) m[e[0]] = e[1]
      setWikiKinds(m)
    }).catch(() => { /* leave wiki icons as the doc fallback */ })
    return () => { cancelled = true }
  }, [refDocOpen, recentFiles, resolveWikiKind])

  // Close the ref-doc popup on outside click.
  useEffect(() => {
    if (!refDocOpen) return
    const onDown = (e: MouseEvent) => {
      if (refDocPopupRef.current && !refDocPopupRef.current.contains(e.target as Node)) {
        closeRefDocPicker()
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [refDocOpen])

  const refDocDisplayKind = (f: RecentFile): SessionKind =>
    f.kind === 'wiki' ? (wikiKinds[f.token] ?? 'doc') : f.kind

  const refDocQuery = refDocInput.trim().toLowerCase()
  const filteredRefDocs = refDocQuery
    ? (recentFiles ?? []).filter((f) => f.title.toLowerCase().includes(refDocQuery) || f.token.toLowerCase().includes(refDocQuery))
    : (recentFiles ?? [])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen && filteredSlashSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % filteredSlashSkills.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + filteredSlashSkills.length) % filteredSlashSkills.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        selectSkill(filteredSlashSkills[slashIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashOpen(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  // ── Attachments ──
  function openFilePicker() {
    fileInputRef.current?.click()
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    const cur = attachments.length
    try { validateAttachmentCount(cur + files.length) } catch { return }
    Promise.all(files.map(fileToAttachment)).then((newAtts) => {
      setAttachments((prev) => [...prev, ...newAtts])
    }).catch(() => { /* invalid file — silently skip */ })
    // Reset so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'

  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files ?? [])
    if (!files.length) return
    const cur = attachments.length
    try { validateAttachmentCount(cur + files.length) } catch { return }
    Promise.all(files.map(fileToAttachment)).then((newAtts) => {
      setAttachments((prev) => [...prev, ...newAtts])
    }).catch(() => { /* invalid file */ })
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.files
    if (!items || items.length === 0) return // plain text paste — let default happen
    for (let i = 0; i < items.length; i++) {
      const f = items[i]
      if (f.type.startsWith('image/')) {
        e.preventDefault() // only prevent default when we handle an image
        fileToAttachment(f).then((a) => {
          setAttachments((prev) => prev.concat(a))
        }).catch((err) => {
          console.warn('剪贴板图片处理失败', err)
        })
      }
    }
  }

  return (
    <div className="input-bar" onDragOver={onDragOver} onDrop={onDrop} onPaste={handlePaste}>
      <div className="input-bar-inner">
        {(visibleAttachments.length > 0 || kbEnabled || selectedSkills.length > 0) && (
          <div className="attachment-list">
            {selectedSkills.map((s) => (
              <div key={s.id} className="attachment-chip attachment-chip--skill">
                <span className="attachment-name">{s.name}</span>
                <button
                  className="attachment-remove"
                  onClick={() => removeSkill(s.id)}
                  aria-label="移除技能"
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
            {kbEnabled && (
              <div className="attachment-chip attachment-chip--kb">
                <span className="attachment-name">知识库</span>
                <Tooltip content="关闭知识库">
                  <button
                    className="attachment-remove"
                    onClick={() => onToggleKb(false)}
                    aria-label="关闭知识库"
                    type="button"
                  >
                    ×
                  </button>
                </Tooltip>
              </div>
            )}
            {visibleAttachments.map((a) => (
              <div key={a.id} className={`attachment-chip${a.type === 'docref' ? ' attachment-chip--docref' : ''}`}>
                {a.type === 'image' && a.dataUrl ? (
                  <img className="attachment-thumb" src={a.dataUrl} alt={a.name} />
                ) : a.type === 'selection' && a.selection ? (
                  <span className="attachment-sel" title={a.selection.selectedText}>
                    <span className="attachment-sel-doc">{a.selection.docTitle || '文档片段'}</span>
                    <span className="attachment-sel-text">{previewSelectionText(a.selection.selectedText)}</span>
                  </span>
                ) : a.type === 'docref' && a.docref ? (
                  <Tooltip content={a.docref.docTitle || a.docref.url} position="top">
                    <span className="attachment-docref">
                      <span className="attachment-docref-icon">
                        <KindIcon kind={a.docref.kind} />
                      </span>
                      <span className="attachment-docref-name">{a.docref.docTitle || '未命名文档'}</span>
                    </span>
                  </Tooltip>
                ) : (
                  <span className="attachment-name">{a.name}</span>
                )}
                <Tooltip content="移除附件">
                  <button
                    className="attachment-remove"
                    onClick={() => removeAttachment(a.id)}
                    aria-label="移除附件"
                    type="button"
                  >
                    ×
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="input-textarea"
          placeholder={placeholder}
          value={text}
          onChange={onTextChange}
          onKeyDown={onKeyDown}
          disabled={blocked}
          rows={1}
        />

        {/* Slash skill picker */}
        {slashOpen && filteredSlashSkills.length > 0 && (
          <div className="slash-popup" role="listbox">
            <div className="slash-popup-group">
              <span className="slash-popup-label">技能</span>
              {filteredSlashSkills.slice(0, 8).map((s, i) => (
                <button
                  key={s.id}
                  className={`slash-item${i === slashIndex ? ' slash-item--active' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={i === slashIndex}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => selectSkill(s)}
                >
                  <span className="slash-item-icon"><IconTools width={12} height={12} /></span>
                  <span className="slash-item-meta">
                    <span className="slash-item-title">{s.name}</span>
                    <span className="slash-item-desc">{s.description || '调用此技能完成任务'}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reference-document picker — pops up above the textarea, matches input width */}
        {refDocOpen && (
          <div className="refdoc-popup" ref={refDocPopupRef} role="dialog" aria-label="引用文档">
            <div className="refdoc-popup-header">
              <span className="refdoc-popup-title">引用文档</span>
              <button
                className="refdoc-popup-close"
                onClick={closeRefDocPicker}
                aria-label="关闭"
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="refdoc-input-row">
              <input
                ref={refDocInputRef}
                className="refdoc-input"
                placeholder="粘贴飞书文档/表格/多维表格链接"
                value={refDocInput}
                onChange={(e) => { setRefDocInput(e.target.value); setRefDocError('') }}
                onKeyDown={onRefDocInputKeyDown}
                disabled={refDocLoading}
              />
              <button
                className="refdoc-add-btn"
                onClick={() => void handleRefDocSubmit()}
                disabled={refDocLoading || !refDocInput.trim()}
                type="button"
              >
                {refDocLoading ? '解析中…' : '添加'}
              </button>
            </div>
            {refDocError && <p className="refdoc-error">{refDocError}</p>}
            {filteredRefDocs.length > 0 && (
              <div className="refdoc-recent">
                <div className="refdoc-recent-label">最近打开</div>
                <div className="refdoc-recent-list">
                  {filteredRefDocs.slice(0, 8).map((f) => {
                    const k = refDocDisplayKind(f)
                    const name = displayName(f)
                    return (
                      <button
                        key={f.token}
                        className="refdoc-recent-item"
                        onClick={() => pickRecentDoc(f)}
                        type="button"
                        title={name}
                      >
                        <span className={`refdoc-recent-icon refdoc-recent-icon--${k}`}>
                          <KindIcon kind={k} />
                        </span>
                        <span className="refdoc-recent-name">{name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {filteredRefDocs.length === 0 && !refDocInput && (
              <p className="refdoc-empty">暂无最近文档，请粘贴链接添加</p>
            )}
          </div>
        )}

        <div className="input-bar-toolbar">
          <div className="toolbar-left">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,image/*"
              className="input-file-hidden"
              onChange={onFileChange}
              tabIndex={-1}
            />
            <Dropdown
              open={plusOpen}
              onOpenChange={setPlusOpen}
              direction="up"
              role="menu"
              menuClassName="inputbar-plus-menu"
              trigger={
                <Tooltip content="添加附件、工具">
                  <IconButton
                    size="md"
                    active={plusOpen}
                    onClick={() => setPlusOpen((v) => !v)}
                    disabled={blocked}
                    aria-label="添加附件、工具"
                    tabIndex={-1}
                  >
                    <IconPlus width={16} height={16} />
                  </IconButton>
                </Tooltip>
              }
            >
              <button
                className="plus-menu-item"
                onClick={() => { openFilePicker(); setPlusOpen(false) }}
                disabled={blocked}
                type="button"
                role="menuitem"
              >
                <span className="plus-menu-icon plus-menu-icon--upload">
                  <IconUpload width={15} height={15} />
                </span>
                <span className="plus-menu-title">添加附件</span>
              </button>
              <button
                className="plus-menu-item"
                onClick={openRefDocPicker}
                disabled={blocked}
                type="button"
                role="menuitem"
              >
                <span className="plus-menu-icon plus-menu-icon--refdoc">
                  <IconLink width={15} height={15} />
                </span>
                <span className="plus-menu-title">引用文档</span>
              </button>
              {HAS_KNOWLEDGE_BASE && (
                <button
                  className={`plus-menu-item${kbEnabled ? ' plus-menu-item--active' : ''}`}
                  onClick={() => { onToggleKb(!kbEnabled); setPlusOpen(false) }}
                  type="button"
                  role="menuitem"
                >
                  <span className="plus-menu-icon plus-menu-icon--kb">
                    <IconBook width={15} height={15} />
                  </span>
                  <span className="plus-menu-title">知识库</span>
                </button>
              )}
              {skills.length > 0 && (
                <div className="plus-menu-group" role="group" aria-label="技能建议">
                  {skills.slice(0, 6).map((s) => (
                    <button
                      key={s.skillId}
                      className="plus-menu-item"
                      onClick={() => { insert(s.lesson || s.intent); setPlusOpen(false) }}
                      type="button"
                      role="menuitem"
                    >
                      <span className="plus-menu-icon plus-menu-icon--skill">
                        <IconSparkle width={14} height={14} />
                      </span>
                      <span className="plus-menu-title">{s.intent}</span>
                    </button>
                  ))}
                </div>
              )}
            </Dropdown>
          </div>

          <div className="toolbar-right">
            {busy ? (
              <Tooltip content="停止生成">
                <button
                  className="btn-send-circle"
                  onClick={() => onStop?.()}
                  disabled={!onStop}
                  type="button"
                  aria-label="停止生成"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="发送 (Enter)">
                <button
                  className="btn-send-circle"
                  onClick={submit}
                  disabled={blocked || (!text.trim() && attachments.length === 0 && selectedSkills.length === 0)}
                  type="button"
                  aria-label="发送"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      <p className="input-hint">{busy ? '生成中…点击右侧停止' : 'Shift+Enter 换行 · Enter 发送'}</p>
    </div>
  )
})

export default InputBar
