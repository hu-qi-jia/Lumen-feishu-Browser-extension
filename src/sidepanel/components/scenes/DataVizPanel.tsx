import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, PageContext, SessionKind, DocRefAttachmentData } from '@/shared/types'
import { generateViz } from '@/shared/ai/dataviz'
import { fetchVizData, deriveVizSourceFromDocRef } from '@/shared/dataviz/data'
import { sendVizToActiveTab } from '@/shared/dataviz/send'
import { loadVizList, saveViz, deleteViz } from '@/shared/dataviz/store'
import { ctxScopeKey, savedVizMatchesCtx } from '@/shared/dataviz/scope'
import { NO_REMOTE_CODE } from '@/shared/config'
import { isTokenExpiredError, resolveToken } from '@/shared/feishu/auth'
import { resolveDocRefFromUrl, getCachedSubTables, setCachedSubTables } from '@/shared/attachments'
import { buildFeishuUrl } from '@/shared/feishu/pageUrl'
import { listSheets } from '@/shared/feishu/sheets'
import { listTables } from '@/shared/feishu/api'
import type { SavedViz, VizSource } from '@/shared/dataviz/types'
import type { VizSpec } from '@/shared/dataviz/spec'
import type { RecentFile } from '../../services/recentFiles'
import { displayName } from '../../services/recentFiles'
import TopBar from '../shell/TopBar'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import Tooltip from '../ui/Tooltip'
import SideDrawer from '../ui/SideDrawer'
import HistoryRow from '../session/HistoryRow'
import DocLinkField from '../session/DocLinkField'
import { KindIcon, IconHistory, IconPlus, IconEye, IconUpload } from '../ui/icons'
import '../session/DocCombobox.css'
import '../session/HistoryRow.css'
import './DataVizPanel.css'
import './SlidesPanel.css'

const errText = (e: unknown) => isTokenExpiredError(e)
  ? '飞书登录已失效，请在「设置」重新登录后再试' : e instanceof Error ? e.message : String(e)

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
  resolveWikiKind?: (wikiToken: string) => Promise<SessionKind | undefined>
  resolveWikiNode?: (wikiToken: string) => Promise<{ kind: SessionKind; docToken: string } | undefined>
}

const SAMPLE_CAP = 30
const RENDER_CAP = 2000

function theme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

async function sendToOverlay(artifact: { code?: string; spec?: VizSpec }, data: unknown[], name: string) {
  await sendVizToActiveTab({ ...artifact, data, name, theme: theme() })
}

type LastViz = { name: string; code?: string; spec?: VizSpec; request?: string; source: VizSource }
const genCache = new Map<string, LastViz>()

function vizSourceLabel(v: SavedViz): string {
  return v.source.kind === 'base' ? '多维表格' : '电子表格'
}

