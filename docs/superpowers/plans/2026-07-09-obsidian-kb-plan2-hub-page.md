# Obsidian 知识库 — App Hub 页面 实现计划（Plan 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 App Hub（应用中心）加一张「知识库」卡 + 一个 `KnowledgeBasePanel`：未连接→接入引导（装插件/开 HTTP/填 Key/测试连接）；已连接→搜索优先的笔记列表（搜索 + 最近）+ 笔记详情（读 / 源码编辑 / 新建 / 删除）。直连 Obsidian 本地 REST API（Plan 1 已验证侧栏直连可达）。

**Architecture:** 复用 Plan 1 的 `src/shared/obsidian/{http,api,auth,util}.ts`（loopback 守卫 + 加密 token + 路径净化）。本计划给 `api.ts` 补笔记 CRUD，给 `useAppSettings` 补 `obsidian*` 字段持久化，再加 4 个新组件：`KnowledgeBasePanel`（外壳：ping 探活 + 两态分发）、`ObsidianConnectForm`（接入）、`ObsidianVaultView`（列表）、`ObsidianNoteDetail`（详情）。路由纯本地 state（`ScenarioPanel` 的 `View` 判别联合 + `setView`），不动 `App.tsx` 路由，只多传一个 `saveSettings`。

**Tech Stack:** React 18 + TS + Vite + vitest（组件测试用 `// @vitest-environment jsdom` docblock）。纯 CSS（语义 class + `App.css` `--color-*` 变量）。Obsidian Local REST API v4（HTTP `127.0.0.1:27123`，Bearer）。

---

## Global Constraints

**项目级硬约束（每个 task 都隐含遵守）——逐字来自 spec §4-§5、CLAUDE.md、项目 memory：**

- **出站**：所有 Obsidian 请求走 `obsidianFetch(method, path, settings, opts)`（`src/shared/obsidian/http.ts`），其 loopback 守卫 `isObsidianOutboundAllowed` 在 fetch 前前置；**绝不**复用 `feishuFetch`。第三出站组（loopback-only），已由 Plan 1 落地。
- **token**：API Key 走 `saveObsidianToken` / `clearObsidianToken` / `getObsidianToken` / `resolveObsidianToken`（`src/shared/obsidian/auth.ts`，独立加密键 `_obsidian_token_v1`）。**绝不**把 token 放进 `AppSettings` blob、绝不进明文包。
- **AppSettings 字段**（已在 `types.ts` + `DEFAULT_SETTINGS`，Plan 1 落地）：`obsidianBaseUrl`（默认 `http://127.0.0.1:27123`）、`obsidianInboxPath`、`obsidianExcludePaths`、`obsidianVaultName`。这些非密钥字段经 `useAppSettings.saveSettings` 持久化（**当前 load/save 漏存它们——Task 2 修**）。
- **插件名**：社区插件目录里叫 **「Local REST API with MCP」**（coddingtonbear，仓库 `coddingtonbear/obsidian-local-rest-api`）。v1 只用 REST 端点（`http://127.0.0.1:27123`），**不用** `/mcp/`。引导文案用此新名。HTTP 27123 需用户在插件设置里手动开「Enable non-encrypted (HTTP) server」（默认关）；HTTPS 27124 自签名证书扩展用不了。
- **UI 规范**：纯 CSS（语义 class + `App.css` `--color-*` 变量），**禁用 emoji**；工具/导航按钮用手写内联 SVG（飞书风线图标，hub 卡片用 `viewBox="0 0 24 24"` + `strokeWidth="1.6"`，面板内图标 `strokeWidth="2"`）；**创建型 CTA（如「新建笔记」）不放图标**；不引入 shadcn / Tailwind / 组件库。
- **既有 UI 原语**（直接复用，勿另造）：`FormField` / `FormInput`（`type:"text"|"url"|"password"`）/ `FormSelect` / `FormSwitch`（`src/sidepanel/components/form`）；`TopBar({title,onBack,rightAction?})`；`Button({variant:"primary"|"secondary"|"danger"|"ghost",size?,block?,icon?,loading?})`；`Tooltip({content,children,position?})`；`SideDrawer({title,onClose,children})`；`Markdown({children:string})`（`src/sidepanel/components/Markdown.tsx`）。
- **v1 不做**：rename/move（REST 无 move，PUT+DELETE 会断反链——要改名去 Obsidian 里改）；向量/embedding 检索；图片/附件；批量操作；Obsidian 专有语法完整渲染。
- **删除必确认**；**写操作不自动重试**（`obsidianFetch` 已只重试 GET）。
- **测试约定**：vitest 默认 `node` env；**组件测试**在每个 `.test.tsx` 顶部加 `// @vitest-environment jsdom` docblock，用 `vi.mock('...shared...')` 注入、`@testing-library/react` 的 `render/screen/fireEvent/waitFor`、`afterEach(cleanup)`；`css:false`（CSS import 被忽略）。逻辑测试（`.test.ts`）用默认 node env，`vi.mock('./http')` 注入 `obsidianFetch`。
- **不 commit**：项目约定「仅用户要求才 commit/push」。每个 task 的最后一步是**门**（`npm run typecheck` 必 0、聚焦 `npx vitest run <path>` 必绿、`npm run build` 必成功），**不跑 git commit**。全部完成 + 用户授权后再统一提交（沿用 Plan 1 模式）。
- **当前分支**：`feishu-ok`，直接在工作树改。

**Obsidian REST 响应形状（来自插件 OpenAPI `docs/openapi.yaml`，写解析代码用）：**

| 端点 | 方法 | 请求 | 200 响应 |
|---|---|---|---|
| `/search/simple/` | POST | `?query=`（query param，无 body） | `Array<{filename:string, score:number, matches?:Array<{context:string, match:{start,end}}>}>` |
| `/search/` | POST | body=JsonLogic，`Content-Type: application/vnd.olrapi.jsonlogic+json` | `Array<{filename:string, result:string\|number\|array\|object\|boolean}>`（只返回非假结果；**无服务端 sort/limit**） |
| `/vault/{filename}` | GET | `Accept: text/markdown` | 笔记正文（字符串） |
| `/vault/{filename}` | PUT | `Content-Type: text/markdown`，body=正文 | `204`（整篇替换）或 `200`（段替换） |
| `/vault/{filename}` | DELETE | — | `204` |
| `/` | GET | — | `{status, authenticated, vault?, ...}`（Plan 1 的 `pingObsidian` 已用） |

> `filename` = vault 相对路径（如 `Folder/My Note.md`），须经 `encodeVaultPath(path)`（`src/shared/obsidian/util.ts`）百分号编码后拼到 `vault/` 之后。NoteJson 含 `stat.mtime`（ms 纪元）——「最近」用 JsonLogic `{var:"stat.mtime"}` 拿到每篇 mtime，客户端排序+切片。

---

## File Structure

```
src/shared/obsidian/
  api.ts                 (modify — Task 1: + recentNotes/searchVault/readNote/writeNote/deleteNote)
  api.test.ts            (modify — Task 1: + tests)
src/sidepanel/hooks/
  useAppSettings.ts      (modify — Task 2: load+save 持久化 obsidian* 字段)
  useAppSettings.test.ts (new    — Task 2: 往返测试)
src/sidepanel/components/
  ScenarioPanel.tsx      (modify — Task 3: View 模式 + HUB_ICONS.book + 门控分组 + 渲染分支 + saveSettings prop)
  ScenarioPanel.test.tsx (modify — Task 3: + 卡片路由测试)
  App.tsx                (modify — Task 3: 给 ScenarioPanel 传 saveSettings)
  KnowledgeBasePanel.tsx (new — Task 3 外壳; Task 4/5 接入子组件)
  KnowledgeBasePanel.css (new — Task 3)
  KnowledgeBasePanel.test.tsx (new — Task 3: ping 两态)
  ObsidianConnectForm.tsx + .css + .test.tsx (new — Task 4)
  ObsidianVaultView.tsx  + .css + .test.tsx (new — Task 5)
  ObsidianNoteDetail.tsx + .css + .test.tsx (new — Task 6)
```

