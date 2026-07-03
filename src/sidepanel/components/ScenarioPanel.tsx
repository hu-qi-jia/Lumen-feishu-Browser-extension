import React, { useEffect, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import type { ScenarioTemplate, ProgressStep, CreationResult } from '../../shared/templates/types'
import { BUILTIN_TEMPLATES } from '../../shared/templates/builtin'
import { executeTemplate } from '../../shared/templates/engine'
import { fetchRemoteTemplates, mergeTemplates, getCacheInfo, clearRegistryCache } from '../../shared/templates/registry'
import { resolveToken } from '../../shared/feishu/auth'
import { safeImageSrc, openUrlInNewTab } from '../../shared/url'
import { CLIP_ENABLED } from '../../shared/config'
import { TemplateCardSkeleton } from './Skeleton'
import HubCard from './HubCard'
import DataVizPanel from './DataVizPanel'
import AISitePanel from './AISitePanel'
import SmartFillPanel from './SmartFillPanel'
import SlidesPanel from './SlidesPanel'
import PdfTranscribePanel from './PdfTranscribePanel'
import type { RecentFile } from '../recentFiles'
import TopBar from './TopBar'
import Button from './Button'
import './ScenarioPanel.css'

// Baked in at build time via VITE_DEFAULT_REGISTRY_URL env var.
// Falls back to empty string (builtin-only) if not set.
const DEFAULT_REGISTRY: string = import.meta.env.VITE_DEFAULT_REGISTRY_URL ?? ''

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  /** Signals an in-flight template build so the host can freeze nav that would unmount us
   *  mid-build (switching tab destroys this panel's local progress/result state). */
  onBusyChange?: (busy: boolean) => void
  /** Recent docs/sheets surfaced to sub-panels (e.g. PDF 转写's target-document combobox). */
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
}

type View =
  | { mode: 'hub' }
  | { mode: 'dataviz' }
  | { mode: 'aisite' }
  | { mode: 'smartfill' }
  | { mode: 'slides' }
  | { mode: 'pdfTranscribe' }
  | { mode: 'gallery' }
  | { mode: 'detail'; template: ScenarioTemplate }
  | { mode: 'progress'; template: ScenarioTemplate; steps: ProgressStep[]; error?: string; inputs?: Record<string, string> }
  | { mode: 'done'; result: CreationResult }

const CATEGORIES = ['全部', '电商', '项目管理', 'CRM']

// ── Hub icons (iOS / SF Symbols style line icons) ──────────────────────────
const stroke = { stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const Svg = (d: React.ReactNode) => <svg viewBox="0 0 24 24" fill="none" {...stroke}>{d}</svg>
const HUB_ICONS: Record<string, React.ReactNode> = {
  chart: Svg(<><rect x="3" y="12" width="4" height="9" rx="1" /><rect x="10" y="7" width="4" height="14" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" /></>),
  globe: Svg(<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>),
  sparkle: Svg(<path d="M12 2l1.8 5.5 5.7.3-4.3 3.2 1.4 5.5L12 13l-4.6 3.5 1.4-5.5-4.3-3.2 5.7-.3z" />),
  report: Svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></>),
  audit: Svg(<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></>),
  summary: Svg(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r=".8" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r=".8" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r=".8" fill="currentColor" stroke="none" /></>),
  slides: Svg(<><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /><polyline points="6 10 10 14 14 10 18 14" /></>),
  grid: Svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>),
  clip: Svg(<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="12" x2="8.6" y2="15.4" /><line x1="15" y1="12" x2="8.6" y2="8.6" /></>),
  download: Svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>),
  camera: Svg(<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>),
  file: Svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><polyline points="9 15 12 12 15 15" /></>),
}

