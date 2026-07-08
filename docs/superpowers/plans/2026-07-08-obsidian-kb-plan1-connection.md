# Obsidian 知识库 — Plan 1：连接地基 + PNA 冒烟测试

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭好 Obsidian 知识库的连接地基（loopback 第三出站链路 + 加密 token + 带守卫的 fetch），并用一次真实冒烟测试验证侧栏进程能打到本地 Obsidian Local REST API（排除 CSP/PNA 阻断这个最大未知数）。

**Architecture:** 新建 `src/shared/obsidian/` 模块，镜像 `feishu/http.ts` + `feishu/auth.ts` 的形态，但带**独立的 loopback-only 出站守卫**（不复用 `feishuFetch`）。改 `manifest.json` 的 `host_permissions` + CSP 给 loopback HTTP 开口。请求从侧栏进程发出（agent 工具派发就在那里）。

**Tech Stack:** TypeScript、vitest、`chrome.storage.local`、AES-256-GCM（复用 `crypto.ts`）、MV3。

**Spec:** [`docs/superpowers/specs/2026-07-08-obsidian-knowledge-base-design.md`](../specs/2026-07-08-obsidian-knowledge-base-design.md)（§4 连接与出站、§8 模块布局）。

## Global Constraints

（每个任务的隐含要求，照抄自 spec / CLAUDE.md）

- **出站三组**：Obsidian 是独立第三组，由 `isObsidianOutboundAllowed`（loopback-only）守卫；**绝不复用 `feishuFetch`**（其飞书域校验会拒 loopback）。见 CLAUDE.md 约束 #4。
- **写操作不自动重试**：只重试 GET（POST/PUT/PATCH/DELETE 失败一次即抛），避免重复创建。见 CLAUDE.md 约束 #7。
- **secret 加密 + 独立存储键**：API Key 经 `crypto.ts:encryptField` 加密，存独立键 `_obsidian_token_v1`，**不进 AppSettings 导出 blob**（镜像 `_feishu_utoken_v1` 模式）。
- **存储键带 `_v1`**；改 schema 要迁移。
- **迭代闸**（CLAUDE.md）：`npm run typecheck` 0 错 → `npm test` 全绿 → `npm run build` 成功。
- **UI 规范**（Plan 2 起生效）：纯 CSS、语义 class + `App.css --color-*`、**禁用 emoji**、手写内联 SVG 图标；不引 shadcn/Tailwind。
- **提交**：仅用户要求时 commit/push；当前分支 `feishu-ok`。提交结束语 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `manifest.json`（改） | `host_permissions` + CSP 给 loopback HTTP 开口 | T1 |
| `src/shared/config.ts`（改） | `BUILD_CONFIG.knowledgeBaseEnabled` + `HAS_KNOWLEDGE_BASE` + `isObsidianOutboundAllowed` | T1 |
| `src/shared/config.test.ts`（改） | 守卫单测 | T1 |
| `src/shared/types.ts`（改） | `AppSettings` 增 Obsidian 非密字段 + `DEFAULT_SETTINGS` | T1 |
| `src/shared/obsidian/util.ts`（新） | `sanitizeVaultPath` + `encodeVaultPath` | T2 |
| `src/shared/obsidian/util.test.ts`（新） | 路径净化单测 | T2 |
| `src/shared/obsidian/auth.ts`（新） | `getObsidianToken`/`resolveObsidianToken`/`saveObsidianToken`/`clearObsidianToken` | T3 |
| `src/shared/obsidian/auth.test.ts`（新） | token 加密往返单测 | T3 |
| `src/shared/obsidian/http.ts`（新） | `buildObsidianUrl` + `obsidianFetch`（守卫+鉴权+超时+GET 重试） | T4 |
| `src/shared/obsidian/http.test.ts`（新） | fetch 守卫/鉴权单测 | T4 |
| `src/shared/obsidian/api.ts`（新） | `pingObsidian`（GET / 探活） | T4 |
| `src/shared/obsidian/api.test.ts`（新） | ping 单测 | T4 |

