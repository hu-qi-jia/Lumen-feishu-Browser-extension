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
import DocLinkField from '../session/DocLinkField'
import { KindIcon } from '../ui/icons'
import '../session/DocCombobox.css'
import './DataVizPanel.css'

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

export default function DataVizPanel({ settings, disabled, onBack, recentFiles, onRemoveRecent, resolveWikiKind, resolveWikiNode }: Props) {
  const [linkInput, setLinkInput] = useState('')
  const [sourceData, setSourceData] = useState<DocRefAttachmentData | null>(null)
  const [subItems, setSubItems] = useState<{ id: string; name: string }[]>([])
  const [subDropdownOpen, setSubDropdownOpen] = useState(false)
  const [resolving, setResolving] = useState(false)

  const [request, setRequest] = useState('')
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [genChars, setGenChars] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const [list, setList] = useState<SavedViz[]>([])
  const last = useRef<LastViz | null>(null)
  const [canSave, setCanSave] = useState(false)
  const [hasGen, setHasGen] = useState(false)
  const subDropdownRef = useRef<HTMLDivElement>(null)

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

  // Build a fake page-context from the selected source for scope matching.
  const sourceCtx = sourceData ? {
    kind: sourceData.kind,
    appToken: sourceData.kind === 'base' ? sourceData.docToken : undefined,
    spreadsheetToken: sourceData.kind === 'sheet' ? sourceData.docToken : undefined,
    tableId: sourceData.kind === 'base' ? sourceData.tableId : undefined,
  } : null
  const curKey = sourceCtx ? ctxScopeKey(sourceCtx) : null
  const visible = sourceCtx ? list.filter((v) => savedVizMatchesCtx(v, sourceCtx)) : list

  // Restore the last generation for this source (survives tab-switch unmount).
  useEffect(() => {
    const cached = curKey ? genCache.get(curKey) : null
    last.current = cached ?? null
    setHasGen(!!cached)
    setCanSave(!!cached)
    setStatus(cached ? `已恢复上次生成的「${cached.name}」——可保存或重新调整` : '')
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
      setLinkInput('')
      setErrMsg('')
      // Reset generation state — new source.
      last.current = null
      setHasGen(false)
      setCanSave(false)
      setStatus('')
    } catch (e) {
      setErrMsg(errText(e))
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
    setCanSave(false)
    setStatus('')
  }

  function clearSource() {
    setSourceData(null)
    setSubItems([])
    setSubDropdownOpen(false)
    last.current = null
    setHasGen(false)
    setCanSave(false)
    setRequest('')
    setStatus('')
    setErrMsg('')
  }

  async function generate(refine = false) {
    if (!request.trim() || busy) return
    if (refine && !last.current) return
    if (!sourceData) return
    setBusy(true); setErrMsg(''); setCanSave(false); setGenChars(0)
    const ac = new AbortController(); abortRef.current = ac
    try {
      setStatus('读取表结构…')
      const source = await deriveVizSourceFromDocRef(settings, sourceData)
      if (!source) throw new Error('无法识别该表格，请重新选择')
      const sample = await fetchVizData(settings, source, SAMPLE_CAP)
      if (!sample.schema.length) throw new Error('这张表没有可用的字段')

      setStatus(refine ? 'AI 调整当前小程序…' : 'AI 生成小程序代码…')
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
      setHasGen(true); setCanSave(true)
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
    setHasGen(false); setCanSave(false); setRequest(''); setStatus(''); setErrMsg(''); setGenChars(0)
  }

  async function save() {
    if (!last.current) return
    const v: SavedViz = {
      id: crypto.randomUUID(), name: last.current.name, source: last.current.source,
      code: last.current.code, spec: last.current.spec, request: last.current.request,
      createdAt: Date.now(), kind: 'viz',
    }
    setList(await saveViz(v)); setCanSave(false); setStatus(`已保存「${v.name}」到「我的小程序」`)
  }

  async function open(v: SavedViz) {
    setBusy(true); setErrMsg(''); setStatus(`打开「${v.name}」…`)
    try {
      if (NO_REMOTE_CODE && !v.spec && v.code) {
        setStatus(`「${v.name}」由旧版生成，正用当前数据重建…`)
        const full = await fetchVizData(settings, v.source, RENDER_CAP)
        const { spec, warning } = await generateViz(settings, { schema: full.schema, sampleRows: full.rows.slice(0, SAMPLE_CAP), request: v.request || v.name })
        await sendToOverlay({ spec }, full.rows, v.name)
        setList(await saveViz({ ...v, spec }))
        setStatus(`已重建并渲染「${v.name}」（已保存，下次秒开）${warning ? `　${warning}` : ''}`)
        return
      }
      const full = await fetchVizData(settings, v.source, RENDER_CAP)
      await sendToOverlay({ code: v.code, spec: v.spec }, full.rows, v.name)
      setStatus(`已用最新数据渲染「${v.name}」`)
    } catch (e) {
      setErrMsg(errText(e)); setStatus('')
    } finally { setBusy(false) }
  }

  async function remove(v: SavedViz) { setList(await deleteViz(v.id)) }

  return (
    <div className="scenario-panel view-enter" key="dataviz">
      <TopBar title="AI 看板" onBack={onBack} />
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
            <span className="dv-source-icon">
              <KindIcon kind={sourceData.kind} />
            </span>
            <span className="dv-source-name" title={sourceData.docTitle}>{sourceData.docTitle || '未命名'}</span>
            <span className="dv-source-divider" aria-hidden="true" />
            <button
              className="dv-source-subtable"
              onClick={() => setSubDropdownOpen((o) => !o)}
              type="button"
              disabled={busy}
            >
              <span>{sourceData.sheetName || sourceData.tableName || '全部子表'}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <Tooltip content="更换数据源">
              <button className="dv-source-remove" onClick={clearSource} disabled={busy} type="button" aria-label="更换数据源">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </Tooltip>
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
            <Button variant="primary" block onClick={() => generate(false)} disabled={disabled || busy || !request.trim()}>
              {busy ? '处理中…' : hasGen ? '重新生成' : '生成并展示'}
            </Button>
            {hasGen && (
              <Button block onClick={() => generate(true)} disabled={disabled || busy || !request.trim()}>
                按上面文字微调（只改你说的那处）
              </Button>
            )}
            {canSave && (
              <Button block onClick={save} disabled={busy}>保存为「我的小程序」</Button>
            )}
            {hasGen && (
              <Button block onClick={newDraft} disabled={busy}>新建一个</Button>
            )}
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

        {visible.length > 0 && (
          <>
            <div className="dv-section">
              {sourceData ? '我的小程序（当前表格 · 点击用最新数据打开）' : '我的小程序'}
            </div>
            <div className="dv-list">
              {visible.map((v) => (
                <div key={v.id} className="dv-item">
                  <Tooltip content="用最新数据重新渲染" position="top">
                    <button className="dv-item-open" onClick={() => open(v)} disabled={busy}>
                      {v.name}
                    </button>
                  </Tooltip>
                  <Tooltip content="删除" position="top">
                    <IconButton variant="danger" className="dv-item-del" onClick={() => remove(v)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></IconButton>
                  </Tooltip>
                </div>
              ))}
            </div>
          </>
        )}
        {visible.length === 0 && list.length > 0 && sourceData && (
          <p className="dv-hint">你在其它表格保存过 {list.length} 个小程序——切换到对应表格即可打开。</p>
        )}
      </div>
    </div>
  )
}
