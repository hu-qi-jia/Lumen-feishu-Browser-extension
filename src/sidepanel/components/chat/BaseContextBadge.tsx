import { useEffect, useRef, useState } from 'react'
import type { FieldCtx, BaseCtx } from '@/shared/feishu/context'
import { ctxSummary } from '@/shared/feishu/context'
import { exportBaseAsTemplate, downloadTemplateJSON } from '@/shared/feishu/export'
import { resolveToken } from '@/shared/feishu/auth'
import type { AppSettings } from '@/shared/types'
import { IconDownload, IconCheck, IconAlert, IconRefresh } from '../primitives/icons'
import Tooltip from '../primitives/Tooltip'
import './BaseContextBadge.css'

interface Props {
  ctx: BaseCtx | null
  loading: boolean
  error: string
  settings: AppSettings
  onRefresh: () => void
}

type ExportState = 'idle' | 'loading' | 'done' | 'error'

/**
 * Base (多维表格) context, rendered as its OWN row directly under the chat topbar (only on a
 * Base page). The topbar row above is left untouched. This row carries a one-line structural
 * summary (N tables · M fields) on the left — clicking it opens a full-width field popover —
 * and icon-only actions on the right that reuse `.chat-topbar-btn` so they match the topbar's
 * buttons (and 2px spacing) exactly. The table NAME is omitted (the doc-selector trigger
 * already shows it); the popover shows only the current table's field chips (header tags).
 */
export default function BaseContextBadge({ ctx, loading, error, settings, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [exportState, setExportState] = useState<ExportState>('idle')
  const [exportMsg, setExportMsg] = useState('')
  const summaryRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  async function handleExport() {
    if (!ctx || exportState === 'loading') return
    setExportState('loading')
    setExportMsg('')
    try {
      const token = await resolveToken(settings)
      const template = await exportBaseAsTemplate(token, ctx.appToken)
      const filename = downloadTemplateJSON(template)
      setExportState('done')
      setExportMsg(filename)
      setTimeout(() => setExportState('idle'), 3000)
    } catch (err) {
      setExportState('error')
      setExportMsg(err instanceof Error ? err.message : String(err))
      setTimeout(() => setExportState('idle'), 4000)
    }
  }

  // Close the field popover on outside click / Escape (the summary toggle handles its own).
  useEffect(() => {
    if (!expanded) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (summaryRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setExpanded(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setExpanded(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [expanded])

  // The current table drives the field popover (fallback to the first table when the active
  // table id isn't known). Header tags only — no table name, per spec.
  const table = ctx ? (ctx.tables.find((t) => t.tableId === ctx.currentTableId) ?? ctx.tables[0]) : undefined
  const fields = table?.fields ?? []
  const summary = ctx ? ctxSummary(ctx) : ''

  const exportTooltip =
    exportState === 'loading' ? '导出中…'
    : exportState === 'done' ? `已导出：${exportMsg}`
    : exportState === 'error' ? `导出失败：${exportMsg}`
    : '导出为模版 JSON（不含数据）'

  return (
    <div className="bcb">
      <div className="bcb-bar">
        {loading ? (
          <>
            <span className="bcb-spinner" />
            <span className="bcb-text">正在读取表结构…</span>
          </>
        ) : error && !ctx ? (
          <>
            <span className="bcb-err-icon" aria-hidden="true"><IconAlert /></span>
            <span className="bcb-text bcb-text--err">{readableError(error)}</span>
            <div className="bcb-spacer" />
            <Tooltip content="重新读取" position="left">
              <button className="chat-topbar-btn" onClick={onRefresh} type="button" aria-label="重新读取">
                <IconRefresh />
              </button>
            </Tooltip>
          </>
        ) : ctx ? (
          <>
            {/* Summary is the field-detail trigger: click → full-width popover below. */}
            <button
              ref={summaryRef}
              className="bcb-summary-btn"
              onClick={() => setExpanded((v) => !v)}
              type="button"
              aria-expanded={expanded}
              aria-label="查看字段详情"
            >
              <span className="bcb-dot bcb-dot--ok" aria-hidden="true" />
              <span className="bcb-summary">{summary}</span>
              <svg className={`bcb-chev${expanded ? ' bcb-chev--open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div className="bcb-spacer" />

            <div className="bcb-actions">
              <Tooltip content={exportTooltip} position="left">
                <button
                  className={`chat-topbar-btn${exportState === 'done' ? ' bcb-btn--success' : ''}`}
                  onClick={handleExport}
                  disabled={exportState === 'loading'}
                  type="button"
                  aria-label="导出为模版"
                >
                  {exportState === 'loading'
                    ? <span className="bcb-spinner bcb-spinner--btn" />
                    : exportState === 'done'
                    ? <IconCheck />
                    : <IconDownload />}
                </button>
              </Tooltip>
              <Tooltip content="重新读取" position="left">
                <button className="chat-topbar-btn" onClick={onRefresh} type="button" aria-label="重新读取">
                  <IconRefresh />
                </button>
              </Tooltip>
            </div>
          </>
        ) : null}
      </div>

      {/* Full-width field popover — spans the whole info bar width. */}
      {expanded && fields.length > 0 && (
        <div className="bcb-detail" ref={popoverRef} role="dialog" aria-label="字段详情">
          <div className="bcb-chips">
            {fields.map((f) => (
              <Tooltip key={f.fieldId} content={chipTooltip(f)} position="bottom">
                <span className="bcb-chip">
                  {f.fieldName}
                  {(f.type === 3 || f.type === 4) && <span className="bcb-chip-dot" />}
                </span>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {exportState === 'error' && exportMsg && (
        <div className="bcb-export-err" role="alert">{exportMsg}</div>
      )}
    </div>
  )
}

function readableError(error: string): string {
  if (/授权|authoriz/i.test(error)) return '请先在「设置」用飞书账号授权后再读取'
  if (/权限|forbidden|unauthorized|permission/i.test(error)) return '你的账号无该表权限'
  const msg = error.length > 48 ? `${error.slice(0, 48)}…` : error
  return `读取失败：${msg}`
}

function chipTooltip(f: FieldCtx): string {
  return `[${f.typeName}]${f.options?.length ? '\n' + f.options.join(' / ') : ''}`
}
