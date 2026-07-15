/** Shared Feishu Open API request helper (used by sheets.ts / docx.ts / api.ts). */
import { FEISHU_API_BASE, isFeishuOutboundAllowed } from '../config'
const BASE = FEISHU_API_BASE
const TIMEOUT_MS = 30_000

/**
 * fetch with a timeout, and bounded retries for IDEMPOTENT methods only. Writes
 * (POST/PUT/PATCH/DELETE) are NEVER auto-retried — a timed-out create may have
 * actually succeeded, so retrying would duplicate it (e.g. two tables). Reads are
 * safe to retry on transient network failures.
 */
export async function robustFetch(url: string, init: RequestInit, method: string): Promise<Response> {
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
  throw new Error(`网络请求失败（已重试 ${maxAttempts} 次）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

/**
 * Make a Feishu request, returning the raw Response. Shared by feishuReq + api.ts.
 */
export async function feishuFetch(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  params?: Record<string, string>
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
  const url = new URL(`${BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  // Code-layer allowlist: a Feishu call must target a configured Feishu host.
  if (!isFeishuOutboundAllowed(url.toString())) {
    throw new Error(`出站被拦截：${url.hostname} 不在允许的飞书主机列表内`)
  }
  return robustFetch(url.toString(), init, method)
}

export async function feishuReq<T = unknown>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  params?: Record<string, string>
): Promise<T> {
  const res = await feishuFetch(method, path, token, body, params)

  // Read the body as text first, then parse — so a non-JSON response (e.g. a 404
  // plain-text "404 page not found" from a wrong endpoint) gives a clear error
  // instead of a cryptic "Unexpected non-whitespace character after JSON at position 4".
  const raw = await res.text()
  let json: { code: number; msg: string; data: T }
  try {
    json = JSON.parse(raw) as { code: number; msg: string; data: T }
  } catch {
    throw new Error(`飞书 API 返回非 JSON 响应（HTTP ${res.status}）：${raw.slice(0, 200) || '(空)'}`)
  }
  if (!res.ok || json.code !== 0) {
    const isForbidden = /unauthorized|forbidden|permission|denied|1310213|1770032|91403/i.test(json.msg) || res.status === 403
    const hint = isForbidden
      ? '（应用对该资源无编辑权限。这是你本人创建的文档/表格？应用与你是两个不同身份——请在「设置」填入有编辑权限的 user_access_token 以你的身份操作，或在该文档右上「分享」把应用加为可编辑协作者）'
      : ''
    throw new Error(`Feishu API error (code=${json.code}): ${json.msg}${hint}`)
  }
  return json.data
}

/**
 * Multipart upload helper — same auth + outbound guard as feishuFetch, but sends
 * FormData without a Content-Type header so the browser can set the multipart
 * boundary automatically. Body is NEVER JSON-stringified. Throws on non-ok response
 * (caller inspects .json() envelope themselves).
 */
export async function feishuUpload(
  path: string,
  formData: FormData,
  token: string
): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  }
  const url = new URL(`${BASE}${path}`)
  if (!isFeishuOutboundAllowed(url.toString())) {
    throw new Error(`出站被拦截：${url.hostname} 不在允许的飞书主机列表内`)
  }
  return robustFetch(url.toString(), init, 'POST') // writes never retry
}
