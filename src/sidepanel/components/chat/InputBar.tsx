import { forwardRef, useEffect, useImperativeHandle, useRef, useState, KeyboardEvent, DragEvent, ChangeEvent } from 'react'
import type { Attachment, DocSelectionPayload } from '@/shared/types'
import { fileToAttachment, validateAttachmentCount, tryAddSelectionAttachment, previewSelectionText } from '@/shared/attachments'
import { preloadSkills, type Skill } from '@/shared/ai/skills'
import { loadUserSkills, type UserSkill } from '@/shared/ai/userSkills'
import { HAS_KNOWLEDGE_BASE } from '@/shared/config'
import Tooltip from '../ui/Tooltip'
import Dropdown from '../ui/Dropdown'
import { IconPlus, IconUpload, IconBook, IconSparkle } from '../ui/icons'
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
}

const InputBar = forwardRef<InputBarHandle, Props>(function InputBar(
  { onSend, disabled, busy, onStop, selection, resourceKind, stagedSelection, onStagedConsumed, workDocToken, kbEnabled, onToggleKb },
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
              <div key={a.id} className="attachment-chip">
                {a.type === 'image' && a.dataUrl ? (
                  <img className="attachment-thumb" src={a.dataUrl} alt={a.name} />
                ) : a.type === 'selection' && a.selection ? (
                  <span className="attachment-sel" title={a.selection.selectedText}>
                    <span className="attachment-sel-doc">{a.selection.docTitle || '文档片段'}</span>
                    <span className="attachment-sel-text">{previewSelectionText(a.selection.selectedText)}</span>
                  </span>
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
                  <span className="slash-item-icon"><IconSparkle width={14} height={14} /></span>
                  <span className="slash-item-meta">
                    <span className="slash-item-title">{s.name}</span>
                    <span className="slash-item-desc">{s.description || '调用此技能完成任务'}</span>
                  </span>
                </button>
              ))}
            </div>
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
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