---

## Task 1: `api.ts` 笔记 CRUD（recentNotes / searchVault / readNote / writeNote / deleteNote）

**Files:**
- Modify: `src/shared/obsidian/api.ts`
- Test: `src/shared/obsidian/api.test.ts`

**Interfaces:**
- Consumes: `obsidianFetch(method, path, settings, opts)`（`./http`，Plan 1）、`encodeVaultPath(path)`（`./util`，Plan 1）、`AppSettings`（`../types`）。
- Produces（后续 task 调用）：
  ```ts
  export interface ObsidianNoteRow { path: string; mtime?: number; snippet?: string; score?: number }
  export async function recentNotes(settings: AppSettings, limit?: number): Promise<ObsidianNoteRow[]>
  export async function searchVault(settings: AppSettings, query: string): Promise<ObsidianNoteRow[]>
  export async function readNote(settings: AppSettings, path: string): Promise<string>
  export async function writeNote(settings: AppSettings, path: string, content: string): Promise<void>
  export async function deleteNote(settings: AppSettings, path: string): Promise<void>
  ```

- [ ] **Step 1: 写失败测试** — 在 `api.test.ts` 末尾追加：

```ts
import { encodeVaultPath } from './util'

const settings = { obsidianBaseUrl: 'http://127.0.0.1:27123' } as any
function jsonRes(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as any
}

describe('obsidian api — vault CRUD', () => {
  it('recentNotes: POST search/ JsonLogic {var:stat.mtime}, 客户端按 mtime 倒序 + 切片', async () => {
    mockFetch.mockResolvedValue(jsonRes([
      { filename: 'a.md', result: 100 },
      { filename: 'b.md', result: 300 },
      { filename: 'c.md', result: 200 },
    ]))
    const rows = await recentNotes(settings, 2)
    expect(mockFetch).toHaveBeenCalledWith('POST', 'search/', settings, expect.objectContaining({
      headers: { 'Content-Type': 'application/vnd.olrapi.jsonlogic+json' },
      body: JSON.stringify({ var: 'stat.mtime' }),
    }))
    expect(rows.map((r) => r.path)).toEqual(['b.md', 'c.md']) // 300, 200 → desc, sliced 2
    expect(rows[0].mtime).toBe(300)
  })

  it('searchVault: POST search/simple/?query=, 映射 filename+context', async () => {
    mockFetch.mockResolvedValue(jsonRes([
      { filename: 'notes/x.md', score: 5, matches: [{ context: 'hello world', match: { start: 0, end: 5 } }] },
    ]))
    const rows = await searchVault(settings, 'hello')
    expect(mockFetch).toHaveBeenCalledWith('POST', 'search/simple/', settings, expect.objectContaining({ params: { query: 'hello' } }))
    expect(rows[0]).toMatchObject({ path: 'notes/x.md', snippet: 'hello world', score: 5 })
  })

  it('searchVault: 空查询不发请求，返回 []', async () => {
    expect(await searchVault(settings, '   ')).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('readNote: GET vault/{path} 带 Accept text/markdown，返回正文', async () => {
    mockFetch.mockResolvedValue(jsonRes('# Title\nbody'))
    const md = await readNote(settings, 'Folder/My Note.md')
    expect(mockFetch).toHaveBeenCalledWith('GET', 'vault/' + encodeVaultPath('Folder/My Note.md'), settings, expect.objectContaining({ headers: { Accept: 'text/markdown' } }))
    expect(md).toBe('# Title\nbody')
  })

  it('writeNote: PUT vault/{path} text/markdown body', async () => {
    mockFetch.mockResolvedValue(jsonRes('', { status: 204, ok: true }))
    await writeNote(settings, 'new.md', '# Hi')
    expect(mockFetch).toHaveBeenCalledWith('PUT', 'vault/' + encodeVaultPath('new.md'), settings, expect.objectContaining({ headers: { 'Content-Type': 'text/markdown' }, body: '# Hi' }))
  })

  it('deleteNote: DELETE vault/{path}', async () => {
    mockFetch.mockResolvedValue(jsonRes('', { status: 204, ok: true }))
    await deleteNote(settings, 'old.md')
    expect(mockFetch).toHaveBeenCalledWith('DELETE', 'vault/' + encodeVaultPath('old.md'), settings, {})
  })

  it('401 → 友好的"重新接入"提示，而非裸状态码', async () => {
    mockFetch.mockResolvedValue(jsonRes({ message: 'unauthorized' }, { status: 401, ok: false }))
    await expect(readNote(settings, 'x.md')).rejects.toThrow(/API Key 无效或已失效/)
  })

  it('非 ok 非 401 → 抛状态码', async () => {
    mockFetch.mockResolvedValue(jsonRes({}, { status: 500, ok: false }))
    await expect(readNote(settings, 'x.md')).rejects.toThrow(/500/)
  })
})
```

> 注：`api.test.ts` 顶部（Plan 1 已有）已 `vi.mock('./http', ...)` 出 `mockFetch` 并 `await import('./api')` 拿到 `pingObsidian`。本 task 在同一文件的 `await import` 处补上 `recentNotes, searchVault, readNote, writeNote, deleteNote` 的解构，并复用既有 `mockFetch` / `beforeEach(reset)`。

- [ ] **Step 2: 跑测试确认全红**

Run: `npx vitest run src/shared/obsidian/api.test.ts`
Expected: 新增 8 个 case FAIL（函数未定义）。

- [ ] **Step 3: 实现** — 在 `api.ts` 末尾追加（`import { encodeVaultPath } from './util'` 加到文件顶部 import 区）：

```ts
import { encodeVaultPath } from './util'

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
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `npx vitest run src/shared/obsidian/api.test.ts`
Expected: 全绿（Plan 1 原有 pingObsidian 用例 + 本 task 8 个新用例）。

- [ ] **Step 5: 门**

Run: `npm run typecheck`（必 0）· `npm run build`（必成功）。
不 commit。

---

## Task 2: `useAppSettings` 持久化 `obsidian*` 字段

**问题**：`AppSettings` 类型 + `DEFAULT_SETTINGS` 已有 `obsidian*` 四字段（Plan 1），但 `useAppSettings.ts` 的 load（:24-49）和 save（:52-72）**漏存它们**——连接表单存了 `obsidianBaseUrl` 重载后就丢。

**Files:**
- Modify: `src/sidepanel/hooks/useAppSettings.ts`
- Test: `src/sidepanel/hooks/useAppSettings.test.ts`（新建）

**Interfaces:**
- Produces：`useAppSettings().saveSettings(s)` 现在会持久化 `obsidianBaseUrl/obsidianInboxPath/obsidianExcludePaths/obsidianVaultName`；load 会读回它们。Task 4 的连接表单依赖此修复。

- [ ] **Step 1: 写失败测试** — 新建 `src/sidepanel/hooks/useAppSettings.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// crypto 走 identity，避免 jsdom 里跑真 AES（obsidian 字段非密钥，本就不加密；feishu/openai 走 identity 也无妨）。
vi.mock('../../shared/crypto', () => ({ encryptField: async (s: string) => s, decryptField: async (s: string) => s }))
// 企业策略不影响本测试，短路成无策略。
vi.mock('../../shared/enterprisePolicy', () => ({
  loadPolicy: async () => null, fetchPolicy: async () => null, applyPolicy: (s: any) => s, FAILCLOSED_POLICY: null,
}))

const store = new Map<string, unknown>()
beforeEach(() => {
  store.clear()
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
          const r: Record<string, unknown> = {}
          for (const k of keys) if (store.has(k)) r[k] = store.get(k)
          cb(r)
        },
        set: (obj: Record<string, unknown>, cb: () => void) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v)
          cb()
        },
      },
    },
  }
})
afterEach(() => { delete (globalThis as any).chrome; vi.restoreAllMocks() })