**Plan 1 不碰 UI**（Hub 卡片、连接表单、chat 工具都在 Plan 2/3）。Plan 1 产出：可单测的连接库 + 一次真实网络冒烟。

---

### Task 1: 出站守卫 + 特性开关 + 设置字段

**Files:**
- Modify: `manifest.json:7-8`（CSP）、`manifest.json:28-38`（host_permissions）
- Modify: `src/shared/config.ts`（BUILD_CONFIG + HAS_* 区 + 守卫）
- Modify: `src/shared/types.ts:85-110`（AppSettings）、`src/shared/types.ts:151-161`（DEFAULT_SETTINGS）
- Test: `src/shared/config.test.ts`

**Interfaces:**
- Produces: `HAS_KNOWLEDGE_BASE: boolean`、`isObsidianOutboundAllowed(url: string, baseUrl: string): boolean`（供 T4 `obsidianFetch` 用）；`AppSettings.obsidianBaseUrl?` 等字段（供 T4 用）。

- [ ] **Step 1: 写失败测试** — 在 `src/shared/config.test.ts` 末尾追加：

```ts
import { isObsidianOutboundAllowed, HAS_KNOWLEDGE_BASE } from './config'

describe('isObsidianOutboundAllowed — Obsidian loopback-only guard', () => {
  const base = 'http://127.0.0.1:27123'
  it('allows URLs under the configured loopback base', () => {
    expect(isObsidianOutboundAllowed('http://127.0.0.1:27123/', base)).toBe(true)
    expect(isObsidianOutboundAllowed('http://127.0.0.1:27123/vault/Note.md', base)).toBe(true)
  })
  it('accepts localhost as loopback', () => {
    expect(isObsidianOutboundAllowed('http://localhost:27123/', 'http://localhost:27123')).toBe(true)
  })
  it('rejects a different port on the same host (origin mismatch)', () => {
    expect(isObsidianOutboundAllowed('http://127.0.0.1:27124/', base)).toBe(false)
  })
  it('rejects non-loopback hosts even if baseUrl is misconfigured to them', () => {
    expect(isObsidianOutboundAllowed('http://evil.com:27123/', 'http://evil.com:27123')).toBe(false)
    expect(isObsidianOutboundAllowed('http://192.168.1.5:27123/', 'http://192.168.1.5:27123')).toBe(false)
  })
  it('rejects scheme mismatch (https vs http)', () => {
    expect(isObsidianOutboundAllowed('https://127.0.0.1:27124/', base)).toBe(false)
  })
  it('rejects malformed / empty input', () => {
    expect(isObsidianOutboundAllowed('not a url', base)).toBe(false)
    expect(isObsidianOutboundAllowed('http://127.0.0.1:27123/', '')).toBe(false)
  })
  it('HAS_KNOWLEDGE_BASE is a boolean (default on unless VITE_KNOWLEDGE_BASE=false)', () => {
    expect(typeof HAS_KNOWLEDGE_BASE).toBe('boolean')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/config.test.ts`
Expected: FAIL — `isObsidianOutboundAllowed` / `HAS_KNOWLEDGE_BASE` 未导出。

- [ ] **Step 3: 实现** — 在 `src/shared/config.ts`：

3a. `BUILD_CONFIG` 内（`clipEnabled` 附近）加：
```ts
  /** Knowledge Base (Obsidian Local REST API integration). Default on; set
   *  VITE_KNOWLEDGE_BASE=false to ship without it. Loopback-only egress
   *  (see isObsidianOutboundAllowed + manifest host_permissions). */
  knowledgeBaseEnabled: ((import.meta.env.VITE_KNOWLEDGE_BASE ?? 'true') as string).trim().toLowerCase() !== 'false',
```

3b. `HAS_*` 常量区（`CLIP_ENABLED` 附近）加：
```ts
/** Knowledge Base (Obsidian) feature flag. When off, all KB code no-ops and the
 *  Hub card / chat toggle are hidden. Store builds disable via VITE_KNOWLEDGE_BASE=false. */
export const HAS_KNOWLEDGE_BASE = BUILD_CONFIG.knowledgeBaseEnabled
```

