import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '@/shared/types'
import type { RecentFile } from '../../services/recentFiles'
import { resolveToken } from '@/shared/feishu/auth'
import { polishMarkdown } from '@/shared/ai/mdPolish'
import { markdownToBlocks, insertContentBlocks, listBlocks } from '@/shared/feishu/docx'
import { cleanMarkdown, normalizeHeadingLevels } from '@/shared/mdClean'
import { openUrlInNewTab } from '@/shared/url'
import { loadPdfs, savePdf, deletePdf, type SavedPdf } from '../../lib/pdfHistory'
import { createDocDirect, type CreateResult } from './createTargets'
import TopBar from '../shell/TopBar'
import Button from '../ui/Button'
import SideDrawer from '../ui/SideDrawer'
import Markdown from '../chat/Markdown'
import { type DocTarget } from '../session/DocCombobox'
import UploadDrop from '../ui/UploadDrop'
import HistoryRow from '../session/HistoryRow'
import Tooltip from '../ui/Tooltip'
import IconButton from '../ui/IconButton'
import WriteTargetSection from './WriteTargetSection'
import { KindIcon, IconPlus, IconHistory, IconCopy, IconCheck, IconDownload, IconSparkle, IconX } from '../ui/icons'
import './PdfTranscribePanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
}

type Phase = 'idle' | 'selected' | 'converting' | 'done' | 'error'
type View = 'preview' | 'markdown'