describe('useAppSettings — obsidian fields persist', () => {
  it('saveSettings persists obsidian* and a fresh load restores them', async () => {
    const { useAppSettings } = await import('./useAppSettings')
    const { result } = renderHook(() => useAppSettings())
    await act(async () => {
      await result.current.saveSettings({
        ...result.current.settings,
        obsidianBaseUrl: 'http://127.0.0.1:9999',
        obsidianInboxPath: 'Inbox/',
        obsidianExcludePaths: 'Archive/**, Daily/**',
        obsidianVaultName: 'MyVault',
      })
    })
    // 新 hook 实例从 chrome.storage 读回。
    const { result: r2 } = renderHook(() => useAppSettings())
    await waitFor(() => expect(r2.current.settings.obsidianBaseUrl).toBe('http://127.0.0.1:9999'))
    expect(r2.current.settings.obsidianInboxPath).toBe('Inbox/')
    expect(r2.current.settings.obsidianExcludePaths).toBe('Archive/**, Daily/**')
    expect(r2.current.settings.obsidianVaultName).toBe('MyVault')
  })

  it('no stored blob → DEFAULT_SETTINGS obsidianBaseUrl (http://127.0.0.1:27123)', async () => {
    const { useAppSettings } = await import('./useAppSettings')
    const { result } = renderHook(() => useAppSettings())
    await waitFor(() => expect(result.current.settings.obsidianBaseUrl).toBe('http://127.0.0.1:27123'))
  })
})
```

- [ ] **Step 2: 跑测试确认全红**

Run: `npx vitest run src/sidepanel/hooks/useAppSettings.test.tsx`
Expected: 第一个 case FAIL（读回的是默认值，不是 9999，因为 save 没存 obsidian 字段）。

- [ ] **Step 3: 实现** — 改 `useAppSettings.ts`。

load（`:29-40` 的 `loaded` 对象）追加 4 字段（落在 `llmSource` 之后、闭合 `}` 之前）：

```ts
        llmSource: (stored.llmSource as AppSettings['llmSource']) ?? undefined,
        obsidianBaseUrl: stored.obsidianBaseUrl ?? DEFAULT_SETTINGS.obsidianBaseUrl,
        obsidianInboxPath: stored.obsidianInboxPath ?? DEFAULT_SETTINGS.obsidianInboxPath,
        obsidianExcludePaths: stored.obsidianExcludePaths ?? DEFAULT_SETTINGS.obsidianExcludePaths,
        obsidianVaultName: stored.obsidianVaultName ?? DEFAULT_SETTINGS.obsidianVaultName,
```

save（`:57-70` 的 `settings_v2` 对象）追加 4 字段（落在 `llmSource` 之后）：

```ts
        llmSource: s.llmSource,
        // Obsidian 接入（非密钥；API Key 走独立加密键 _obsidian_token_v1，不在此 blob）
        obsidianBaseUrl: s.obsidianBaseUrl,
        obsidianInboxPath: s.obsidianInboxPath,
        obsidianExcludePaths: s.obsidianExcludePaths,
        obsidianVaultName: s.obsidianVaultName,
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `npx vitest run src/sidepanel/hooks/useAppSettings.test.tsx`
Expected: 2/2 PASS。

- [ ] **Step 5: 门**

Run: `npm run typecheck`（必 0）· `npm run build`（必成功）。不 commit。

---

## Task 3: Hub 卡片 + 路由 + `KnowledgeBasePanel` 外壳（ping 两态）

把「知识库」卡接进 Hub（门控 `HAS_KNOWLEDGE_BASE`），点击进 `KnowledgeBasePanel`；外壳在挂载时 ping，loading / connected / disconnected 三态先放占位（Task 4/5 再把 connected/disconnected 换成真子组件）。同时把 `saveSettings` 从 `App.tsx` 串到 `ScenarioPanel` 再到面板。

**Files:**
- Modify: `src/sidepanel/components/ScenarioPanel.tsx`
- Modify: `src/sidepanel/components/ScenarioPanel.test.tsx`
- Modify: `src/sidepanel/App.tsx`
- New: `src/sidepanel/components/KnowledgeBasePanel.tsx` + `KnowledgeBasePanel.css` + `KnowledgeBasePanel.test.tsx`

**Interfaces:**
- Consumes: `pingObsidian(settings, token?)`（`../../shared/obsidian/api`，Plan 1）、`HAS_KNOWLEDGE_BASE`（`../../shared/config`，Plan 1）、`AppSettings`、`saveSettings`。
- Produces（后续 task 用）：`KnowledgeBasePanel` props = `{ settings: AppSettings; saveSettings?: (s: AppSettings) => Promise<void>; onBack: () => void }`。

- [ ] **Step 1: 写失败测试** — 先写外壳测试 `KnowledgeBasePanel.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'

const mockPing = vi.fn()
vi.mock('../../shared/obsidian/api', () => ({ pingObsidian: mockPing }))

const KnowledgeBasePanel = (await import('./KnowledgeBasePanel')).default

beforeEach(() => mockPing.mockReset())
afterEach(cleanup)

describe('KnowledgeBasePanel — ping 两态外壳', () => {
  it('挂载即 ping；已连接 → 显示已连接占位（kb-vault-view）', async () => {
    mockPing.mockResolvedValue({ ok: true, status: 200, authenticated: true, vault: 'MyVault' })
    render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('kb-vault-view')).toBeTruthy())
    expect(screen.getByText(/MyVault/)).toBeTruthy()
  })

  it('未连接 → 显示接入占位（kb-connect-form）', async () => {
    mockPing.mockResolvedValue({ ok: false, status: 0, authenticated: false })
    render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('kb-connect-form')).toBeTruthy())
  })

  it('ping 期间显示 loading（kb-loading）', async () => {
    let resolve: (v: any) => void = () => {}
    mockPing.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} />)
    expect(screen.getByTestId('kb-loading')).toBeTruthy()
    resolve({ ok: true, status: 200, authenticated: true })
    await waitFor(() => expect(screen.queryByTestId('kb-loading')).toBeNull())
  })
})
```

并在 `ScenarioPanel.test.tsx` 末尾追加一个路由测试：

```tsx
  it('知识库 card routes to the KnowledgeBasePanel', async () => {
    vi.resetModules()
    const pingMock = vi.fn().mockResolvedValue({ ok: false, status: 0, authenticated: false })
    vi.doMock('../../shared/obsidian/api', () => ({ pingObsidian: pingMock }))
    const ScenarioPanelFresh = (await import('./ScenarioPanel')).default
    const { container } = render(<ScenarioPanelFresh settings={settings} context={ctx} disabled={false} recentFiles={[]} />)
    const card = Array.from(container.querySelectorAll('.hub-card--clickable'))
      .find((el) => el.textContent?.includes('知识库')) as HTMLElement
    expect(card).toBeTruthy()
    fireEvent.click(card)
    await waitFor(() => expect(container.querySelector('.topbar-title')?.textContent).toBe('知识库'))
    vi.doUnmock('../../shared/obsidian/api')
  })
```

> 这个 case 用 `vi.resetModules()` + `vi.doMock` 把 `pingObsidian` 桩成"未连接"，避免外壳挂载时真发 fetch。

- [ ] **Step 2: 跑测试确认全红**

Run: `npx vitest run src/sidepanel/components/KnowledgeBasePanel.test.tsx src/sidepanel/components/ScenarioPanel.test.tsx`
Expected：`KnowledgeBasePanel.test` 全 FAIL（组件不存在）；`ScenarioPanel.test` 新 case FAIL（无「知识库」卡）。

- [ ] **Step 3: 实现 `KnowledgeBasePanel.tsx` 外壳**