3c. 文件末尾（`isFeishuOutboundAllowed` 之后）加：
```ts
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
```

- [ ] **Step 4: 改 AppSettings** — 在 `src/shared/types.ts`：

4a. `AppSettings` 接口末尾（`llmSource?` 之后）加：
```ts
  /** Obsidian Local REST API base URL (loopback only). Default http://127.0.0.1:27123. */
  obsidianBaseUrl?: string
  /** Default folder for new KB notes created without an explicit target (empty = vault root). */
  obsidianInboxPath?: string
  /** Comma-separated glob exclusions for retrieval/listing (e.g. 'Archive/**, Daily/**'). */
  obsidianExcludePaths?: string
  /** Display name of the connected vault (cosmetic). */
  obsidianVaultName?: string
```

4b. `DEFAULT_SETTINGS` 末尾加：
```ts
  obsidianBaseUrl: 'http://127.0.0.1:27123',
  obsidianInboxPath: '',
  obsidianExcludePaths: '',
  obsidianVaultName: '',
```

- [ ] **Step 5: 改 manifest** — 在 `manifest.json`：

5a. CSP（第 8 行）把 `connect-src 'self' https:` 改为：
```
connect-src 'self' https: http://127.0.0.1:* http://localhost:*
```
（整行：`"extension_pages": "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*"`）

5b. `host_permissions`（第 28-38 行）末尾加两条：
```json
    "http://127.0.0.1:*/*",
    "http://localhost:*/*"
```

- [ ] **Step 6: 跑测试 + 全量闸**

Run: `npx vitest run src/shared/config.test.ts` → Expected PASS。
Run: `npm run typecheck && npm test && npm run build` → Expected 全绿、构建成功。

- [ ] **Step 7: 提交（仅用户已要求时）**

```bash
git add manifest.json src/shared/config.ts src/shared/config.test.ts src/shared/types.ts
git commit -m "feat(kb): Obsidian loopback outbound guard + feature flag + settings fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: vault 路径净化工具

**Files:**
- Create: `src/shared/obsidian/util.ts`
- Test: `src/shared/obsidian/util.test.ts`

**Interfaces:**
- Produces: `sanitizeVaultPath(raw: string): string`（抛错于 traversal/非法字符）、`encodeVaultPath(path: string): string`（供 T4 用）。

- [ ] **Step 1: 写失败测试** — `src/shared/obsidian/util.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeVaultPath, encodeVaultPath } from './util'

describe('sanitizeVaultPath', () => {
  it('strips leading slash + normalizes backslashes', () => {
    expect(sanitizeVaultPath('/Folder/Note.md')).toBe('Folder/Note.md')
    expect(sanitizeVaultPath('\\Folder\\Note.md')).toBe('Folder/Note.md')
  })
  it('rejects path traversal (.. / .)', () => {
    expect(() => sanitizeVaultPath('../secret')).toThrow(/非法/)
    expect(() => sanitizeVaultPath('a/../../b')).toThrow(/非法/)
    expect(() => sanitizeVaultPath('./x')).toThrow(/非法/)
  })
  it('rejects Obsidian-invalid characters (# | ^ : %% [[ ]])', () => {
    expect(() => sanitizeVaultPath('a#b.md')).toThrow(/非法字符/)
    expect(() => sanitizeVaultPath('a[[b]].md')).toThrow(/非法字符/)
    expect(() => sanitizeVaultPath('a|b.md')).toThrow(/非法字符/)
  })
  it('rejects Windows-invalid characters (< > ? *)', () => {
    expect(() => sanitizeVaultPath('a<b.md')).toThrow(/非法字符/)
    expect(() => sanitizeVaultPath('a?b.md')).toThrow(/非法字符/)
  })
  it('rejects empty input', () => {
    expect(() => sanitizeVaultPath('')).toThrow(/为空/)
    expect(() => sanitizeVaultPath('   ')).toThrow(/为空/)
  })
  it('keeps a clean nested path incl. unicode', () => {
    expect(sanitizeVaultPath('Projects/2026/Obsidian 接入.md')).toBe('Projects/2026/Obsidian 接入.md')
  })
})

