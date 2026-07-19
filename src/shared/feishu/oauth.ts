/**
 * In-extension Feishu OAuth (user identity).
 *
 * Flow: chrome.identity.launchWebAuthFlow → authorization code →
 *       authen/v2/oauth/token (user_access_token) → authen/v1/user_info (open_id).
 *
 * Token exchange + refresh need the client_secret. Direct mode (personal):
 *   VITE_FEISHU_APP_SECRET baked in, or password-encrypted, or user-entered (store build).
 */
import { BUILD_CONFIG, FEISHU_API_BASE, FEISHU_AUTHORIZE_URL, isFeishuOutboundAllowed } from '../config'
import { getClientSecret } from './appSecret'
import { getUserAppId, hasUserAppCreds } from './userAppCreds'

const AUTHORIZE = FEISHU_AUTHORIZE_URL
const TOKEN = `${FEISHU_API_BASE}/authen/v2/oauth/token`
const USER_INFO = `${FEISHU_API_BASE}/authen/v1/user_info`

/**
 * Default OAuth scopes requested during「用飞书账号授权」when the operator hasn't set
 * VITE_FEISHU_OAUTH_SCOPE. These cover every user_access_token-gated API the extension
 * calls; the corresponding scopes must ALSO be enabled on the app in the Feishu console.
 * If a scope here isn't enabled on the app, Feishu will error at authorize time — remove
 * it from VITE_FEISHU_OAUTH_SCOPE or enable it in the console.
 */
const DEFAULT_OAUTH_SCOPES = [
  'offline_access',
  'bitable:app',
  'docx:document',
  'sheets:spreadsheet',
  'drive:drive',
  'wiki:wiki',
  'contact:user.base:readonly',
  'board:whiteboard:node:create',
  'board:whiteboard:node:read',
  'board:whiteboard:node:delete',
  'board:whiteboard:node:update',
]

interface TokenResp { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string; scope?: string }

/**
 * Resolve the App ID for OAuth: baked-in (direct build) → user-entered (BYO / store build).
 * Empty string when neither is configured — caller surfaces a clear error.
 */
async function resolveAppId(): Promise<string> {
  return BUILD_CONFIG.feishuAppId || (await getUserAppId())
}

/**
 * fetch + read-as-text + parse-JSON for OAuth endpoints (token + user_info).
 * Mirrors feishuReq's text-first pattern: a 401/4xx with a non-JSON body (e.g. an
 * HTML error page from a misrouted request) surfaces a clear error instead of a
 * cryptic "Unexpected non-whitespace character after JSON" or a bare
 * "Failed to load resource: the server responded with a status of 401" console line
 * that hides the real reason (invalid client, expired refresh_token, wrong redirect_uri).
 * Returns { ok, status, json } so callers can craft specific error messages.
 */
async function oauthFetch(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(url, init)
  const raw = await res.text()
  let json: any = {}
  if (raw) {
    try {
      json = JSON.parse(raw)
    } catch {
      throw new Error(`OAuth 端点返回非 JSON 响应（HTTP ${res.status}）：${raw.slice(0, 200) || '(空)'}`)
    }
  }
  return { ok: res.ok, status: res.status, json }
}

/**
 * Request a token from Feishu. The client_secret is sent in the POST body
 * (baked-plaintext, password-unlocked, or user-entered). Returns the parsed token response.
 */
async function requestToken(payload: Record<string, unknown>): Promise<TokenResp> {
  const clientId = await resolveAppId()
  if (!clientId) {
    throw new Error('未配置 App ID：请在「设置 → 飞书设置」填写你自己的飞书 App ID 与 App Secret。')
  }
  const clientSecret = await getClientSecret()
  if (!clientSecret) {
    throw new Error('应用密钥未就绪：请在「设置 → 飞书设置」填写并保存你的 App Secret（内置加密版则先输入解锁密码）。')
  }
  if (!isFeishuOutboundAllowed(TOKEN)) {
    throw new Error(`出站被拦截：${new URL(TOKEN).hostname} 不在允许的飞书主机列表内`)
  }
  const { json } = await oauthFetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, client_id: clientId, client_secret: clientSecret }),
  })
  return json as TokenResp
}

/** OAuth is usable when an app id is configured AND we can obtain tokens — a baked secret
 *  (direct), a password-encrypted secret (direct, after unlock), or user-entered App ID +
 *  Secret (public / store "bring your own app" build). */
async function canDoOAuth(): Promise<boolean> {
  if (BUILD_CONFIG.feishuAppId) {
    return !!BUILD_CONFIG.feishuAppSecret || !!BUILD_CONFIG.appSecretEnc
  }
  return await hasUserAppCreds()
}

export interface OAuthResult {
  userToken: string
  openId: string
  name: string
  /** Long-lived refresh token — persist to auto-renew the user token before its ~2h expiry. */
  refreshToken?: string
  /** user_access_token lifetime in seconds (typically ~7200). */
  expiresIn?: number
}

/**
 * Exchange a refresh_token for a fresh user_access_token (+ rotated refresh_token).
 * Returns null on any failure (caller falls back to the existing token and lets the
 * eventual 401 surface). Used by auth.getValidUserToken for transparent renewal.
 */
export async function refreshUserAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number } | null> {
  if (!refreshToken || !(await canDoOAuth())) return null
  try {
    const tj = await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken })
    if (!tj.access_token) {
      // Surface WHY (refresh_token expired? secret wrong? scope?) — visible in the SW console.
      console.warn('[feishu-oauth] 自动续期失败：', tj.error_description ?? tj.error ?? JSON.stringify(tj))
      return null
    }
    // Feishu rotates the refresh_token on each use; keep the new one or reuse the old.
    return { accessToken: tj.access_token, refreshToken: tj.refresh_token ?? refreshToken, expiresIn: tj.expires_in }
  } catch (e) {
    console.warn('[feishu-oauth] 自动续期异常：', e instanceof Error ? e.message : String(e))
    return null
  }
}

