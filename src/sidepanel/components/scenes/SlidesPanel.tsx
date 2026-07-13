import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, PageContext, SessionKind } from '@/shared/types'
import { runMaterialsToSlides, adjustDeck, type Slide } from '@/shared/ai/slides'
import type { SlideImage } from '@/shared/ai/slidesImages'
import { loadDecks, saveDeck, deleteDeck, type SavedDeck, type SourceRef } from '@/shared/ai/slidesStore'
import { resolveSource, fetchMaterial, type ResolvedSource } from '@/shared/ai/slidesSources'
import { deckScopeKey } from '@/shared/dataviz/scope'
import { parseFeishuContext, buildFeishuUrl } from '@/shared/feishu/pageUrl'
import { isTokenExpiredError } from '@/shared/feishu/auth'
import type { RecentFile } from '../../services/recentFiles'
import TopBar from '../shell/TopBar'
import SideDrawer from '../ui/SideDrawer'
import Button from '../ui/Button'
import DocLinkField from '../session/DocLinkField'
import Tooltip from '../ui/Tooltip'
import IconButton from '../ui/IconButton'
import { IconPlus, IconX, IconEye, IconCode, IconFileText, IconHistory, IconDownload } from '../ui/icons'
import { downloadSlidesHtml } from '@/shared/ai/slidesExport'
import { downloadSlidesPptx } from '@/shared/ai/slidesExportPptx'
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, getTheme } from '@/shared/ai/slidesThemes'
import { ThemeThumb } from '../ui/ThemeThumb'
import { ImagePicker } from '../ui/ImagePicker'
import HistoryRow from '../session/HistoryRow'
import './SlidesPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
  /** Resolve a wiki-wrapped resource to its real kind so the source-dropdown icon is right
   *  (a wiki-Base shows the base icon). Optional. */
  resolveWikiKind?: (wikiToken: string) => Promise<SessionKind | undefined>
}

const errText = (e: unknown) => isTokenExpiredError(e)
  ? '飞书登录已失效，请在「设置」重新登录后再试' : e instanceof Error ? e.message : String(e)

const KIND_LABEL: Record<SourceRef['kind'], string> = { doc: '文档', sheet: '表格', base: '多维表格' }

type Deck = { name: string; slides: Slide[] }

/** Open a deck in its own tab via the bundled viewer page. Page-independent (no content-script
 *  dependency), so viewing works on any tab — the user doesn't have to stay on the Feishu doc.
 *  `print` triggers the viewer's print-all path (→ save as PDF). */
async function openDeck(deck: Deck, themeId: string, print = false, images: SlideImage[] = []): Promise<void> {
  await chrome.storage.session.set({
    deckView: { slides: deck.slides, name: deck.name, themeId, print, images },
  })
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/viewer/deckViewer.html') })
}