describe('encodeVaultPath', () => {
  it('encodes segments but preserves slashes', () => {
    expect(encodeVaultPath('Folder/My Note.md')).toBe('Folder/My%20Note.md')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/obsidian/util.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现** — `src/shared/obsidian/util.ts`：

```ts
/** Obsidian vault path utilities.
 *  Vault paths are POSIX-style and relative to the vault root (e.g. 'Folder/Note.md').
 *  These sanitize agent/user-supplied paths before they reach the REST API. */

// Obsidian-forbidden inside links/filenames (see Internal links doc).
const INVALID_NOTE_CHARS = /[#|^:`%%\[\]]/
// Windows-forbidden filename chars (per-segment; no '/' — segments are pre-split).
const WIN_INVALID = /[<>:"\\|?*\x00-\x1f]/

/** Sanitize a vault-relative path. Strips a leading slash, normalizes backslashes,
 *  rejects '..' / '.' segments and Obsidian/Windows-invalid characters.
 *  Returns the cleaned path; throws on unrecoverable input. */
export function sanitizeVaultPath(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('vault 路径为空')
  const p = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  for (const seg of p.split('/')) {
    if (seg === '..' || seg === '.') throw new Error(`非法 vault 路径（禁止 .. / .）：${raw}`)
    if (seg === '') continue
    if (INVALID_NOTE_CHARS.test(seg) || WIN_INVALID.test(seg)) throw new Error(`vault 路径含非法字符：${seg}`)
  }
  return p
}

/** URL-encode a vault path for /vault/{path}, preserving '/' separators. */
export function encodeVaultPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/obsidian/util.test.ts` → Expected PASS。

- [ ] **Step 5: 提交（仅用户已要求时）**

```bash
git add src/shared/obsidian/util.ts src/shared/obsidian/util.test.ts
git commit -m "feat(kb): vault path sanitizer + encoder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: token 加密存储与解析

**Files:**
- Create: `src/shared/obsidian/auth.ts`
- Test: `src/shared/obsidian/auth.test.ts`

**Interfaces:**
- Produces: `getObsidianToken(): Promise<string>`（不抛，空返回 ''）、`resolveObsidianToken(): Promise<string>`（空则抛设置提示）、`saveObsidianToken(token: string): Promise<void>`、`clearObsidianToken(): Promise<void>`。供 T4 `obsidianFetch` / `pingObsidian` 用。

- [ ] **Step 1: 写失败测试** — `src/shared/obsidian/auth.test.ts`（chrome mock + 动态 import，镜像 `feishu/utoken.test.ts`）：

```ts
import { describe, it, expect, beforeEach } from 'vitest'

// In-memory chrome.storage + runtime.id for crypto key derivation.
const mem: Record<string, unknown> = {}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test-ext-id-obsidian-auth' },
  storage: { local: {
    get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
      const r: Record<string, unknown> = {}
      for (const k of keys) if (k in mem) r[k] = mem[k]
      cb(r)
    },
    set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, items); cb?.() },
  } },
}

const { saveObsidianToken, clearObsidianToken, resolveObsidianToken } = await import('./auth')

beforeEach(() => {
  for (const k of Object.keys(mem)) if (k !== '_device_seed') delete mem[k]
})

describe('resolveObsidianToken — encrypted Obsidian API key', () => {
  it('round-trips a saved token; plaintext never sits in storage', async () => {
    await saveObsidianToken('obs-key-abc-123')
    expect(mem['_obsidian_token_v1']).not.toBe('obs-key-abc-123') // encrypted at rest
    expect(await resolveObsidianToken()).toBe('obs-key-abc-123')
  })
  it('throws a clear setup message when no token is stored', async () => {
    await clearObsidianToken()
    await expect(resolveObsidianToken()).rejects.toThrow(/未连接|API Key/)
  })
  it('clear removes the token', async () => {
    await saveObsidianToken('k')
    await clearObsidianToken()
    await expect(resolveObsidianToken()).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/obsidian/auth.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现** — `src/shared/obsidian/auth.ts`：

```ts
/** Obsidian Local REST API token storage (encrypted, dedicated key).
 *  Mirrors feishu/auth.ts utoken: stored under its OWN storage key (NOT in the AppSettings
 *  blob) so it never appears in exported/backed-up settings. */
import { encryptField, decryptField } from '../crypto'

const OBSIDIAN_TOKEN_KEY = '_obsidian_token_v1'

function storageGet(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try { chrome.storage.local.get([key], (r) => resolve(r?.[key])) } catch { resolve(undefined) }
  })
}
function storageSet(key: string, val: unknown): Promise<void> {
  return new Promise((resolve) => {
    try { chrome.storage.local.set({ [key]: val }, () => resolve()) } catch { resolve() }
  })
}

/** Persist the Obsidian API key (encrypted). Empty/undefined clears it. */
export async function saveObsidianToken(token: string): Promise<void> {
  await storageSet(OBSIDIAN_TOKEN_KEY, await encryptField(token || ''))
}

/** Drop the stored Obsidian token (disconnect). */
export async function clearObsidianToken(): Promise<void> {
  await storageSet(OBSIDIAN_TOKEN_KEY, '')
}

/** Read the stored token without throwing ('' when absent). */
export async function getObsidianToken(): Promise<string> {
  const raw = await storageGet(OBSIDIAN_TOKEN_KEY)
  if (!raw || typeof raw !== 'string') return ''
  return decryptField(raw)
}

/** Resolve the API key, throwing a clear setup message when absent. */
export async function resolveObsidianToken(): Promise<string> {
  const token = (await getObsidianToken()).trim()
  if (!token) throw new Error('未连接 Obsidian 知识库 — 请到「应用 → 知识库」填入 Local REST API 的 API Key。')
  return token
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/obsidian/auth.test.ts` → Expected PASS。

- [ ] **Step 5: 提交（仅用户已要求时）**

```bash
git add src/shared/obsidian/auth.ts src/shared/obsidian/auth.test.ts
git commit -m "feat(kb): encrypted Obsidian API-key storage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: obsidianFetch + pingObsidian

**Files:**
- Create: `src/shared/obsidian/http.ts`、`src/shared/obsidian/api.ts`
- Test: `src/shared/obsidian/http.test.ts`、`src/shared/obsidian/api.test.ts`

**Interfaces:**
- Consumes: T1 `isObsidianOutboundAllowed` + `AppSettings.obsidianBaseUrl`；T2 `encodeVaultPath`；T3 `getObsidianToken`。
- Produces: `obsidianFetch(method, path, settings, opts?): Promise<Response>`、`buildObsidianUrl(baseUrl, path, params?): string`、`pingObsidian(settings, token?): Promise<ObsidianPing>`。（供 Plan 2 的连接表单 / Plan 3 的 agent 工具用。）

- [ ] **Step 1: 写 http 失败测试** — `src/shared/obsidian/http.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppSettings } from '../types'

const mem: Record<string, unknown> = {}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test-ext-id-obsidian-http' },
  storage: { local: {
    get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
      const r: Record<string, unknown> = {}
      for (const k of keys) if (k in mem) r[k] = mem[k]
      cb(r)
    },
    set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, items); cb?.() },
  } },
}

const { obsidianFetch, buildObsidianUrl } = await import('./http')
const { saveObsidianToken } = await import('./auth')

const SETTINGS = { obsidianBaseUrl: 'http://127.0.0.1:27123' } as AppSettings

beforeEach(() => { for (const k of Object.keys(mem)) if (k !== '_device_seed') delete mem[k] })

describe('buildObsidianUrl', () => {
  it('joins base + path and trims slashes', () => {
    expect(buildObsidianUrl('http://127.0.0.1:27123/', 'vault/Note.md')).toBe('http://127.0.0.1:27123/vault/Note.md')
  })
  it('appends query params', () => {
    expect(buildObsidianUrl('http://127.0.0.1:27123', 'search/simple/', { query: 'a b' })).toBe('http://127.0.0.1:27123/search/simple/?query=a+b')
  })
})

describe('obsidianFetch — guard + auth + retry', () => {
  it('hits the built URL with a Bearer header when a token is stored', async () => {
    await saveObsidianToken('k-123')
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await obsidianFetch('GET', '', SETTINGS)
    expect(f).toHaveBeenCalledOnce()
    expect(f.mock.calls[0][0]).toBe('http://127.0.0.1:27123/')
    expect((f.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer k-123')
  })
  it('omits Authorization when no token stored (GET / is auth-optional)', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await obsidianFetch('GET', '', SETTINGS)
    expect((f.mock.calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined()
  })
  it('rejects BEFORE fetch when the URL is not loopback (guard)', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(obsidianFetch('GET', '', { obsidianBaseUrl: 'http://evil.com:27123' } as AppSettings)).rejects.toThrow(/出站被拦截/)
    expect(f).not.toHaveBeenCalled()
  })
  it('does NOT retry writes (POST fires once even on transient failure)', async () => {
    await saveObsidianToken('k')
    const f = vi.fn().mockRejectedValue(new Error('net'))
    vi.stubGlobal('fetch', f)
    await expect(obsidianFetch('POST', 'vault/x.md', SETTINGS, { body: 'x' })).rejects.toThrow()
    expect(f).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 写 api 失败测试** — `src/shared/obsidian/api.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppSettings } from '../types'

const mem: Record<string, unknown> = {}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test-ext-id-obsidian-api' },
  storage: { local: {
    get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
      const r: Record<string, unknown> = {}
      for (const k of keys) if (k in mem) r[k] = mem[k]
      cb(r)
    },
    set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, items); cb?.() },
  } },
}

