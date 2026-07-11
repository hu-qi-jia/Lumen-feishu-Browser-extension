import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '@/shared/types'
import type { ClipCapture } from '@/shared/clip/types'
import { fileToClip } from '@/shared/clip/file'
import { resolveToken } from '@/shared/feishu/auth'
import { formatMarkdown } from '@/shared/ai/mdPolish'
import { markdownToSegments, insertSegments, listBlocks } from '@/shared/feishu/docx'
import { openUrlInNewTab } from '@/shared/url'
import type { RecentFile } from '../../services/recentFiles'
import { loadFileImports, saveFileImport, deleteFileImport, type SavedFileImport } from '../../lib/fileImportHistory'
import { createDocDirect, createBaseDirect, createSheetDirect, type CreateResult } from './createTargets'
import TopBar from '../shell/TopBar'
import Button from '../ui/Button'
import Markdown from '../chat/Markdown'
import Tooltip from '../ui/Tooltip'
import IconButton from '../ui/IconButton'
import UploadDrop from '../ui/UploadDrop'
import SideDrawer from '../ui/SideDrawer'
import HistoryRow from '../session/HistoryRow'
import WriteTargetSection from './WriteTargetSection'
import { KindIcon, IconPlus, IconHistory } from '../ui/icons'
import './FileImportPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
}

type Phase = 'idle' | 'parsing' | 'preview' | 'failed'
type BodyView = 'preview' | 'markdown'