```tsx
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { pingObsidian } from '../../shared/obsidian/api'
import TopBar from './TopBar'
import './KnowledgeBasePanel.css'

interface Props {
  settings: AppSettings
  saveSettings?: (s: AppSettings) => Promise<void>
  onBack: () => void
}

type Conn = 'loading' | 'connected' | 'disconnected'

/** 知识库面板外壳：挂载 ping → loading/connected/disconnected 三态分发。
 *  Task 4 把 disconnected 占位换成 <ObsidianConnectForm>；Task 5 把 connected 占位换成 <ObsidianVaultView>。 */
export default function KnowledgeBasePanel({ settings, saveSettings, onBack }: Props) {
  const [conn, setConn] = useState<Conn>('loading')
  const [vault, setVault] = useState<string | undefined>(settings.obsidianVaultName)

  useEffect(() => {
    let alive = true
    setConn('loading')
    pingObsidian(settings).then((p) => {
      if (!alive) return
      setVault(p.vault ?? settings.obsidianVaultName)
      setConn(p.ok && p.authenticated ? 'connected' : 'disconnected')
    })
    return () => { alive = false }
  }, [settings])

  return (
    <div className="scenario-panel view-enter" key="kb">
      <TopBar title="知识库" onBack={onBack} />
      <div className="kb-body">
        {conn === 'loading' && (
          <div className="kb-loading" data-testid="kb-loading">连接 Obsidian 中…</div>
        )}
        {conn === 'connected' && (
          // Task 5 替换为 <ObsidianVaultView settings={settings} onDisconnected={() => setConn('disconnected')} />
          <div className="kb-placeholder" data-testid="kb-vault-view">
            已连接{vault ? ` · ${vault}` : ''}（内容列表即将就绪）
          </div>
        )}
        {conn === 'disconnected' && (
          // Task 4 替换为 <ObsidianConnectForm settings={settings} saveSettings={saveSettings} onConnected={(v) => { if (v) setVault(v); setConn('connected') }} />
          <div className="kb-placeholder" data-testid="kb-connect-form">
            未连接 Obsidian（接入表单即将就绪）
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 实现 `KnowledgeBasePanel.css`**

```css
.kb-body { display: flex; flex-direction: column; gap: 12px; padding: 14px; overflow-y: auto; }
.kb-loading, .kb-placeholder {
  padding: 24px 14px; text-align: center; font-size: 12px; color: var(--color-text-secondary);
  border: 1px dashed var(--color-border); border-radius: var(--radius); background: var(--color-surface);
}
```

- [ ] **Step 5: 接进 `ScenarioPanel.tsx`**

5a. import 区（挨着其它 panel import + `CLIP_ENABLED` 的 config import）：
```tsx
import KnowledgeBasePanel from './KnowledgeBasePanel'
import { HAS_KNOWLEDGE_BASE } from '../../shared/config'   // 若 CLIP_ENABLED 已从此处 import，合并到同一行
```

5b. `View` 判别联合（`:42-52`）加一个分支：
```tsx
  | { mode: 'knowledgeBase' }
```

5c. `Props` 接口（`:27`）加可选字段：
```tsx
  saveSettings?: (s: AppSettings) => Promise<void>
```
（`AppSettings` 类型若未 import 则补 `import type { AppSettings } from '../../shared/types'`。）

5d. 函数签名解构（`:74`）加 `saveSettings`。

5e. `HUB_ICONS`（`:56-72`）加 `book` 图标（飞书风，strokeWidth 1.6，挨着其它条目）：
```tsx
  book: Svg(<> <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /> <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /> </>),
```

5f. Hub 渲染里（挨着 `CLIP_ENABLED` 那个条件块，`:198-208` 附近）加门控分组：
```tsx
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
```

5g. 渲染分支（挨着 `if (view.mode === 'pdfTranscribe')`，`:231` 附近）加：
```tsx
  if (view.mode === 'knowledgeBase') {
    return <KnowledgeBasePanel settings={settings} saveSettings={saveSettings} onBack={() => setView({ mode: 'hub' })} />
  }
```

- [ ] **Step 6: 接进 `App.tsx`** — `:425` 的 `<ScenarioPanel …/>` 加一个 prop：
```tsx
<ScenarioPanel settings={settings} saveSettings={saveSettings} context={ctx} disabled={!canOperate} onBusyChange={setScenarioBusy} recentFiles={recentFiles} onRemoveRecent={removeFromRecent} resolveWikiKind={resolveWikiKind} />
```
（`saveSettings` 已在 `App.tsx:49` 解构出。）

- [ ] **Step 7: 跑测试确认全绿**

Run: `npx vitest run src/sidepanel/components/KnowledgeBasePanel.test.tsx src/sidepanel/components/ScenarioPanel.test.tsx`
Expected: 全绿（含新路由 case）。

- [ ] **Step 8: 门**

Run: `npm run typecheck`（必 0）· `npm run build`（必成功）。不 commit。

---

## Task 4: `ObsidianConnectForm`（接入引导 + 测试连接 + 保存）

未连接态的真表单：①装插件 ②开 HTTP server ③复制 API Key ④填端点+Key+测试连接，外加可折叠的"高级"（收件箱路径 / 排除路径）。测试连接走 `pingObsidian`；成功即存 token（`saveObsidianToken`）+ 设置（`saveSettings`）并 `onConnected`。

**Files:**
- New: `src/sidepanel/components/ObsidianConnectForm.tsx` + `.css` + `.test.tsx`
- Modify: `KnowledgeBasePanel.tsx`（把 disconnected 占位换成此组件）

**Interfaces:**
- Consumes: `pingObsidian`、`saveObsidianToken` / `getObsidianToken`（`../../shared/obsidian/auth`）、`FormField` / `FormInput`（`./form`）、`Button`、`Tooltip`、`AppSettings`。
- Produces：`ObsidianConnectForm` props = `{ settings: AppSettings; saveSettings?: (s: AppSettings) => Promise<void>; onConnected: (vault?: string) => void }`。

- [ ] **Step 1: 写失败测试** — `ObsidianConnectForm.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'

const mockPing = vi.fn()
vi.mock('../../shared/obsidian/api', () => ({ pingObsidian: mockPing }))
const mockSaveToken = vi.fn(); const mockGetToken = vi.fn()
vi.mock('../../shared/obsidian/auth', () => ({ saveObsidianToken: mockSaveToken, getObsidianToken: mockGetToken }))

const ObsidianConnectForm = (await import('./ObsidianConnectForm')).default
beforeEach(() => { mockPing.mockReset(); mockSaveToken.mockReset(); mockGetToken.mockReset(); mockGetToken.mockResolvedValue('') })
afterEach(cleanup)

function fillAndConnect(key = 'SECRET_KEY', endpoint = 'http://127.0.0.1:27123') {
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: key } })
  fireEvent.change(screen.getByLabelText('端点'), { target: { value: endpoint } })
  fireEvent.click(screen.getByText('测试连接'))
}