const { pingObsidian } = await import('./api')
const { saveObsidianToken } = await import('./auth')
const SETTINGS = { obsidianBaseUrl: 'http://127.0.0.1:27123' } as AppSettings

beforeEach(() => { for (const k of Object.keys(mem)) if (k !== '_device_seed') delete mem[k] })

describe('pingObsidian — reachability + auth probe', () => {
  it('reports ok + authenticated on 200 with a token', async () => {
    await saveObsidianToken('k')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true, vault: 'My' }), { status: 200 })))
    const r = await pingObsidian(SETTINGS)
    expect(r).toMatchObject({ ok: true, status: 200, authenticated: true, vault: 'My' })
  })
  it('treats 401 as reachable (server up, token wrong)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    const r = await pingObsidian(SETTINGS)
    expect(r.ok).toBe(true)
    expect(r.status).toBe(401)
  })
  it('reports not-ok on a network/CSP block (fetch throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')))
    const r = await pingObsidian(SETTINGS)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(0)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/shared/obsidian/http.test.ts src/shared/obsidian/api.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 4: 实现 http.ts** — `src/shared/obsidian/http.ts`：

```ts
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
```

- [ ] **Step 5: 实现 api.ts** — `src/shared/obsidian/api.ts`：

```ts
/** High-level Obsidian vault operations. Thin wrappers over the REST API used by the Hub
 *  panel (Plan 2) and the agent KB tools (Plan 3). Plan 1 ships just the ping probe. */
import type { AppSettings } from '../types'
import { obsidianFetch } from './http'

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
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/shared/obsidian/` → Expected PASS。

