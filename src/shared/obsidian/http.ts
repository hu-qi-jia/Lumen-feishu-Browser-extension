/** Obsidian Local REST API fetch helper. Mirrors feishu/http.ts shape but with its OWN
 *  outbound guard (isObsidianOutboundAllowed) — never reuse feishuFetch (its Feishu-domain
 *  guard rejects loopback). Loopback-only by construction (see config.ts).
 *  NOTE: obsidianRobustFetch mirrors feishu/http.ts robustFetch; a future refactor could
 *  hoist both into a shared util. */
import type { AppSettings } from '../types'
import { isObsidianOutboundAllowed } from '../config'
import { getObsidianToken } from './auth'

const TIMEOUT_MS = 30_000

/** fetch with timeout + bounded retry for GET ONLY. Writes never retry (a timed-out create
 *  may have succeeded → retry would duplicate it). Reads are safe to retry on transient net. */
async function obsidianRobustFetch(url: string, init: RequestInit, method: string): Promise<Response> {
  const maxAttempts = method.toUpperCase() === 'GET' ? 3 : 1
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, signal: ctrl.signal })
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 400 * attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`Obsidian 请求失败（已重试 ${maxAttempts} 次）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

/** Build a full Obsidian URL from the configured base + a vault-relative path.
 *  `path` is the segment after the host, already URL-encoded by the caller for note paths
 *  (use encodeVaultPath), or a literal like 'search/simple/'. '' = the server root. */
export function buildObsidianUrl(baseUrl: string, path: string, params?: Record<string, string>): string {
  const url = new URL(baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, ''))
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

/** Make an Obsidian request, returning the raw Response. Resolves the API key (sent only when
 *  present — GET / is auth-optional), enforces the loopback outbound guard, applies timeout
 *  + GET-only retry. `opts.token` overrides the stored token (used by the connect form). */
export async function obsidianFetch(
  method: string,
  path: string,
  settings: AppSettings,
  opts: { body?: BodyInit | null; headers?: Record<string, string>; params?: Record<string, string>; token?: string } = {}
): Promise<Response> {
  const baseUrl = settings.obsidianBaseUrl || 'http://127.0.0.1:27123'
  const url = buildObsidianUrl(baseUrl, path, opts.params)
  if (!isObsidianOutboundAllowed(url, baseUrl)) {
    throw new Error(`出站被拦截：${new URL(url).host} 不在允许的 Obsidian loopback 端点内`)
  }
  const token = opts.token !== undefined ? opts.token : await getObsidianToken()
  const headers: Record<string, string> = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) }
  const init: RequestInit = { method: method.toUpperCase(), headers, body: opts.body ?? undefined }
  return obsidianRobustFetch(url, init, method)
}
