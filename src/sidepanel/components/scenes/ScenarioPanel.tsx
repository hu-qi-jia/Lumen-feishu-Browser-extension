import React, { useState } from 'react'
import type { AppSettings, PageContext, SessionKind } from '@/shared/types'
import { HAS_KNOWLEDGE_BASE } from '@/shared/config'
import HubCard from '../shell/HubCard'
import DataVizPanel from './DataVizPanel'
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
  /** Resolve a wiki node to its real kind + obj_token. Reuses the shared cache. */
  resolveWikiNode?: (wikiToken: string) => Promise<{ kind: SessionKind; docToken: string } | undefined>
}

type View =
  | { mode: 'hub' }
  | { mode: 'dataviz' }
  | { mode: 'slides' }
  | { mode: 'pdfTranscribe' }
  | { mode: 'fileImport' }
  | { mode: 'skill' }
  | { mode: 'knowledgeBase' }

// ── Hub icons (Lucide / Phosphor style — unified geometric line set, 1.5 stroke) ──
const stroke = { stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const Svg = (d: React.ReactNode) => <svg viewBox="0 0 24 24" fill="none" {...stroke}>{d}</svg>
const HUB_ICONS: Record<string, React.ReactNode> = {
  chart: Svg(<><path d="M4 14a8 8 0 0 1 16 0" /><path d="M4 14h16" /><path d="M12 14l4.5-3.5" /><circle cx="12" cy="14" r="1.1" fill="currentColor" stroke="none" /></>),
  slides: Svg(<><rect x="2" y="3" width="20" height="13" rx="2" /><path d="M12 16v4" /><path d="M8 21h8" /></>),
  file: Svg(<><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" /><polyline points="14.5 2 14.5 7.5 20 7.5" /><path d="M8 13h8" /><path d="M8 17h6" /></>),
  table: Svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" /></>),
  skill: Svg(<><path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" /></>),
  book: Svg(<><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></>),
}

export default function ScenarioPanel({ settings, context, disabled, onGoToSettings, recentFiles, onRemoveRecent, resolveWikiKind, resolveWikiNode }: Props) {
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
      { key: 'page', label: '数据可视化', requires: 'any', feats: [
        { icon: 'chart', title: 'AI 看板', desc: '表格数据生成图表看板', go: () => setView({ mode: 'dataviz' }) },
      ] },
      { key: 'slides', label: '演示文稿', requires: 'content', feats: [
        { icon: 'slides', title: 'PPT 生成', desc: '将文档或表格数据转为演示 PPT', go: () => setView({ mode: 'slides' }) },
      ] },

      { key: 'pdf', label: '内容转写', requires: 'any', feats: [
        { icon: 'file', title: 'PDF 格式转换', desc: 'PDF 转 Markdown', go: () => setView({ mode: 'pdfTranscribe' }) },
        { icon: 'table', title: '表格文件转写', desc: 'CSV/TSV 写入飞书文档', go: () => setView({ mode: 'fileImport' }) },
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
    return <DataVizPanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} recentFiles={recentFiles} onRemoveRecent={onRemoveRecent} resolveWikiKind={resolveWikiKind} resolveWikiNode={resolveWikiNode} />
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