/** 将保存的 VizSource 转换回 DocRefAttachmentData，用于点击历史记录时恢复数据源 UI。 */
function vizSourceToDocRef(source: VizSource, name: string): DocRefAttachmentData {
  if (source.kind === 'base') {
    return { kind: 'base', docToken: source.appToken, tableId: source.tableId, docTitle: name, url: '' }
  }
  // range 格式为 "SheetId!A1:Z2000"，提取 sheetId
  const sheetId = source.range.split('!')[0] || ''
  return { kind: 'sheet', docToken: source.spreadsheetToken, sheetId, docTitle: name, url: '' }
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

export default function DataVizPanel({ settings, disabled, onBack, recentFiles, onRemoveRecent, resolveWikiKind, resolveWikiNode }: Props) {
  const [linkInput, setLinkInput] = useState('')
  const [sourceData, setSourceData] = useState<DocRefAttachmentData | null>(null)
  const [subItems, setSubItems] = useState<{ id: string; name: string }[]>([])
  const [subDropdownOpen, setSubDropdownOpen] = useState(false)
  const [subLoading, setSubLoading] = useState(false)
  const [resolving, setResolving] = useState(false)

  const [request, setRequest] = useState('')
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [genChars, setGenChars] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const [list, setList] = useState<SavedViz[]>([])
  const last = useRef<LastViz | null>(null)
  const [hasGen, setHasGen] = useState(false)
  const [activeVizId, setActiveVizId] = useState('')
  const subDropdownRef = useRef<HTMLDivElement>(null)
  const prefetchRef = useRef(new Set<string>())
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => { loadVizList().then((all) => setList(all)) }, [])

  useEffect(() => {
    if (typeof chrome === 'undefined') return
    const onMsg = (msg: { type?: string; ok?: boolean; message?: string }) => {
      if (msg?.type !== 'DATAVIZ_RESULT') return
      if (msg.ok) setStatus((s) => s || '渲染完成')
      else { setErrMsg('图表渲染失败：' + (msg.message || '生成的代码报错，可重试或换一种描述')); setStatus('') }
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [])

  // Filter to table types only (sheet/base/wiki) — no doc/ppt.
  const tableRecentFiles = useMemo(
    () => recentFiles.filter((f) => f.kind === 'sheet' || f.kind === 'base' || f.kind === 'wiki'),
    [recentFiles],
  )

  // Prefetch sub-table lists for recent table files in the background so that
  // picking a recent table feels instant. Fire-and-forget; failures are ignored.
  useEffect(() => {
    if (disabled || !tableRecentFiles.length) return
    void (async () => {
      const userToken = await resolveToken(settings).catch(() => undefined)
      if (!userToken) return
      const direct = tableRecentFiles.filter(
        (f) => (f.kind === 'sheet' || f.kind === 'base') && !getCachedSubTables(f.token) && !prefetchRef.current.has(f.token),
      )
      const wikis = tableRecentFiles.filter(
        (f) => f.kind === 'wiki' && resolveWikiNode && !getCachedSubTables(f.token) && !prefetchRef.current.has(f.token),
      )
      direct.forEach((f) => {
        prefetchRef.current.add(f.token)
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
      })
      wikis.forEach((f) => {
        prefetchRef.current.add(f.token)
        void (async () => {
          try {
            const resolved = await resolveWikiNode!(f.token)
            if (!resolved || (resolved.kind !== 'sheet' && resolved.kind !== 'base')) return
            if (getCachedSubTables(resolved.docToken)) return
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
      })
    })()
  }, [disabled, tableRecentFiles, resolveWikiNode, settings])

  // Build a fake page-context from the selected source for scope matching.
  const sourceCtx = sourceData ? {
    kind: sourceData.kind,
    appToken: sourceData.kind === 'base' ? sourceData.docToken : undefined,
    spreadsheetToken: sourceData.kind === 'sheet' ? sourceData.docToken : undefined,
    tableId: sourceData.kind === 'base' ? sourceData.tableId : undefined,
  } : null
  const curKey = sourceCtx ? ctxScopeKey(sourceCtx) : null

  // Restore the last generation for this source (survives tab-switch unmount).
  useEffect(() => {
    const cached = curKey ? genCache.get(curKey) : null
    last.current = cached ?? null
    setHasGen(!!cached)
    setStatus(cached ? `已恢复上次生成的「${cached.name}」——可重新调整或导出` : '')
  }, [curKey])

  // Close sub-table dropdown on outside click.
  useEffect(() => {
    if (!subDropdownOpen) return
    const onDown = (e: MouseEvent) => {
      if (subDropdownRef.current && !subDropdownRef.current.contains(e.target as Node)) setSubDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [subDropdownOpen])

  async function fetchSubTables(data: DocRefAttachmentData): Promise<{ id: string; name: string }[]> {
    const cached = getCachedSubTables(data.docToken)
    if (cached) return cached
    const userToken = await resolveToken(settings).catch(() => undefined)
    if (!userToken) throw new Error('未授权，请先在设置中配置')
    if (data.kind === 'sheet') {
      const res = await listSheets(userToken, data.docToken) as {
        sheets?: Array<{ sheet_id: string; title: string; index?: number }>
      }
      const items = (res.sheets ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((s) => ({ id: s.sheet_id, name: s.title }))
      setCachedSubTables(data.docToken, items)
      return items
    }
    const res = await listTables(userToken, data.docToken) as {
      items?: Array<{ table_id: string; name: string }>
    }
    const items = (res.items ?? []).map((t) => ({ id: t.table_id, name: t.name }))
    setCachedSubTables(data.docToken, items)
    return items
  }

  async function selectSource(data: DocRefAttachmentData) {
    if (data.kind !== 'sheet' && data.kind !== 'base') {
      setErrMsg('AI 看板仅支持多维表格和电子表格')
      return
    }
    // Show the source card immediately so the UI feels responsive; sub-tables load in the background.
    setSourceData(data)
    setSubItems([])
    setSubLoading(true)
    setSubDropdownOpen(false)
    setLinkInput('')
    setErrMsg('')
    last.current = null
    setHasGen(false)
    setActiveVizId('')
    setStatus('')
    try {
      const items = await fetchSubTables(data)
      if (items.length === 0) { setErrMsg('该表格没有子表'); return }
      // Auto-select: use existing tableId/sheetId if set and valid, else first.
      const existingId = data.tableId || data.sheetId
      const match = existingId ? items.find((it) => it.id === existingId) : undefined
      const sel = match ?? items[0]
      const updated: DocRefAttachmentData = data.kind === 'sheet'
        ? { ...data, sheetId: sel.id, sheetName: sel.name }
        : { ...data, tableId: sel.id, tableName: sel.name }
      setSourceData(updated)
      setSubItems(items)
    } catch (e) {
      setErrMsg(errText(e))
    } finally {
      setSubLoading(false)
    }
  }

  async function pickRecent(f: RecentFile) {
    setErrMsg('')
    setResolving(true)
    try {
      let data: DocRefAttachmentData | null = null
      if (f.kind === 'wiki' && resolveWikiNode) {
        const resolved = await resolveWikiNode(f.token)
        if (!resolved) { setErrMsg('无法解析该知识库节点'); return }
        if (resolved.kind !== 'sheet' && resolved.kind !== 'base') {
          setErrMsg('AI 看板仅支持多维表格和电子表格')
          return
        }
        data = {
          kind: resolved.kind,
          docToken: resolved.docToken,
          docTitle: displayName(f),
          url: buildFeishuUrl('wiki', f.token) || '',
        }
      } else if (f.kind === 'wiki') {
        const url = buildFeishuUrl('wiki', f.token) || ''
        data = await resolveDocRefFromUrl(url, settings)
        if (data && !data.docTitle) data.docTitle = displayName(f)
      } else {
        const url = buildFeishuUrl(f.kind, f.token) || ''
        data = { kind: f.kind, docToken: f.token, docTitle: displayName(f), url }
      }
      if (!data) { setErrMsg('无法解析该文档'); return }
      await selectSource(data)
    } catch (e) {
      setErrMsg(errText(e))
    } finally {
      setResolving(false)
    }
  }

  async function handleLinkSubmit() {
    const url = linkInput.trim()
    if (!url || resolving) return
    setResolving(true)
    setErrMsg('')
    try {
      const data = await resolveDocRefFromUrl(url, settings)
      if (!data) { setErrMsg('无法识别该链接'); return }
      if (data.kind !== 'sheet' && data.kind !== 'base') {
        setErrMsg('AI 看板仅支持多维表格和电子表格')
        return
      }
      if (!data.docTitle) {
        const match = recentFiles.find((f) => f.token === data!.docToken)
        if (match) data.docTitle = displayName(match)
      }
      await selectSource(data)
    } catch (e) {
      setErrMsg(errText(e))
    } finally {
      setResolving(false)
    }
  }

  function changeSubTable(id: string, name: string) {
    if (!sourceData) return
    const updated = sourceData.kind === 'sheet'
      ? { ...sourceData, sheetId: id, sheetName: name }
      : { ...sourceData, tableId: id, tableName: name }
    setSourceData(updated)
    setSubDropdownOpen(false)
    last.current = null
    setHasGen(false)
    setActiveVizId('')
    setStatus('')
  }

  function clearSource() {
    setSourceData(null)
    setSubItems([])
    setSubDropdownOpen(false)
    last.current = null
    setHasGen(false)
    setActiveVizId('')
    setRequest('')
    setStatus('')
    setErrMsg('')
  }

  async function generate(refine = false) {
    if (!request.trim() || busy) return
    if (refine && !last.current) return
    if (!sourceData) return
    setBusy(true); setErrMsg(''); setGenChars(0)
    const ac = new AbortController(); abortRef.current = ac
    try {
      setStatus('读取表结构…')
      const source = await deriveVizSourceFromDocRef(settings, sourceData)
      if (!source) throw new Error('无法识别该表格，请重新选择')
      const sample = await fetchVizData(settings, source, SAMPLE_CAP)
      if (!sample.schema.length) throw new Error('这张表没有可用的字段')

      setStatus(refine ? 'AI 调整当前看板…' : 'AI 生成看板代码…')
      const { name, code, spec, warning } = await generateViz(settings, {
        schema: sample.schema, sampleRows: sample.rows, request: request.trim(),
        previousCode: refine ? last.current!.code : undefined,
        previousSpec: refine ? last.current!.spec : undefined,
        signal: ac.signal, onProgress: setGenChars,
      })
      const finalName = refine && last.current ? last.current.name : name

      setStatus('拉取全部数据并渲染…')
      const full = await fetchVizData(settings, source, RENDER_CAP)
      await sendToOverlay({ code, spec }, full.rows, finalName)

      last.current = { name: finalName, code, spec, request: refine && last.current ? last.current.request : request.trim(), source }
      if (curKey) genCache.set(curKey, last.current)

      // Auto-save to history (like PPT does) so generations never get lost.
      const id = refine && activeVizId ? activeVizId : crypto.randomUUID()
      const existing = refine && activeVizId ? list.find((x) => x.id === activeVizId) : null
      const v: SavedViz = {
        id, name: finalName, source, code, spec,
        request: refine && last.current ? last.current.request : request.trim(),
        createdAt: existing?.createdAt ?? Date.now(), kind: 'viz',
      }
      setList(await saveViz(v))
      if (!refine) setActiveVizId(id)

      setHasGen(true)
      if (refine) setRequest('')
      setStatus(`已${refine ? '调整' : '生成'}「${finalName}」并展示在页面上${warning ? `　${warning}` : ''}`)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setStatus('已取消')
      else { setErrMsg(errText(e)); setStatus('') }
    } finally {
      setBusy(false); abortRef.current = null
    }
  }

  function cancel() { abortRef.current?.abort() }

  function newDraft() {
    last.current = null
    if (curKey) genCache.delete(curKey)
    setHasGen(false); setActiveVizId(''); setRequest(''); setStatus(''); setErrMsg(''); setGenChars(0)
  }

  /** Open a viz in the standalone viewer tab (page-independent, like PPT's deckViewer). */
  async function openInViewer(artifact: { code?: string; spec?: VizSpec }, source: VizSource, name: string) {
    const full = await fetchVizData(settings, source, RENDER_CAP)
    await chrome.storage.session.set({
      vizView: { code: artifact.code, spec: artifact.spec, data: full.rows, name, theme: theme() },
    })
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/viewer/vizViewer.html') })
  }

  /** Open the current generation in the viewer tab. */
  async function openViewer() {
    if (!last.current || busy) return
    setErrMsg('')
    try {
      await openInViewer({ code: last.current.code, spec: last.current.spec }, last.current.source, last.current.name)
    } catch (e) {
      setErrMsg(errText(e))
    }
  }

  /** Export the current generation as a standalone HTML file (via the viewer's export path). */
  async function exportHtml() {
    if (!last.current || busy) return
    setErrMsg('')
    try {
      const full = await fetchVizData(settings, last.current.source, RENDER_CAP)
      await chrome.storage.session.set({
        vizView: {
          code: last.current.code, spec: last.current.spec, data: full.rows,
          name: last.current.name, theme: theme(), export: true,
        },
      })
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/viewer/vizViewer.html?export=1') })
    } catch (e) {
      setErrMsg(errText(e))
    }
  }

  // 打开历史看板：参考 PPT 的 openSaved —— 不进入 busy，立即切换页面 + 打开标签页，
  // 子表异步加载，数据拉取在后台进行，避免「AI 处理中」长等待。
  async function open(v: SavedViz) {
    if (busy) return
    setDrawerOpen(false)
    setErrMsg(''); setStatus('')
    setActiveVizId(v.id)

    let code = v.code
    let spec = v.spec

    // 旧版 code-only 看板：在后台用当前数据重建 spec（不阻塞 UI）。
    if (NO_REMOTE_CODE && !spec && code) {
      void (async () => {
        try {
          const full = await fetchVizData(settings, v.source, RENDER_CAP)
          const res = await generateViz(settings, { schema: full.schema, sampleRows: full.rows.slice(0, SAMPLE_CAP), request: v.request || v.name })
          setList(await saveViz({ ...v, spec: res.spec }))
          last.current = { ...last.current!, spec: res.spec }
        } catch { /* 重建失败不影响查看 */ }
      })()
    }

    // 立即恢复数据源 + 生成状态，跳转到生成后的页面（显示重新生成/查看/导出按钮）
    const restored = vizSourceToDocRef(v.source, v.name)
    const restoredKey = ctxScopeKey({
      kind: restored.kind,
      appToken: restored.kind === 'base' ? restored.docToken : undefined,
      spreadsheetToken: restored.kind === 'sheet' ? restored.docToken : undefined,
      tableId: restored.kind === 'base' ? restored.tableId : undefined,
    })
    const artifact: LastViz = { name: v.name, code, spec, request: v.request, source: v.source }
    if (restoredKey) genCache.set(restoredKey, artifact)
    last.current = artifact
    setHasGen(true)
    setSourceData(restored)
    setLinkInput('')
    setRequest('')
    setSubItems([])
    setStatus('')

    // 异步加载子表列表（不阻塞），回填子表名
    setSubLoading(true)
    void (async () => {
      try {
        const items = await fetchSubTables(restored)
        setSubItems(items)
        const selId = restored.kind === 'sheet' ? restored.sheetId : restored.tableId
        const sel = items.find((it) => it.id === selId)
        if (sel) {
          setSourceData((prev) => prev ? {
            ...prev,
            sheetName: prev.kind === 'sheet' ? sel.name : prev.sheetName,
            tableName: prev.kind === 'base' ? sel.name : prev.tableName,
          } : prev)
        }
      } catch { /* 子表加载失败不影响展示 */ }
      finally { setSubLoading(false) }
    })()

    // 在新标签页展示 html（后台拉取数据，不设 busy）
    try {
      await openInViewer({ code, spec }, v.source, v.name)
    } catch (e) {
      setErrMsg(errText(e))
    }
  }

  async function remove(v: SavedViz) { setList(await deleteViz(v.id)) }

  return (
    <div className="scenario-panel view-enter" key="dataviz">
      <TopBar
        title="AI 看板"
        onBack={onBack}
        rightAction={
          <>
            {hasGen && (
              <Tooltip content="新建" position="bottom">
                <IconButton onClick={newDraft} aria-label="新建看板" disabled={busy}>
                  <IconPlus />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip content="历史记录" position="bottom">
              <IconButton onClick={() => setDrawerOpen(true)} aria-label="历史记录" disabled={busy}>
                <IconHistory />
              </IconButton>
            </Tooltip>
          </>
        }
      />
      <div className="dv-body">
        <p className="dv-sub">选择一个多维表格或电子表格，用一句话生成图表 / 看板。</p>

        {/* ── Source selection ── */}
        {!sourceData ? (
          <div className="dv-field">
            <label className="dv-label">数据源</label>
            <DocLinkField
              value={linkInput}
              onValueChange={setLinkInput}
              recentFiles={tableRecentFiles}
              onPickRecent={(f) => void pickRecent(f)}
              onRemoveRecent={onRemoveRecent}
              onSubmit={handleLinkSubmit}
              resolveWikiKind={resolveWikiKind}
              placeholder="粘贴表格链接或选择最近表格"
              disabled={disabled || busy || resolving}
            />
            {resolving && <p className="dv-hint">解析中…</p>}
          </div>
        ) : (
          <div className="dv-source-card" ref={subDropdownRef}>
            <div className="dv-source-card__top">
              <span className="dv-source-card__icon">
                <KindIcon kind={sourceData.kind} />
              </span>
              <span className="dv-source-card__name" title={sourceData.docTitle}>{sourceData.docTitle || '未命名'}</span>
              <Tooltip content="更换数据源">
                <button className="dv-source-card__remove" onClick={clearSource} disabled={busy} type="button" aria-label="更换数据源">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </Tooltip>
            </div>
            <button
              className="dv-source-card__sub"
              onClick={() => setSubDropdownOpen((o) => !o)}
              type="button"
              disabled={busy || subLoading}
            >
              <span className="dv-source-card__sub-label">{sourceData.kind === 'sheet' ? '工作表' : '数据表'}</span>
              <span className="dv-source-card__sub-name">
                {subLoading
                  ? '读取子表中…'
                  : (sourceData.sheetName || sourceData.tableName || '全部子表')}
              </span>
              {!subLoading && (
                <svg className="dv-source-card__sub-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
            </button>
            {subDropdownOpen && (
              <div className="dv-subtable-popup" role="listbox">
                {subItems.map((it) => {
                  const selected = sourceData.sheetId === it.id || sourceData.tableId === it.id
                  return (
                    <button
                      key={it.id}
                      className={`dv-subtable-item${selected ? ' dv-subtable-item--active' : ''}`}
                      onClick={() => changeSubTable(it.id, it.name)}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={it.name}
                    >
                      <span className="dv-subtable-item-name">{it.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Request + actions ── */}
        {sourceData && (
          <>
            <textarea
              className="dv-input"
              placeholder={hasGen
                ? '例如：把第二个图换成饼图；放大标题；左边的图加数据标签…'
                : '例如：按地区销量做柱状图；做一个利润计算器；把这张表做成报表…'}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={3}
              disabled={disabled || busy}
            />
            <div className="dv-actions">
              <Button variant="primary" block onClick={() => generate(hasGen)} disabled={disabled || busy || !request.trim()}>
                {busy ? '处理中…' : hasGen ? '重新生成' : '生成并展示'}
              </Button>
              {hasGen && (
                <div className="dv-actions dv-actions--row">
                  <Button variant="secondary" icon={<IconEye />} onClick={openViewer} disabled={busy}>查看看板</Button>
                  <Button variant="secondary" icon={<IconUpload />} onClick={exportHtml} disabled={busy}>导出 HTML</Button>
                </div>
              )}
            </div>
          </>
        )}

        {status && <p className="dv-hint">{status}</p>}
        {busy && (
          <p className="dv-hint">
            {genChars > 0 ? `AI 生成中…已生成 ${genChars} 字` : 'AI 处理中…'}
            {abortRef.current && <span className="dv-cancel" onClick={cancel} style={{ marginLeft: 8, color: '#4f6bff', cursor: 'pointer' }}>取消</span>}
          </p>
        )}
        {errMsg && <p className="dv-hint dv-hint--err">{errMsg}</p>}
        {disabled && <p className="dv-hint">请先在「设置」里完成 API Key / 飞书授权。</p>}
      </div>

      {drawerOpen && (
        <SideDrawer title="历史记录" onClose={() => setDrawerOpen(false)}>
          <div className="sl-decks">
            {list.length === 0 && <p className="sl-decks-empty">还没有保存过的看板</p>}
            {[...list]
              .sort((a, b) => {
                // 当前表格的看板置顶，再按创建时间倒序。
                const aInScope = sourceCtx ? (savedVizMatchesCtx(a, sourceCtx) ? 0 : 1) : 1
                const bInScope = sourceCtx ? (savedVizMatchesCtx(b, sourceCtx) ? 0 : 1) : 1
                if (aInScope !== bInScope) return aInScope - bInScope
                return b.createdAt - a.createdAt
              })
              .map((v) => {
                const inScope = !sourceCtx || savedVizMatchesCtx(v, sourceCtx)
                return (
                  <HistoryRow
                    key={v.id}
                    name={v.name}
                    meta={`${vizSourceLabel(v)} · ${timeAgo(v.createdAt)}${inScope && sourceCtx ? ' · 当前表格' : ''}`}
                    active={activeVizId === v.id}
                    onOpen={() => open(v)}
                    onDelete={() => remove(v)}
                    deleteDisabled={busy}
                    openDisabled={busy}
                    openTitle="在新标签页预览"
                  />
                )
              })}
          </div>
        </SideDrawer>
      )}
    </div>
  )
}