export default function PdfTranscribePanel({ settings, context, disabled, onBack, recentFiles, onRemoveRecent }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState('document')
  const [activePdfId, setActivePdfId] = useState<string | null>(null)
  const [editMd, setEditMd] = useState('')
  const [view, setView] = useState<View>('preview')
  const [polishing, setPolishing] = useState(false)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [copied, setCopied] = useState(false)
  const [target, setTarget] = useState<DocTarget | null>(
    context.feishu?.kind === 'doc' && context.feishu?.documentId
      ? { token: context.feishu.documentId, title: '当前文档' } : null,
  )
  // 新建文档（直插，不走 AI）—— PDF 转写仅保留新建文档一项，内联展示结果。
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreateResult | null>(null)
  const [createErr, setCreateErr] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pdfs, setPdfs] = useState<SavedPdf[]>([])
  const pickedFile = useRef<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { loadPdfs().then(setPdfs) }, [])

  // Clear any pending "copied" reset on unmount so it can't setState after teardown.
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  // Auto-size the markdown editor to fit its content so it never shows its own scrollbar —
  // the outer .pdf-result-scroll region scrolls instead, matching the preview view exactly.
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editMd, view])

  function handleFile(file: File) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { setError('请上传 PDF 文件。'); setPhase('error'); return }
    setFileName(file.name.replace(/\.pdf$/i, ''))
    setEditMd(''); setError(''); setInfo('')
    setPhase('selected')
    pickedFile.current = file
  }

  async function handleConvert() {
    const file = pickedFile.current
    if (!file) return
    setPhase('converting'); setError(''); setInfo('')
    try {
      const { extractMarkdown, detectScan } = await import('@/shared/pdfExtract')
      const buf = await file.arrayBuffer()
      const md = await extractMarkdown(buf)
      const scan = detectScan(md)
      if (scan.likelyScan) { setError(scan.reason); setPhase('error'); return }
      // editMd = 默认清理（断行修复 + 压缩空行）后的干净稿。
      setEditMd(cleanMarkdown(normalizeHeadingLevels(md))); setView('preview'); setPhase('done')
      const id = crypto.randomUUID()
      setActivePdfId(id)
      setPdfs(await savePdf({ id, fileName, markdown: md, createdAt: Date.now() }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setPhase('error')
    }
  }

  async function handlePolish() {
    setPolishing(true); setError(''); setInfo('')
    try {
      // 基于当前编辑内容润色（editMd）——润色你"看到的"，不再丢手改。
      const polished = await polishMarkdown(settings, editMd)
      setEditMd(polished); setInfo('已 AI 润色。')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setPolishing(false) }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(editMd)
      setInfo('已复制到剪贴板。')
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('复制失败，请手动选择复制。')
    }
  }
  function handleExport() {
    const blob = new Blob([editMd], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${fileName}.md`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }
  async function handleAddToDoc() {
    if (!target?.token) { setError('请先选择目标文档。'); return }
    setWriting(true); setError(''); setInfo('')
    try {
      const token = await resolveToken(settings)
      const doc = target.token
      const v = await listBlocks(token, doc)
      const root = (v.items as Array<{ block_id?: string; children?: string[] }>).find((b) => b.block_id === doc)
      // The page block must exist — otherwise the link isn't a Feishu doc. But a BLANK doc's page
      // block comes back without a `children` array (or with `[]`); that's a valid empty document,
      // not an error — insert at index 0 (the start). Only the truly-missing-root case throws.
      if (!root) throw new Error('无法确定文档末尾位置，请确认链接指向飞书文档。')
      await insertContentBlocks(token, doc, markdownToBlocks(editMd), root.children?.length ?? 0)
      setInfo(`已写入「${target.title}」末尾。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setWriting(false) }
  }

  // ── 新建文档（直插，不走 AI）—— PDF 转写仅保留新建文档 ──────────────────────
  async function runCreateDoc() {
    setCreating(true); setCreateErr(''); setCreated(null); setError(''); setInfo('')
    try {
      const token = await resolveToken(settings)
      const r = await createDocDirect(token, `${fileName} - 文档`, editMd, settings)
      setCreated(r)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  function openHistory(p: SavedPdf) {
    // History items saved before the PAGE_BREAK strip could still carry HTML comments —
    // scrub them so neither the editor nor the preview shows literal <!-- PAGE_BREAK -->.
    const md = p.markdown.replace(/<!--[\s\S]*?-->/g, '')
    setFileName(p.fileName); setEditMd(cleanMarkdown(normalizeHeadingLevels(md)))
    setActivePdfId(p.id)
    pickedFile.current = null; setError(''); setInfo('已载入历史记录。')
    setPhase('done'); setHistoryOpen(false)
  }
  async function removeHistory(id: string) { setPdfs(await deletePdf(id)) }

  // Start a fresh task session — clear the picked file and parsed result so the upload module
  // reappears. Mirrors SlidesPanel.newDraft. `target` is intentionally kept: the write
  // destination is independent of which PDF is loaded.
  function newTask() {
    pickedFile.current = null
    setPhase('idle')
    setFileName('document')
    setActivePdfId(null)
    setEditMd('')
    setView('preview')
    setError(''); setInfo('')
    setCopied(false)
    setCreating(false); setCreated(null); setCreateErr('')
  }

  const hasFile = phase === 'selected' || phase === 'converting' || phase === 'done'

  return (
    <div className="scenario-panel view-enter" key="pdf">
      <TopBar title="PDF 转 Markdown" onBack={onBack} rightAction={
        <>
          {phase === 'done' && (
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
      <div className="sc-detail-body">
        {phase !== 'done' && (
          <p className="sl-sub">上传 PDF 文件，本地解析为 Markdown，可复制、下载、AI 润色或写入飞书文档。</p>
        )}

        <input type="file" accept=".pdf,application/pdf" hidden ref={fileInputRef} data-testid="pdf-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        {/* 上传文件 */}
        <div className="sc-field">
          <label className="sc-field-label">上传文件</label>
          {phase !== 'done' && (
            <UploadDrop
              busy={phase === 'converting'} max={1} count={hasFile ? 1 : 0}
              mainText="点击或拖入 PDF 文件" hintText="本地解析，不上传服务器"
              onFiles={(fl) => { const f = fl[0]; if (f) handleFile(f) }}
              onTrigger={() => fileInputRef.current?.click()} />
          )}
          {hasFile && (
            <div
              className={`file-source-card${phase === 'converting' ? ' is-busy' : ''}`}
              data-testid="pdf-picked-file"
              role={phase === 'selected' ? 'button' : undefined}
              tabIndex={phase === 'selected' ? 0 : undefined}
              aria-label={phase === 'selected' ? '点击或拖入 PDF 更换文件' : undefined}
              onClick={phase === 'selected' ? () => fileInputRef.current?.click() : undefined}
              onDragOver={phase === 'selected' ? (e) => { e.preventDefault(); e.stopPropagation() } : undefined}
              onDrop={phase === 'selected' ? (e) => {
                e.preventDefault(); e.stopPropagation()
                const f = e.dataTransfer.files?.[0]; if (f) handleFile(f)
              } : undefined}
            >
              <span className="file-source-ic"><KindIcon kind="doc" /></span>
              <div className="file-source-meta">
                <div className="file-source-name">{fileName}.pdf</div>
                <div className="file-source-sub">{phase === 'converting' ? '解析中…' : phase === 'selected' ? '点击或拖入更换' : '已转换'}</div>
              </div>
              <span className="file-source-tag">PDF</span>
              {phase === 'selected' && (
                <IconButton
                  className="file-source-x"
                  aria-label="移除文件"
                  onClick={(e) => { e.stopPropagation(); pickedFile.current = null; setPhase('idle') }}
                >
                  <IconX />
                </IconButton>
              )}
            </div>
          )}
        </div>

        {phase === 'converting' && <div className="sc-pdf-progress">正在解析 PDF…</div>}

        {phase === 'error' && (
          <div className="sc-error-box">
            <div className="sc-error-title">无法转写</div>
            <div className="sc-error-msg">{error}</div>
            <Button variant="primary" onClick={() => setPhase(pickedFile.current ? 'selected' : 'idle')}>重新选择</Button>
          </div>
        )}

        {(phase === 'selected' || phase === 'converting') && (
          <div className="pdf-actions">
            <Button variant="primary" className="pdf-action-btn" onClick={handleConvert} disabled={phase === 'converting'} loading={phase === 'converting'}>
              {phase === 'converting' ? '转换中…' : '转换'}
            </Button>
            <Button variant="secondary" className="pdf-action-btn" disabled={phase === 'converting'} onClick={() => { pickedFile.current = null; setPhase('idle') }}>选择文件</Button>
          </div>
        )}

        {phase === 'done' && (
          <>
            {/* 转换结果 */}
            <div className="sc-field">
              <label className="sc-field-label">转换结果</label>
              <div className="pdf-result-box" data-testid="pdf-result-box">
                <div className="pdf-result-bar">
                  <div className="sc-target-opts pdf-view-toggle">
                    <button className={`sc-target-opt${view === 'preview' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('preview')}>预览</button>
                    <button className={`sc-target-opt${view === 'markdown' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('markdown')}>Markdown</button>
                  </div>
                  <div className="pdf-result-icons">
                    <Tooltip content={copied ? '已复制' : '复制'}>
                      <Button size="sm" variant="ghost" icon={copied ? <IconCheck /> : <IconCopy />} onClick={handleCopy} aria-label={copied ? '已复制' : '复制'} className={copied ? 'is-copied' : undefined} />
                    </Tooltip>
                    <Tooltip content="下载">
                      <Button size="sm" variant="ghost" icon={<IconDownload />} onClick={handleExport} aria-label="下载" />
                    </Tooltip>
                    <Tooltip content="AI 润色">
                      <Button size="sm" variant="ghost" icon={<IconSparkle />} onClick={handlePolish} disabled={disabled} loading={polishing} aria-label="AI 润色" />
                    </Tooltip>
                  </div>
                </div>
                <div className="pdf-result-scroll">
                  {view === 'preview'
                    ? <div data-testid="pdf-preview"><Markdown>{editMd}</Markdown></div>
                    : <textarea ref={editorRef} className="field-input sc-pdf-editor" data-testid="pdf-editor" value={editMd} onChange={(e) => setEditMd(e.target.value)} />}
                </div>
              </div>
              {disabled && <p className="sc-pdf-hint">AI 润色需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}
            </div>

            {/* 目标文档 + 新建 —— 复用文件导入的 WriteTargetSection，仅保留新建文档 */}
            <WriteTargetSection
              recentFiles={recentFiles} onRemoveRecent={onRemoveRecent}
              target={target} onTargetChange={setTarget}
              onConfirm={handleAddToDoc} writing={writing || creating}
              onNewDoc={runCreateDoc}
              kinds={['doc']}
              busy={creating}
            />

            {creating && (
              <div className="wt-create-running">
                <span className="wt-create-spinner" /> 正在新建并写入…
              </div>
            )}
            {createErr && <div className="wt-create-err">{createErr}</div>}
            {created && (
              <div className="wt-create-done">
                <span className="wt-create-done-text">已新建「{created.name}」并写入内容</span>
                <Button size="sm" variant="primary" onClick={() => openUrlInNewTab(created.url)}>打开 ↗</Button>
              </div>
            )}
          </>
        )}

        {error && phase !== 'error' && <div className="sc-refresh-err">{error}</div>}
        {!error && info && phase === 'done' && <div className="sc-registry-info">{info}</div>}
      </div>

      {historyOpen && (
        <SideDrawer title="历史记录" onClose={() => setHistoryOpen(false)}>
          <div className="pdf-history-list">
            {pdfs.length === 0 && <p className="pdf-history-empty">还没有转换过的文件</p>}
            {[...pdfs].sort((a, b) => b.createdAt - a.createdAt).map((p) => (
              <HistoryRow key={p.id}
                name={`${p.fileName}.pdf`}
                meta={timeAgo(p.createdAt)}
                active={p.id === activePdfId}
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
