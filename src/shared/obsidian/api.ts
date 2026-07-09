/** High-level Obsidian vault operations. Thin wrappers over the REST API used by the Hub
 *  panel (Plan 2) and the agent KB tools (Plan 3). Plan 1 ships just the ping probe. */
import type { AppSettings } from '../types'
import { obsidianFetch } from './http'
import { encodeVaultPath } from './util'

export interface ObsidianPing {
  ok: boolean
  /** HTTP status from GET / (200 = server reachable; 401 = reachable, token wrong). */
  status: number
  /** True when the server confirms the token is valid. */
  authenticated?: boolean
  /** Vault name advertised by the server, if present. */
  vault?: string
}

/** Reachability + auth probe: GET / . No token required to confirm the server is up, but a
 *  token (stored or via opts) is sent when available so we can also confirm it's valid.
 *  This is the PNA/CSP gate primitive — never throws; network/CSP/PNA blocks return ok:false. */
export async function pingObsidian(settings: AppSettings, token?: string): Promise<ObsidianPing> {
  try {
    const res = await obsidianFetch('GET', '', settings, token ? { token } : {})
    let body: { authenticated?: boolean; vault?: string } = {}
    try { body = await res.json() as typeof body } catch { /* non-JSON (older plugin) */ }
    return {
      ok: res.ok || res.status === 401,                  // 401 = server reachable, token wrong
      status: res.status,
      authenticated: body.authenticated ?? (res.ok && !!token),
      vault: body.vault,
    }
  } catch {
    return { ok: false, status: 0, authenticated: false } // CSP / PNA / Obsidian not running
  }
}

/** 一行笔记（列表/搜索结果通用）。`path` 是 vault 相对路径。 */
export interface ObsidianNoteRow {
  path: string
  /** ms 纪元（最近列表用）。 */
  mtime?: number
  /** 搜索命中的上下文片段。 */
  snippet?: string
  /** 搜索得分。 */
  score?: number
}

/** 把非 ok 响应翻成可读错误：401 专门提示重新接入（避免被误读成"网络/CSP/PNA 拦截"），
 *  其它非 ok 带状态码。obsidianFetch 的 loopback 守卫在网络/CSP 层已先行拦截并抛"出站被拦截"。 */
function authedOrThrow(res: { ok: boolean; status: number }, fallback: string): void {
  if (res.status === 401) throw new Error('Obsidian API Key 无效或已失效 — 请到「应用 → 知识库」重新接入。')
  if (!res.ok) throw new Error(`${fallback}（${res.status}）`)
}

/** 最近笔记：POST /search/ JsonLogic `{var:"stat.mtime"}` 返回每篇 mtime（非假→全量），
 *  客户端按 mtime 倒序 + 切片（插件无服务端 sort/limit）。
 *  ⚠️ 大 vault（万级）这条全量拉取可能偏慢——UI 层应缓存（spec §7.2）。 */
export async function recentNotes(settings: AppSettings, limit = 20): Promise<ObsidianNoteRow[]> {
  const res = await obsidianFetch('POST', 'search/', settings, {
    headers: { 'Content-Type': 'application/vnd.olrapi.jsonlogic+json' },
    body: JSON.stringify({ var: 'stat.mtime' }),
  })
  authedOrThrow(res, '读取最近笔记失败')
  const items = (await res.json()) as Array<{ filename: string; result: number }>
  return items
    .map((it) => ({ path: it.filename, mtime: typeof it.result === 'number' ? it.result : undefined }))
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    .slice(0, limit)
}

/** 全文搜索：POST /search/simple/?query= 。空查询短路返回 []（不发请求）。 */
export async function searchVault(settings: AppSettings, query: string): Promise<ObsidianNoteRow[]> {
  const q = query.trim()
  if (!q) return []
  const res = await obsidianFetch('POST', 'search/simple/', settings, { params: { query: q } })
  authedOrThrow(res, '搜索失败')
  const items = (await res.json()) as Array<{ filename: string; score: number; matches?: Array<{ context: string }> }>
  return items.map((it) => ({ path: it.filename, score: it.score, snippet: it.matches?.[0]?.context }))
}

/** 读笔记正文（markdown）。`path` 为 vault 相对路径。 */
export async function readNote(settings: AppSettings, path: string): Promise<string> {
  const res = await obsidianFetch('GET', `vault/${encodeVaultPath(path)}`, settings, { headers: { Accept: 'text/markdown' } })
  authedOrThrow(res, '读取笔记失败')
  return res.text()
}

/** 整篇写/新建：PUT /vault/{path} text/markdown。 */
export async function writeNote(settings: AppSettings, path: string, content: string): Promise<void> {
  const res = await obsidianFetch('PUT', `vault/${encodeVaultPath(path)}`, settings, {
    headers: { 'Content-Type': 'text/markdown' },
    body: content,
  })
  authedOrThrow(res, '保存笔记失败')
}

/** 删除笔记：DELETE /vault/{path}（204 成功）。删除破坏性——调用方必须先确认。 */
export async function deleteNote(settings: AppSettings, path: string): Promise<void> {
  const res = await obsidianFetch('DELETE', `vault/${encodeVaultPath(path)}`, settings, {})
  authedOrThrow(res, '删除笔记失败')
}
