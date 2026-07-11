import React, { useState } from 'react'
import type { AppSettings, PageContext, SessionKind } from '@/shared/types'
import { HAS_KNOWLEDGE_BASE } from '@/shared/config'
import HubCard from '../shell/HubCard'
import DataVizPanel from './DataVizPanel'
import SmartFillPanel from './SmartFillPanel'
import SlidesPanel from './SlidesPanel'
import PdfTranscribePanel from './PdfTranscribePanel'
import FileImportPanel from './FileImportPanel'
import SkillPanel from './SkillPanel'
import KnowledgeBasePanel from '../settings/knowledge-base/KnowledgeBasePanel'
import type { RecentFile } from '../../services/recentFiles'
import './ScenarioPanel.css'


interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  /** Open the settings tab — forwarded to KnowledgeBasePanel's gate so an unconnected
   *  vault routes the user to setup instead of showing an inline connect form. */
  onGoToSettings: () => void
  /** Recent docs/sheets surfaced to sub-panels (e.g. PDF 转写's target-document combobox). */
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
  /** Resolve a wiki-wrapped resource to its real kind, forwarded to SlidesPanel's source dropdown
   *  so wiki-Base/Sheet rows show the right type icon. Optional. */
  resolveWikiKind?: (wikiToken: string) => Promise<SessionKind | undefined>
}

type View =
  | { mode: 'hub' }
  | { mode: 'dataviz' }
  | { mode: 'smartfill' }
  | { mode: 'slides' }
  | { mode: 'pdfTranscribe' }
  | { mode: 'fileImport' }
  | { mode: 'skill' }
  | { mode: 'knowledgeBase' }

// ── Hub icons (iOS / SF Symbols style line icons) ──────────────────────────
const stroke = { stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const Svg = (d: React.ReactNode) => <svg viewBox="0 0 24 24" fill="none" {...stroke}>{d}</svg>
const HUB_ICONS: Record<string, React.ReactNode> = {
  chart: Svg(<><rect x="3" y="12" width="4" height="9" rx="1" /><rect x="10" y="7" width="4" height="14" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" /></>),
  sparkle: Svg(<path d="M12 2l1.8 5.5 5.7.3-4.3 3.2 1.4 5.5L12 13l-4.6 3.5 1.4-5.5-4.3-3.2 5.7-.3z" />),
  report: Svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></>),
  audit: Svg(<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></>),
  summary: Svg(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r=".8" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r=".8" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r=".8" fill="currentColor" stroke="none" /></>),
  slides: Svg(<><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /><polyline points="6 10 10 14 14 10 18 14" /></>),
  camera: Svg(<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>),
  file: Svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><polyline points="9 15 12 12 15 15" /></>),
  book: Svg(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>),
  skill: Svg(<><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></>),
}

export default function ScenarioPanel({ settings, context, disabled, onGoToSettings, recentFiles, onRemoveRecent, resolveWikiKind }: Props) {
  const [view, setView] = useState<View>({ mode: 'hub' })

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
      ] },
      { key: 'enrich', label: '数据分析', requires: 'table', feats: [
        { icon: 'sparkle', title: '智能填充', desc: 'AI 推断并补全空缺的列数据', go: () => setView({ mode: 'smartfill' }) },
      ] },
      { key: 'slides', label: '演示文稿', requires: 'content', feats: [
        { icon: 'slides', title: 'PPT 生成', desc: '将文档或表格数据转为演示 PPT', go: () => setView({ mode: 'slides' }) },
      ] },

      { key: 'pdf', label: '内容转写', requires: 'any', feats: [
        { icon: 'file', title: 'PDF 格式转换', desc: 'PDF 转换为可编辑的 Markdown', go: () => setView({ mode: 'pdfTranscribe' }) },
        { icon: 'file', title: '表格文件转写', desc: '导入 CSV/TSV/TXT，AI 整理后写入飞书文档或表格', go: () => setView({ mode: 'fileImport' }) },
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

          <div className="sc-hub-group">
            <div className="sc-hub-section">技能库</div>
            <div className="sc-hub-grid">
              <HubCard
                icon={HUB_ICONS.skill}
                title="技能库"
                desc="上传或创建 skill，agent 可调用执行任务"
                onClick={() => setView({ mode: 'skill' })}
              />
            </div>
          </div>

          {HAS_KNOWLEDGE_BASE && (
            <div className="sc-hub-group">
              <div className="sc-hub-section">知识库</div>
              <div className="sc-hub-grid">
                <HubCard
                  icon={HUB_ICONS.book}
                  title="知识库"
                  desc="把 Obsidian 仓库接入，可被助手检索与读写"
                  onClick={() => setView({ mode: 'knowledgeBase' })}
                />
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

  if (view.mode === 'smartfill') {
    return <SmartFillPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'slides') {
    return <SlidesPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} recentFiles={recentFiles} onRemoveRecent={onRemoveRecent} resolveWikiKind={resolveWikiKind} />
  }

  if (view.mode === 'pdfTranscribe') {
    return <PdfTranscribePanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} recentFiles={recentFiles} onRemoveRecent={onRemoveRecent} />
  }

  if (view.mode === 'fileImport') {
    return <FileImportPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} recentFiles={recentFiles} onRemoveRecent={onRemoveRecent} />
  }

  if (view.mode === 'skill') {
    return <SkillPanel onBack={() => setView({ mode: 'hub' })} />
  }

  if (view.mode === 'knowledgeBase') {
    return <KnowledgeBasePanel settings={settings} onBack={() => setView({ mode: 'hub' })} onGoToSettings={onGoToSettings} />
  }

  return null
}
