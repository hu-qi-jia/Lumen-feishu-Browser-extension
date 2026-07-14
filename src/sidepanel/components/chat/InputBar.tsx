import { forwardRef, useEffect, useImperativeHandle, useRef, useState, KeyboardEvent, DragEvent, ChangeEvent } from 'react'
import type { AppSettings, Attachment, DocRefAttachmentData, DocSelectionPayload, SessionKind } from '@/shared/types'
import { fileToAttachment, validateAttachmentCount, tryAddSelectionAttachment, previewSelectionText, tryAddDocRefAttachment, resolveDocRefFromUrl, updateDocRefAttachment, getCachedSubTables, setCachedSubTables } from '@/shared/attachments'
import { loadUserSkills, type UserSkill } from '@/shared/ai/userSkills'
import { HAS_KNOWLEDGE_BASE } from '@/shared/config'
import { buildFeishuUrl } from '@/shared/feishu/pageUrl'
import { listSheets } from '@/shared/feishu/sheets'
import { listTables } from '@/shared/feishu/api'
import { resolveToken } from '@/shared/feishu/auth'
import { fetchSelectionContext } from '@/shared/feishu/docx'
import type { RecentFile } from '../../services/recentFiles'
import { displayName } from '../../services/recentFiles'
import Tooltip from '../ui/Tooltip'
import Dropdown from '../ui/Dropdown'
import { IconPlus, IconUpload, IconBook, IconTools, IconLink, KindIcon } from '../ui/icons'
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
  /** Resource kind of the current page (base/sheet/doc/wiki). Used to gate auto-fill of selection
   *  (doc/wiki use the selection button instead). */
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
  /** Resolve a wiki node to its real kind + obj_token. Reuses the shared cache. */
  resolveWikiNode?: (wikiToken: string) => Promise<{ kind: SessionKind; docToken: string } | undefined>
  /** App settings — needed to resolve the user token for link → title lookups. */
  settings: AppSettings
}

