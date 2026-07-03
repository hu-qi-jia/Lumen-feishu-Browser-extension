import { useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { resolveToken } from '../../shared/feishu/auth'
import { extractMarkdown, detectScan } from '../../shared/pdfExtract'
import { polishMarkdown } from '../../shared/ai/mdPolish'
import { markdownToBlocks, insertContentBlocks, listBlocks } from '../../shared/feishu/docx'
import { parseDocTokenFromUrl } from '../../shared/feishu/parseDocRef'
import TopBar from './TopBar'
import Button from './Button'
import './PdfTranscribePanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
}

type Phase = 'idle' | 'extracting' | 'polishing' | 'done' | 'error'

interface DocTarget { token: string; title: string }

export default function PdfTranscribePanel({ settings, context, disabled, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [rawMd, setRawMd] = useState('')
  const [polishedMd, setPolishedMd] = useState('')
  const [editMd, setEditMd] = useState('')
  const [polishEnabled, setPolishEnabled] = useState(!disabled)
  const [polishFailed, setPolishFailed] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [fileName, setFileName] = useState('document')
  const [target, setTarget] = useState<DocTarget | null>(
    context.feishu?.kind === 'doc' && context.feishu?.appToken
      ? { token: context.feishu.appToken, title: '当前文档' }
      : null,
  )
  const [showTargetInput, setShowTargetInput] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [writing, setWriting] = useState(false)

  async function handleFile(file: File) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { setError('请上传 PDF 文件。'); setPhase('error'); return }
    setFileName(file.name.replace(/\.pdf$/i, ''))
    setPhase('extracting'); setError(''); setInfo('')
    try {
      const buf = await file.arrayBuffer()
      const md = await extractMarkdown(buf)
      setRawMd(md)
      const scan = detectScan(md)
      if (scan.likelyScan) { setError(scan.reason); setPhase('error'); return }
      if (polishEnabled) {
        setPhase('polishing')
        try {
          const polished = await polishMarkdown(settings, md)
          setPolishedMd(polished); setEditMd(polished); setPolishFailed(false)
        } catch {
          setPolishedMd(md); setEditMd(md); setPolishFailed(true)
          setInfo('AI 润色失败，已显示原始抽取结果。')
        }
      } else {
        setPolishedMd(md); setEditMd(md)
      }
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setPhase('error')
    }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(editMd)
    setInfo('已复制到剪贴板。')
  }
  function handleExport() {
    const blob = new Blob([editMd], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${fileName}.md`; a.click()
    URL.revokeObjectURL(url)
  }
  async function handleAddToDoc() {
    if (!target?.token) { setShowTargetInput(true); return }
    setWriting(true); setError(''); setInfo('')
    try {
      const token = await resolveToken(settings)
      const doc = target.token
      const view = await listBlocks(token, doc)
      const root = (view.items as Array<{ block_id?: string; children?: string[] }>)
        .find(b => b.block_id === doc)
      const index = root?.children?.length ?? 0
      await insertContentBlocks(token, doc, markdownToBlocks(editMd), index)
      setInfo(`已写入「${target.title}」末尾。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWriting(false)
    }
  }
  function handlePickTarget() {
    const ref = parseDocTokenFromUrl(targetInput)
    if (!ref) { setError('无法识别文档链接或 token'); return }
    setTarget({ token: ref.token, title: '指定文档' })
    setShowTargetInput(false); setError('')
  }

  return (
    <div className="scenario-panel view-enter" key="pdf">
      <TopBar title="PDF 转写" onBack={onBack} />
      <div className="sc-detail-body">
        {phase === 'idle' && (
          <label className="sc-pdf-drop" data-testid="pdf-drop">
            <input
              type="file" accept=".pdf,application/pdf" hidden data-testid="pdf-input"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
            />
            <p>点击或拖入 PDF 文件</p>
            <p className="sc-pdf-hint">本地解析，不上传服务器</p>
          </label>
        )}
        {(phase === 'extracting' || phase === 'polishing') && (
          <div className="sc-pdf-progress" data-testid="pdf-progress">
            {phase === 'extracting' ? '正在解析 PDF…' : '正在 AI 润色…'}
          </div>
        )}
        {phase === 'error' && (
          <div className="sc-error-box">
            <div className="sc-error-title">无法转写</div>
            <div className="sc-error-msg">{error}</div>
            <Button variant="primary" onClick={() => setPhase('idle')}>重新选择</Button>
          </div>
        )}
        {phase === 'done' && (
          <>
            <label className="sc-input-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox" checked={polishEnabled} disabled={disabled}
                onChange={e => {
                  setPolishEnabled(e.target.checked)
                  setEditMd(e.target.checked ? polishedMd : rawMd)
                }}
              />
              <span className="sc-input-label">启用 AI 润色</span>
            </label>
            {disabled && <p className="sc-pdf-hint">AI 润色需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}
            <textarea
              className="field-input sc-pdf-editor" data-testid="pdf-editor"
              value={editMd} onChange={e => setEditMd(e.target.value)} rows={16}
            />
            <div className="sc-pdf-target-row">
              <span className="sc-inputs-label">目标：{target ? target.title : '未选择'}</span>
              {!showTargetInput && (
                <button className="sc-refresh-btn" onClick={() => setShowTargetInput(true)}>换一个</button>
              )}
            </div>
            {showTargetInput && (
              <div className="sc-input-field">
                <input
                  className="field-input" data-testid="target-input"
                  value={targetInput} onChange={e => setTargetInput(e.target.value)}
                  placeholder="粘贴飞书文档链接或 token"
                />
                <Button variant="primary" onClick={handlePickTarget}>确定</Button>
              </div>
            )}
            <div className="sc-done-actions">
              <Button variant="primary" onClick={handleCopy}>复制</Button>
              <Button onClick={handleExport}>导出 .md</Button>
              <Button onClick={handleAddToDoc} disabled={writing}>
                {writing ? '写入中…' : '添加到文档'}
              </Button>
            </div>
            {error && <div className="sc-refresh-err">{error}</div>}
            {!error && polishFailed && info && <div className="sc-refresh-err">{info}</div>}
            {!error && !polishFailed && info && <div className="sc-registry-info">{info}</div>}
          </>
        )}
      </div>
    </div>
  )
}
