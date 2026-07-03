import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import type { RecentFile } from '../recentFiles'
import { resolveToken } from '../../shared/feishu/auth'
import { polishMarkdown } from '../../shared/ai/mdPolish'
import { markdownToBlocks, insertContentBlocks, listBlocks } from '../../shared/feishu/docx'
import { loadPdfs, savePdf, deletePdf, type SavedPdf } from '../pdfHistory'
import TopBar from './TopBar'
import Button from './Button'
import SideDrawer from './SideDrawer'
import Markdown from './Markdown'
import DocCombobox, { type DocTarget } from './DocCombobox'
import { IconUpload, IconFileText, IconHistory, IconX } from './icons'
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
  const [rawMd, setRawMd] = useState('')
  const [editMd, setEditMd] = useState('')
  const [view, setView] = useState<View>('preview')
  const [polishing, setPolishing] = useState(false)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [target, setTarget] = useState<DocTarget | null>(
    context.feishu?.kind === 'doc' && context.feishu?.appToken
      ? { token: context.feishu.appToken, title: '当前文档' } : null,
  )
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pdfs, setPdfs] = useState<SavedPdf[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const pickedFile = useRef<File | null>(null)

  useEffect(() => { loadPdfs().then(setPdfs) }, [])

  function handleFile(file: File) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { setError('请上传 PDF 文件。'); setPhase('error'); return }
    setFileName(file.name.replace(/\.pdf$/i, ''))
    setRawMd(''); setEditMd(''); setError(''); setInfo('')
    setPhase('selected')
    pickedFile.current = file
  }

  async function handleConvert() {
    const file = pickedFile.current
    if (!file) return
    setPhase('converting'); setError(''); setInfo('')
    try {
      const { extractMarkdown, detectScan } = await import('../../shared/pdfExtract')
      const buf = await file.arrayBuffer()
      const md = await extractMarkdown(buf)
      const scan = detectScan(md)
      if (scan.likelyScan) { setError(scan.reason); setPhase('error'); return }
      setRawMd(md); setEditMd(md); setView('preview'); setPhase('done')
      setPdfs(await savePdf({ id: crypto.randomUUID(), fileName, markdown: md, createdAt: Date.now() }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setPhase('error')
    }
  }

  async function handlePolish() {
    setPolishing(true); setError(''); setInfo('')
    try {
      const polished = await polishMarkdown(settings, rawMd)
      setEditMd(polished); setInfo('已 AI 润色。')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setPolishing(false) }
  }

  async function handleCopy() {
    try { await navigator.clipboard.writeText(editMd); setInfo('已复制到剪贴板。') }
    catch { setError('复制失败，请手动选择复制。') }
  }
  function handleExport() {
    const blob = new Blob([editMd], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${fileName}.md`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }
  async function handleAddToDoc() {
    if (!target?.token) { setInfo('请先选择目标文档。'); return }
    setWriting(true); setError(''); setInfo('')
    try {
      const token = await resolveToken(settings)
      const doc = target.token
      const v = await listBlocks(token, doc)
      const root = (v.items as Array<{ block_id?: string; children?: string[] }>).find((b) => b.block_id === doc)
      if (!root?.children) throw new Error('无法确定文档末尾位置，请确认链接指向飞书文档。')
      await insertContentBlocks(token, doc, markdownToBlocks(editMd), root.children.length)
      setInfo(`已写入「${target.title}」末尾。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setWriting(false) }
  }

  function openHistory(p: SavedPdf) {
    setFileName(p.fileName); setRawMd(p.markdown); setEditMd(p.markdown)
    pickedFile.current = null; setError(''); setInfo('已载入历史记录。')
    setPhase('done'); setHistoryOpen(false)
  }
  async function removeHistory(id: string) { setPdfs(await deletePdf(id)) }

  // drag handlers (stopPropagation so Feishu's page-level clip handler doesn't hijack)
  const stop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation() }
  function onDrop(e: React.DragEvent) {
    stop(e)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  return (
    <div className="scenario-panel view-enter" key="pdf">
      <TopBar title="PDF 转写" onBack={onBack} rightAction={
        <button className="sc-history-btn" onClick={() => setHistoryOpen(true)} aria-label="历史记录" title="历史记录">
          <IconHistory />
        </button>
      } />
      <div className="sc-detail-body">
        {phase === 'idle' && (
          <label className="sc-pdf-drop" data-testid="pdf-drop"
            onDragEnter={stop} onDragOver={stop} onDragLeave={stop} onDrop={onDrop}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" hidden data-testid="pdf-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            <span className="sc-pdf-drop-ic"><IconUpload /></span>
            <p>点击或拖入 PDF 文件</p>
            <p className="sc-pdf-hint">本地解析，不上传服务器</p>
          </label>
        )}

        {phase !== 'idle' && (
          <div className="pdf-file-card">
            <span className="pdf-file-ic"><IconFileText /></span>
            <span className="pdf-file-name">{fileName}.pdf</span>
          </div>
        )}

        {phase === 'converting' && <div className="sc-pdf-progress">正在解析 PDF…</div>}

        {phase === 'error' && (
          <div className="sc-error-box">
            <div className="sc-error-title">无法转写</div>
            <div className="sc-error-msg">{error}</div>
            <Button variant="primary" onClick={() => setPhase(pickedFile.current ? 'selected' : 'idle')}>重新选择</Button>
          </div>
        )}

        {(phase === 'selected' || phase === 'converting' || phase === 'done') && (
          <div className="sc-done-actions pdf-action-row">
            {phase !== 'done' && (
              <Button variant="primary" onClick={handleConvert} disabled={phase === 'converting'} loading={phase === 'converting'}>
                {phase === 'converting' ? '转换中…' : '转换'}
              </Button>
            )}
            <Button onClick={() => { pickedFile.current = null; setPhase('idle') }}>选择文件</Button>
          </div>
        )}

        {phase === 'done' && (
          <div className="pdf-result">
            <div className="pdf-result-head">
              <div className="sc-target-opts pdf-view-toggle">
                <button className={`sc-target-opt${view === 'preview' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('preview')}>预览</button>
                <button className={`sc-target-opt${view === 'markdown' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('markdown')}>Markdown</button>
              </div>
            </div>
            {view === 'preview'
              ? <div className="pdf-preview" data-testid="pdf-preview"><Markdown>{editMd}</Markdown></div>
              : <textarea className="field-input sc-pdf-editor" data-testid="pdf-editor" value={editMd} onChange={(e) => setEditMd(e.target.value)} rows={16} />}
            <div className="sc-done-actions pdf-actions">
              <Button onClick={handleCopy}>复制</Button>
              <Button onClick={handleExport}>下载</Button>
              <Button onClick={handlePolish} disabled={disabled} loading={polishing}>AI 润色</Button>
            </div>
            {disabled && <p className="sc-pdf-hint">AI 润色需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}
            <DocCombobox recentFiles={recentFiles} onRemoveRecent={onRemoveRecent}
              target={target} onTargetChange={setTarget} onConfirm={handleAddToDoc} writing={writing} />
          </div>
        )}

        {error && phase !== 'error' && <div className="sc-refresh-err">{error}</div>}
        {!error && info && phase === 'done' && <div className="sc-registry-info">{info}</div>}
      </div>

      {historyOpen && (
        <SideDrawer title="历史记录" onClose={() => setHistoryOpen(false)}>
          <div className="pdf-history">
            {pdfs.length === 0 && <p className="pdf-history-empty">还没有转换过的文件</p>}
            {[...pdfs].sort((a, b) => b.createdAt - a.createdAt).map((p) => (
              <div className="pdf-history-row" key={p.id}>
                <button className="pdf-history-main" onClick={() => openHistory(p)}>
                  <span className="pdf-history-name">{p.fileName}</span>
                  <span className="pdf-history-time">{timeAgo(p.createdAt)}</span>
                </button>
                <button className="drawer-row-btn" onClick={() => removeHistory(p.id)} aria-label="删除"><IconX /></button>
              </div>
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