export default function SlidesPanel({ settings, disabled, onBack, recentFiles, onRemoveRecent, resolveWikiKind }: Props) {
  const [linkInput, setLinkInput] = useState('')
  const [sources, setSources] = useState<ResolvedSource[]>([])
  const [resolving, setResolving] = useState(false)
  const [request, setRequest] = useState('')
  const [status, setStatus] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasGen, setHasGen] = useState(false)
  const [genChars, setGenChars] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [decks, setDecks] = useState<SavedDeck[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeDeckId, setActiveDeckId] = useState('')
  const [adjReq, setAdjReq] = useState('')
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID)
  const [images, setImages] = useState<SlideImage[]>([])
  const [imgProg, setImgProg] = useState<{ done: number; total: number } | null>(null)
  const [imgFailed, setImgFailed] = useState(0)
  const [imgFailedDetail, setImgFailedDetail] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const last = useRef<Deck | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const reqRef = useRef<HTMLTextAreaElement>(null)
  const adjRef = useRef<HTMLTextAreaElement>(null)
  const slideCount = last.current?.slides.length ?? 0
  const deckName = last.current?.name ?? ''

  // Stable filtered list so the source dropdown's wiki-icon resolution effect doesn't re-run on
  // every keystroke (an inline .filter() would mint a new array ref each render).
  const sourceRecentFiles = useMemo(() => recentFiles.filter((f) => f.kind !== 'ppt'), [recentFiles])

  useEffect(() => { loadDecks().then(setDecks) }, [])

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return
    function onClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [exportOpen])

  // Live elapsed ticker so the user sees it's still working.
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  // Auto-grow the compose textareas to fit content — no internal scrollbar, height follows text.
  // Empty input clears the inline height so CSS min-height gives the taller default. Same pattern
  // as InputBar's resize().
  function autoSize(el: HTMLTextAreaElement | null, text: string) {
    if (!el) return
    if (!text) { el.style.height = ''; return }
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(() => { autoSize(reqRef.current, request) }, [request])
  useEffect(() => { autoSize(adjRef.current, adjReq) }, [adjReq])

  // Dedup on the resource TOKEN, not the raw URL string — a pasted link and the same doc picked
  // from "最近打开" carry different origins (acme.feishu.cn vs the synthetic feishu.cn) but the
  // same token, so a string compare would let the same doc in twice.
  const tokenOf = (url: string): string | undefined => {
    const c = parseFeishuContext(url); if (!c) return undefined
    return c.appToken ?? c.spreadsheetToken ?? c.documentId ?? c.wikiToken ?? c.slideToken
  }
  async function resolveAndAdd(url: string) {
    if (!url || resolving) return
    const key = tokenOf(url)
    if (key && sources.some((s) => tokenOf(s.url) === key)) { setErrMsg('这个文档已经添加过了'); return }
    setResolving(true); setErrMsg('')
    try {
      const resolved = await resolveSource(settings, url)
      setSources((cur) => [...cur, resolved])
      setLinkInput('')
    } catch (e) {
      setErrMsg(errText(e))
    } finally { setResolving(false) }
  }
  function addLink() { void resolveAndAdd(linkInput.trim()) }
  // Pick a cached recent doc → rebuild its Feishu link → resolve + add as a source chip, the same
  // path a pasted link takes. ppt recents have no content-source path and are filtered out before
  // reaching here, but guard anyway.
  function addRecent(f: RecentFile) { const url = buildFeishuUrl(f.kind, f.token); if (url) void resolveAndAdd(url) }

  function removeSource(idx: number) {
    setSources((cur) => cur.filter((_, i) => i !== idx))
  }

  async function generate() {
    if (busy || sources.length === 0) return
    const ac = new AbortController(); abortRef.current = ac
    setBusy(true); setErrMsg(''); setStatus(''); setGenChars(0); setImgProg(null); setImgFailed(0); setImgFailedDetail('')
    try {
      setStatus(`读取 ${sources.length} 份资料…`)
      const materials = []
      for (const src of sources) materials.push(await fetchMaterial(settings, src))
      // Preview the doc-image download count so the user knows images are coming (and roughly how many).
      const docImgTotal = materials
        .filter((m): m is Extract<typeof m, { kind: 'doc' }> => m.kind === 'doc')
        .reduce((n, m) => n + m.imageTokens.length, 0)
      if (docImgTotal > 0) setStatus(`下载文档图片…（共 ${docImgTotal} 张）`)
      else setStatus('综合资料生成幻灯片…（约需几十秒，请耐心等待）')
      const r = await runMaterialsToSlides(settings, materials, request.trim() || undefined, {
        signal: ac.signal, onProgress: setGenChars, themeHint: getTheme(themeId).promptHint,
        onImageProgress: (done, total) => { setImgProg({ done, total }); setStatus(`下载文档图片 ${done}/${total}…`) },
      })
      const pool = [...images, ...r.images]
      const deck: Deck = { name: r.name, slides: r.slides }
      last.current = deck
      setImages(pool)
      setImgFailed(r.imgFailed)
      setImgFailedDetail(r.imgFailedDetail ?? '')
      setHasGen(true)

      // Auto-save so the deck is in history immediately (no manual 保存 step).
      const srcKey = primarySrcKey(sources) ?? 'multi'
      const saved: SavedDeck = {
        id: crypto.randomUUID(), name: r.name, srcKey,
        slides: r.slides, sources: r.sources, themeId, images: pool, createdAt: Date.now(),
      }
      setDecks(await saveDeck(saved))
      setActiveDeckId(saved.id)

      await openDeck(deck, themeId, false, pool)
      setStatus(`已生成「${r.name}」· 共 ${r.slides.length} 页${r.truncated ? '（部分文档较长/图片较多，已截取）' : ''}`)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setStatus('已取消')
      else { setErrMsg(errText(e)); setStatus('') }
    } finally { setBusy(false); abortRef.current = null; setImgProg(null) }
  }

  function cancel() { abortRef.current?.abort() }

  function newDraft() {
    last.current = null
    setActiveDeckId('')
    setHasGen(false); setRequest(''); setStatus(''); setErrMsg(''); setGenChars(0); setAdjReq(''); setThemeId(DEFAULT_THEME_ID)
    setImages([]); setImgProg(null); setImgFailed(0); setImgFailedDetail('')
  }

  /** 重新生成 — ONE button, dual meaning (no separate 调整):
   *  · with a 修改 instruction → revise the current deck in place (adjustDeck, one AI call that
   *    understands natural-language page refs like "第3页" / "所有标题");
   *  · without → full regeneration from the original sources. */
  async function regenerate() {
    if (busy) return
    const deck = last.current
    const mod = adjReq.trim()
    if (!deck || !mod) {
      if (!sources.length) { setErrMsg('请填写修改内容，或先添加资料后重新生成。'); return }
      void generate()
      return
    }
    const ac = new AbortController(); abortRef.current = ac
    setBusy(true); setErrMsg(''); setStatus('按修改重新生成…'); setGenChars(0)
    try {
      const slides = await adjustDeck(settings, { slides: deck.slides, images, instruction: mod, signal: ac.signal })
      const nd: Deck = { name: deck.name, slides }
      last.current = nd
      // Persist the revised slides onto the saved deck (saveDeck dedups by id → in-place update).
      const existing = decks.find((d) => d.id === activeDeckId)
      if (existing) setDecks(await saveDeck({ ...existing, slides, images }))
      await openDeck(nd, themeId, false, images)
      setStatus(`已按修改重新生成 · 共 ${slides.length} 页`)
      setAdjReq('')
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setStatus('已取消')
      else { setErrMsg(errText(e)); setStatus('') }
    } finally { setBusy(false); abortRef.current = null }
  }

  /** 导出 PDF — open the viewer with the print flag; it lays all slides out and calls print(). */
  async function exportPdf() {
    if (!last.current || busy) return
    setErrMsg('')
    try { await openDeck(last.current, themeId, true, images) }
    catch (e) { setErrMsg(errText(e)) }
  }

  function exportHtml() {
    if (!last.current || busy) return
    try { downloadSlidesHtml(last.current.slides, last.current.name, getTheme(themeId), images); setStatus('已导出 HTML 文件') }
    catch (e) { setErrMsg(errText(e)) }
  }

  /** 导出 PPTX — 用 PptxGenJS 生成 .pptx 文件（可在 PowerPoint/Keynote/WPS 中编辑）。
   *  pptxgenjs 动态加载，导出期间禁用其他操作。 */
  async function exportPptx() {
    if (!last.current || busy) return
    setErrMsg(''); setStatus('正在生成 PPTX…')
    try { await downloadSlidesPptx(last.current.slides, last.current.name, getTheme(themeId), images); setStatus('已导出 PPTX 文件') }
    catch (e) { setErrMsg(errText(e)); setStatus('') }
  }

  // Reopen a saved deck WITHOUT regenerating.
  async function openSaved(d: SavedDeck) {
    if (busy) return
    setDrawerOpen(false)
    const deck: Deck = { name: d.name, slides: d.slides }
    const tid = d.themeId ?? DEFAULT_THEME_ID
    const imgs = d.images ?? []
    last.current = deck; setHasGen(true); setActiveDeckId(d.id); setAdjReq(''); setThemeId(tid); setImages(imgs)
    setStatus(''); setErrMsg(''); setImgFailed(0); setImgFailedDetail('')
    try { await openDeck(deck, tid, false, imgs) }
    catch (e) { setErrMsg(errText(e)) }
  }

  async function remove(d: SavedDeck) { setDecks(await deleteDeck(d.id)) }


  return (
    <div className="scenario-panel view-enter" key="slides">
      <TopBar
        title="PPT 生成"
        onBack={onBack}
        rightAction={
          <>
            {hasGen && (
              <Tooltip content="新建一个" position="bottom">
                <IconButton onClick={newDraft} aria-label="新建演示" disabled={busy}>
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

      <div className="sl-body">
        {/* ── Compose form — only visible before the first generation ─────────── */}
        {!hasGen && (
          <>
            <p className="sl-sub">粘贴飞书文档 / 表格 / 多维表格链接，AI 综合资料生成演示 PPT。</p>

            <div className="sl-field">
              <label className="sl-label">参考素材</label>
              <div className="sl-add">
                <div className="sl-add-field">
                  <DocLinkField
                    value={linkInput}
                    onValueChange={setLinkInput}
                    recentFiles={sourceRecentFiles}
                    onPickRecent={(f) => void addRecent(f)}
                    onRemoveRecent={onRemoveRecent}
                    onSubmit={addLink}
                    resolveWikiKind={resolveWikiKind}
                    placeholder="粘贴飞书文档 / 表格 / 多维表格链接"
                    disabled={busy || resolving}
                  />
                </div>
                <Button icon={<IconPlus />} onClick={addLink} disabled={busy || resolving || !linkInput.trim()}>
                  {resolving ? '解析…' : '添加'}
                </Button>
              </div>
            </div>

            {sources.length > 0 && (
              <div className="sl-chips">
                {sources.map((s, i) => (
                  <span className="sl-chip" key={s.url}>
                    <span className={`sl-chip-tag sl-chip-tag--${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                    <span className="sl-chip-label">{s.label}</span>
                    <button className="sl-chip-x" onClick={() => removeSource(i)} type="button" aria-label="移除" disabled={busy}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="sl-field">
              <label className="sl-label">模板风格</label>
              <div className="sl-themes">
                {BUILT_IN_THEMES.map((t) => (
                  <ThemeThumb key={t.id} theme={t} selected={themeId === t.id} disabled={busy} onSelect={() => setThemeId(t.id)} />
                ))}
              </div>
            </div>

            <div className="sl-field">
              <label className="sl-label">补充说明 <span className="sl-label-hint">（可选）</span></label>
              <textarea
                ref={reqRef}
                className="sl-req" rows={3} value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="如：侧重结论、10 页内" disabled={busy}
              />
            </div>

            <div className="sl-field">
              <label className="sl-label">图片 <span className="sl-label-hint">（可选，上传后可在"修改"里指派到页）</span></label>
              <ImagePicker images={images} onChange={setImages} disabled={busy} />
            </div>
          </>
        )}

        {/* ── Result card — gives the generated artifact presence in the panel ── */}
        {hasGen && (
          <div className="sl-result">
            <div className="sl-result-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </div>
            <div className="sl-result-meta">
              <div className="sl-result-name">{deckName || '演示文稿'}</div>
              <div className="sl-result-sub">共 {slideCount} 页{sources.length > 0 ? ` · 基于 ${sources.length} 份资料` : ''}</div>
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        {busy ? (
          <div className="sl-actions">
            <Button variant="primary" loading>生成中</Button>
            <Button icon={<IconX />} onClick={cancel}>取消</Button>
          </div>
        ) : !hasGen ? (
          <Button variant="primary" block onClick={generate} disabled={disabled || busy || sources.length === 0}>
            生成
          </Button>
        ) : (
          <>
            {/* Theme is locked to what was chosen before generation — no post-gen switching
                (the deck already carries its themeId; to change look, regenerate). */}
            <Button variant="primary" block icon={<IconEye />} onClick={() => last.current && openDeck(last.current, themeId, false, images)}>查看 PPT</Button>

            <div className="sl-export-wrap" ref={exportRef}>
              <Button
                variant="secondary"
                block
                icon={<IconDownload />}
                onClick={() => setExportOpen((v) => !v)}
                disabled={busy}
              >
                导出
              </Button>
              {exportOpen && (
                <div className="sl-export-menu">
                  <button className="sl-export-item" onClick={() => { setExportOpen(false); exportPptx() }}>
                    <IconDownload />
                    <span>PowerPoint (.pptx)</span>
                  </button>
                  <button className="sl-export-item" onClick={() => { setExportOpen(false); exportPdf() }}>
                    <IconFileText />
                    <span>PDF 文档</span>
                  </button>
                  <button className="sl-export-item" onClick={() => { setExportOpen(false); exportHtml() }}>
                    <IconCode />
                    <span>HTML 网页</span>
                  </button>
                </div>
              )}
            </div>

            {/* Image-pool visibility post-generation: shows which page each image landed on via
                pageOf reverse-lookup against the current slides. The count + failure note explain
                why fewer images than the doc contains may show (download failures / >60 cap). */}
            <div className="sl-field">
              <label className="sl-label">
                图片（共 {images.length} 张{imgFailed > 0 ? ` · ${imgFailed} 张下载失败${imgFailedDetail ? `（${imgFailedDetail}）` : ''}` : ''}）
              </label>
              <ImagePicker
                images={images}
                onChange={setImages}
                disabled={busy}
                pageOf={(id) => {
                  const slides = last.current?.slides ?? []
                  for (let i = 0; i < slides.length; i++) {
                    const s = slides[i]
                    if (s.image === id) return i + 1
                    if (s.cards?.some((c) => c.image === id)) return i + 1
                  }
                  return undefined
                }}
              />
            </div>

            <div className="sl-field">
              <label className="sl-label">修改</label>
              <textarea
                ref={adjRef}
                className="sl-req" rows={3} value={adjReq}
                onChange={(e) => setAdjReq(e.target.value)}
                placeholder="描述要改的地方（留空则从资料重新生成）" disabled={busy}
              />
            </div>

            <Button block onClick={regenerate} disabled={disabled}>重新生成</Button>
          </>
        )}

        {busy && (
          <p className="sl-hint sl-status">
            {status || '处理中…'}（已 {elapsed}s{genChars > 0 ? `，已生成 ${genChars} 字` : ''}{imgProg && imgProg.total ? `，图片 ${imgProg.done}/${imgProg.total}` : ''}）
          </p>
        )}

        {!busy && status ? <p className="sl-hint">{status}</p> : null}
        {errMsg && <p className="sl-hint sl-hint--err">{errMsg}</p>}
        {disabled && sources.length === 0 && !hasGen && <p className="sl-hint">生成需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}
      </div>

      {drawerOpen && (
        <SideDrawer title="历史记录" onClose={() => setDrawerOpen(false)}>
          <div className="sl-decks">
            {decks.length === 0 && <p className="sl-decks-empty">还没有生成过的演示</p>}
            {[...decks].sort((a, b) => b.createdAt - a.createdAt).map((d) => (
              <HistoryRow key={d.id}
                name={d.name}
                meta={`${sourceLabel(d)} · ${timeAgo(d.createdAt)}`}
                active={activeDeckId === d.id}
                onOpen={() => openSaved(d)}
                onDelete={() => remove(d)}
                deleteDisabled={busy}
                openDisabled={busy}
                openTitle="在新标签页展示这套幻灯片"
              />
            ))}
          </div>
        </SideDrawer>
      )}
    </div>
  )
}

/** Scope key for the primary (first) source — keeps the page launcher pill matching that page so
 *  existing launcher behavior is preserved without a separate concept. */
function primarySrcKey(sources: ResolvedSource[]): string | null {
  if (!sources.length) return null
  const ctx = parseFeishuContext(sources[0].url)
  return ctx ? deckScopeKey(ctx) : null
}

function sourceLabel(d: SavedDeck): string {
  if (!d.sources?.length) return '未标注来源'
  return d.sources.map((s) => `《${s.label}》`).join('')
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