describe('ObsidianConnectForm', () => {
  it('成功：ping 带表单值 → 存 token + saveSettings → onConnected(vault)', async () => {
    mockPing.mockResolvedValue({ ok: true, status: 200, authenticated: true, vault: 'MyVault' })
    const onConnected = vi.fn(); const saveSettings = vi.fn().mockResolvedValue(undefined)
    render(<ObsidianConnectForm settings={DEFAULT_SETTINGS} saveSettings={saveSettings} onConnected={onConnected} />)
    fillAndConnect()
    await waitFor(() => expect(mockPing).toHaveBeenCalled())
    expect(mockPing).toHaveBeenCalledWith(expect.objectContaining({ obsidianBaseUrl: 'http://127.0.0.1:27123' }), 'SECRET_KEY')
    await waitFor(() => expect(mockSaveToken).toHaveBeenCalledWith('SECRET_KEY'))
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ obsidianBaseUrl: 'http://127.0.0.1:27123', obsidianVaultName: 'MyVault' }))
    expect(onConnected).toHaveBeenCalledWith('MyVault')
  })

  it('401（已连但 key 无效）→ 显示"API Key 无效"，不存不连', async () => {
    mockPing.mockResolvedValue({ ok: true, status: 401, authenticated: false })
    const onConnected = vi.fn()
    render(<ObsidianConnectForm settings={DEFAULT_SETTINGS} onConnected={onConnected} />)
    fillAndConnect()
    await waitFor(() => expect(screen.getByText(/API Key 无效/)).toBeTruthy())
    expect(mockSaveToken).not.toHaveBeenCalled()
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('连不上（ok:false）→ 提示开启 HTTP server，不连', async () => {
    mockPing.mockResolvedValue({ ok: false, status: 0, authenticated: false })
    const onConnected = vi.fn()
    render(<ObsidianConnectForm settings={DEFAULT_SETTINGS} onConnected={onConnected} />)
    fillAndConnect()
    await waitFor(() => expect(screen.getByText(/无法连接|HTTP server/)).toBeTruthy())
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('重开场景（key 留空）→ 用已存 token 测试，且不覆盖 token；高级字段照存', async () => {
    mockGetToken.mockResolvedValue('STORED_TOKEN')
    mockPing.mockResolvedValue({ ok: true, status: 200, authenticated: true, vault: 'V' })
    const saveSettings = vi.fn().mockResolvedValue(undefined); const onConnected = vi.fn()
    render(<ObsidianConnectForm settings={{ ...DEFAULT_SETTINGS }} saveSettings={saveSettings} onConnected={onConnected} />)
    // 不填 key，直接测试 → 用 STORED_TOKEN
    fireEvent.click(screen.getByText('测试连接'))
    await waitFor(() => expect(mockPing).toHaveBeenCalledWith(expect.anything(), 'STORED_TOKEN'))
    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    expect(mockSaveToken).not.toHaveBeenCalled() // 没填 key → 不覆盖
    expect(onConnected).toHaveBeenCalled()
  })

  it('空 key + 无已存 token → 禁用测试按钮', () => {
    mockGetToken.mockResolvedValue('')
    render(<ObsidianConnectForm settings={DEFAULT_SETTINGS} onConnected={() => {}} />)
    expect((screen.getByText('测试连接').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认全红**

Run: `npx vitest run src/sidepanel/components/ObsidianConnectForm.test.tsx`
Expected: 全 FAIL（组件不存在）。

- [ ] **Step 3: 实现 `ObsidianConnectForm.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { pingObsidian } from '../../shared/obsidian/api'
import { saveObsidianToken, getObsidianToken } from '../../shared/obsidian/auth'
import { FormField, FormInput } from './form'
import Button from './Button'
import Tooltip from './Tooltip'
import './ObsidianConnectForm.css'

interface Props {
  settings: AppSettings
  saveSettings?: (s: AppSettings) => Promise<void>
  onConnected: (vault?: string) => void
}

type Result = { kind: 'ok' | 'err'; msg: string }

const PLUGIN_URL = 'https://github.com/coddingtonbear/obsidian-local-rest-api'

/** 把 Obsidian 接入知识库：装插件 → 开 HTTP → 复制 Key → 填端点+Key → 测试连接。
 *  token 走独立加密键；obsidianBaseUrl/Inbox/Exclude/Vault 走 AppSettings。 */
export default function ObsidianConnectForm({ settings, saveSettings, onConnected }: Props) {
  const [endpoint, setEndpoint] = useState(settings.obsidianBaseUrl || 'http://127.0.0.1:27123')
  const [apiKey, setApiKey] = useState('')
  const [inbox, setInbox] = useState(settings.obsidianInboxPath || '')
  const [exclude, setExclude] = useState(settings.obsidianExcludePaths || '')
  const [hasStored, setHasStored] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [showAdv, setShowAdv] = useState(false)

  useEffect(() => { getObsidianToken().then((t) => setHasStored(!!t)) }, [])

  const canTest = testing || !!apiKey.trim() || hasStored

  async function test() {
    setResult(null); setTesting(true)
    try {
      const token = apiKey.trim() || await getObsidianToken()
      const probe = await pingObsidian({ ...settings, obsidianBaseUrl: endpoint }, token || undefined)
      if (!probe.ok) {
        setResult({ kind: 'err', msg: `无法连接到 ${endpoint}。请确认 Obsidian 已运行、插件已启用并打开了 HTTP server（端口 27123）。` })
        return
      }
      if (!probe.authenticated) {
        setResult({ kind: 'err', msg: 'API Key 无效或已失效，请回 Obsidian 设置 → Local REST API 重新复制。' })
        return
      }
      // 成功：存 token（仅当用户填了 key）+ 存设置。
      if (apiKey.trim()) await saveObsidianToken(apiKey.trim())
      const vaultName = probe.vault ?? settings.obsidianVaultName
      await saveSettings?.({ ...settings, obsidianBaseUrl: endpoint, obsidianInboxPath: inbox, obsidianExcludePaths: exclude, obsidianVaultName: vaultName })
      setResult({ kind: 'ok', msg: `已连接${probe.vault ? ` · ${probe.vault}` : ''}` })
      onConnected(probe.vault)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="kb-connect" data-testid="kb-connect-form">
      <div className="kb-connect-intro">把你的 Obsidian 仓库接入，助手即可检索与读写笔记。流量只在 localhost，API Key 加密存储。</div>

      <ol className="kb-steps">
        <li className="kb-step">
          <span className="kb-step-no">1</span>
          <span className="kb-step-body">安装社区插件 <a href={PLUGIN_URL} target="_blank" rel="noreferrer">Local REST API with MCP</a></span>
        </li>
        <li className="kb-step">
          <span className="kb-step-no">2</span>
          <span className="kb-step-body">
            设置 → Local REST API，打开「Enable non-encrypted (HTTP) server」
            <Tooltip content="扩展无法信任 HTTPS 的自签名证书，故走 HTTP（端口 27123）。流量仅在本机回环。" position="right">
              <span className="kb-q">?</span>
            </Tooltip>
          </span>
        </li>
        <li className="kb-step">
          <span className="kb-step-no">3</span>
          <span className="kb-step-body">复制同页显示的 API Key</span>
        </li>
      </ol>

      <FormField label="API Key">
        <FormInput type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasStored ? '••••••（已保存，留空则沿用）' : '粘贴 Obsidian API Key'} aria-label="API Key" />
      </FormField>

      <FormField label="端点">
        <FormInput type="url" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} aria-label="端点" />
      </FormField>

      <div className="kb-adv-toggle">
        <button type="button" className="kb-link-btn" onClick={() => setShowAdv((v) => !v)}>{showAdv ? '收起' : '高级'}选项</button>
      </div>
      {showAdv && (
        <>
          <FormField label="收件箱路径" hint="新建笔记的默认落点（空 = vault 根）。">
            <FormInput type="text" value={inbox} onChange={(e) => setInbox(e.target.value)} placeholder="Inbox/" />
          </FormField>
          <FormField label="排除路径" hint="逗号分隔 glob，检索与列表都排除。">
            <FormInput type="text" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="Archive/**, Daily/**" />
          </FormField>
        </>
      )}

      <div className="kb-test-row">
        <Button variant="primary" onClick={test} loading={testing} disabled={!canTest}>测试连接</Button>
        {result && <span className={`kb-test-result ${result.kind === 'ok' ? 'kb-test-result--ok' : 'kb-test-result--err'}`}>{result.msg}</span>}
      </div>

      <div className="kb-privacy">开启后，检索到的笔记内容会发往你配置的 LLM 以供回答。</div>
    </div>
  )
}
```

> `FormInput` 是否接受 `aria-label`/`placeholder`？它渲染 `<input className="form-input" {...}/>`，应透传原生 input 属性。若类型未透传，把 `aria-label` 改用包一层 `<label>` 或给 `FormField` 加 `htmlFor`。实现者按实际 `FormInput` 签名调整（读 `./form/FormInput.tsx`）。

- [ ] **Step 4: 实现 `ObsidianConnectForm.css`**

```css
.kb-connect { display: flex; flex-direction: column; gap: 12px; padding: 14px; overflow-y: auto; }
.kb-connect-intro { font-size: 12px; color: var(--color-text-secondary); line-height: 1.6; }
.kb-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.kb-step { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: var(--color-text); line-height: 1.5; }
.kb-step-no { flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; background: var(--color-primary-soft); color: var(--color-primary); font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.kb-step-body a { color: var(--color-primary); }
.kb-q { display: inline-flex; width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--color-border-strong); color: var(--color-text-secondary); font-size: 10px; align-items: center; justify-content: center; margin-left: 4px; cursor: help; }
.kb-adv-toggle { margin: -2px 0; }
.kb-link-btn { background: none; border: none; color: var(--color-primary); font-size: 11px; cursor: pointer; padding: 0; }
.kb-test-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.kb-test-result { font-size: 11px; }
.kb-test-result--ok { color: var(--color-success); }
.kb-test-result--err { color: var(--color-error); }
.kb-privacy { font-size: 10px; color: var(--color-text-secondary); line-height: 1.5; border-top: 1px solid var(--color-border); padding-top: 8px; }
```

- [ ] **Step 5: 接进 `KnowledgeBasePanel.tsx`** — disconnected 分支占位换成：

```tsx
        {conn === 'disconnected' && (
          <ObsidianConnectForm
            settings={settings}
            saveSettings={saveSettings}
            onConnected={(v) => { if (v) setVault(v); setConn('connected') }}
          />
        )}
```
顶部加 `import ObsidianConnectForm from './ObsidianConnectForm'`。

- [ ] **Step 6: 跑测试确认全绿**

Run: `npx vitest run src/sidepanel/components/ObsidianConnectForm.test.tsx src/sidepanel/components/KnowledgeBasePanel.test.tsx`
Expected: 全绿。

- [ ] **Step 7: 门**

Run: `npm run typecheck`（必 0）· `npm run build`（必成功）。不 commit。

---

## Task 5: `ObsidianVaultView`（搜索 + 最近 列表）

已连接态：顶栏（仓库名 + 设置按钮重开接入）+ 搜索框（主入口，`Ctrl+K` 聚焦）+ 「最近 / 搜索」分段；点笔记行进详情（Task 6）。最近用 `recentNotes`（缓存，避免反复全量拉取），搜索用 `searchVault`。

**Files:**
- New: `src/sidepanel/components/ObsidianVaultView.tsx` + `.css` + `.test.tsx`
- Modify: `KnowledgeBasePanel.tsx`（connected 占位换成此组件）

**Interfaces:**
- Consumes: `recentNotes` / `searchVault`（`../../shared/obsidian/api`，Task 1）、`AppSettings`。
- Produces：`ObsidianVaultView` props = `{ settings: AppSettings; onDisconnected: () => void }`。内部选中笔记时渲染 `<ObsidianNoteDetail>`（Task 6）。

- [ ] **Step 1: 写失败测试** — `ObsidianVaultView.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'

const mockRecent = vi.fn(); const mockSearch = vi.fn()
vi.mock('../../shared/obsidian/api', () => ({ recentNotes: mockRecent, searchVault: mockSearch }))

const ObsidianVaultView = (await import('./ObsidianVaultView')).default
beforeEach(() => { mockRecent.mockReset(); mockSearch.mockReset() })
afterEach(cleanup)

describe('ObsidianVaultView', () => {
  it('挂载即载入最近笔记并渲染行', async () => {
    mockRecent.mockResolvedValue([{ path: 'a.md', mtime: 1000 }, { path: 'Folder/b.md', mtime: 2000 }])
    render(<ObsidianVaultView settings={DEFAULT_SETTINGS} onDisconnected={() => {}} />)
    await waitFor(() => expect(mockRecent).toHaveBeenCalled())
    expect(screen.getByText('a.md')).toBeTruthy()
    expect(screen.getByText(/b\.md/)).toBeTruthy()
  })

  it('搜索提交 → searchVault → 显示带片段的结果', async () => {
    mockRecent.mockResolvedValue([])
    mockSearch.mockResolvedValue([{ path: 'n.md', snippet: 'hit here', score: 3 }])
    render(<ObsidianVaultView settings={DEFAULT_SETTINGS} onDisconnected={() => {}} />)
    await waitFor(() => expect(mockRecent).toHaveBeenCalled())
    fireEvent.change(screen.getByPlaceholderText(/搜索笔记/), { target: { value: 'hit' } })
    fireEvent.click(screen.getByLabelText('搜索'))
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith(expect.anything(), 'hit'))
    expect(screen.getByText('n.md')).toBeTruthy()
    expect(screen.getByText(/hit here/)).toBeTruthy()
  })

  it('载入失败 → 显示错误，不崩', async () => {
    mockRecent.mockRejectedValue(new Error('读取最近笔记失败（500）'))
    render(<ObsidianVaultView settings={DEFAULT_SETTINGS} onDisconnected={() => {}} />)
    await waitFor(() => expect(screen.getByText(/读取最近笔记失败|500/)).toBeTruthy())
  })

  it('设置按钮 → onDisconnected（回接入表单）', async () => {
    mockRecent.mockResolvedValue([])
    const onDisconnected = vi.fn()
    render(<ObsidianVaultView settings={DEFAULT_SETTINGS} onDisconnected={onDisconnected} />)
    await waitFor(() => expect(mockRecent).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('设置'))
    expect(onDisconnected).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认全红**

Run: `npx vitest run src/sidepanel/components/ObsidianVaultView.test.tsx`
Expected: 全 FAIL。

- [ ] **Step 3: 实现 `ObsidianVaultView.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { recentNotes, searchVault, type ObsidianNoteRow } from '../../shared/obsidian/api'
import Tooltip from './Tooltip'
import './ObsidianVaultView.css'

interface Props {
  settings: AppSettings
  onDisconnected: () => void
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

export default function ObsidianVaultView({ settings, onDisconnected }: Props) {
  const [tab, setTab] = useState<'recent' | 'search'>('recent')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ObsidianNoteRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState<string | null>(null)
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

  // Ctrl+K 聚焦搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 选中笔记 → 渲染详情（Task 6）。Task 6 完成前用占位。
  if (active) {
    return (
      // Task 6 替换为：<ObsidianNoteDetail settings={settings} path={active} onClose={() => { setActive(null); loadRecent(true) }} onDeleted={() => { setActive(null); loadRecent(true) }} />
      <div className="kb-placeholder" data-testid="kb-note-detail">笔记详情即将就绪：{active}</div>
    )
  }

  return (
    <div className="kb-vault" data-testid="kb-vault-view">
      <div className="kb-vault-head">
        <span className="kb-vault-name">{settings.obsidianVaultName || 'Obsidian'}</span>
        <Tooltip content="连接设置" position="bottom">
          <button className="kb-icon-btn" onClick={onDisconnected} type="button" aria-label="设置">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
        </Tooltip>
      </div>

      <div className="kb-search">
        <input
          ref={searchInput}
          className="form-input kb-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
          placeholder="搜索笔记…  (Ctrl+K)"
        />
        <button className="kb-icon-btn" onClick={runSearch} type="button" aria-label="搜索">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        </button>
      </div>

      <div className="kb-tabs">
        <button className={`kb-tab${tab === 'recent' ? ' kb-tab--active' : ''}`} onClick={() => { setTab('recent'); loadRecent() }} type="button">最近</button>
        <button className={`kb-tab${tab === 'search' ? ' kb-tab--active' : ''}`} onClick={() => setTab('search')} type="button">搜索</button>
      </div>

      {error && <div className="kb-error">{error}</div>}
      {loading && <div className="kb-muted">载入中…</div>}
      {!loading && !error && rows.length === 0 && <div className="kb-muted">{tab === 'search' ? '无匹配笔记' : '仓库为空'}</div>}

      <ul className="kb-list">
        {rows.map((r) => (
          <li key={r.path}>
            <button className="kb-row" onClick={() => setActive(r.path)} type="button">
              <span className="kb-row-title">{r.path.split('/').pop() || r.path}</span>
              <span className="kb-row-path">{r.path}</span>
              {r.snippet && <span className="kb-row-snip">{r.snippet}</span>}
              {r.mtime && tab === 'recent' && <span className="kb-row-time">{relTime(r.mtime)}</span>}
            </button>
          </li>
        ))}
      </ul>

      <div className="kb-new-wrap">
        {/* 创建型 CTA 不放图标（项目规范）。Task 6 接详情的新建态。 */}
        <button className="kb-new" type="button" disabled>新建笔记</button>
      </div>
    </div>
  )
}
```

> 「新建笔记」按钮在本 task 先 `disabled`（Task 6 把详情接入后，改成进入"新建态"详情）。`recentNotes` 全量拉取 + 客户端排序：已用 `recentCache` 缓存，仅首次载入/详情返回时强制刷新；大 vault 注意 spec §7.2 提示。

- [ ] **Step 4: 实现 `ObsidianVaultView.css`**

```css
.kb-vault { display: flex; flex-direction: column; gap: 10px; padding: 14px; overflow-y: auto; }
.kb-vault-head { display: flex; align-items: center; justify-content: space-between; }
.kb-vault-name { font-size: 13px; font-weight: 600; color: var(--color-text); }
.kb-icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg); color: var(--color-text-secondary); cursor: pointer; }
.kb-icon-btn:hover { color: var(--color-primary); border-color: var(--color-primary-border); }
.kb-icon-btn svg { width: 15px; height: 15px; }
.kb-search { display: flex; gap: 6px; }
.kb-search-input { flex: 1; }
.kb-tabs { display: flex; gap: 4px; }
.kb-tab { flex: 1; padding: 6px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg); color: var(--color-text-secondary); font-size: 11px; cursor: pointer; }
.kb-tab--active { color: var(--color-primary); border-color: var(--color-primary-border); background: var(--color-primary-soft); }
.kb-error { font-size: 11px; color: var(--color-error); }
.kb-muted { font-size: 11px; color: var(--color-text-secondary); padding: 12px 0; text-align: center; }
.kb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.kb-row { width: 100%; display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg); cursor: pointer; }
.kb-row:hover { border-color: var(--color-primary-border); background: var(--color-primary-tint); }
.kb-row-title { font-size: 12px; font-weight: 600; color: var(--color-text); }
.kb-row-path { font-size: 10px; color: var(--color-text-secondary); }
.kb-row-snip { font-size: 10px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kb-row-time { font-size: 10px; color: var(--color-text-secondary); }
.kb-new-wrap { padding-top: 4px; }
.kb-new { width: 100%; padding: 8px; border: 1px dashed var(--color-primary-border); border-radius: 8px; background: var(--color-primary-soft); color: var(--color-primary); font-size: 12px; cursor: pointer; }
.kb-new:disabled { opacity: .5; cursor: not-allowed; }
```

- [ ] **Step 5: 接进 `KnowledgeBasePanel.tsx`** — connected 分支占位换成：

```tsx
        {conn === 'connected' && (
          <ObsidianVaultView settings={settings} onDisconnected={() => setConn('disconnected')} />
        )}
```
顶部加 `import ObsidianVaultView from './ObsidianVaultView'`。

- [ ] **Step 6: 跑测试确认全绿**

Run: `npx vitest run src/sidepanel/components/ObsidianVaultView.test.tsx src/sidepanel/components/KnowledgeBasePanel.test.tsx`
Expected: 全绿。

- [ ] **Step 7: 门**

Run: `npm run typecheck`（必 0）· `npm run build`（必成功）。不 commit。

---

## Task 6: `ObsidianNoteDetail`（读 / 源码编辑 / 新建 / 删除）

笔记详情：读 markdown → `<Markdown>` 预览 ⇄ `<textarea>` 源码编辑；保存走 `writeNote`（PUT）；删除带确认走 `deleteNote`（DELETE）；新建 = 空编辑态 + 标题输入 → `writeNote` 新路径。接入 `VaultView` 的行点击与「新建笔记」。

**Files:**
- New: `src/sidepanel/components/ObsidianNoteDetail.tsx` + `.css` + `.test.tsx`
- Modify: `src/sidepanel/components/ObsidianVaultView.tsx`（行点击 + 新建按钮接入）

**Interfaces:**
- Consumes: `readNote` / `writeNote` / `deleteNote`（`../../shared/obsidian/api`，Task 1）、`sanitizeVaultPath`（`../../shared/obsidian/util`，Plan 1）、`Markdown`、`AppSettings`。
- Produces：`ObsidianNoteDetail` props = `{ settings: AppSettings; path: string | null; onClose: () => void; onDeleted: () => void }`（`path === null` = 新建态）。

- [ ] **Step 1: 写失败测试** — `ObsidianNoteDetail.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'

const mockRead = vi.fn(); const mockWrite = vi.fn(); const mockDelete = vi.fn()
vi.mock('../../shared/obsidian/api', () => ({ readNote: mockRead, writeNote: mockWrite, deleteNote: mockDelete }))

const ObsidianNoteDetail = (await import('./ObsidianNoteDetail')).default
beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset(); mockDelete.mockReset() })
afterEach(cleanup)

describe('ObsidianNoteDetail', () => {
  it('读现有笔记 → 显示正文 + 编辑切换', async () => {
    mockRead.mockResolvedValue('# Hello\nworld')
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path="a.md" onClose={() => {}} onDeleted={() => {}} />)
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy()) // Markdown 渲染 # Hello
    fireEvent.click(screen.getByText('编辑'))
    const ta = screen.getByTestId('kb-editor') as HTMLTextAreaElement
    expect(ta.value).toContain('# Hello')
  })

  it('编辑后保存 → writeNote(path, draft)', async () => {
    mockRead.mockResolvedValue('orig'); mockWrite.mockResolvedValue(undefined)
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path="a.md" onClose={() => {}} onDeleted={() => {}} />)
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    fireEvent.click(screen.getByText('编辑'))
    fireEvent.change(screen.getByTestId('kb-editor'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(mockWrite).toHaveBeenCalledWith(expect.anything(), 'a.md', 'changed'))
  })

  it('删除 → 确认 → deleteNote → onDeleted', async () => {
    mockRead.mockResolvedValue('x'); mockDelete.mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path="a.md" onClose={() => {}} onDeleted={onDeleted} />)
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('删除'))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(expect.anything(), 'a.md'))
    expect(onDeleted).toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('取消确认 → 不删除', async () => {
    mockRead.mockResolvedValue('x')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path="a.md" onClose={() => {}} onDeleted={() => {}} />)
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('删除'))
    expect(mockDelete).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('新建态（path=null）→ 输入标题 + 正文 → writeNote(newPath, body)', async () => {
    mockWrite.mockResolvedValue(undefined)
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path={null} onClose={() => {}} onDeleted={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('笔记标题'), { target: { value: 'Idea' } })
    fireEvent.change(screen.getByTestId('kb-editor'), { target: { value: 'first' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(mockWrite).toHaveBeenCalledWith(expect.anything(), 'Idea.md', 'first'))
  })
})
```

- [ ] **Step 2: 跑测试确认全红**

Run: `npx vitest run src/sidepanel/components/ObsidianNoteDetail.test.tsx`
Expected: 全 FAIL。

- [ ] **Step 3: 实现 `ObsidianNoteDetail.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { readNote, writeNote, deleteNote } from '../../shared/obsidian/api'
import { sanitizeVaultPath } from '../../shared/obsidian/util'
import Markdown from './Markdown'
import './ObsidianNoteDetail.css'

interface Props {
  settings: AppSettings
  /** null = 新建态；否则 vault 相对路径。 */
  path: string | null
  onClose: () => void
  onDeleted: () => void
}

/** 笔记详情：读（Markdown 预览）⇄ 源码编辑；保存（PUT）；删除（DELETE，确认）；新建（空编辑态）。 */
export default function ObsidianNoteDetail({ settings, path, onClose, onDeleted }: Props) {
  const isNew = path === null
  const [title, setTitle] = useState(isNew ? '' : (path!.split('/').pop() || '').replace(/\.md$/i, ''))
  const [mode, setMode] = useState<'view' | 'edit'>(isNew ? 'edit' : 'view')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isNew) return
    let alive = true; setLoading(true); setError('')
    readNote(settings, path!).then((md) => { if (!alive) return; setBody(md); setDraft(md) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [settings, path, isNew])

  async function save() {
    const target = isNew ? sanitizeVaultPath(title.trim()) + '.md' : path!
    if (!target || target === '.md') { setError('请填写笔记标题'); return }
    setSaving(true); setError('')
    try {
      await writeNote(settings, target, draft)
      setBody(draft); setMode('view')
      if (isNew) onClose() // 新建成功 → 回列表（列表会刷新）
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  async function remove() {
    if (!window.confirm(`确认删除「${path}」？此操作不可撤销。`)) return
    setSaving(true); setError('')
    try { await deleteNote(settings, path!); onDeleted() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setSaving(false) }
  }

  return (
    <div className="kb-detail" data-testid="kb-note-detail">
      <div className="kb-detail-head">
        <button className="kb-icon-btn" onClick={onClose} type="button" aria-label="返回">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="kb-detail-path">{isNew ? '新建笔记' : path}</span>
        <div className="kb-detail-actions">
          {!isNew && mode === 'view' && (
            <button className="kb-icon-btn" onClick={() => setMode('edit')} type="button" aria-label="编辑">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </button>
          )}
          {!isNew && (
            <button className="kb-icon-btn" onClick={remove} type="button" aria-label="删除" disabled={saving}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          )}
        </div>
      </div>

      {error && <div className="kb-error">{error}</div>}
      {loading && <div className="kb-muted">载入中…</div>}

      {!loading && mode === 'view' && !isNew && (
        <div className="kb-detail-body"><Markdown>{body}</Markdown></div>
      )}

      {(!loading && mode === 'edit') || isNew ? (
        <div className="kb-detail-edit">
          {isNew && (
            <input className="form-input kb-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="笔记标题" />
          )}
          <textarea className="kb-editor" data-testid="kb-editor" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="kb-detail-foot">
            {!isNew && <button className="kb-link-btn" type="button" onClick={() => { setDraft(body); setMode('view') }}>取消</button>}
            <button className="kb-save" type="button" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: 实现 `ObsidianNoteDetail.css`**

```css
.kb-detail { display: flex; flex-direction: column; gap: 10px; padding: 14px; overflow-y: auto; }
.kb-detail-head { display: flex; align-items: center; gap: 8px; }
.kb-detail-path { font-size: 12px; color: var(--color-text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-detail-actions { display: flex; gap: 6px; }
.kb-detail-body { font-size: 13px; color: var(--color-text); line-height: 1.7; }
.kb-detail-edit { display: flex; flex-direction: column; gap: 8px; }
.kb-title-input { font-weight: 600; }
.kb-editor { width: 100%; min-height: 240px; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg); color: var(--color-text); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; outline: none; box-sizing: border-box; }
.kb-editor:focus { border-color: var(--color-primary); box-shadow: var(--ring); }
.kb-detail-foot { display: flex; justify-content: flex-end; gap: 10px; align-items: center; }
.kb-link-btn { background: none; border: none; color: var(--color-text-secondary); font-size: 11px; cursor: pointer; }
.kb-save { padding: 6px 16px; border: none; border-radius: 8px; background: var(--color-primary); color: #fff; font-size: 12px; cursor: pointer; }
.kb-save:hover:not(:disabled) { background: var(--color-primary-hover); }
.kb-save:disabled { opacity: .5; cursor: not-allowed; }
```

- [ ] **Step 5: 接进 `ObsidianVaultView.tsx`** — 顶部 `import ObsidianNoteDetail from './ObsidianNoteDetail'`；把 `if (active) { return <占位> }` 替换为：

```tsx
  if (active) {
    return <ObsidianNoteDetail settings={settings} path={active} onClose={() => setActive(null)} onDeleted={() => { setActive(null); loadRecent(true) }} />
  }
```
并把「新建笔记」按钮的 `disabled` 去掉、`onClick` 设为进新建态：新增一个 `const [creating, setCreating] = useState(false)`，在组件 return 前加：

```tsx
  if (creating) {
    return <ObsidianNoteDetail settings={settings} path={null} onClose={() => setCreating(false)} onDeleted={() => setCreating(false)} />
  }
```
按钮改为 `<button className="kb-new" type="button" onClick={() => setCreating(true)}>新建笔记</button>`。
（新建保存成功后 `onClose` 回列表；列表 `loadRecent(true)` 刷新能看到新笔记。）

- [ ] **Step 6: 跑测试确认全绿**

Run: `npx vitest run src/sidepanel/components/ObsidianNoteDetail.test.tsx src/sidepanel/components/ObsidianVaultView.test.tsx`
Expected: 全绿。

- [ ] **Step 7: 门**

Run: `npm run typecheck`（必 0）· `npm run build`（必成功）。不 commit。

---

## Task 7（可选·收尾）: 全量门 + 手动真机验收

- [ ] **Step 1: 全量门**

Run: `npm run typecheck`（必 0）· `npm test`（必全绿，Plan 1 后 ~810 用例 + 本计划新增）· `npm run build`（必成功）。

- [ ] **Step 2: 真机验收（用户手动）**

`npm run dev:ui`（落到对话），切到「应用」tab，确认「知识库」卡出现并点击进面板：
1. 未连接 → 接入引导；填 API Key + 测试连接 →「已连接 · <vault>」。
2. 已连接 → 最近笔记列表出现；搜索一个关键词 → 命中带片段。
3. 点一篇 → 正文 Markdown 渲染；编辑 → 保存；回 Obsidian 确认改动落地。
4. 删除一篇（确认）→ 回 Obsidian 确认已删。
5. 新建一篇（标题 + 正文 + 保存）→ 回 Obsidian 确认新文件出现。
6. [设置] 齿轮 → 回接入表单（高级里的收件箱/排除路径改了能存住、重载不丢）。

任一步失败 → 回相应 task 修。全过 → Plan 2 完成，可进入 final whole-branch review + 用户授权后统一 commit（沿用 Plan 1 模式）。

---

## Self-Review（写计划后自查）

- **Spec 覆盖（§5）**：接入引导（T4）✓；连接状态（T3 ping 两态）✓；内容列表搜索优先 + 最近（T5）✓；笔记详情读/编辑/新建/删除（T6）✓；重命名/移动 v1 不做（约束声明）✓；纯 CSS + 禁 emoji + SVG（约束 + 各 CSS）✓；创建 CTA 无图标（T5 `.kb-new`）✓。§5 未覆盖：标签聚合 tab、目录树 tab —— spec §5.1 明确留 v1.5，符合范围。
- **占位扫描**：无 TBD/TODO；每步含完整代码；Task 3 的 connected/disconnected 占位是**有意的渐进占位**（T4/T5 替换），已在代码注释标明，非缺失。
- **类型一致性**：`ObsidianNoteRow`（T1 定义）在 T5 消费一致；`KnowledgeBasePanel`/`ObsidianConnectForm`/`ObsidianVaultView`/`ObsidianNoteDetail` 的 props 在定义处与各调用处签名一致（`saveSettings?` 可选、`onConnected(vault?)`、`onDisconnected()`、`path: string | null`）。
- **与 Plan 1 衔接**：复用 `obsidianFetch`/`pingObsidian`/`saveObsidianToken`/`getObsidianToken`/`encodeVaultPath`/`sanitizeVaultPath`/`HAS_KNOWLEDGE_BASE`/`isObsidianOutboundAllowed`（均 Plan 1 已落地），无重复造轮子。
- **下游 Plan 3 备忘**：`obsidianFetch` 用非抛 `getObsidianToken`（让 `GET /` 免鉴权探活）→ Plan 3 的 chat 写/鉴权读工具若直接调 `searchVault`/`readNote`/`writeNote`/`deleteNote`，401 已被 `authedOrThrow` 翻成"重新接入"提示（本计划 T1 落地），无需各调用方再 `resolveObsidianToken`；但若 Plan 3 想在调用前 fail-fast（省一次往返），仍可先 `resolveObsidianToken`。
