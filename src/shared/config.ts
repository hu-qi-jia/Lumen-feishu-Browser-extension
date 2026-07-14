/**
 * Build-time constants injected by Vite from .env.local.
 * These are string-replaced in the compiled bundle — not stored at runtime.
 */
// A store-PACKAGED build (VITE_WEBSTORE=1) ships NO baked credentials — it's BYO (the user enters
// their own App ID/Secret in Settings). Force the cred env to empty so a leaked `.env.local` value
// (Vite won't let an empty `.env.store.local` override it) can't bake the dev's app into a public
// store build. `_storePkg` folds to a constant → the minifier also strips the dead literal.
const _storePkg = (import.meta.env.VITE_WEBSTORE ?? '') === '1' || (import.meta.env.VITE_WEBSTORE ?? '') === 'true'

export const BUILD_CONFIG = {
  /** internal config revision */
  _rev: 'c0a73d',
  feishuAppId:     (_storePkg ? '' : (import.meta.env.VITE_FEISHU_APP_ID     ?? '')) as string,
  feishuAppSecret: (_storePkg ? '' : (import.meta.env.VITE_FEISHU_APP_SECRET ?? '')) as string,
  /** Password-encrypted App Secret (personal mode). base64(salt‖iv‖ciphertext), produced
   *  by scripts/encrypt-secret.mjs. The plaintext secret is NOT in the bundle — only this
   *  ciphertext; a user password (PBKDF2→AES-GCM) decrypts it at runtime to enable OAuth. */
  appSecretEnc:    (_storePkg ? '' : (import.meta.env.VITE_FEISHU_APP_SECRET_ENC ?? '')).trim() as string,
  /** Max tool calls per conversation turn before the agent stops and asks the user to
   *  confirm continuing (a safety checkpoint against runaway loops / mass operations).
   *  Default 60; set VITE_MAX_TOOL_CALLS to tune (clamped 1–100). */
  maxToolCalls: (() => {
    const n = parseInt((import.meta.env.VITE_MAX_TOOL_CALLS ?? '') as string, 10)
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 30
  })(),
  /** Space-separated OAuth scopes (must be enabled on the app). Empty = identity only. */
  feishuOauthScope: (import.meta.env.VITE_FEISHU_OAUTH_SCOPE ?? '') as string,
  allowedCidrs:    (import.meta.env.VITE_ALLOWED_CIDRS     ?? '')
    .split(',').map((s: string) => s.trim()).filter(Boolean) as string[],
  /** Optional host pin: comma-separated hostnames the LLM endpoint may point at.
   *  When set, the OpenAI base URL is restricted to these hosts (data-exfil guard).
   *  Empty = no host restriction, only the https/validity check. */
  openaiAllowedHosts: (import.meta.env.VITE_OPENAI_ALLOWED_HOSTS ?? '')
    .split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean) as string[],
  /** Redact likely-sensitive values (CN phone / email / ID / bank card) from data BEFORE it's sent
   *  to the LLM. Only affects the copy sent to the model — never the source Feishu data. */
  llmRedact: (import.meta.env.VITE_LLM_REDACT ?? '') === '1',
  /** Hard cap (chars) on a single data payload embedded in an LLM prompt. 0 = no extra cap. */
  llmMaxPayloadChars: Number(import.meta.env.VITE_LLM_MAX_PAYLOAD_CHARS ?? '') || 0,
  /** Feishu BASE DOMAIN. Public SaaS = feishu.cn. */
  feishuBaseDomain: 'feishu.cn',
  /** Screenshot clipper: capture the visible tab into a Feishu Base/Sheet/Doc via vision OCR.
   *  Gesture-gated + activeTab only (no new host_permissions, no new egress). Default on;
   *  set VITE_CLIP_ENABLED=false to ship without it. */
  clipEnabled: ((import.meta.env.VITE_CLIP_ENABLED ?? 'true') as string).trim().toLowerCase() !== 'false',
  /** Knowledge Base (Obsidian Local REST API integration). Default on; set
   *  VITE_KNOWLEDGE_BASE=false to ship without it. Loopback-only egress
   *  (see isObsidianOutboundAllowed + manifest host_permissions). */
  knowledgeBaseEnabled: ((import.meta.env.VITE_KNOWLEDGE_BASE ?? 'true') as string).trim().toLowerCase() !== 'false',
  /** Store-PACKAGING flag (VITE_WEBSTORE): strips manifest `key` + applies the store name/desc
   *  (in vite.config.ts). Does NOT by itself disable remote code — that's a separate, opt-in flag
   *  below, so a full-featured BYO build can still be packaged for the store. */
  webstore: (import.meta.env.VITE_WEBSTORE ?? '') === '1' ||
    (import.meta.env.VITE_WEBSTORE ?? '') === 'true',
  /** No-remote-code flag (VITE_NO_REMOTE_CODE): execute NO LLM-generated JS — data-viz/site render
   *  from a declarative VizSpec via the bundled interpreter, so the sandbox CSP drops 'unsafe-eval'.
   *  Parse identically to sandbox/main.ts NO_EVAL and vite.config.ts noEval (bare ===, no .trim())
   *  so a whitespaced value can't make the app believe "no remote code" while CSP still ships eval.
   *  One value, one parse, everywhere. */
  noRemoteCode: (import.meta.env.VITE_NO_REMOTE_CODE ?? '') === '1' ||
    (import.meta.env.VITE_NO_REMOTE_CODE ?? '') === 'true',
} as const

