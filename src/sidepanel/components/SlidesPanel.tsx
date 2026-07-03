import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { runMaterialsToSlides, adjustDeck, type Slide } from '../../shared/ai/slides'
import type { SlideImage } from '../../shared/ai/slidesImages'
import { loadDecks, saveDeck, deleteDeck, type SavedDeck, type SourceRef } from '../../shared/ai/slidesStore'
import { resolveSource, fetchMaterial, type ResolvedSource } from '../../shared/ai/slidesSources'
import { deckScopeKey } from '../../shared/dataviz/scope'
import { parseFeishuContext } from '../../shared/feishu/pageUrl'
import { isTokenExpiredError } from '../../shared/feishu/auth'
import TopBar from './TopBar'
import SideDrawer from './SideDrawer'
import Button from './Button'
import { IconPlus, IconX, IconEye, IconCode, IconFileText } from './icons'
import { downloadSlidesHtml } from '../../shared/ai/slidesExport'
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, getTheme } from '../../shared/ai/slidesThemes'
import { ThemeThumb } from './ThemeThumb'
import { ImagePicker } from './ImagePicker'
import './SlidesPanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
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

export default function SlidesPanel({ settings, disabled, onBack }: Props) {
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
  const last = useRef<Deck | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const reqRef = useRef<HTMLTextAreaElement>(null)
  const adjRef = useRef<HTMLTextAreaElement>(null)
  const slideCount = last.current?.slides.length ?? 0
  const deckName = last.current?.name ?? ''

  useEffect(() => { loadDecks().then(setDecks) }, [])

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

  async function addLink() {
    const url = linkInput.trim()
    if (!url || resolving) return
    if (sources.some((s) => s.url === url)) { setErrMsg('这个链接已经添加过了'); return }
    setResolving(true); setErrMsg('')
    try {
      const resolved = await resolveSource(settings, url)
      setSources((cur) => [...cur, resolved])
      setLinkInput('')
    } catch (e) {
      setErrMsg(errText(e))
    } finally { setResolving(false) }
  }

  function removeSource(idx: number) {
    setSources((cur) => cur.filter((_, i) => i !== idx))
  }

  async function generate() {
    if (busy || sources.length === 0) return
    const ac = new AbortController(); abortRef.current = ac
    setBusy(true); setErrMsg(''); setStatus(''); setGenChars(0); setImgProg(null)
    try {
      setStatus(`读取 ${sources.length} 份资料…`)
      const materials = []
      for (const src of sources) materials.push(await fetchMaterial(settings, src))
      // Preview the doc-image download count so the user knows images are coming (and roughly how many).
      const docImgTotal = materials
        .filter((m): m is Extract<typeof m, { kind: 'doc' }> => m.kind === 'doc')
        .reduce((n, m) => n + m.imageTokens.length, 0)
      if (docImgTotal > 0) setStatus(`下载文档图片…（共 ${Math.min(docImgTotal, 8)} 张）`)
      else setStatus('综合资料生成幻灯片…（约需几十秒，请耐心等待）')
      const r = await runMaterialsToSlides(settings, materials, request.trim() || undefined, {
        signal: ac.signal, onProgress: setGenChars, themeHint: getTheme(themeId).promptHint,
        onImageProgress: (done, total) => { setImgProg({ done, total }); setStatus(`下载文档图片 ${done}/${total}…`) },
      })
      const pool = [...images, ...r.images]
      const deck: Deck = { name: r.name, slides: r.slides }
      last.current = deck
      setImages(pool)
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
    setImages([]); setImgProg(null)
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

  // Reopen a saved deck WITHOUT regenerating.
  async function openSaved(d: SavedDeck) {
    if (busy) return
    setDrawerOpen(false)
    const deck: Deck = { name: d.name, slides: d.slides }
    const tid = d.themeId ?? DEFAULT_THEME_ID
    const imgs = d.images ?? []
    last.current = deck; setHasGen(true); setActiveDeckId(d.id); setAdjReq(''); setThemeId(tid); setImages(imgs)
    setStatus(''); setErrMsg('')
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
              <button className="sl-history-btn" onClick={newDraft} type="button" aria-label="新建演示" disabled={busy} title="新建一个">
                <IconPlus />
              </button>
            )}
            <button className="sl-history-btn" onClick={() => setDrawerOpen(true)} type="button" aria-label="历史记录" disabled={busy} title="历史记录">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l4 2" />
              </svg>
            </button>
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
                <div className="sl-add-input-wrap">
                  <input
                    className="sl-add-input" value={linkInput}
                    placeholder="粘贴飞书文档 / 表格链接"
                    onChange={(e) => setLinkInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
                    disabled={busy || resolving}
                  />
                  {linkInput && !busy && !resolving && (
                    <button className="sl-add-clear" onClick={() => setLinkInput('')} type="button" aria-label="清除">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
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

            <div className="sl-export-row">
              <Button icon={<IconCode />} onClick={exportHtml}>导出 HTML</Button>
              <Button icon={<IconFileText />} onClick={exportPdf}>导出 PDF</Button>
            </div>

            {/* Image-pool visibility post-generation: shows which page each image landed on via
                pageOf reverse-lookup against the current slides. */}
            <div className="sl-field">
              <label className="sl-label">图片</label>
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
              <div className={`sl-deck ${activeDeckId === d.id ? 'sl-deck--active' : ''}`} key={d.id}>
                <button className="sl-deck-main" onClick={() => openSaved(d)} disabled={busy} title="在新标签页展示这套幻灯片">
                  <span className="sl-deck-name">{d.name}</span>
                  <span className="sl-deck-meta">{sourceLabel(d)} · {timeAgo(d.createdAt)}</span>
                </button>
                <span className="sl-deck-actions">
                  <button className="drawer-row-btn" onClick={() => remove(d)} type="button" aria-label="删除" disabled={busy}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </span>
              </div>
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