- [ ] **Step 7: 全量闸**

Run: `npm run typecheck && npm test && npm run build` → Expected 全绿、构建成功。

- [ ] **Step 8: 提交（仅用户已要求时）**

```bash
git add src/shared/obsidian/http.ts src/shared/obsidian/http.test.ts src/shared/obsidian/api.ts src/shared/obsidian/api.test.ts
git commit -m "feat(kb): obsidianFetch (loopback guard + bearer) + pingObsidian probe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: PNA 冒烟测试（手动闸门 — 决定 Plan 2 是否按原架构走）

**Files:** 无代码改动。这是一次**真机验证**，回答 spec §4.4 的唯一未知数：侧栏进程（扩展源 + 已声明的 host_permissions + 已改的 CSP）能不能 `fetch('http://127.0.0.1:27123/')`。

> 为什么用 raw fetch 片段而不是调 `pingObsidian`：守卫/鉴权逻辑已被 T4 单测覆盖；本闸门只验**网络策略**（CSP/PNA），而 raw fetch 与 `obsidianFetch` 在这一层完全等价（同一页面上下文、同一 host_permissions、同一 CSP）。

- [ ] **Step 1: 备好 Obsidian**

1. Obsidian → 设置 → 第三方插件 → 关闭「安全模式」→ 社区插件 → 浏览 → 装 **"Local REST API"**（coddingtonbear）→ 启用。
2. 设置 → Local REST API → **勾选 "Enable HTTP server"**（关键：默认只有 HTTPS 27124，扩展用不了）→ 复制 **API Key**。
3. 保持 Obsidian 开着（server 才活着）。

- [ ] **Step 2: 构建并加载扩展**

Run: `npm run build`
然后 Chrome → `chrome://extensions` → 开发者模式 → 加载 `feishu-doc-ai-assistant/dist`（或既有加载项点「重新加载」）。

