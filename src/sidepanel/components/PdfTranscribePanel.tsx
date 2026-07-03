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
import UploadDrop from './UploadDrop'
import HistoryRow from './HistoryRow'
import { IconFileText, IconHistory, IconCopy, IconDownload, IconSparkles } from './icons'
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
  const [fileSize, setFileSize] = useState(0)
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
  const pickedFile = useRef<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { loadPdfs().then(setPdfs) }, [])

  function handleFile(file: File) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { setError('请上传 PDF 文件。'); setPhase('error'); return }
    setFileName(file.name.replace(/\.pdf$/i, ''))
    setFileSize(file.size)
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
    if (!target?.token) { setError('请先选择目标文档。'); return }
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

  const hasFile = phase === 'selected' || phase === 'converting' || phase === 'done'

  return (
    <div className="scenario-panel view-enter" key="pdf">
      <TopBar title="PDF 转 Markdown" onBack={onBack} rightAction={
        <button className="sc-history-btn" onClick={() => setHistoryOpen(true)} aria-label="历史记录" title="历史记录">
          <IconHistory />
        </button>
      } />
      <div className="sc-detail-body">
        <p className="sl-sub">上传 PDF 文件，本地解析为 Markdown，可复制、下载、AI 润色或写入飞书文档。</p>

        <input type="file" accept=".pdf,application/pdf" hidden ref={fileInputRef} data-testid="pdf-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <UploadDrop
          busy={phase === 'converting'} max={1} count={0}
          selectedName={hasFile ? `${fileName}.pdf` : undefined}
          selectedIcon={<IconFileText />}
          selectedMeta={hasFile ? `${formatBytes(fileSize)} · 点击或拖入替换` : undefined}
          mainText="点击或拖入 PDF 文件" hintText="本地解析，不上传服务器"
          onFiles={(fl) => { const f = fl[0]; if (f) handleFile(f) }}
          onTrigger={() => fileInputRef.current?.click()} />

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
            <Button variant="secondary" className="pdf-action-btn" onClick={() => { pickedFile.current = null; setPhase('idle') }}>选择文件</Button>
          </div>
        )}

        {phase === 'done' && (
          <>
            <div className="pdf-action-row">
              <Button variant="secondary" block onClick={() => { pickedFile.current = null; setPhase('idle') }}>重新上传</Button>
            </div>
            <div className="pdf-result">
              <div className="pdf-result-box" data-testid="pdf-result-box">
                <div className="pdf-result-bar">
                  <div className="sc-target-opts pdf-view-toggle">
                    <button className={`sc-target-opt${view === 'preview' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('preview')}>预览</button>
                    <button className={`sc-target-opt${view === 'markdown' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('markdown')}>Markdown</button>
                  </div>
                  <div className="pdf-result-icons">
                    <Button size="sm" variant="ghost" icon={<IconCopy />} onClick={handleCopy} aria-label="复制" title="复制" />
                    <Button size="sm" variant="ghost" icon={<IconDownload />} onClick={handleExport} aria-label="下载" title="下载" />
                    <Button size="sm" variant="ghost" icon={<IconSparkles />} onClick={handlePolish} disabled={disabled} loading={polishing} aria-label="AI 润色" title="AI 润色" />
                  </div>
                </div>
                <div className="pdf-result-scroll">
                  {view === 'preview'
                    ? <div data-testid="pdf-preview"><Markdown>{editMd}</Markdown></div>
                    : <textarea className="field-input sc-pdf-editor" data-testid="pdf-editor" value={editMd} onChange={(e) => setEditMd(e.target.value)} />}
                </div>
              </div>
              {disabled && <p className="sc-pdf-hint">AI 润色需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}
              <DocCombobox recentFiles={recentFiles} onRemoveRecent={onRemoveRecent}
                target={target} onTargetChange={setTarget} onConfirm={handleAddToDoc} writing={writing} />
            </div>
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

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