const InputBar = forwardRef<InputBarHandle, Props>(function InputBar(
  { onSend, disabled, busy, onStop, selection, resourceKind, stagedSelection, onStagedConsumed, workDocToken, kbEnabled, onToggleKb, recentFiles, resolveWikiKind, resolveWikiNode, settings },
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
  // 弹窗内子表选择：选中 sheet/base 文件/链接后，先让用户挑具体子表再添加 chip
  const [refDocSubPicker, setRefDocSubPicker] = useState<{
    data: DocRefAttachmentData
    loading: boolean
    items: { id: string; name: string }[]
    error?: string
  } | null>(null)
  // 子表选择器：在已添加的 sheet/base docref chip 上展开内联下拉，可二次切换子表
  const [subTablePicker, setSubTablePicker] = useState<{
    chipId: string
    loading: boolean
    items: { id: string; name: string }[]
    error?: string
  } | null>(null)
  const refDocInputRef = useRef<HTMLInputElement>(null)
  const refDocPopupRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef('')
  textRef.current = text
  const lastInsertedRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    const newAttachments = r.attachments
    setAttachments(newAttachments)
    textareaRef.current?.focus()
    // Async backfill: fetch list_blocks once, match selectedText → block_id + paragraph + heading.
    // Agent then gets block_id in the chip metadata and can call update_document_block directly,
    // skipping a redundant list_blocks round-trip. Fire-and-forget; failures are silent.
    const chipId = newAttachments[newAttachments.length - 1].id
    void (async () => {
      try {
        const token = await resolveToken(settings).catch(() => undefined)
        if (!token) return
        const ctx = await fetchSelectionContext(token, payload.docToken, payload.selectedText)
        if (!ctx.blockId && !ctx.paragraphText && !ctx.headingText) return
        setAttachments((prev) => prev.map((a) => a.id === chipId && a.type === 'selection' && a.selection
          ? { ...a, selection: { ...a.selection!, ...ctx } }
          : a))
      } catch { /* silent — agent will fall back to list_blocks */ }
    })()
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

  // 引用文档弹窗打开时，后台预拉取所有表格/多维表格最近文件的子表列表，
  // 用户点击时缓存已就绪、秒进子表选择视图。fire-and-forget，不阻塞 UI。
  useEffect(() => {
    if (!refDocOpen) return
    void (async () => {
      const userToken = await resolveToken(settings).catch(() => undefined)
      if (!userToken) return
      // 直接可用的 sheet/base（token 已知）
      const direct = (recentFiles ?? []).filter(
        (f) => (f.kind === 'sheet' || f.kind === 'base') && !getCachedSubTables(f.token),
      )
      // wiki 类型需先解析出真实 kind + obj_token
      const wikis = (recentFiles ?? []).filter((f) => f.kind === 'wiki' && resolveWikiNode)
      for (const f of direct) {
        void (async () => {
          try {
            if (f.kind === 'sheet') {
              const res = await listSheets(userToken, f.token) as {
                sheets?: Array<{ sheet_id: string; title: string; index?: number }>
              }
              setCachedSubTables(f.token, (res.sheets ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((s) => ({ id: s.sheet_id, name: s.title })))
            } else {
              const res = await listTables(userToken, f.token) as {
                items?: Array<{ table_id: string; name: string }>
              }
              setCachedSubTables(f.token, (res.items ?? []).map((t) => ({ id: t.table_id, name: t.name })))
            }
          } catch { /* 单个失败不影响其他 */ }
        })()
      }
      for (const f of wikis) {
        void (async () => {
          const resolved = await resolveWikiNode!(f.token)
          if (!resolved || (resolved.kind !== 'sheet' && resolved.kind !== 'base')) return
          if (getCachedSubTables(resolved.docToken)) return
          try {
            if (resolved.kind === 'sheet') {
              const res = await listSheets(userToken, resolved.docToken) as {
                sheets?: Array<{ sheet_id: string; title: string; index?: number }>
              }
              setCachedSubTables(resolved.docToken, (res.sheets ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((s) => ({ id: s.sheet_id, name: s.title })))
            } else {
              const res = await listTables(userToken, resolved.docToken) as {
                items?: Array<{ table_id: string; name: string }>
              }
              setCachedSubTables(resolved.docToken, (res.items ?? []).map((t) => ({ id: t.table_id, name: t.name })))
            }
          } catch { /* 单个失败不影响其他 */ }
        })()
      }
    })()
  }, [refDocOpen, recentFiles, resolveWikiNode, settings])

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
    setRefDocSubPicker(null)
  }

  function addDocRef(data: DocRefAttachmentData): boolean {
    const r = tryAddDocRefAttachment(attachments, data)
    if (!r.added) return false
    setAttachments(r.attachments)
    return true
  }

  async function pickRecentDoc(f: RecentFile) {
    // wiki 类型的 recent file 存的 token 是 wiki token，需要解析拿到真实 kind + obj_token。
    // 使用 resolveWikiNode 复用已有缓存（resolveWikiKind 或页面上下文可能已解析过），
    // 跳过 resolveDocRefFromUrl 的 title fetch 和验证调用，减少串行 API 数。
    if (f.kind === 'wiki' && resolveWikiNode) {
      setRefDocLoading(true)
      setRefDocError('')
      try {
        const resolved = await resolveWikiNode(f.token)
        if (!resolved) {
          setRefDocError('无法解析该知识库节点')
          return
        }
        const url = buildFeishuUrl('wiki', f.token) || ''
        const data: DocRefAttachmentData = {
          kind: resolved.kind,
          docToken: resolved.docToken,
          docTitle: displayName(f),
          url,
        }
        if (resolved.kind === 'sheet' || resolved.kind === 'base') {
          await enterRefDocSubPicker(data)
          return
        }
        const added = addDocRef(data)
        if (added) closeRefDocPicker()
      } catch {
        setRefDocError('解析知识库节点失败')
      } finally {
        setRefDocLoading(false)
      }
      textareaRef.current?.focus()
      return
    }
    // 回退：没有 resolveWikiNode 时走完整解析
    if (f.kind === 'wiki') {
      setRefDocLoading(true)
      setRefDocError('')
      try {
        const url = buildFeishuUrl('wiki', f.token) || ''
        const data = await resolveDocRefFromUrl(url, settings)
        if (!data) {
          setRefDocError('无法解析该知识库节点')
          return
        }
        if (!data.docTitle) data.docTitle = displayName(f)
        if (data.kind === 'sheet' || data.kind === 'base') {
          await enterRefDocSubPicker(data)
          return
        }
        const added = addDocRef(data)
        if (added) closeRefDocPicker()
      } catch {
        setRefDocError('解析知识库节点失败')
      } finally {
        setRefDocLoading(false)
      }
      textareaRef.current?.focus()
      return
    }
    const url = buildFeishuUrl(f.kind, f.token) || ''
    const data: DocRefAttachmentData = { kind: f.kind, docToken: f.token, docTitle: displayName(f), url }
    if (f.kind === 'sheet' || f.kind === 'base') {
      await enterRefDocSubPicker(data)
      return
    }
    const added = addDocRef(data)
    if (added) closeRefDocPicker()
    textareaRef.current?.focus()
  }

  // ── Sub-table picker (sheet/base docref chip) ──
  // 用户在引用表格/多维表格后，可点击 chip 上的"选择子表"按钮拉取子表列表并指定一张，
  // 让 agent 直接定位、省去 list_sheets / list_tables 枚举步骤。
  async function openSubTablePicker(chip: Attachment) {
    if (!chip.docref) return
    const d = chip.docref
    if (d.kind !== 'sheet' && d.kind !== 'base') return
    // 先查缓存，命中则跳过网络请求
    const cached = getCachedSubTables(d.docToken)
    if (cached) {
      setSubTablePicker({ chipId: chip.id, loading: false, items: cached })
      return
    }
    setSubTablePicker({ chipId: chip.id, loading: true, items: [] })
    const userToken = await resolveToken(settings).catch(() => undefined)
    if (!userToken) {
      setSubTablePicker({ chipId: chip.id, loading: false, items: [], error: '未授权，请先在设置中配置' })
      return
    }
    try {
      if (d.kind === 'sheet') {
        const res = await listSheets(userToken, d.docToken) as {
          sheets?: Array<{ sheet_id: string; title: string; index?: number }>
        }
        const items = (res.sheets ?? [])
          .slice()
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .map((s) => ({ id: s.sheet_id, name: s.title }))
        setCachedSubTables(d.docToken, items)
        setSubTablePicker({ chipId: chip.id, loading: false, items })
      } else {
        const res = await listTables(userToken, d.docToken) as {
          items?: Array<{ table_id: string; name: string }>
        }
        const items = (res.items ?? []).map((t) => ({ id: t.table_id, name: t.name }))
        setCachedSubTables(d.docToken, items)
        setSubTablePicker({ chipId: chip.id, loading: false, items })
      }
    } catch {
      setSubTablePicker({ chipId: chip.id, loading: false, items: [], error: '拉取子表失败' })
    }
  }

  function pickSubTable(chipId: string, id: string, name: string) {
    const chip = attachments.find((a) => a.id === chipId)
    if (!chip?.docref) return
    const patch =
      chip.docref.kind === 'sheet'
        ? { sheetId: id, sheetName: name }
        : { tableId: id, tableName: name }
    setAttachments((prev) => updateDocRefAttachment(prev, chipId, patch))
    setSubTablePicker(null)
  }

  function clearSubTable(chipId: string) {
    const chip = attachments.find((a) => a.id === chipId)
    if (!chip?.docref) return
    const patch =
      chip.docref.kind === 'sheet'
        ? { sheetId: undefined, sheetName: undefined }
        : { tableId: undefined, tableName: undefined }
    setAttachments((prev) => updateDocRefAttachment(prev, chipId, patch))
    setSubTablePicker(null)
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
      if (data.kind === 'sheet' || data.kind === 'base') {
        await enterRefDocSubPicker(data)
        return
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

  // 进入弹窗内的子表选择视图（sheet/base）。先查缓存，命中则秒开。
  async function enterRefDocSubPicker(data: DocRefAttachmentData) {
    const cached = getCachedSubTables(data.docToken)
    if (cached) {
      setRefDocSubPicker({ data, loading: false, items: cached })
      return
    }
    setRefDocSubPicker({ data, loading: true, items: [] })
    const userToken = await resolveToken(settings).catch(() => undefined)
    if (!userToken) {
      setRefDocSubPicker({ data, loading: false, items: [], error: '未授权，请先在设置中配置' })
      return
    }
    try {
      if (data.kind === 'sheet') {
        const res = await listSheets(userToken, data.docToken) as {
          sheets?: Array<{ sheet_id: string; title: string; index?: number }>
        }
        const items = (res.sheets ?? [])
          .slice()
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .map((s) => ({ id: s.sheet_id, name: s.title }))
        setCachedSubTables(data.docToken, items)
        setRefDocSubPicker({ data, loading: false, items })
      } else {
        const res = await listTables(userToken, data.docToken) as {
          items?: Array<{ table_id: string; name: string }>
        }
        const items = (res.items ?? []).map((t) => ({ id: t.table_id, name: t.name }))
        setCachedSubTables(data.docToken, items)
        setRefDocSubPicker({ data, loading: false, items })
      }
    } catch {
      setRefDocSubPicker({ data, loading: false, items: [], error: '拉取子表失败' })
    }
  }

  function confirmRefDocSubTable(id?: string, name?: string) {
    if (!refDocSubPicker) return
    const data = refDocSubPicker.data
    const withSub: DocRefAttachmentData =
      data.kind === 'sheet' && id
        ? { ...data, sheetId: id, sheetName: name }
        : data.kind === 'base' && id
          ? { ...data, tableId: id, tableName: name }
          : data
    const added = addDocRef(withSub)
    if (!added) {
      setRefDocSubPicker(null)
      setRefDocError('该文档已添加，或引用数量已达上限')
      return
    }
    closeRefDocPicker()
    textareaRef.current?.focus()
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

  // Close the sub-table picker on outside click.
  useEffect(() => {
    if (!subTablePicker) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // 点击 subtable-btn 或 subtable-popup 内部时不关闭（它们自己处理 stopPropagation，
      // 但用类名兜底防止事件冒泡顺序差异导致误关）。
      if (t.closest('.docref-subtable-btn') || t.closest('.docref-subtable-popup')) return
      setSubTablePicker(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [subTablePicker])

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
              <div key={a.id} className={`attachment-chip${a.type === 'docref' ? ' attachment-chip--docref' : ''}${subTablePicker?.chipId === a.id ? ' attachment-chip--subtable-open' : ''}`}>
                {a.type === 'image' && a.dataUrl ? (
                  <img className="attachment-thumb" src={a.dataUrl} alt={a.name} />
                ) : a.type === 'selection' && a.selection ? (
                  <span className="attachment-sel" title={a.selection.selectedText}>
                    <span className="attachment-sel-doc">{a.selection.docTitle || '文档片段'}</span>
                    <span className="attachment-sel-text">{previewSelectionText(a.selection.selectedText)}</span>
                  </span>
                ) : a.type === 'docref' && a.docref ? (
                  <Tooltip content={a.docref.docTitle || a.docref.url} position="top">
                    <button
                      className="attachment-docref"
                      onClick={(e) => {
                        if (a.docref?.kind !== 'sheet' && a.docref?.kind !== 'base') return
                        e.stopPropagation()
                        if (subTablePicker?.chipId === a.id) setSubTablePicker(null)
                        else void openSubTablePicker(a)
                      }}
                      type="button"
                      title={a.docref.kind === 'sheet' ? '选择工作表' : a.docref.kind === 'base' ? '选择数据表' : '引用文档'}
                    >
                      <span className="attachment-docref-icon">
                        <KindIcon kind={a.docref.kind} />
                      </span>
                      <span className="attachment-docref-name">{a.docref.docTitle || '未命名文档'}</span>
                      {(a.docref.kind === 'sheet' || a.docref.kind === 'base') && (
                        <>
                          <span className="attachment-docref-divider" aria-hidden="true" />
                          <span className="attachment-docref-subtable">
                            {a.docref.sheetName || a.docref.tableName || '全部子表'}
                          </span>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </>
                      )}
                    </button>
                  </Tooltip>
                ) : (
                  <span className="attachment-name">{a.name}</span>
                )}
                <Tooltip content={a.type === 'selection' ? '移除引用' : '移除附件'}>
                  <button
                    className="attachment-remove"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={a.type === 'selection' ? '移除引用' : '移除附件'}
                    type="button"
                  >
                    ×
                  </button>
                </Tooltip>
                {subTablePicker?.chipId === a.id && (
                  <div className="docref-subtable-popup" role="listbox">
                    {subTablePicker.loading ? (
                      <div className="docref-subtable-msg">加载中…</div>
                    ) : subTablePicker.error ? (
                      <div className="docref-subtable-msg docref-subtable-msg--error">{subTablePicker.error}</div>
                    ) : subTablePicker.items.length === 0 ? (
                      <div className="docref-subtable-msg">暂无子表</div>
                    ) : (
                      <>
                        <button
                          className="docref-subtable-item"
                          onClick={(e) => { e.stopPropagation(); clearSubTable(a.id) }}
                          type="button"
                          role="option"
                          aria-selected={!a.docref?.sheetId && !a.docref?.tableId}
                        >
                          <span className="docref-subtable-item-name">全部子表</span>
                        </button>
                        {subTablePicker.items.map((it) => {
                          const selected = a.docref?.sheetId === it.id || a.docref?.tableId === it.id
                          return (
                            <button
                              key={it.id}
                              className={`docref-subtable-item${selected ? ' docref-subtable-item--active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); pickSubTable(a.id, it.id, it.name) }}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              title={it.name}
                            >
                              <span className="docref-subtable-item-name">{it.name}</span>
                            </button>
                          )
                        })}
                      </>
                    )}
                  </div>
                )}
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
          <div className="refdoc-popup" ref={refDocPopupRef} role="dialog" aria-label={refDocSubPicker ? '选择子表' : '引用文档'}>
            {refDocSubPicker ? (
              <>
                <div className="refdoc-popup-header">
                  <button
                    className="refdoc-popup-back"
                    onClick={() => setRefDocSubPicker(null)}
                    aria-label="返回"
                    type="button"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <span className="refdoc-popup-title">选择{refDocSubPicker.data.kind === 'sheet' ? '工作表' : '数据表'}</span>
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
                <div className="refdoc-subtable-doc">
                  <span className="refdoc-subtable-doc-icon">
                    <KindIcon kind={refDocSubPicker.data.kind} />
                  </span>
                  <span className="refdoc-subtable-doc-name" title={refDocSubPicker.data.docTitle}>
                    {refDocSubPicker.data.docTitle || '未命名'}
                  </span>
                </div>
                <div className="refdoc-subtable-list" role="listbox">
                  {refDocSubPicker.loading ? (
                    <div className="refdoc-subtable-msg">加载中…</div>
                  ) : refDocSubPicker.error ? (
                    <div className="refdoc-subtable-msg refdoc-subtable-msg--error">{refDocSubPicker.error}</div>
                  ) : (
                    <>
                      <button
                        className="refdoc-subtable-list-item"
                        onClick={() => confirmRefDocSubTable()}
                        type="button"
                        role="option"
                      >
                        <span className="refdoc-subtable-list-name">全部{refDocSubPicker.data.kind === 'sheet' ? '工作表' : '数据表'}</span>
                        <span className="refdoc-subtable-list-hint">由 AI 自行选择</span>
                      </button>
                      {refDocSubPicker.items.map((it) => (
                        <button
                          key={it.id}
                          className="refdoc-subtable-list-item"
                          onClick={() => confirmRefDocSubTable(it.id, it.name)}
                          type="button"
                          role="option"
                          title={it.name}
                        >
                          <span className="refdoc-subtable-list-name">{it.name}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
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
                            onClick={() => void pickRecentDoc(f)}
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
              </>
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
