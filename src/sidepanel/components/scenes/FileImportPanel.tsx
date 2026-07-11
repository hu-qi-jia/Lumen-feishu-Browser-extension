import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '@/shared/types'
import type { ClipCapture } from '@/shared/clip/types'
import { fileToClip } from '@/shared/clip/file'
import { resolveToken } from '@/shared/feishu/auth'
import { markdownToBlocks, insertContentBlocks, listBlocks } from '@/shared/feishu/docx'
import { openUrlInNewTab } from '@/shared/url'
import { runAgent } from '@/shared/ai/agent'
import type { RecentFile } from '../../services/recentFiles'
import { loadFileImports, saveFileImport, deleteFileImport, type SavedFileImport } from '../../lib/fileImportHistory'
import TopBar from '../shell/TopBar'
import Button from '../ui/Button'
import Markdown from '../chat/Markdown'
import Tooltip from '../ui/Tooltip'
import IconButton from '../ui/IconButton'
import UploadDrop from '../ui/UploadDrop'
import SideDrawer from '../ui/SideDrawer'
import HistoryRow from '../session/HistoryRow'
import WriteTargetSection, { buildCreateInstructions } from './WriteTargetSection'
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

type Phase = 'idle' | 'parsing' | 'preview' | 'running' | 'done' | 'failed'
type BodyView = 'preview' | 'markdown'

