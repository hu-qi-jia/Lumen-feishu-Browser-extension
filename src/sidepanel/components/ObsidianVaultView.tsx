import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { recentNotes, searchVault, type ObsidianNoteRow } from '../../shared/obsidian/api'
import Tooltip from './Tooltip'
import SearchBox from './SearchBox'
import ObsidianNoteDetail from './ObsidianNoteDetail'
import { IconPlus } from './icons'
import './ObsidianVaultView.css'

interface Props {
  settings: AppSettings
}

function relTime(ms?: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(ms).toLocaleDateString()
}

/** 已连接态：扁平顶栏（vault 名 + 右上「新建笔记」图标）+ SearchBox + 最近/搜索 tab + 扁平行列表。
 *  设置/改连接走 Hub 门禁或全局设置入口，不在本页内联。 */
export default function ObsidianVaultView({ settings }: Props) {
  const [tab, setTab] = useState<'recent' | 'search'>('recent')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ObsidianNoteRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const recentCache = useRef<ObsidianNoteRow[] | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  async function loadRecent(force = false) {
    if (!force && recentCache.current) { setRows(recentCache.current); return }
    setLoading(true); setError('')
    try {
      const r = await recentNotes(settings)
      recentCache.current = r; setRows(r)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (tab === 'recent') loadRecent() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tab])

  async function runSearch() {
    const q = query.trim()
    if (!q) return
    setTab('search'); setLoading(true); setError('')
    try { setRows(await searchVault(settings, q)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  // Ctrl/Cmd+K 聚焦搜索框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (active) {
    return <ObsidianNoteDetail settings={settings} path={active} onClose={() => setActive(null)} onDeleted={() => { setActive(null); loadRecent(true) }} />
  }
  if (creating) {
    return <ObsidianNoteDetail settings={settings} path={null} onClose={() => { setCreating(false); setTab('recent'); loadRecent(true) }} onDeleted={() => setCreating(false)} />
  }

  return (
    <div className="kb-vault" data-testid="kb-vault-view">
      <div className="sc-field">
        <div className="kb-vault-head">
          <span className="kb-vault-name">{settings.obsidianVaultName || 'Obsidian'}</span>
          <Tooltip content="新建笔记" position="bottom">
            <button className="kb-head-btn" onClick={() => setCreating(true)} type="button" aria-label="新建笔记"><IconPlus /></button>
          </Tooltip>
        </div>
      </div>

      <div className="sc-field">
        <SearchBox value={query} onChange={setQuery} onSearch={runSearch} placeholder="搜索笔记…  (Ctrl+K)" ariaLabel="搜索笔记" inputRef={searchInput} />
      </div>

      <div className="sc-target-opts">
        <button className={`sc-target-opt${tab === 'recent' ? ' sc-target-opt--active' : ''}`} onClick={() => { setTab('recent'); loadRecent() }} type="button">最近</button>
        <button className={`sc-target-opt${tab === 'search' ? ' sc-target-opt--active' : ''}`} onClick={() => setTab('search')} type="button">搜索</button>
      </div>

      {error && <div className="sc-refresh-err">{error}</div>}
      {loading && <div className="sc-empty">载入中…</div>}
      {!loading && !error && rows.length === 0 && <div className="sc-empty">{tab === 'search' ? '无匹配笔记' : '仓库为空'}</div>}

      <ul className="kb-list">
        {rows.map((r) => {
          const title = r.path.split('/').pop() || r.path
          return (
            <li key={r.path}>
              <button className="kb-row" onClick={() => setActive(r.path)} type="button">
                <span className="kb-row-title">{title}</span>
                {r.path !== title && <span className="kb-row-path">{r.path}</span>}
                {r.snippet && <span className="kb-row-snip">{r.snippet}</span>}
                {r.mtime && tab === 'recent' && <span className="kb-row-time">{relTime(r.mtime)}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