export default function FileImportPanel({ settings, context, disabled, onBack, recentFiles, onRemoveRecent }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [clip, setClip] = useState<ClipCapture | null>(null)
  const [editMd, setEditMd] = useState('')
  const [bodyView, setBodyView] = useState<BodyView>('preview')
  const [activeId, setActiveId] = useState<string | null>(null)
  // 目标文档（DocCombobox 单目标）。当前页是飞书文档时预填。
  const [target, setTarget] = useState<{ token: string; title: string } | null>(
    context.feishu?.kind === 'doc' && context.feishu?.documentId
      ? { token: context.feishu.documentId, title: '当前文档' } : null,
  )
  const [writing, setWriting] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const [info, setInfo] = useState('')
  // 新建目标（直插，内联展示，不跳转）
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreateResult | null>(null)
  const [createErr, setCreateErr] = useState('')
  // 写入/新建时的当前步骤文案（优化格式 → 写入/新建），驱动内联 loading。
  const [busyLabel, setBusyLabel] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [imports, setImports] = useState<SavedFileImport[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => { loadFileImports().then(setImports) }, [])

  // 编辑器自适应高度（同 PdfTranscribePanel / ClipPanel）
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editMd, bodyView])

  async function handleFile(file: File) {
    setPhase('parsing'); setErrMsg(''); setInfo(''); setCreated(null); setCreateErr('')
    try {
      const c = await fileToClip(file)
      setClip(c); setEditMd(c.content); setBodyView('preview')
      setActiveId(null); setPhase('preview')
      const id = crypto.randomUUID()
      setActiveId(id)
      const ext = file.name.toLowerCase().split('.').pop() || ''
      setImports(await saveFileImport({ id, fileName: file.name, fileType: ext, content: c.content, truncated: c.truncated, createdAt: Date.now() }))
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e)); setPhase('failed')
    }
  }

  // 写入已有文档 —— 先 AI 优化格式（仅排版、不改内容），再插入 blocks。
  async function handleAddToDoc() {
    if (!target?.token) { setErrMsg('请先选择目标文档。'); return }
    setWriting(true); setErrMsg(''); setInfo(''); setBusyLabel('正在优化格式…')
    try {
      const token = await resolveToken(settings)
      // AI 优化格式；失败则降级用原 markdown（不阻断写入）。
      let md = editMd
      if (!disabled) {
        try { md = await formatMarkdown(settings, editMd) } catch { /* 降级 */ }
      }
      setBusyLabel('正在写入…')
      const doc = target.token
      const v = await listBlocks(token, doc)
      const root = (v.items as Array<{ block_id?: string; children?: string[] }>).find((b) => b.block_id === doc)
      if (!root) throw new Error('无法确定文档末尾位置，请确认链接指向飞书文档。')
      await insertSegments(token, doc, markdownToSegments(md), root.children?.length ?? 0)
      setInfo(`已写入「${target.title}」末尾。`)
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setWriting(false); setBusyLabel('')
    }
  }

  // ── 新建目标：先 AI 优化格式（仅排版、不改内容），再直插创建，内联展示 ──────────
  function titleFor(kind: string): string {
    const base = clip?.title?.replace(/\.[^.]+$/, '') || '文件导入'
    return `${base} - ${kind}`
  }
  async function runCreate(kind: 'doc' | 'base' | 'sheet') {
    if (!clip) return
    setCreating(true); setCreateErr(''); setCreated(null); setErrMsg(''); setInfo(''); setBusyLabel('正在优化格式…')
    try {
      const token = await resolveToken(settings)
      // AI 优化格式；失败则降级用原 markdown（不阻断创建）。
      let md = editMd
      if (!disabled) {
        try { md = await formatMarkdown(settings, editMd) } catch { /* 降级 */ }
      }
      setBusyLabel('正在新建并写入…')
      const title = titleFor(kind === 'base' ? '多维表格' : kind === 'sheet' ? '电子表格' : '文档')
      const r = kind === 'doc'
        ? await createDocDirect(token, title, md, settings)
        : kind === 'sheet'
          ? await createSheetDirect(token, title, md, settings)
          : await createBaseDirect(token, title, md, settings)
      setCreated(r)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false); setBusyLabel('')
    }
  }

  function openHistory(p: SavedFileImport) {
    setClip({ url: 'file://' + p.fileName, title: p.fileName, selectedText: '', content: p.content, capturedAt: p.createdAt, truncated: p.truncated })
    setEditMd(p.content); setBodyView('preview'); setActiveId(p.id)
    setErrMsg(''); setInfo(''); setCreated(null); setCreateErr(''); setPhase('preview'); setHistoryOpen(false)
  }
  async function removeHistory(id: string) { setImports(await deleteFileImport(id)) }

  function newTask() {
    setClip(null); setEditMd(''); setErrMsg(''); setInfo(''); setStatus0()
    setActiveId(null); setPhase('idle')
  }
  function setStatus0() { setCreated(null); setCreateErr(''); setCreating(false); setBusyLabel('') }

  const hasFile = phase === 'preview'

  return (
    <div className="scenario-panel view-enter" key="fileImport">
      <TopBar title="文件导入" onBack={onBack} rightAction={
        <>
          {hasFile && (
            <Tooltip content="新建任务" position="bottom">
              <IconButton onClick={newTask} aria-label="新建任务">
                <IconPlus />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip content="历史记录" position="bottom">
            <IconButton onClick={() => setHistoryOpen(true)} aria-label="历史记录">
              <IconHistory />
            </IconButton>
          </Tooltip>
        </>
      } />
      <div className="sc-detail-body fi-body">
        {phase === 'failed' && (
          <div className="sc-error-box">
            <div className="sc-error-title">导入失败</div>
            <div className="sc-error-msg">{errMsg || '无法解析该文件。'}</div>
            <Button variant="primary" onClick={() => { setErrMsg(''); setPhase('idle') }}>重新选择</Button>
          </div>
        )}

        {phase !== 'failed' && (
          <>
            {phase === 'idle' && (
              <p className="sl-sub">拖入或选择 CSV / TSV / TXT 文件，本地解析为表格后，AI 整理并写入飞书。</p>
            )}

            <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" hidden ref={fileInputRef}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />

            {(phase === 'idle' || phase === 'parsing') && (
              <div className="sc-field">
                <label className="sc-field-label">上传文件</label>
                <UploadDrop
                  busy={phase === 'parsing'} max={1} count={hasFile ? 1 : 0}
                  mainText="点击或拖入 CSV / TSV / TXT 文件"
                  hintText="本地解析 · 单文件 ≤ 5MB · Excel 请先另存为 CSV"
                  onFiles={(fl) => { const f = fl[0]; if (f) handleFile(f) }}
                  onTrigger={() => fileInputRef.current?.click()} />
              </div>
            )}

            {phase === 'parsing' && <div className="sc-pdf-progress">正在解析文件…</div>}

            {phase === 'preview' && clip && (
              <>
                {/* 文件信息卡 */}
                <div className="file-source-card">
                  <span className="file-source-ic"><KindIcon kind="doc" /></span>
                  <div className="file-source-meta">
                    <div className="file-source-name">{clip.title}</div>
                    <div className="file-source-sub">{clip.truncated ? '已截断 · ' : ''}{clip.content.length} 字符</div>
                  </div>
                  <span className="file-source-tag">{(clip.title.toLowerCase().split('.').pop() || '').toUpperCase()}</span>
                </div>

                {/* 识别结果 */}
                <div className="sc-field">
                  <label className="sc-field-label">识别结果</label>
                  <div className="pdf-result-box">
                    <div className="pdf-result-bar">
                      <div className="sc-target-opts pdf-view-toggle">
                        <button className={`sc-target-opt${bodyView === 'preview' ? ' sc-target-opt--active' : ''}`} onClick={() => setBodyView('preview')}>预览</button>
                        <button className={`sc-target-opt${bodyView === 'markdown' ? ' sc-target-opt--active' : ''}`} onClick={() => setBodyView('markdown')}>Markdown</button>
                      </div>
                    </div>
                    <div className="pdf-result-scroll">
                      {bodyView === 'preview'
                        ? <div data-testid="fi-preview"><Markdown>{editMd || '(空)'}</Markdown></div>
                        : <textarea ref={editorRef} className="field-input sc-pdf-editor" data-testid="fi-editor" value={editMd} onChange={(e) => setEditMd(e.target.value)} />}
                    </div>
                  </div>
                </div>

                {/* 目标文档 + 新建 —— 共享 WriteTargetSection */}
                <WriteTargetSection
                  recentFiles={recentFiles} onRemoveRecent={onRemoveRecent}
                  target={target} onTargetChange={setTarget}
                  onConfirm={handleAddToDoc} writing={writing || creating}
                  onNewDoc={() => runCreate('doc')} onNewBase={() => runCreate('base')} onNewSheet={() => runCreate('sheet')}
                  busy={creating}
                />

                {/* 写入/新建进行中：显示当前步骤（优化格式 → 写入/新建） */}
                {busyLabel && (
                  <div className="wt-create-running">
                    <span className="wt-create-spinner" /> {busyLabel}
                  </div>
                )}
                {createErr && <div className="wt-create-err">{createErr}</div>}
                {created && (
                  <div className="wt-create-done">
                    <span className="wt-create-done-text">已新建「{created.name}」并写入内容</span>
                    <Button size="sm" variant="primary" onClick={() => openUrlInNewTab(created.url)}>打开</Button>
                  </div>
                )}

                {disabled && <p className="sc-pdf-hint">写入飞书需要完成 API Key / 飞书授权。</p>}
                {errMsg && <div className="sc-refresh-err">{errMsg}</div>}
                {!errMsg && info && <div className="sc-registry-info">{info}</div>}
              </>
            )}
          </>
        )}
      </div>

      {historyOpen && (
        <SideDrawer title="导入历史" onClose={() => setHistoryOpen(false)}>
          <div className="fi-history-list">
            {imports.length === 0 && <p className="fi-history-empty">还没有导入过的文件</p>}
            {[...imports].sort((a, b) => b.createdAt - a.createdAt).map((p) => (
              <HistoryRow key={p.id}
                name={p.fileName}
                meta={timeAgo(p.createdAt)}
                active={p.id === activeId}
                onOpen={() => openHistory(p)}
                onDelete={() => removeHistory(p.id)}
              />
            ))}
          </div>
        </SideDrawer>
      )}
    </div>
  )
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