export default function FileImportPanel({ settings, context, disabled, onBack, recentFiles, onRemoveRecent }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [clip, setClip] = useState<ClipCapture | null>(null)
  const [editMd, setEditMd] = useState('')
  const [bodyView, setBodyView] = useState<BodyView>('preview')
  const [activeId, setActiveId] = useState<string | null>(null)
  // 目标文档（DocCombobox 单目标，同 PdfTranscribePanel）。当前页是飞书文档时预填。
  const [target, setTarget] = useState<{ token: string; title: string } | null>(
    context.feishu?.kind === 'doc' && context.feishu?.documentId
      ? { token: context.feishu.documentId, title: '当前文档' } : null,
  )
  const [writing, setWriting] = useState(false)
  const [status, setStatus] = useState<string[]>([])
  const [result, setResult] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [info, setInfo] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [imports, setImports] = useState<SavedFileImport[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { loadFileImports().then(setImports) }, [])

  // 编辑器自适应高度（同 PdfTranscribePanel / ClipPanel）
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editMd, bodyView])

  async function handleFile(file: File) {
    setPhase('parsing'); setErrMsg(''); setInfo('')
    try {
      const c = await fileToClip(file)
      setClip(c); setEditMd(c.content); setBodyView('preview')
      setActiveId(null); setResult('')
      setPhase('preview')
      const id = crypto.randomUUID()
      setActiveId(id)
      const ext = file.name.toLowerCase().split('.').pop() || ''
      setImports(await saveFileImport({ id, fileName: file.name, fileType: ext, content: c.content, truncated: c.truncated, createdAt: Date.now() }))
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e)); setPhase('failed')
    }
  }

  // 写入已有文档 —— 直接插入 blocks（同 PdfTranscribePanel handleAddToDoc，不走 agent）。
  async function handleAddToDoc() {
    if (!target?.token) { setErrMsg('请先选择目标文档。'); return }
    setWriting(true); setErrMsg(''); setInfo('')
    try {
      const token = await resolveToken(settings)
      const doc = target.token
      const v = await listBlocks(token, doc)
      const root = (v.items as Array<{ block_id?: string; children?: string[] }>).find((b) => b.block_id === doc)
      if (!root) throw new Error('无法确定文档末尾位置，请确认链接指向飞书文档。')
      await insertContentBlocks(token, doc, markdownToBlocks(editMd), root.children?.length ?? 0)
      setInfo(`已写入「${target.title}」末尾。`)
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setWriting(false)
    }
  }

  // ── 新建目标（agent 创建 + 写入，指令复用 WriteTargetSection.buildCreateInstructions） ──
  const createInstructions = useMemo(() => buildCreateInstructions({
    sourceLabel: '文件导入',
    content: editMd,
    sourceUrl: clip?.url ?? '',
    sourceTitle: clip?.title ?? '',
  }), [editMd, clip])

  async function runCreate(instruction: string) {
    if (!clip) return
    setPhase('running'); setStatus([]); setResult(''); setErrMsg(''); setInfo('')
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await runAgent(
        [{ id: crypto.randomUUID(), role: 'user', content: instruction, createdAt: Date.now() }],
        settings,
        { url: clip.url, title: clip.title, selectedText: '' },
        {
          onChunk: (c) => setResult((r) => r + c),
          onAssistantMessage: (m) => { if (m.content) setResult(m.content) },
          onToolStart: (name) => setStatus((s) => [...s, name]),
          onToolEnd: () => {},
          onToolMessage: () => {},
          // 导入只新建/插入（非破坏性），删除一律不自动确认。
          requestConfirmation: (req) => Promise.resolve(req.kind === 'delete' ? 'cancel' : 'confirm'),
        },
        undefined,
        ac.signal,
      )
      setPhase('done')
    } catch (e) {
      const aborted = ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')
      if (!aborted) { setErrMsg(e instanceof Error ? e.message : String(e)); setPhase('failed') }
    } finally {
      if (abortRef.current === ac) abortRef.current = null
    }
  }
  function createNewBase() { if (clip) void runCreate(createInstructions.newBase) }
  function createNewSheet() { if (clip) void runCreate(createInstructions.newSheet) }
  function createNewDoc() { if (clip) void runCreate(createInstructions.newDoc) }

  // done 阶段：从 agent 结果里提取链接（同 ClipPanel）
  const resultUrl = useMemo(() => {
    const m = result.match(/https?:\/\/[^\s)\]]+/)
    return m ? m[0].replace(/[.,。，、）)]+$/, '') : ''
  }, [result])

  function openHistory(p: SavedFileImport) {
    setClip({ url: 'file://' + p.fileName, title: p.fileName, selectedText: '', content: p.content, capturedAt: p.createdAt, truncated: p.truncated })
    setEditMd(p.content); setBodyView('preview'); setActiveId(p.id)
    setResult(''); setErrMsg(''); setInfo(''); setPhase('preview'); setHistoryOpen(false)
  }
  async function removeHistory(id: string) { setImports(await deleteFileImport(id)) }

  function newTask() {
    abortRef.current?.abort()
    setClip(null); setEditMd(''); setResult(''); setErrMsg(''); setInfo(''); setStatus([])
    setActiveId(null); setPhase('idle')
  }

  const hasFile = phase === 'preview' || phase === 'running' || phase === 'done'

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
                {/* 文件信息卡（与 PDF 转写共用 file-source-card 样式） */}
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
                  onConfirm={handleAddToDoc} writing={writing}
                  onNewDoc={createNewDoc} onNewBase={createNewBase} onNewSheet={createNewSheet}
                  disabled={disabled}
                />

                {disabled && <p className="sc-pdf-hint">AI 整理需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}
                {errMsg && <div className="sc-refresh-err">{errMsg}</div>}
                {!errMsg && info && <div className="sc-registry-info">{info}</div>}
              </>
            )}

            {phase === 'running' && (
              <div className="fi-running">
                <div className="fi-spinner" />
                <p>AI 正在整理并写入…</p>
                {status.length > 0 && <p className="fi-status">{status.join(' · ')}</p>}
                {result && <pre className="fi-result-preview">{result}</pre>}
              </div>
            )}

            {phase === 'done' && (
              <div className="fi-done">
                <div className="fi-done-icon"></div>
                <p className="fi-done-text">{result || '已写入。'}</p>
                {resultUrl && (
                  <Button variant="primary" block onClick={() => openUrlInNewTab(resultUrl)}>
                    在飞书中打开 ↗
                  </Button>
                )}
                <div className="fi-actions">
                  <Button variant="ghost" onClick={newTask}>新任务</Button>
                </div>
              </div>
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