export default function ScenarioPanel({ settings, context, disabled, onBusyChange, recentFiles, onRemoveRecent }: Props) {
  const [view, setView] = useState<View>({ mode: 'hub' })
  const [templates, setTemplates] = useState<ScenarioTemplate[]>(BUILTIN_TEMPLATES)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [cacheInfo, setCacheInfo] = useState(getCacheInfo())

  // Auto-fetch when settings arrive or registry URL changes.
  // Effective URL = user override → build-time default → builtin only.
  useEffect(() => {
    const effectiveUrl = settings.templateRegistryUrl || DEFAULT_REGISTRY
    if (effectiveUrl) loadRemote(effectiveUrl, false)
    else setTemplates(BUILTIN_TEMPLATES)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.templateRegistryUrl])

  async function loadRemote(url: string, force: boolean) {
    if (force) clearRegistryCache()
    setRefreshing(true)
    setRefreshError('')
    const { templates: remote, error } = await fetchRemoteTemplates(url)
    if (error) setRefreshError(error)
    setTemplates(mergeTemplates(remote))
    setCacheInfo(getCacheInfo())
    setRefreshing(false)
  }

  // Launch (or re-launch) a template build, wiring progress + a recoverable failure
  // state. Shared by the detail "开始创建" action and the failure "重试" button so the
  // flow always lands on a screen with a way out — never a dead progress screen.
  function launchTemplate(tpl: ScenarioTemplate, inputs: Record<string, string>) {
    onBusyChange?.(true) // freeze host nav while building (runTemplate always settles → always cleared)
    setView({ mode: 'progress', template: tpl, steps: [], inputs })
    runTemplate(tpl, inputs, settings, context, (steps) => {
      setView(v => (v.mode === 'progress' ? { ...v, steps } : v))
    })
      .then(result => setView({ mode: 'done', result }))
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err)
        setView(v => (v.mode === 'progress' ? { ...v, error: msg } : v))
      })
      .finally(() => onBusyChange?.(false))
  }

  // ── Gallery ──────────────────────────────────────────────────────────────

  const filtered = templates.filter(t => {
    const q = search.toLowerCase()
    const matchSearch = !q || t.name.toLowerCase().includes(q) || t.tags.some(tag => tag.toLowerCase().includes(q))
    const matchCat = category === '全部' || t.category === category
    return matchSearch && matchCat
  })

  // ── Hub (feature launcher — the 场景 tab landing) ──────────────────────────

  if (view.mode === 'hub') {
    // Context-aware hub: the header already knows the page's resource type (App.tsx badge), so
    // surface the features that fit THIS page first and DIM the ones that need another resource
    // (with a 「需…」 tag) instead of letting the user discover the mismatch only after a full-panel
    // navigation + 返回. Unknown / wiki(未解析) → show everything at full strength (no demotion),
    // since we can't yet tell what the page is. Cards stay clickable — this is purely presentation.
    const kind = context.feishu?.kind
    const pageKind: 'table' | 'doc' | null =
      kind === 'base' || kind === 'sheet' ? 'table' : kind === 'doc' ? 'doc' : null
    type Feat = { icon: string; title: string; desc: string; go: () => void }
    // 'content' = works on a doc OR a table (e.g. 幻灯片/PPT).
    type Grp = { key: string; label: string; requires: 'table' | 'doc' | 'any' | 'content'; feats: Feat[] }
    const groups: Grp[] = [
      { key: 'page', label: '数据可视化', requires: 'table', feats: [
        { icon: 'chart', title: 'AI 看板', desc: '一句话将表格转为图表、报表、看板', go: () => setView({ mode: 'dataviz' }) },
        { icon: 'globe', title: 'AI 建站', desc: '一句话将表格数据生成完整网站', go: () => setView({ mode: 'aisite' }) },
      ] },
      { key: 'enrich', label: '数据分析', requires: 'table', feats: [
        { icon: 'sparkle', title: '智能填充', desc: 'AI 推断并补全空缺的列数据', go: () => setView({ mode: 'smartfill' }) },
      ] },
      { key: 'slides', label: '演示文稿', requires: 'content', feats: [
        { icon: 'slides', title: 'PPT 生成', desc: '将文档或表格数据转为演示 PPT', go: () => setView({ mode: 'slides' }) },
      ] },
      { key: 'build', label: '模板建库', requires: 'any', feats: [
        { icon: 'grid', title: '场景模版', desc: '一键搭建 CRM、电商、项目管理系统', go: () => setView({ mode: 'gallery' }) },
      ] },
      { key: 'pdf', label: '内容转写', requires: 'any', feats: [
        { icon: 'file', title: 'PDF 转写', desc: '把 PDF 抽成 Markdown，AI 润色后写入文档', go: () => setView({ mode: 'pdfTranscribe' }) },
      ] },
    ]
    // 'content' (PPT) works on a doc OR a table, so it's active whenever the page is either (and on
    // an unresolved/unknown page we show it too — the panel itself gates).
    const isActive = (g: Grp) => g.requires === 'any' || pageKind === null || g.requires === pageKind || (g.requires === 'content' && pageKind != null)
    // active page-matched group first (rank 0), then anywhere/content (rank 1), then dimmed (rank 2).
    const rank = (g: Grp) => (!isActive(g) ? 2 : g.requires === pageKind ? 0 : 1)
    const ordered = groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    const reqLabel = (r: Grp['requires']) => (r === 'table' ? '需表格' : r === 'doc' ? '需文档' : r === 'content' ? '需文档/表格' : '')

    return (
      <div className="scenario-panel view-enter" key="hub">
        <div className="sc-hub">
          <h2 className="sc-hub-title">应用</h2>

          {ordered.map(({ g }) => {
            const dim = !isActive(g)
            return (
              <div key={g.key} className={`sc-hub-group${dim ? ' sc-hub-group--dim' : ''}`}>
                <div className="sc-hub-section">
                  {g.label}
                  {dim && <span className="sc-hub-req">{reqLabel(g.requires)}</span>}
                </div>
                <div className="sc-hub-grid">
                  {g.feats.map((f) => (
                    <HubCard
                      key={f.title}
                      icon={HUB_ICONS[f.icon]}
                      title={f.title}
                      desc={f.desc}
                      onClick={f.go}
                      dimmed={dim}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {CLIP_ENABLED && (
            <div className="sc-hub-group">
              <div className="sc-hub-section">网页采集</div>
              <div className="sc-hub-grid">
                <HubCard icon={HUB_ICONS.clip} title="网页剪藏" desc="右键将网页内容 AI 整理后写入飞书" />
                <HubCard icon={HUB_ICONS.download} title="全量抓取" desc="抓取虚拟滚动表格的全部数据行" />
                <HubCard icon={HUB_ICONS.camera} title="截图识别" desc="视觉模型识别图片中的表格数据" />
                <HubCard icon={HUB_ICONS.file} title="文件导入" desc="拖入 CSV 文件，AI 整理写入飞书" />
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (view.mode === 'dataviz') {
    return <DataVizPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'aisite') {
    return <AISitePanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'smartfill') {
    return <SmartFillPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'slides') {
    return <SlidesPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'pdfTranscribe') {
    return <PdfTranscribePanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} recentFiles={recentFiles} onRemoveRecent={onRemoveRecent} />
  }

  if (view.mode === 'gallery') {
    const registryUrl = settings.templateRegistryUrl || DEFAULT_REGISTRY
    // First remote fetch hasn't merged yet → show skeletons instead of bare builtins.
    const initialLoading = refreshing && templates === BUILTIN_TEMPLATES
    return (
      <div className="scenario-panel view-enter" key="gallery">
        <TopBar title="场景模版" onBack={() => setView({ mode: 'hub' })} />
        <div className="sc-search-row">
          <input
            className="sc-search"
            placeholder="搜索场景模版…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="sc-cats">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`sc-cat ${category === cat ? 'sc-cat--active' : ''}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="sc-list">
          {initialLoading ? (
            Array.from({ length: 4 }).map((_, i) => <TemplateCardSkeleton key={i} />)
          ) : (
            <>
              {filtered.length === 0 && (
                <div className="sc-empty">没有匹配的模版</div>
              )}
              {filtered.map(t => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onClick={() => setView({ mode: 'detail', template: t })}
                />
              ))}
            </>
          )}
        </div>

        <div className="sc-registry-bar">
          {registryUrl ? (
            <>
              <span className="sc-registry-info">
                {cacheInfo
                  ? `更新于 ${timeAgo(cacheInfo.fetchedAt)}`
                  : '未缓存'}
              </span>
              <button
                className="sc-refresh-btn"
                onClick={() => registryUrl && loadRemote(registryUrl, true)}
                disabled={refreshing || !registryUrl}
              >
                {refreshing ? '更新中…' : '更新模版库'}
              </button>
            </>
          ) : (
            <span className="sc-registry-info">
              {DEFAULT_REGISTRY ? '模版市场' : '内置模版 · 在设置中配置模版库地址可获取更多'}
            </span>
          )}
          {refreshError && <span className="sc-refresh-err">{refreshError}</span>}
        </div>
      </div>
    )
  }

  // ── Detail (input form) ───────────────────────────────────────────────────

  if (view.mode === 'detail') {
    return (
      <DetailForm
        template={view.template}
        context={context}
        disabled={disabled}
        onBack={() => setView({ mode: 'gallery' })}
        onStart={(inputs) => launchTemplate(view.template, inputs)}
      />
    )
  }

  // ── Progress ──────────────────────────────────────────────────────────────

  if (view.mode === 'progress') {
    const failed = !!view.error
    const tpl = view.template
    const lastInputs = view.inputs
    return (
      <div className="scenario-panel scenario-panel--centered view-enter" key="progress">
        <div className="sc-progress-title">{failed ? '创建未完成' : '正在创建…'}</div>
        <div className="sc-steps">
          {view.steps.map(step => (
            <div key={step.id} className={`sc-step sc-step--${step.status}`}>
              <span className="sc-step-icon">
                {step.status === 'done' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> : step.status === 'error' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> : step.status === 'running' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/></svg>}
              </span>
              <span className="sc-step-label">{step.label}</span>
              {step.detail && <span className="sc-step-detail">{step.detail}</span>}
            </div>
          ))}
        </div>

        {failed && (
          <>
            <div className="sc-error-box">
              <div className="sc-error-title">创建失败</div>
              <div className="sc-error-msg">{view.error}</div>
              <div className="sc-error-hint">已创建的部分（若有）不会自动删除，可按上方链接前往查看或在飞书中手动清理。</div>
            </div>
            <div className="sc-done-actions">
              {lastInputs && (
                <Button variant="primary" onClick={() => launchTemplate(tpl, lastInputs)}>
                  重试
                </Button>
              )}
              <Button onClick={() => setView({ mode: 'detail', template: tpl })}>
                返回上一步
              </Button>
              <Button onClick={() => setView({ mode: 'gallery' })}>
                返回模版列表
              </Button>
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Done ─────────────────────────────────────────────────────────────────

  if (view.mode === 'done') {
    const { result } = view
    return (
      <div className="scenario-panel scenario-panel--centered view-enter" key="done">
        <div className="sc-done-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        <h3 className="sc-done-title">创建完成！</h3>
        <div className="sc-done-name">「{result.appName}」</div>

        <div className="sc-done-stats">
          <div className="sc-stat">
            <span className="sc-stat-num">{result.tables.length}</span>
            <span className="sc-stat-label">张数据表</span>
          </div>
          <div className="sc-stat">
            <span className="sc-stat-num">{result.totalRecords}</span>
            <span className="sc-stat-label">条示例数据</span>
          </div>
        </div>

        <div className="sc-done-tables">
          {result.tables.map(t => (
            <div key={t.ref} className="sc-done-table">
              <span>{t.name}</span>
              <span className="sc-done-check"></span>
            </div>
          ))}
        </div>

        {result.dashboardsCreated && result.dashboardsCreated.length > 0 && (
          <div className="sc-dash-created">
            {result.dashboardsCreated.map((name, i) => (
              <div key={i} className="sc-dash-created-item">
                <span></span>
                <span>仪表盘「{name}」已自动创建并配置图表</span>
              </div>
            ))}
          </div>
        )}

        {result.dashboardWarnings && result.dashboardWarnings.length > 0 && (
          <div className="sc-dash-warnings">
            <p className="sc-dash-warn-title">仪表盘需手动处理</p>
            {result.dashboardWarnings.map((w, i) => (
              <p key={i} className="sc-dash-warn-item">{w}</p>
            ))}
          </div>
        )}

        <Button variant="primary" block onClick={() => openUrlInNewTab(result.appUrl)}>
          在飞书中打开 ↗
        </Button>

        <div className="sc-done-actions">
          <Button block onClick={() => setView({ mode: 'gallery' })}>
            返回模版列表
          </Button>
        </div>
      </div>
    )
  }

  return null
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TemplateCard({
  template: t, onClick,
}: {
  template: ScenarioTemplate; onClick: () => void
}) {
  // Cover image is optional; fall back to the emoji icon if absent or it fails to load.
  const [coverFailed, setCoverFailed] = useState(false)
  // Only render http(s) covers — blocks a javascript:/data: src smuggled via a remote template.
  const coverSrc = safeImageSrc(t.cover)
  const showCover = !!coverSrc && !coverFailed
  // The whole card opens the detail/config view — browsing isn't gated by API keys;
  // the real gate is the "开始创建" button inside DetailForm.
  return (
    <div
      className="sc-card sc-card--clickable"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      <div className="sc-card-left">
        {showCover ? (
          <img
            className="sc-card-cover"
            src={coverSrc}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <span className="sc-card-icon">{t.icon}</span>
        )}
      </div>
      <div className="sc-card-body">
        <div className="sc-card-title-row">
          <span className="sc-card-title">{t.name}</span>
          {t.source === 'remote' && <span className="sc-badge-remote">远程</span>}
        </div>
        <p className="sc-card-desc">{t.description}</p>
        <div className="sc-card-meta">
          {t.preview.tables} 张表 · {t.preview.views} 个视图 · {t.preview.records} 条示例
          {(t.preview.dashboards ?? 0) > 0 && ` · ${t.preview.dashboards} 个仪表盘`}
        </div>
      </div>
      <button
        className="sc-card-btn"
        onClick={(e) => { e.stopPropagation(); onClick() }}
        title="查看并创建"
      >
        查看
      </button>
    </div>
  )
}

function DetailForm({
  template, context, disabled, onBack, onStart,
}: {
  template: ScenarioTemplate
  context: PageContext
  disabled: boolean
  onBack: () => void
  onStart: (inputs: Record<string, string>) => void
}) {
  const initInputs = Object.fromEntries(
    template.inputs.map(inp => [inp.key, inp.default ?? ''])
  )
  const [inputs, setInputs] = useState<Record<string, string>>(initInputs)
  const [target, setTarget] = useState<'new_app' | 'current_app'>(template.target)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setInputs(v => ({ ...v, [k]: e.target.value }))

  const canSubmit = template.inputs
    .filter(i => i.required)
    .every(i => inputs[i.key]?.trim())

  return (
    <div className="scenario-panel view-enter" key="detail">
      <TopBar
        title={template.name}
        onBack={onBack}
        rightAction={<span className="sc-detail-icon">{template.icon}</span>}
      />

      <div className="sc-detail-body">
        <p className="sc-detail-desc">{template.description}</p>

        {/* Preview */}
        <div className="sc-preview">
          <p className="sc-preview-label">将创建</p>
          {template.tables.map(t => {
            const formulaCount = t.fields.filter(f => f.type === 20).length
            return (
              <div key={t.ref} className="sc-preview-item">
                <svg className="sc-preview-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v18" /><path d="M3 12h18" /><rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
                <span>
                  {t.name}（{t.fields.length} 字段
                  {formulaCount > 0 ? `，含 ${formulaCount} 个公式` : ''}
                  {t.views?.length ? `，${t.views.length} 视图` : ''}
                  {t.sample_records?.length ? `，${t.sample_records.length} 条示例` : ''}）
                </span>
              </div>
            )
          })}
          {template.dashboards?.map(d => (
            <div key={d.name} className="sc-preview-item">
              <svg className="sc-preview-ic sc-preview-ic--dash" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
              </svg>
              <span>仪表盘「{d.name}」（{d.blocks.length} 个图表）</span>
            </div>
          ))}
        </div>

        {/* Inputs */}
        {template.inputs.length > 0 && (
          <div className="sc-inputs">
            <p className="sc-inputs-label">配置</p>
            {template.inputs.map(inp => (
              <label key={inp.key} className="sc-input-field">
                <span className="sc-input-label">
                  {inp.label}{inp.required && <span className="sc-required">*</span>}
                </span>
                {inp.type === 'select' ? (
                  <select className="field-input" value={inputs[inp.key]} onChange={set(inp.key)}>
                    {inp.options?.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="field-input"
                    type="text"
                    value={inputs[inp.key]}
                    onChange={set(inp.key)}
                    placeholder={inp.placeholder}
                  />
                )}
              </label>
            ))}
          </div>
        )}

        {/* Target selector — segmented control */}
        <div className="sc-target">
          <p className="sc-inputs-label">目标应用</p>
          <div className="sc-target-opts">
            <label className={`sc-target-opt${target === 'new_app' ? ' sc-target-opt--active' : ''}`}>
              <input type="radio" name="target" value="new_app" checked={target === 'new_app'} onChange={() => setTarget('new_app')} />
              <svg className="sc-target-opt-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>创建新应用</span>
            </label>
            <label className={`sc-target-opt${target === 'current_app' ? ' sc-target-opt--active' : ''}${!context.feishu?.isBase ? ' sc-target-opt--disabled' : ''}`}>
              <input type="radio" name="target" value="current_app" disabled={!context.feishu?.isBase} checked={target === 'current_app'} onChange={() => setTarget('current_app')} />
              <svg className="sc-target-opt-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
              <span>当前 Base{!context.feishu?.isBase ? '（未打开）' : ''}</span>
            </label>
          </div>
        </div>

        <Button
          variant="primary"
          block
          disabled={disabled || !canSubmit}
          onClick={() => onStart({ ...inputs, _target: target })}
        >
          {disabled ? '请先配置 API Keys' : '开始创建 →'}
        </Button>
      </div>
    </div>
  )
}

// ─── Template execution ───────────────────────────────────────────────────────

async function runTemplate(
  template: ScenarioTemplate,
  inputs: Record<string, string>,
  settings: AppSettings,
  context: PageContext,
  onProgress: (steps: ProgressStep[]) => void
): Promise<CreationResult> {
  const token = await resolveToken(settings)
  const target = (inputs._target as 'new_app' | 'current_app') ?? template.target
  const tpl = { ...template, target }

  // DOM automation is only reliable when we're already on the target Base page
  const createDashboard = target === 'current_app'
    ? async (name: string): Promise<string | null> => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (!tab?.id) return null
          const result = await chrome.tabs.sendMessage(tab.id, { type: 'CREATE_DASHBOARD_UI', name })
          return (result as { blockToken?: string } | null)?.blockToken ?? null
        } catch {
          return null
        }
      }
    : undefined

  return executeTemplate(
    tpl, inputs, token, context.feishu?.appToken, onProgress, createDashboard,
    context.url, settings.feishuOwnerOpenId?.trim() || undefined
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