/** True when an App ID is configured AND we can mint a user token — a baked-in secret (direct),
 *  or a password-encrypted secret (direct, after unlock). */
export const HAS_BUILTIN_CREDS =
  !!(BUILD_CONFIG.feishuAppId &&
    (BUILD_CONFIG.feishuAppSecret || BUILD_CONFIG.appSecretEnc))

/** True when a PLAINTEXT client_secret is baked in (direct OAuth, no password). */
export const HAS_APP_SECRET = !!BUILD_CONFIG.feishuAppSecret

/** True when the App Secret ships ENCRYPTED and needs a password to unlock at runtime. */
export const HAS_ENCRYPTED_SECRET = !!BUILD_CONFIG.appSecretEnc && !BUILD_CONFIG.feishuAppSecret

/** True when CIDR allowlist was configured */
export const HAS_NETWORK_RESTRICTION = BUILD_CONFIG.allowedCidrs.length > 0

/** Knowledge Base (Obsidian) feature flag. When off, all KB code no-ops and the
 *  Hub card / chat toggle are hidden. Store builds disable via VITE_KNOWLEDGE_BASE=false. */
export const HAS_KNOWLEDGE_BASE = BUILD_CONFIG.knowledgeBaseEnabled

/** Screenshot clipper feature flag (see BUILD_CONFIG.clipEnabled). */
export const CLIP_ENABLED = BUILD_CONFIG.clipEnabled

/** No-remote-code mode: data-viz/site render from a declarative VizSpec, never from LLM-generated
 *  JS; lets us honestly answer "no remote code" + drop sandbox 'unsafe-eval'. Now independent of the
 *  store-packaging flag, so a store build can keep full features (remote code) while still BYO. */
export const NO_REMOTE_CODE = BUILD_CONFIG.noRemoteCode

// ─── Derived Feishu endpoints (all derived from the one base domain) ───────────
/** https://open.<domain>/open-apis — base for all OpenAPI calls. */
export const FEISHU_API_BASE = `https://open.${BUILD_CONFIG.feishuBaseDomain}/open-apis`
/** OAuth authorize (consent) page URL — on accounts.<domain>. */
export const FEISHU_AUTHORIZE_URL = `https://accounts.${BUILD_CONFIG.feishuBaseDomain}/open-apis/authen/v1/authorize`

/** CSP / host_permissions match pattern covering every Feishu subdomain (open, accounts,
 *  the tenant pages, etc.) — all live under the one base domain. e.g. `*.feishu.cn`. */
export const FEISHU_HOST_PATTERN = `*.${BUILD_CONFIG.feishuBaseDomain}`

/** Code-layer outbound guard for the FEISHU group: true only when the URL targets a
 *  subdomain of the configured base domain (open/accounts/tenant…).
 *  The assistant only ever reaches two endpoint groups — Feishu (this) and the LLM
 *  (guarded separately by assertSafeBaseUrl / openaiAllowedHosts). */
export function isFeishuOutboundAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    const d = BUILD_CONFIG.feishuBaseDomain
    return host === d || host.endsWith('.' + d)
  } catch {
    return false
  }
}

/** Loopback hostnames permitted for the Obsidian Local REST API (v1: local-only). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** Code-layer outbound guard for the OBSIDIAN (knowledge base) group: true only when the
 *  URL's origin exactly matches the user-configured Obsidian base URL AND that host is
 *  loopback. v1 is local-only, so this group physically cannot reach the public internet.
 *  `baseUrl` is the configured endpoint, e.g. 'http://127.0.0.1:27123'. */
export function isObsidianOutboundAllowed(url: string, baseUrl: string): boolean {
  if (!baseUrl) return false
  try {
    const u = new URL(url)
    const b = new URL(baseUrl)
    if (u.origin !== b.origin) return false                       // exact scheme+host+port
    return LOOPBACK_HOSTS.has(u.hostname.toLowerCase())           // v1: loopback only
  } catch {
    return false
  }
}