/** The redirect URL that must be registered in the Feishu app's security settings.
 *  Returns '' when chrome.identity is unavailable (dev mock / non-extension context)
 *  so callers can render safely without crashing. */
export function oauthRedirectUrl(): string {
  try {
    return chrome?.identity?.getRedirectURL?.() ?? ''
  } catch {
    return ''
  }
}

/**
 * Fetch the user's open_id (+ name) directly from a user_access_token, via
 * authen/v1/user_info. A reliable fallback when in-extension OAuth is blocked
 * (redirect-URL registration, unpublished app, etc.) — the user pastes a token
 * and we fill open_id without launching the OAuth flow.
 */
export async function fetchUserOpenId(userToken: string): Promise<{ openId: string; name: string }> {
  const token = userToken.trim()
  if (!token) throw new Error('请先在上方填入 user_access_token')
  if (!isFeishuOutboundAllowed(USER_INFO)) {
    throw new Error(`出站被拦截：${new URL(USER_INFO).hostname} 不在允许的飞书主机列表内`)
  }
  const { status, json: ui } = await oauthFetch(USER_INFO, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!ui || ui.code !== 0 || !ui.data) {
    throw new Error(`获取用户信息失败（HTTP ${status}, code=${ui?.code}）：${ui?.msg || 'access token 无效或已过期'}。请确认 token 有效且未过期。`)
  }
  return { openId: ui.data.open_id, name: ui.data.name }
}

export async function authorizeFeishuUser(): Promise<OAuthResult> {
  if (!(await canDoOAuth())) {
    throw new Error('尚未配置飞书应用凭据：请在「设置 → 飞书设置」填写你的 App ID 与 App Secret。')
  }
  const appId = await resolveAppId()
  if (!appId) {
    throw new Error('未配置 App ID：请在「设置 → 飞书设置」填写你的飞书 App ID。')
  }
  const redirectUri = oauthRedirectUrl()
  if (!redirectUri) {
    throw new Error('无法获取扩展重定向 URL（需在扩展环境中运行，dev 预览不支持 OAuth）')
  }
  // CSPRNG state (CSRF defense for the OAuth callback) — not Math.random().
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  // `offline_access` is needed for Feishu to return a refresh_token; without it the
  // user_access_token dies at ~2h with no way to renew (code 99991677). It's a DEFAULT here, not
  // a hard requirement: an operator whose auth server lacks it can opt out by putting the token
  // `-offline_access` in VITE_FEISHU_OAUTH_SCOPE. prompt=consent ensures the consent screen shows.
  // When VITE_FEISHU_OAUTH_SCOPE is empty, fall back to DEFAULT_OAUTH_SCOPES so that a fresh
  // install requests every scope the extension needs — otherwise the user_access_token has
  // identity-only permissions and every API call 403s even after enabling scopes in the console.
  const configured = BUILD_CONFIG.feishuOauthScope.trim().split(/\s+/).filter(Boolean)
  const optOut = configured.includes('-offline_access')
  const wanted = configured.filter((s) => s !== '-offline_access')
  const base = configured.length ? wanted : DEFAULT_OAUTH_SCOPES.filter((s) => s !== 'offline_access')
  const scope = Array.from(new Set(optOut ? base : ['offline_access', ...base])).join(' ')
  const authUrl =
    `${AUTHORIZE}?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&state=${state}&prompt=consent` +
    (scope ? `&scope=${encodeURIComponent(scope)}` : '')

  let finalUrl: string | undefined
  try {
    finalUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // "The user did not approve access" = 授权窗口没有跳回 redirect_uri 就结束了。
    // 真实原因通常是下面之一，逐一排查：
    throw new Error(
      `授权未完成（${msg}）。逐项检查：\n` +
      `① 重定向 URL 必须在飞书后台「安全设置 → 重定向 URL」里【完全一致】登记（含末尾斜杠）：${redirectUri}\n` +
      `② 应用若是「测试中」，你必须是应用的测试成员（或先发布上线），否则授权页无「同意」按钮；\n` +
      `③ 别在授权页中途关闭窗口；\n` +
      `④ 实在不行可跳过授权：手动获取 open_id 填到上面的输入框（见「如何获取?」）。`
    )
  }
  if (!finalUrl) throw new Error('授权被取消')

  const params = new URL(finalUrl).searchParams
  if (params.get('state') !== state) throw new Error('state 不匹配，已中止（可能的 CSRF）')
  const code = params.get('code')
  if (!code) throw new Error('未取得授权码：' + (params.get('error_description') ?? params.get('error') ?? finalUrl))

  const tj = await requestToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  if (!tj.access_token) {
    throw new Error('换取 token 失败：' + (tj.error_description ?? tj.error ?? JSON.stringify(tj)))
  }
  if (!isFeishuOutboundAllowed(USER_INFO)) {
    throw new Error(`出站被拦截：${new URL(USER_INFO).hostname} 不在允许的飞书主机列表内`)
  }
  const { status, json: ui } = await oauthFetch(USER_INFO, {
    headers: { Authorization: `Bearer ${tj.access_token}` },
  })
  if (!ui || ui.code !== 0 || !ui.data) throw new Error(`获取用户信息失败（HTTP ${status}, code=${ui?.code}）：${ui?.msg}`)

  return {
    userToken: tj.access_token,
    openId: ui.data.open_id,
    name: ui.data.name,
    refreshToken: tj.refresh_token,
    expiresIn: tj.expires_in,
  }
}