- [ ] **Step 3: 在侧栏 DevTools 跑探针**

打开扩展侧栏 → 右键「检查」打开 DevTools → Console 粘贴（替换 `PASTE_KEY`）：

```js
fetch('http://127.0.0.1:27123/', { headers: { Authorization: 'Bearer PASTE_KEY' } })
  .then(async r => console.log('OK', r.status, await r.text()))
  .catch(e => console.error('BLOCKED:', e.message))
```

- [ ] **Step 4: 判定闸门**

- **`OK 200 …`**（或 `OK 401 …` 也算可达，只是 key 不对）→ **闸门通过** ✅。说明 CSP/PNA 没拦。进入 **Plan 2**（App Hub 知识库页 + 连接表单），按 spec 原架构走。
- **`BLOCKED: Failed to fetch`** / `ERR_BLOCKED_BY_CLIENT` / CSP 报错 → **闸门失败** ❌。PNA 或 CSP 仍拦。**不要硬上 Plan 2**；先实现兜底：把 Obsidian 调用改成经 service worker 消息转发（`background/index.ts` 收消息 → 调 `obsidianFetch` → 回传），侧栏不再直连。重跑 Step 3 验证 SW 路径通后再进 Plan 2。

- [ ] **Step 5: 记录结果**

把 Step 4 的判定（通过 / 失败 + 走的哪条路）补进 spec §10 的「PNA 是否拦截」一行，再开 Plan 2。

---

## Plan 1 完成定义（DoD）

- [ ] T1–T4 全部单测通过；`npm run typecheck && npm test && npm run build` 全绿。
- [ ] T5 闸门有明确判定（通过 → 进 Plan 2；失败 → 已切 SW 路径并复验）。
- [ ] `src/shared/obsidian/` 模块就位：`util` / `auth` / `http` / `api`，带独立 loopback 守卫，token 加密存独立键。
- [ ] spec §10 风险表 PNA 一行已据实更新。

## 后续（本计划不做）

- **Plan 2**：App Hub「知识库」页 — 接入引导（装插件/开 HTTP/填 key/测试连接，调 `pingObsidian`）+ 内容列表（搜索 + 最近）+ 笔记详情 CRUD。需先读 `ScenarioPanel.tsx`、`HubCard.tsx`、`App.tsx` 路由。
- **Plan 3**：chat KB 模式 — InputBar 工具图标改造、`session.kbEnabled`、`toolsForContext` 注入、`executeTool` 分支、`buildSystemPrompt`。需先读 `InputBar.tsx`、`agent.ts`、`sessions/`。
