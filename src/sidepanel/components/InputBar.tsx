import { forwardRef, useEffect, useImperativeHandle, useRef, useState, KeyboardEvent, DragEvent, ChangeEvent } from 'react'
import type { Attachment } from '../../shared/types'
import { fileToAttachment, validateAttachmentCount } from '../../shared/attachments'
import { preloadSkills, type Skill } from '../../shared/ai/skills'
import Tooltip from './Tooltip'
import './InputBar.css'

/** Imperative handle so parents (e.g. a field picker) can drop text into the box. */
export interface InputBarHandle { insert: (t: string) => void }

interface Props {
  onSend: (text: string, attachments?: Attachment[]) => void
  disabled: boolean
  /** True while the AI is generating a reply — shows "生成中……" placeholder + blocks input. */
  busy?: boolean
  /** Abort the in-flight generation. Send button flips to a stop icon while busy. */
  onStop?: () => void
  /** Show the voice-input button (Web Speech API). Off for locked/private builds. */
  voiceEnabled?: boolean
  /** The user's current page selection — auto-filled into the box so they can describe an
   *  edit right after selecting a field/cell. */
  selection?: string
  /** Resource kind for skill preloading. */
  resourceKind?: string
}

// Minimal typing for the (un-typed) webkitSpeechRecognition API.
interface SpeechRec {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
const SpeechRecognitionCtor: (new () => SpeechRec) | undefined =
  (typeof window !== 'undefined' &&
    ((window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec })
      .webkitSpeechRecognition ||
      (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition)) || undefined

const InputBar = forwardRef<InputBarHandle, Props>(function InputBar(
  { onSend, disabled, busy, onStop, voiceEnabled, selection, resourceKind },
  ref,
) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState('')
  const [skills, setSkills] = useState<Skill[]>([])
  const [skillsOpen, setSkillsOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recRef = useRef<SpeechRec | null>(null)
  const textRef = useRef('')
  textRef.current = text
  const lastInsertedRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const skillsWrapRef = useRef<HTMLDivElement>(null)

  // Preload skills when resource kind changes
  useEffect(() => {
    if (!resourceKind) return
    preloadSkills(resourceKind).then(setSkills)
  }, [resourceKind])

  const blocked = disabled || !!busy

  const placeholder = disabled
    ? '请先在设置中完成配置'
    : busy
      ? '生成中…'
      : listening
        ? '正在聆听…'
        : '描述你现在想做的事'

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

  // Auto-fill the user's page selection into the box
  useEffect(() => {
    const sel = (selection ?? '').trim()
    if (!sel) return
    const filled = sel + ' '
    if (textRef.current === '' || textRef.current === lastInsertedRef.current) {
      lastInsertedRef.current = filled
      setText(filled)
      textareaRef.current?.focus()
    }
  }, [selection])

  function insert(t: string) {
    const s = t.trim()
    if (!s) return
    setText((cur) => (cur.trim() ? cur.trimEnd() + ' ' + s + ' ' : s + ' '))
    textareaRef.current?.focus()
  }

  // Parent-driven insert (field picker)
  useImperativeHandle(ref, () => ({ insert }), [insert])

  useEffect(() => () => { try { recRef.current?.stop() } catch { /* ignore */ } }, [])

  function submit() {
    const t = text.trim()
    if ((!t && attachments.length === 0) || blocked) return
    onSend(t, attachments.length ? attachments : undefined)
    setText('')
    setAttachments([])
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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
    e.dataTransfer.dropEffect = 'copy'
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
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

  // ── Voice ──
  async function toggleMic() {
    setMicError('')
    if (listening) { try { recRef.current?.stop() } catch { /* ignore */ } return }
    if (!SpeechRecognitionCtor) { setMicError('当前浏览器不支持语音输入'); return }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      setMicError('麦克风权限被拒绝或不可用：请在地址栏左侧或扩展页给本扩展允许麦克风后重试。')
      return
    }

    const rec = new SpeechRecognitionCtor()
    rec.lang = 'zh-CN'
    rec.interimResults = true
    rec.continuous = false
    const base = text ? text.trimEnd() + ' ' : ''
    rec.onresult = (e) => {
      let s = ''
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript
      setText(base + s)
    }
    rec.onerror = (e) => {
      setListening(false); recRef.current = null
      const code = e?.error ?? ''
      if (code === 'network' || code === 'service-not-allowed') {
        setMicError('语音识别服务连不上——浏览器语音依赖 Google 服务，国内网络通常不可用。')
      } else if (code === 'not-allowed') {
        setMicError('麦克风权限被拒绝，请允许后重试。')
      } else if (code === 'no-speech') {
        setMicError('没听到声音，请靠近麦克风再试。')
      } else {
        setMicError(`语音输入失败（${code || '未知'}）。`)
      }
    }
    rec.onend = () => { setListening(false); recRef.current = null }
    recRef.current = rec
    setListening(true)
    try { rec.start() } catch { setListening(false); setMicError('无法启动语音输入'); recRef.current = null }
  }

  // Close skills menu on outside click
  useEffect(() => {
    if (!skillsOpen) return
    function onDown(e: MouseEvent) {
      if (skillsWrapRef.current && !skillsWrapRef.current.contains(e.target as Node)) setSkillsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [skillsOpen])

  return (
    <div className="input-bar" onDragOver={onDragOver} onDrop={onDrop} onPaste={handlePaste}>
      <div className="input-bar-inner">
        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map((a) => (
              <div key={a.id} className="attachment-chip">
                {a.type === 'image' && a.dataUrl ? (
                  <img className="attachment-thumb" src={a.dataUrl} alt={a.name} />
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={blocked}
          rows={1}
        />

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
            <Tooltip content="添加附件">
              <button
                className="btn-icon"
                onClick={openFilePicker}
                disabled={blocked}
                type="button"
                tabIndex={-1}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </Tooltip>
            <div className="tools-menu-wrap" ref={skillsWrapRef}>
              <Tooltip content={skills.length ? '技能建议' : '暂无可用技能'}>
                <button
                  className="btn-tools"
                  onClick={() => setSkillsOpen((v) => !v)}
                  disabled={blocked || skills.length === 0}
                  type="button"
                  tabIndex={-1}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                  </svg>
                  <span>Tools</span>
                </button>
              </Tooltip>
              {skillsOpen && (
                <div className="tools-menu">
                  {skills.slice(0, 6).map((s) => (
                    <button
                      key={s.skillId}
                      className="tools-menu-item"
                      onClick={() => { insert(s.lesson || s.intent); setSkillsOpen(false) }}
                      type="button"
                    >
                      <span className="tools-menu-title">{s.intent}</span>
                      {s.lesson && s.lesson !== s.intent && (
                        <span className="tools-menu-desc">{s.lesson}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="toolbar-right">
            {voiceEnabled && SpeechRecognitionCtor && (
              <Tooltip content={listening ? '停止语音输入' : '语音输入'}>
                <button
                  className={`btn-icon ${listening ? 'btn-mic--on' : ''}`}
                  onClick={() => void toggleMic()}
                  disabled={blocked}
                  type="button"
                  tabIndex={-1}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
                    <path d="M19 11a7 7 0 0 1-14 0" />
                    <line x1="12" y1="18" x2="12" y2="22" />
                  </svg>
                </button>
              </Tooltip>
            )}
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
                  disabled={blocked || (!text.trim() && attachments.length === 0)}
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
      <p className="input-hint">{micError || (listening ? '正在聆听…' : busy ? '生成中…点击右侧停止' : 'Shift+Enter 换行 · Enter 发送')}</p>
    </div>
  )
})

export default InputBar
