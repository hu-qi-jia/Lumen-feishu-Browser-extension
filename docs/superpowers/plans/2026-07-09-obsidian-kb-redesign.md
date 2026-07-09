# Obsidian 知识库 — UI 重做 + chat 工具只读接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Obsidian 知识库的接入/连接设置搬进设置页（新 tab），Hub 入口改为"未配置→引导去设置"；知识库列表/详情页扁平化重做并抽公共 `SearchBox`；chat 输入框「工具」下拉加「知识库」会话级开关，开启后 agent 具备只读检索能力。

**Architecture:** 设置页加第 6 个 tab「知识库」（复用 `FeishuSteps` + `FormField`/`FormInput`），接入表单 `ObsidianConnectForm` 整体迁入并删除原文件；`KnowledgeBasePanel` 的 disconnected 态从接入表单改为门禁空态（跳设置）；`ObsidianVaultView`/`ObsidianNoteDetail` 对齐全站 `TopBar`/`BackButton` + `icons.tsx`，列表改 `.drawer-row` 风扁平行，搜索改公共 `SearchBox`；session 加 `kbEnabled`，`agent.ts` 的 `toolsForContext`/`executeTool`/`buildSystemPrompt`/`runAgent` 接入两个只读 KB 工具（`search_knowledge_base`/`read_knowledge_note`）。

**Tech Stack:** React 18 + TypeScript + Vite + vitest 4.x；纯 CSS（语义 class + `App.css` `--color-*` 变量）；`@testing-library/react`（组件测试用 `// @vitest-environment jsdom` 行首 docblock）。

## Global Constraints

> 每个任务的需求都隐含以下项目级硬约束（来自 CLAUDE.md / 设计 spec / 记忆）：

- **不自动 commit/push**：CLAUDE.md「仅用户要求才 commit/push」。本计划所有改动留在工作树；每个任务末尾跑 **gate**（`npm run typecheck` + 聚焦 `npx vitest run <路径>`），**不**跑 `git commit`。全量 `npm test` + `npm run build` 只在最后一个任务跑。统一 commit 由用户在真机验收后授权（仅本计划文件）。
- **分支 `feishu-ok`**：直接改，不开特性分支。
- **UI 纯 CSS**：语义 className + 各组件 `.css` + `App.css` `--color-*` 变量；**禁用** shadcn/Tailwind/UI 组件库。
- **禁用 emoji**；图标用手写内联 SVG，统一收口在 `src/sidepanel/components/icons.tsx`。
- **图标规范**：创建型 CTA（新建笔记/保存/测试连接）**不放图标**；工具/导航按钮（设置/搜索/返回/编辑/删除）**带图标**。
- **出站边界**：只走 `feishuReq`/`feishuFetch`/`assertSafeBaseUrl`，以及第三组 loopback-only 的 `obsidianFetch`（`isObsidianOutboundAllowed`）。**绝不**复用 `feishuFetch` 发 Obsidian 请求。
- **secret 不进明文包**：Obsidian API Key 走独立加密键 `_obsidian_token_v1`（`saveObsidianToken`/`getObsidianToken`），**绝不**进 `AppSettings` blob、绝不内联。
- **写操作不自动重试**；删除必确认。
- **cheapest viable**：不付费、不用 Python、不引 SaaS API。
- **vitest**：组件测试文件首行加 `// @vitest-environment jsdom`；RTL `render/screen/fireEvent/waitFor`；`afterEach(cleanup)`；`vi.mock` 模块边界。逻辑测试默认 `node` 环境。
- **YAGNI/DRY/TDD**：每个任务先写失败测试 → 跑红 → 最小实现 → 跑绿 → gate。

---

## File Structure

**新增**
- `src/sidepanel/components/settings/KnowledgeBaseTab.tsx` —— 设置页「知识库」tab：`FeishuSteps` 引导 + 端点/API Key + 测试连接 + 高级（inbox/exclude）。
- `src/sidepanel/components/SearchBox.tsx` + `SearchBox.css` —— 公共搜索框（前导放大镜 + 无框输入 + 清除叉 + focus 描边）。

**修改**
- `src/sidepanel/components/icons.tsx` —— +`IconSearch`/`IconSettings`/`IconChevronLeft`。
- `src/sidepanel/components/Settings.tsx` —— SETTINGS_TABS +「知识库」+ 渲染分支。
- `src/sidepanel/components/settings/types.ts` —— `SettingsTabId` +`'knowledgeBase'`。
- `src/sidepanel/components/KnowledgeBasePanel.tsx` —— disconnected→门禁；props 去 `saveSettings`、加 `onGoToSettings`。
- `src/sidepanel/components/ScenarioPanel.tsx` —— props 去 `saveSettings`、加 `onGoToSettings`，透给 KnowledgeBasePanel。
- `src/sidepanel/App.tsx` —— ScenarioPanel 去 `saveSettings`、加 `onGoToSettings`；ChatPanel 加 `kbEnabled`/`onToggleKb`。
- `src/sidepanel/components/ObsidianVaultView.tsx`/`.css` —— 扁平顶栏（vault 名 + 齿轮→onGoToSettings）、`SearchBox`、`.drawer-row` 风列表、图标 import；props `onDisconnected`→`onGoToSettings`。
- `src/sidepanel/components/ObsidianNoteDetail.tsx`/`.css` —— `TopBar` 顶栏、`IconEdit`/`IconTrash` import、去 `.kb-detail-head`/`.kb-icon-btn`。
- `src/sidepanel/components/SessionDrawer.tsx` —— 采用 `SearchBox`。
- `src/sidepanel/components/InputBar.tsx` —— 下拉加「知识库」开关行 + 修正 disabled + 新 props `kbEnabled`/`onToggleKb`。
- `src/sidepanel/components/ChatPanel.tsx` —— 透 `kbEnabled`/`onToggleKb` 给 InputBar；`runAgent` 调用传 `kbEnabled`。
- `src/shared/types.ts` —— `SessionMeta` +`kbEnabled?: boolean`。
- `src/sidepanel/sessions/useSessions.ts` —— `SessionsApi` +`setKbEnabled(id, on)`。
- `src/shared/ai/tools.ts` —— +`KNOWLEDGE_TOOLS`（2 个只读工具）。
- `src/shared/ai/agent.ts` —— `toolsForContext`(+opts)、`executeTool`(+2 分支)、`buildSystemPrompt`(+kbEnabled)、`runAgent`(+kbEnabled 尾参)。
- 配套测试：上述各组件 `.test.tsx` + `agent.test.ts` + `useSessions` 测试。

**删除**
- `src/sidepanel/components/ObsidianConnectForm.tsx` / `.css` / `.test.tsx`（接入 UI 整体迁入设置 tab）。

**文档（最后任务）**
- `CLAUDE.md` 约束 #4 + `SECURITY_AUDIT.md` —— 第三出站组（Obsidian-loopback）补述（Plan 1 遗留 TODO）。

---

## Task 1: icons.tsx 补 IconSearch / IconSettings / IconChevronLeft

**Files:**
- Modify: `src/sidepanel/components/icons.tsx`（在 `IconTrash` 之后、`KindIcon` 之前追加）
- Test: `src/sidepanel/components/icons.test.tsx`（新建）

**Interfaces:**
- Produces: `IconSearch(p: SVGProps<SVGSVGElement>)`、`IconSettings(p)`、`IconChevronLeft(p)`，签名与既有 `IconEdit` 等一致（`const X = (p: P) => <svg {...common} {...p}>…</svg>`，`P = SVGProps<SVGSVGElement>`）。

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { IconSearch, IconSettings, IconChevronLeft } from './icons'

describe('新增图标', () => {
  it('IconSearch 渲染圆 + 把手线', () => {
    const { container } = render(<IconSearch />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelector('circle')?.getAttribute('cx')).toBe('11')
    expect(svg.querySelector('line')).toBeTruthy()
  })
  it('IconSettings 渲染齿轮（含中心圆 + 主路径）', () => {
    const { container } = render(<IconSettings />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelector('circle')?.getAttribute('r')).toBe('3')
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(1)
  })
  it('IconChevronLeft 渲染左折线', () => {
    const { container } = render(<IconChevronLeft />)
    expect(container.querySelector('svg polyline')?.getAttribute('points')).toBe('15 18 9 12 15 6')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/sidepanel/components/icons.test.tsx`
Expected: FAIL（三个 icon 未导出 / undefined）。

- [ ] **Step 3: 实现 —— 在 icons.tsx 的 `IconTrash`（约 149 行）之后追加**

```tsx
export const IconSearch = (p: P) => (
  <svg {...common} {...p}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

export const IconChevronLeft = (p: P) => (
  <svg {...common} {...p}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

export const IconSettings = (p: P) => (
  <svg {...common} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/components/icons.test.tsx`
Expected: PASS（3/3）。

- [ ] **Step 5: gate**

Run: `npm run typecheck`
Expected: 0 错误。

---

## Task 2: 公共 SearchBox 组件

**Files:**
- Create: `src/sidepanel/components/SearchBox.tsx`、`src/sidepanel/components/SearchBox.css`
- Test: `src/sidepanel/components/SearchBox.test.tsx`

**Interfaces:**
- Consumes: `IconSearch`、`IconX`（Task 1 + 既有 icons.tsx）。
- Produces: `default function SearchBox({ value, onChange, onSearch?, placeholder?, autoFocus?, inputRef? }: Props)` —— `onChange(v: string)`、`onSearch()` 在 Enter 时触发；非空显示清除叉（点清除 → `onChange('')` + 回焦）。

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SearchBox from './SearchBox'

describe('SearchBox', () => {
  it('输入触发 onChange', () => {
    const onChange = vi.fn()
    render(<SearchBox value="" onChange={onChange} placeholder="搜" />)
    fireEvent.change(screen.getByPlaceholderText('搜'), { target: { value: 'abc' } })
    expect(onChange).toHaveBeenCalledWith('abc')
  })
  it('Enter 触发 onSearch', () => {
    const onSearch = vi.fn()
    render(<SearchBox value="x" onChange={() => {}} onSearch={onSearch} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSearch).toHaveBeenCalledTimes(1)
  })
  it('有值时显示清除叉，点击清空', () => {
    const onChange = vi.fn()
    render(<SearchBox value="x" onChange={onChange} />)
    const clear = screen.getByLabelText('清除')
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith('')
  })
  it('无值时不显示清除叉', () => {
    render(<SearchBox value="" onChange={() => {}} />)
    expect(screen.queryByLabelText('清除')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/sidepanel/components/SearchBox.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 SearchBox.tsx**

```tsx
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { IconSearch, IconX } from './icons'
import './SearchBox.css'

interface Props {
  value: string
  onChange: (v: string) => void
  onSearch?: () => void
  placeholder?: string
  autoFocus?: boolean
  /** 由调用方持有 ref（如 Ctrl+K 聚焦）；不传则内部自持。 */
  inputRef?: React.Ref<HTMLInputElement>
  /** 输入框尾部附加节点（如独立提交按钮）。 */
  trailing?: ReactNode
}

export default function SearchBox({ value, onChange, onSearch, placeholder, autoFocus, inputRef, trailing }: Props) {
  const innerRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? innerRef

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && onSearch) { e.preventDefault(); onSearch() }
  }

  return (
    <div className="search-box">
      <IconSearch className="search-box-icon" />
      <input
        ref={ref}
        className="search-box-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
      />
      {value && (
        <button type="button" className="search-box-clear" aria-label="清除" onClick={() => { onChange(''); ref.current?.focus() }}>
          <IconX />
        </button>
      )}
      {trailing}
    </div>
  )
}
```

- [ ] **Step 4: 实现 SearchBox.css（以 SessionDrawer `.drawer-search` 为蓝本）**

```css
.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
}
.search-box:focus-within {
  border-color: var(--color-primary-border);
}
.search-box-icon {
  width: 13px;
  height: 13px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.search-box-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  outline: none;
  font-size: 12px;
  color: var(--color-text);
}
.search-box-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 2px;
  flex-shrink: 0;
}
.search-box-clear:hover {
  color: var(--color-text);
}
.search-box-clear svg {
  width: 13px;
  height: 13px;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/components/SearchBox.test.tsx`
Expected: PASS（4/4）。

- [ ] **Step 6: gate**

Run: `npm run typecheck`
Expected: 0 错误。

---

## Task 3: 设置页「知识库」tab（KnowledgeBaseTab）

**Files:**
- Create: `src/sidepanel/components/settings/KnowledgeBaseTab.tsx`
- Modify: `src/sidepanel/components/Settings.tsx`（SETTINGS_TABS + 渲染分支 + import）、`src/sidepanel/components/settings/types.ts`（`SettingsTabId`）
- Test: `src/sidepanel/components/settings/KnowledgeBaseTab.test.tsx`

**Interfaces:**
- Consumes: `SettingsTabProps { form, patch, set }`（`settings/types.ts`）；`FeishuSteps` + `FeishuStep`（`./FeishuSteps`）；`FormField`/`FormInput`（`../form`）；`Button`（`../Button`）；`Tooltip`（`../Tooltip`）；`pingObsidian(settings, token?) => {ok, status, authenticated?, vault?}`、`saveObsidianToken(key)`、`getObsidianToken() => Promise<string>`（`../../../shared/obsidian/{api,auth}`）。
- Produces: `default function KnowledgeBaseTab({ form, patch }: SettingsTabProps)`。`FormInput` 的 `onChange` 是 `(e: ChangeEvent) => void`（用 `e.target.value`）。
- 行为：测试连接成功 → `saveObsidianToken(key)`（仅当填了 key）+ `patch({ obsidianVaultName })`；端点/inbox/exclude 通过 `patch` 进 form（随底部「保存」批量落盘）。

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import type { AppSettings } from '../../../shared/types'

const mockPing = vi.fn()
const mockSaveToken = vi.fn()
const mockGetToken = vi.fn()
vi.mock('../../../shared/obsidian/api', () => ({ pingObsidian: (...a: unknown[]) => mockPing(...a) }))
vi.mock('../../../shared/obsidian/auth', () => ({ saveObsidianToken: (...a: unknown[]) => mockSaveToken(...a), getObsidianToken: () => mockGetToken() }))

const KnowledgeBaseTab = (await import('./KnowledgeBaseTab')).default

beforeEach(() => { mockPing.mockReset(); mockSaveToken.mockReset(); mockGetToken.mockReset(); mockGetToken.mockResolvedValue('') })

describe('KnowledgeBaseTab', () => {
  it('渲染三步引导 + 端点/API Key 字段', () => {
    render(<KnowledgeBaseTab form={{ ...DEFAULT_SETTINGS }} patch={() => {}} set={() => () => {}} />)
    expect(screen.getByText('安装社区插件')).toBeTruthy()
    expect(screen.getByPlaceholderText('http://127.0.0.1:27123')).toBeTruthy()
  })
  it('填 key + 测试连接成功 → 存 token + patch vault', async () => {
    mockPing.mockResolvedValue({ ok: true, status: 200, authenticated: true, vault: 'MyVault' })
    const patch = vi.fn()
    render(<KnowledgeBaseTab form={{ ...DEFAULT_SETTINGS }} patch={patch} set={() => () => {}} />)
    fireEvent.change(screen.getByPlaceholderText('粘贴 API Key'), { target: { value: 'k1' } })
    fireEvent.click(screen.getByText('测试连接'))
    await waitFor(() => expect(mockPing).toHaveBeenCalled())
    await waitFor(() => expect(mockSaveToken).toHaveBeenCalledWith('k1'))
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ obsidianVaultName: 'MyVault' }))
    expect(screen.getByText(/已连接 · MyVault/)).toBeTruthy()
  })
  it('连接失败 → 错误态，不存 token', async () => {
    mockPing.mockResolvedValue({ ok: false, status: 0, authenticated: false })
    const patch = vi.fn()
    render(<KnowledgeBaseTab form={{ ...DEFAULT_SETTINGS }} patch={patch} set={() => () => {}} />)
    fireEvent.change(screen.getByPlaceholderText('粘贴 API Key'), { target: { value: 'k1' } })
    fireEvent.click(screen.getByText('测试连接'))
    await waitFor(() => expect(screen.getByText(/无法连接/)).toBeTruthy())
    expect(mockSaveToken).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/sidepanel/components/settings/KnowledgeBaseTab.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 KnowledgeBaseTab.tsx**

```tsx
import { useEffect, useState } from 'react'
import type { SettingsTabProps } from './types'
import FeishuSteps, { type FeishuStep } from './FeishuSteps'
import { FormField, FormInput } from '../form'
import Button from '../Button'
import Tooltip from '../Tooltip'
import { pingObsidian } from '../../../shared/obsidian/api'
import { saveObsidianToken, getObsidianToken } from '../../../shared/obsidian/auth'

const PLUGIN_URL = 'https://github.com/coddingtonbear/obsidian-local-rest-api'

type Result = { kind: 'ok' | 'err'; msg: string }

/** 设置页「知识库」tab：FeishuSteps 三步引导 + 端点/API Key + 测试连接 + 高级（inbox/exclude）。
 *  API Key 走独立加密键（测试连接成功即存）；端点/inbox/exclude/vault 通过 patch 进 form，
 *  随设置页底部「保存」批量落盘（与其余 tab 一致）。 */
export default function KnowledgeBaseTab({ form, patch }: SettingsTabProps) {
  const [apiKey, setApiKey] = useState('')
  const [hasStored, setHasStored] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [showAdv, setShowAdv] = useState(false)

  useEffect(() => { getObsidianToken().then((t) => setHasStored(!!t)) }, [])

  const canTest = !!apiKey.trim() || hasStored

  async function test() {
    setResult(null); setTesting(true)
    try {
      const token = apiKey.trim() || await getObsidianToken()
      const probe = await pingObsidian({ ...form }, token || undefined)
      if (!probe.ok) { setResult({ kind: 'err', msg: `无法连接到 ${form.obsidianBaseUrl}。请确认 Obsidian 已运行、插件已启用并打开了 HTTP server（端口 27123）。` }); return }
      if (!probe.authenticated) { setResult({ kind: 'err', msg: 'API Key 无效或已失效，请回 Obsidian 设置 → Local REST API 重新复制。' }); return }
      if (apiKey.trim()) await saveObsidianToken(apiKey.trim())
      if (probe.vault) patch({ obsidianVaultName: probe.vault })
      setHasStored(true)
      setResult({ kind: 'ok', msg: `已连接${probe.vault ? ` · ${probe.vault}` : ''}` })
    } catch (e) {
      setResult({ kind: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const steps: FeishuStep[] = [
    { title: '安装社区插件', description: <>安装 <a href={PLUGIN_URL} target="_blank" rel="noreferrer">Local REST API with MCP</a></> },
    {
      title: '开启 HTTP server',
      description: (
        <>
          Obsidian 设置 → Local REST API，打开「Enable non-encrypted (HTTP) server」
          <Tooltip content="扩展无法信任 HTTPS 的自签名证书，故走 HTTP（端口 27123）。流量仅在本机回环，API Key 仍加密存储。" position="right">
            <span className="kb-q" style={{ marginLeft: 4 }}>?</span>
          </Tooltip>
        </>
      ),
    },
    { title: '复制 API Key', description: '复制同页显示的 API Key，填到下方输入框。' },
  ]

  return (
    <div className="kb-tab">
      <FeishuSteps steps={steps} current={null} />

      <FormField label="端点" hint="Obsidian Local REST API 地址，默认本机 27123。">
        <FormInput type="url" value={form.obsidianBaseUrl ?? ''} onChange={(e) => patch({ obsidianBaseUrl: e.target.value })} placeholder="http://127.0.0.1:27123" />
      </FormField>

      <FormField label="API Key" hint={hasStored ? '已保存，留空则沿用；填写则覆盖。' : '粘贴 Obsidian Local REST API 页面显示的 API Key。'}>
        <FormInput type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasStored ? '••••••（已保存）' : '粘贴 API Key'} />
      </FormField>

      <div className="kb-tab-test">
        <Button variant="primary" onClick={test} loading={testing} disabled={!canTest}>测试连接</Button>
        {result && <span className={`kb-tab-result ${result.kind === 'ok' ? 'kb-tab-result--ok' : 'kb-tab-result--err'}`}>{result.msg}</span>}
      </div>

      <div className="kb-tab-adv">
        <button type="button" className="kb-link-btn" onClick={() => setShowAdv((v) => !v)}>{showAdv ? '收起' : '高级'}选项</button>
      </div>
      {showAdv && (
        <>
          <FormField label="收件箱路径" hint="新建笔记的默认落点（空 = vault 根）。">
            <FormInput type="text" value={form.obsidianInboxPath ?? ''} onChange={(e) => patch({ obsidianInboxPath: e.target.value })} placeholder="Inbox/" />
          </FormField>
          <FormField label="排除路径" hint="逗号分隔 glob，检索与列表都排除。">
            <FormInput type="text" value={form.obsidianExcludePaths ?? ''} onChange={(e) => patch({ obsidianExcludePaths: e.target.value })} placeholder="Archive/**, Daily/**" />
          </FormField>
        </>
      )}

      <p className="field-hint">开启后，检索到的笔记内容会发往你配置的 LLM 以供回答。</p>
    </div>
  )
}
```

- [ ] **Step 4: 在 KnowledgeBaseTab.css（新建）补少量样式**

```css
.kb-tab { display: flex; flex-direction: column; gap: 14px; }
.kb-tab-test { display: flex; align-items: center; gap: 10px; }
.kb-tab-result { font-size: 12px; }
.kb-tab-result--ok { color: var(--color-success-strong, var(--color-primary)); }
.kb-tab-result--err { color: var(--color-warning-strong); }
.kb-tab-adv { margin-top: -4px; }
.kb-link-btn { background: none; border: none; color: var(--color-primary); cursor: pointer; font-size: 12px; padding: 0; }
.kb-link-btn:hover { text-decoration: underline; }
```

- [ ] **Step 5: 接入 Settings.tsx**

在 `Settings.tsx`：
- import：`import KnowledgeBaseTab from './settings/KnowledgeBaseTab'`
- `SETTINGS_TABS` 在「飞书配置」之后插入 `{ id: 'knowledgeBase', label: '知识库' }`
- 渲染分支（在 `tab === 'feishu'` 之后）加：
```tsx
        {tab === 'knowledgeBase' && <KnowledgeBaseTab form={form} patch={patch} set={set} />}
```

- [ ] **Step 6: 扩 SettingsTabId**

`src/sidepanel/components/settings/types.ts`：
```ts
export type SettingsTabId = 'general' | 'ai' | 'feishu' | 'knowledgeBase' | 'backup' | 'appearance'
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/components/settings/KnowledgeBaseTab.test.tsx`
Expected: PASS（3/3）。

- [ ] **Step 8: gate**

Run: `npm run typecheck`
Expected: 0 错误。

---

## Task 4: KnowledgeBasePanel 改门禁 + 删除 ObsidianConnectForm + 透 onGoToSettings

**Files:**
- Modify: `src/sidepanel/components/KnowledgeBasePanel.tsx`、`src/sidepanel/components/KnowledgeBasePanel.test.tsx`、`src/sidepanel/components/ScenarioPanel.tsx`、`src/sidepanel/App.tsx`、`src/sidepanel/components/KnowledgeBasePanel.css`
- Delete: `src/sidepanel/components/ObsidianConnectForm.tsx`、`ObsidianConnectForm.css`、`ObsidianConnectForm.test.tsx`

**Interfaces:**
- Consumes: Task 5 将给 `ObsidianVaultView` 的 `onGoToSettings`（本任务先把 KnowledgeBasePanel 的 prop 名定为 `onGoToSettings`）。
- Produces: `KnowledgeBasePanel({ settings, onBack, onGoToSettings })`；disconnected 渲染 `data-testid="kb-gate"` + 「去设置完成配置」按钮（`onClick={onGoToSettings}`）；connected 仍渲染 `ObsidianVaultView`（传 `onGoToSettings`）。

- [ ] **Step 1: 改 KnowledgeBasePanel.test.tsx 为新行为**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'

const mockPing = vi.fn()
vi.mock('../../shared/obsidian/api', () => ({ pingObsidian: mockPing }))

const KnowledgeBasePanel = (await import('./KnowledgeBasePanel')).default

beforeEach(() => mockPing.mockReset())
afterEach(cleanup)

describe('KnowledgeBasePanel', () => {
  it('已连接 → vault 视图（kb-vault-view）', async () => {
    mockPing.mockResolvedValue({ ok: true, status: 200, authenticated: true, vault: 'MyVault' })
    render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} onGoToSettings={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('kb-vault-view')).toBeTruthy())
  })
  it('未连接 → 门禁（kb-gate）+ 去设置按钮', async () => {
    mockPing.mockResolvedValue({ ok: false, status: 0, authenticated: false })
    const go = vi.fn()
    render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} onGoToSettings={go} />)
    await waitFor(() => expect(screen.getByTestId('kb-gate')).toBeTruthy())
    fireEvent.click(screen.getByText('去设置完成配置'))
    expect(go).toHaveBeenCalled()
  })
  it('ping 期间显示 loading', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockPing.mockReturnValue(new Promise((r) => { resolve = r as (v: unknown) => void }))
    render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} onGoToSettings={() => {}} />)
    expect(screen.getByTestId('kb-loading')).toBeTruthy()
    resolve({ ok: true, status: 200, authenticated: true })
    await waitFor(() => expect(screen.queryByTestId('kb-loading')).toBeNull())
  })
  it('settings 引用变但 baseUrl 不变 → 不重新 ping', async () => {
    mockPing.mockResolvedValue({ ok: true, status: 200, authenticated: true, vault: 'V' })
    const { rerender } = render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} onGoToSettings={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('kb-vault-view')).toBeTruthy())
    expect(mockPing).toHaveBeenCalledTimes(1)
    rerender(<KnowledgeBasePanel settings={{ ...DEFAULT_SETTINGS, obsidianVaultName: 'Other' }} onBack={() => {}} onGoToSettings={() => {}} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(mockPing).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/sidepanel/components/KnowledgeBasePanel.test.tsx`
Expected: FAIL（props 不含 onGoToSettings / 无 kb-gate）。

- [ ] **Step 3: 改 KnowledgeBasePanel.tsx**

```tsx
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { pingObsidian } from '../../shared/obsidian/api'
import TopBar from './TopBar'
import ObsidianVaultView from './ObsidianVaultView'
import Button from './Button'
import './KnowledgeBasePanel.css'

interface Props {
  settings: AppSettings
  onBack: () => void
  /** 去设置页配置/改连接（Hub 内不再内联接入表单）。 */
  onGoToSettings: () => void
}

type Conn = 'loading' | 'connected' | 'disconnected'

/** 知识库面板外壳：ping → loading/connected/disconnected。
 *  connected → ObsidianVaultView；disconnected → 门禁空态（引导去设置），不再内联接入表单。 */
export default function KnowledgeBasePanel({ settings, onBack, onGoToSettings }: Props) {
  const [conn, setConn] = useState<Conn>('loading')
  const [vault, setVault] = useState<string | undefined>(settings.obsidianVaultName)

  // 仅当端点变化才重新探活（接入成功后 saveSettings 换引用但端点未变 → 不应重 ping）。
  const baseUrl = settings.obsidianBaseUrl
  useEffect(() => {
    let alive = true
    setConn('loading')
    pingObsidian(settings).then((p) => {
      if (!alive) return
      setVault(p.vault ?? settings.obsidianVaultName)
      setConn(p.ok && p.authenticated ? 'connected' : 'disconnected')
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl])

  return (
    <div className="scenario-panel view-enter" key="kb">
      <TopBar title="知识库" onBack={onBack} />
      <div className="kb-body">
        {conn === 'loading' && (
          <div className="kb-loading" data-testid="kb-loading">连接 Obsidian 中…</div>
        )}
        {conn === 'connected' && (
          <ObsidianVaultView
            settings={{ ...settings, obsidianVaultName: vault || settings.obsidianVaultName }}
            onGoToSettings={onGoToSettings}
          />
        )}
        {conn === 'disconnected' && (
          <div className="kb-gate" data-testid="kb-gate">
            <p className="kb-gate-msg">尚未连接 Obsidian 知识库。</p>
            <Button variant="primary" onClick={onGoToSettings}>去设置完成配置</Button>
          </div>
        )}
      </div>
    </div>
  )
}
```

KnowledgeBasePanel.css 追加门禁样式（保留既有 `.kb-body`/`.kb-loading`）：
```css
.kb-gate { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 48px 24px; text-align: center; }
.kb-gate-msg { color: var(--color-text-secondary); font-size: 13px; margin: 0; }
```

- [ ] **Step 4: ScenarioPanel 透 onGoToSettings（去 saveSettings）**

`src/sidepanel/components/ScenarioPanel.tsx`：
- Props 接口：删 `saveSettings?`，加 `onGoToSettings: () => void`。
- knowledgeBase 渲染分支（约 254 行）改为：
```tsx
  if (view.mode === 'knowledgeBase') {
    return <KnowledgeBasePanel settings={settings} onBack={() => setView({ mode: 'hub' })} onGoToSettings={onGoToSettings} />
  }
```

- [ ] **Step 5: App.tsx 调整 ScenarioPanel props（约 425 行）**

```tsx
                <ScenarioPanel settings={settings} context={ctx} disabled={!canOperate} onBusyChange={setScenarioBusy} recentFiles={recentFiles} onRemoveRecent={removeFromRecent} resolveWikiKind={resolveWikiKind} onGoToSettings={() => setTab('settings')} />
```
（删去 `saveSettings={saveSettings}`。确认 `App.tsx` 仍 import/保留 `saveSettings` 供其他用途——若仅此处用且不再需要，保留 useAppSettings 返回值即可，不删 hook。）

- [ ] **Step 6: 删除 ObsidianConnectForm 三件套**

删除 `src/sidepanel/components/ObsidianConnectForm.tsx`、`ObsidianConnectForm.css`、`ObsidianConnectForm.test.tsx`。
全仓 grep `ObsidianConnectForm` 确认无残留引用：`grep -r "ObsidianConnectForm" src`（应只剩已删文件，0 命中）。

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/components/KnowledgeBasePanel.test.tsx`
Expected: PASS（4/4）。

- [ ] **Step 8: gate**

Run: `npm run typecheck`
Expected: 0 错误（含 ScenarioPanel/App 的 props 改动）。

> ⚠️ 此任务后 `ObsidianVaultView` 的 prop 从 `onDisconnected` 改为 `onGoToSettings`（Task 5 实现），本任务的 typecheck 会因 `ObsidianVaultView` 仍用旧 prop 暂时报错——**Task 5 会修好**。若希望本任务自洽，可先在 Task 5 Step 1 之前临时给 `ObsidianVaultView` 加 `onGoToSettings?: () => void` 兼容，但推荐按 T1→T5 顺序执行、Task 5 完成后一并绿。执行者：本任务 Step 8 若仅剩 `ObsidianVaultView` prop 不匹配错误，记一笔继续 Task 5。

---

## Task 5: ObsidianVaultView 扁平化（TopBar 风顶栏 + SearchBox + drawer-row 列表）

**Files:**
- Modify: `src/sidepanel/components/ObsidianVaultView.tsx`、`src/sidepanel/components/ObsidianVaultView.css`、`src/sidepanel/components/ObsidianVaultView.test.tsx`
- Consumes: `SearchBox`（Task 2）、`IconSettings`（Task 1）。

**Interfaces:**
- Produces: `ObsidianVaultView({ settings, onGoToSettings })`（替换原 `onDisconnected`）。顶栏 = vault 名 + 「设置」齿轮（`IconSettings`，`onClick={onGoToSettings}`），**不**再加第二层 `TopBar`（外层 KnowledgeBasePanel 已有 TopBar）；搜索用 `<SearchBox>`；列表行用 `.kb-row` 扁平风。

- [ ] **Step 1: 改 ObsidianVaultView.test.tsx 关键断言**

把既有用例里对 `onDisconnected` 的引用改为 `onGoToSettings`，并断言顶栏齿轮按钮与 SearchBox 存在。最小新增用例：
```tsx
it('顶栏有设置齿轮，点击触发 onGoToSettings', async () => {
  // mock recentNotes 为 []，ping 由 KnowledgeBasePanel 负责；本组件直接渲染
  vi.mocked(recentNotes).mockResolvedValue([])
  const go = vi.fn()
  render(<ObsidianVaultView settings={{ ...DEFAULT_SETTINGS, obsidianVaultName: 'V' }} onGoToSettings={go} />)
  await waitFor(() => expect(screen.getByTestId('kb-vault-view')).toBeTruthy())
  fireEvent.click(screen.getByLabelText('设置'))
  expect(go).toHaveBeenCalled()
})
it('SearchBox 输入 + Enter → searchVault', async () => {
  vi.mocked(recentNotes).mockResolvedValue([])
  vi.mocked(searchVault).mockResolvedValue([{ path: 'a.md', score: 1, snippet: 's' }])
  render(<ObsidianVaultView settings={{ ...DEFAULT_SETTINGS }} onGoToSettings={() => {}} />)
  await waitFor(() => expect(screen.getByTestId('kb-vault-view')).toBeTruthy())
  const input = screen.getByPlaceholderText(/搜索笔记/)
  fireEvent.change(input, { target: { value: 'kw' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(searchVault).toHaveBeenCalledWith(expect.anything(), 'kw'))
})
```
（`recentNotes`/`searchVault` 用 `vi.mock('../../shared/obsidian/api', () => ({ recentNotes: vi.fn(), searchVault: vi.fn() }))` + `vi.mocked`；其余既有用例同步把 `onDisconnected`→`onGoToSettings`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/sidepanel/components/ObsidianVaultView.test.tsx`
Expected: FAIL（`onDisconnected` 不再存在 / 齿轮未渲染）。

- [ ] **Step 3: 改 ObsidianVaultView.tsx**

替换顶栏与搜索块、列表行 className；props 改 `onGoToSettings`。完整新文件：

```tsx
import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { recentNotes, searchVault, type ObsidianNoteRow } from '../../shared/obsidian/api'
import Tooltip from './Tooltip'
import SearchBox from './SearchBox'
import ObsidianNoteDetail from './ObsidianNoteDetail'
import { IconSettings } from './icons'
import './ObsidianVaultView.css'

interface Props {
  settings: AppSettings
  onGoToSettings: () => void
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

/** 已连接态：扁平顶栏（vault 名 + 设置齿轮）+ SearchBox + 最近/搜索 tab + 扁平行列表。
 *  齿轮去设置页改连接（不在本页内联接入表单）。 */
export default function ObsidianVaultView({ settings, onGoToSettings }: Props) {
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
      <div className="kb-vault-head">
        <span className="kb-vault-name">{settings.obsidianVaultName || 'Obsidian'}</span>
        <Tooltip content="连接设置" position="bottom">
          <button className="kb-head-btn" onClick={onGoToSettings} type="button" aria-label="设置"><IconSettings /></button>
        </Tooltip>
      </div>

      <SearchBox value={query} onChange={setQuery} onSearch={runSearch} placeholder="搜索笔记…  (Ctrl+K)" inputRef={searchInput} />

      <div className="kb-tabs">
        <button className={`kb-tab${tab === 'recent' ? ' kb-tab--active' : ''}`} onClick={() => { setTab('recent'); loadRecent() }} type="button">最近</button>
        <button className={`kb-tab${tab === 'search' ? ' kb-tab--active' : ''}`} onClick={() => setTab('search')} type="button">搜索</button>
      </div>

      {error && <div className="kb-error">{error}</div>}
      {loading && <div className="kb-muted">载入中…</div>}
      {!loading && !error && rows.length === 0 && <div className="kb-muted">{tab === 'search' ? '无匹配笔记' : '仓库为空'}</div>}

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

      <button className="kb-new" type="button" onClick={() => setCreating(true)}>新建笔记</button>
    </div>
  )
}
```

- [ ] **Step 4: 重写 ObsidianVaultView.css 为扁平风**

```css
.kb-vault { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.kb-vault-head { display: flex; align-items: center; justify-content: space-between; }
.kb-vault-name { font-size: 14px; font-weight: 600; color: var(--color-text); }
.kb-head-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; background: transparent; color: var(--color-text-secondary); border-radius: var(--radius-sm); cursor: pointer; }
.kb-head-btn:hover { color: var(--color-primary); background: var(--color-primary-soft); }
.kb-head-btn svg { width: 16px; height: 16px; }

.kb-tabs { display: flex; gap: 4px; }
.kb-tab { background: none; border: none; color: var(--color-text-secondary); font-size: 12px; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer; }
.kb-tab:hover { background: var(--color-surface); }
.kb-tab--active { color: var(--color-primary); background: var(--color-primary-soft); }

.kb-error { color: var(--color-warning-strong); font-size: 12px; }
.kb-muted { color: var(--color-text-secondary); font-size: 12px; padding: 16px 4px; text-align: center; }

/* 扁平列表行（对齐 .drawer-row：透明边、hover 浅底、active primary-soft） */
.kb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.kb-row { display: flex; flex-direction: column; gap: 1px; width: 100%; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: var(--radius-sm); background: none; cursor: pointer; }
.kb-row:hover { background: var(--color-surface); }
.kb-row:active { background: var(--color-primary-soft); }
.kb-row-title { font-size: 12.5px; font-weight: 600; color: var(--color-text); }
.kb-row-path, .kb-row-snip, .kb-row-time { font-size: 10.5px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.kb-new { align-self: flex-start; background: none; border: 1px solid var(--color-border); color: var(--color-text); font-size: 12px; padding: 6px 12px; border-radius: var(--radius); cursor: pointer; margin-top: 4px; }
.kb-new:hover { border-color: var(--color-primary); color: var(--color-primary); }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/components/ObsidianVaultView.test.tsx`
Expected: PASS。

- [ ] **Step 6: gate**

Run: `npm run typecheck`
Expected: 0 错误（此时 Task 4 遗留的 `ObsidianVaultView` prop 错误应已消除）。

---

## Task 6: ObsidianNoteDetail 扁平顶栏（TopBar + IconEdit/IconTrash）

**Files:**
- Modify: `src/sidepanel/components/ObsidianNoteDetail.tsx`、`src/sidepanel/components/ObsidianNoteDetail.css`、`src/sidepanel/components/ObsidianNoteDetail.test.tsx`
- Consumes: `TopBar`、`IconEdit`、`IconTrash`（既有 + Task 1）。

**Interfaces:**
- 不变 props：`{ settings, path: string | null, onClose, onDeleted }`。
- 头部由 `.kb-detail-head` + 描边 `.kb-icon-btn` 改为 `<TopBar title={isNew?'新建笔记':path} onBack={onClose} rightAction={…} />`；编辑/删除按钮用 `IconEdit`/`IconTrash`。

- [ ] **Step 1: 调整 ObsidianNoteDetail.test.tsx**

既有用例把 `screen.getByLabelText('返回')` / 编辑/删除的可达性断言保留；新增确认顶栏使用 TopBar（返回键存在 + 居左）。关键：编辑按钮 `aria-label="编辑"`、删除 `aria-label="删除"` 仍可达（现在由 IconEdit/IconTrash 渲染）。示例补充：
```tsx
it('查看态有编辑 + 删除（图标按钮），点击编辑进入编辑态', async () => {
  vi.mocked(readNote).mockResolvedValue('# hi')
  render(<ObsidianNoteDetail settings={{ ...DEFAULT_SETTINGS }} path="a/b.md" onClose={() => {}} onDeleted={() => {}} />)
  await waitFor(() => expect(vi.mocked(readNote)).toHaveBeenCalled())
  fireEvent.click(screen.getByLabelText('编辑'))
  expect(screen.getByTestId('kb-editor')).toBeTruthy()
})
it('删除走 confirm → deleteNote', async () => {
  vi.mocked(readNote).mockResolvedValue('# hi')
  vi.mocked(deleteNote).mockResolvedValue(undefined)
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const onDeleted = vi.fn()
  render(<ObsidianNoteDetail settings={{ ...DEFAULT_SETTINGS }} path="a/b.md" onClose={() => {}} onDeleted={onDeleted} />)
  await waitFor(() => expect(vi.mocked(readNote)).toHaveBeenCalled())
  fireEvent.click(screen.getByLabelText('删除'))
  await waitFor(() => expect(deleteNote).toHaveBeenCalled())
  expect(onDeleted).toHaveBeenCalled()
  confirmSpy.mockRestore()
})
```

- [ ] **Step 2: 跑测试确认失败/通过基线**

Run: `npx vitest run src/sidepanel/components/ObsidianNoteDetail.test.tsx`
（若既有用例已覆盖编辑/删除 aria-label，应仍绿；本步主要是确认重构后不断。）

- [ ] **Step 3: 改 ObsidianNoteDetail.tsx 头部**

替换 `.kb-detail-head` 块（保留 save/remove 函数体不变）：

```tsx
import TopBar from './TopBar'
import { IconEdit, IconTrash } from './icons'
```
（文件顶部 import 区追加；移除原内联返回/编辑/删除 SVG。）

把 return 里的头部替换为：
```tsx
  return (
    <div className="kb-detail" data-testid="kb-note-detail">
      <TopBar
        title={isNew ? '新建笔记' : path}
        onBack={onClose}
        rightAction={
          !isNew ? (
            <div className="kb-detail-actions">
              {mode === 'view' && (
                <button className="kb-head-btn" onClick={() => setMode('edit')} type="button" aria-label="编辑"><IconEdit /></button>
              )}
              <button className="kb-head-btn" onClick={remove} type="button" aria-label="删除" disabled={saving}><IconTrash /></button>
            </div>
          ) : undefined
        }
      />

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
```
（save/remove 函数体、`useEffect` 读笔记、inbox 落点逻辑——保持现状，不动。）

- [ ] **Step 4: ObsidianNoteDetail.css 调整**

删 `.kb-detail-head` / `.kb-icon-btn` / `.kb-detail-actions` 旧定位；新增/保留：
```css
.kb-detail { display: flex; flex-direction: column; height: 100%; }
.kb-detail-actions { display: flex; gap: 2px; }
.kb-head-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; background: transparent; color: var(--color-text-secondary); border-radius: var(--radius-sm); cursor: pointer; }
.kb-head-btn:hover:not(:disabled) { color: var(--color-primary); background: var(--color-primary-soft); }
.kb-head-btn svg { width: 16px; height: 16px; }
.kb-head-btn:disabled { opacity: .5; cursor: not-allowed; }
.kb-detail-body, .kb-detail-edit { padding: 12px; overflow: auto; }
.kb-editor { width: 100%; min-height: 240px; resize: vertical; font-family: var(--font-mono, monospace); font-size: 12.5px; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius); }
.kb-detail-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.kb-save { background: var(--color-primary); color: #fff; border: none; padding: 6px 16px; border-radius: var(--radius); cursor: pointer; font-size: 12px; }
.kb-save:disabled { opacity: .6; cursor: not-allowed; }
.kb-link-btn { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: 12px; }
.kb-error { color: var(--color-warning-strong); font-size: 12px; }
.kb-muted { color: var(--color-text-secondary); font-size: 12px; }
.kb-title-input { margin-bottom: 8px; }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/components/ObsidianNoteDetail.test.tsx`
Expected: PASS。

- [ ] **Step 6: gate**

Run: `npm run typecheck`
Expected: 0 错误。

---

## Task 7: SessionDrawer 采用 SearchBox

**Files:**
- Modify: `src/sidepanel/components/SessionDrawer.tsx`（约 116-136 的 `.drawer-search` 块）、`src/sidepanel/components/SessionDrawer.css`（可留旧 class，无害）
- Consumes: `SearchBox`（Task 2）。

**Interfaces:**
- SessionDrawer 现有搜索态为 `query`/`setQuery`（`onChange={(e)=>setQuery(e.target.value)}`、清除 `setQuery('')`）。

- [ ] **Step 1: 写测试（若 SessionDrawer 已有测试则补一条；否则跳过本步，仅做替换 + 手测）**

若 `SessionDrawer.test.tsx` 存在：确认搜索输入仍可达（`screen.getByPlaceholderText(/搜索会话/)`）、输入触发过滤。本任务以"替换不破坏"为验收。

- [ ] **Step 2: 替换 `.drawer-search` 块**

`src/sidepanel/components/SessionDrawer.tsx`：
顶部 import 加 `import SearchBox from './SearchBox'`。
把约 116-136 的整块 `<div className="drawer-search">…</div>` 替换为：
```tsx
      <div className="drawer-search-wrap">
        <SearchBox
          value={query}
          onChange={(v) => setQuery(v)}
          placeholder="搜索会话标题或内容"
        />
      </div>
```
（`.drawer-search-wrap` 仅作外层间距；`SessionDrawer.css` 给它 `margin: 8px 10px 4px;`。原 `.drawer-search*` 样式可保留不删，无害。）

- [ ] **Step 3: 跑相关测试**

Run: `npx vitest run src/sidepanel/components/SessionDrawer.test.tsx`
Expected: PASS（若无测试文件则跳过）。

- [ ] **Step 4: gate**

Run: `npm run typecheck`
Expected: 0 错误。

---

## Task 8: session.kbEnabled + useSessions.setKbEnabled

**Files:**
- Modify: `src/shared/types.ts`（`SessionMeta`）、`src/sidepanel/sessions/useSessions.ts`（`SessionsApi` + setter）
- Test: `src/sidepanel/sessions/useSessions.test.ts`（既有则补；否则新建一条）或并入既有测试。

**Interfaces:**
- Produces: `SessionMeta.kbEnabled?: boolean`；`SessionsApi.setKbEnabled(id: string, on: boolean): void`。
- 加性可选字段，旧存储无该键 → undefined（视为 false），**无需 schema 迁移**。

- [ ] **Step 1: 写失败测试**

在既有 `useSessions` 测试文件（若存在）追加；否则新建 `src/sidepanel/sessions/useSessions.kb.test.ts`：
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessions } from './useSessions'

vi.mock('./store', () => ({
  loadIndex: vi.fn().mockResolvedValue(null),
  saveIndex: vi.fn().mockResolvedValue(undefined),
  loadMessages: vi.fn().mockResolvedValue([]),
  saveMessages: vi.fn().mockResolvedValue(undefined),
  removeMessages: vi.fn().mockResolvedValue(undefined),
}))

describe('useSessions.setKbEnabled', () => {
  beforeEach(() => vi.clearAllMocks())
  it('切换 active 会话的 kbEnabled 并落到 meta', async () => {
    const { result } = renderHook(() => useSessions(null, false))
    await act(() => new Promise((r) => setTimeout(r, 0))) // 等 initial load
    const id = result.current.activeSession?.id
    expect(id).toBeTruthy()
    act(() => result.current.setKbEnabled(id!, true))
    expect(result.current.activeSession?.kbEnabled).toBe(true)
    act(() => result.current.setKbEnabled(id!, false))
    expect(result.current.activeSession?.kbEnabled).toBe(false)
  })
})
```
（若 store mock 形态与既有测试不同，照既有测试的 mock 形态对齐。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/sidepanel/sessions`
Expected: FAIL（`setKbEnabled` 不存在）。

- [ ] **Step 3: types.ts 加字段**

`src/shared/types.ts` 的 `SessionMeta`（约 149 行 `preview?` 之后）加：
```ts
  /** 本会话是否启用知识库（chat 工具开关）。缺省 false（旧会话无此键）。 */
  kbEnabled?: boolean
```

- [ ] **Step 4: useSessions.ts 加 setter**

`SessionsApi` 接口（约 42 行 `stampKind` 之后）加：
```ts
  /** Toggle knowledge-base tools for a session (chat 工具下拉的「知识库」开关). */
  setKbEnabled: (sessionId: string, on: boolean) => void
```
在 `stampKind` 的 `useCallback`（约 294 行）之后、`const activeSession = …`（约 298 行）之前加：
```ts
  const setKbEnabled = useCallback((sessionId: string, on: boolean) => {
    const idx = indexRef.current
    persistIndex({
      ...idx,
      sessions: idx.sessions.map((s) => (s.id === sessionId ? { ...s, kbEnabled: on } : s)),
    })
  }, [persistIndex])
```
在 return 对象（约 301-303 行）加 `setKbEnabled`：
```ts
  return {
    ready, index, activeSession, messages,
    setMessages, setMessagesFor, switchTo, createSession, removeSession, removeSessionsByAppToken, renameSession, rebindSession, resolveTitle, stampKind, setKbEnabled,
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/sessions`
Expected: PASS。

- [ ] **Step 6: gate**

Run: `npm run typecheck`
Expected: 0 错误。

---

## Task 9: agent 只读 KB 接线（tools + toolsForContext + executeTool + buildSystemPrompt + runAgent）

**Files:**
- Modify: `src/shared/ai/tools.ts`、`src/shared/ai/agent.ts`、`src/shared/ai/agent.test.ts`
- Consumes: `searchVault(settings, query)`、`readNote(settings, path)`（`../obsidian/api`，既有）、`HAS_KNOWLEDGE_BASE`（`../config`）。
- 关键约束：`runAgent` 有 **4 个调用点**（ChatPanel:196、ClipPanel:212、harness/driver.ts:70、agent.test.ts:331、agent.dedup.test.ts:104/122）。**只加尾参 `kbEnabled?: boolean`**（位于 `signal?` 之后），其余调用点不传 → undefined → KB 关闭，零改动。

**Interfaces:**
- Produces:
  - `KNOWLEDGE_TOOLS: ChatCompletionTool[]`（`search_knowledge_base`、`read_knowledge_note`）。
  - `toolsForContext(kind, opts?: { kbEnabled?: boolean }): ChatCompletionTool[]`（kbEnabled && HAS_KNOWLEDGE_BASE 时追加 `KNOWLEDGE_TOOLS`）。
  - `executeTool` 新增两分支（返回 string；错误也返回 `Error: …` 字符串，与 `render_data_app` 一致）。
  - `buildSystemPrompt(ctx, s, baseCtx?, kbEnabled?): string`（第 4 参；动态尾部追加 KB 段，**不动静态前缀**）。
  - `runAgent(history, settings, context, callbacks, baseCtx?, signal?, kbEnabled?): Promise<void>`。

- [ ] **Step 1: 写失败测试（agent.test.ts 追加）**

```ts
import { toolsForContext, executeTool, buildSystemPrompt } from './agent'
import { DEFAULT_SETTINGS } from '../types'

describe('知识库只读工具', () => {
  it('toolsForContext：kbEnabled 关时不带 KB 工具；开时带两个', () => {
    const off = toolsForContext('doc').map((t) => t.function.name)
    expect(off).not.toContain('search_knowledge_base')
    const on = toolsForContext('doc', { kbEnabled: true }).map((t) => t.function.name)
    if (HAS_KNOWLEDGE_BASE) {
      expect(on).toContain('search_knowledge_base')
      expect(on).toContain('read_knowledge_note')
    } else {
      expect(on).not.toContain('search_knowledge_base') // 商店构建关
    }
  })
  it('executeTool search_knowledge_base → 调 searchVault', async () => {
    const mockSearch = vi.fn().mockResolvedValue([{ path: 'a.md', score: 1 }])
    vi.doMock('../obsidian/api', () => ({ searchVault: mockSearch, readNote: vi.fn() }))
    const { executeTool } = await import('./agent')
    const out = await executeTool('search_knowledge_base', { query: 'kw' }, 'tok', {} as never, { ...DEFAULT_SETTINGS })
    expect(mockSearch).toHaveBeenCalled()
    expect(String(out)).toContain('a.md')
  })
  it('buildSystemPrompt：kbEnabled 时含知识库段', () => {
    const p = buildSystemPrompt({} as never, { ...DEFAULT_SETTINGS }, undefined, true)
    if (HAS_KNOWLEDGE_BASE) expect(p).toContain('知识库')
  })
})
```
（顶部需 `import { HAS_KNOWLEDGE_BASE } from '../config'`、`import { vi } from 'vitest'`；按既有 agent.test.ts 的 mock 风格调整 `vi.doMock`/`vi.mock` —— 若 agent.test.ts 已在顶层 mock `'./tools'` 或 `'../obsidian/api'`，沿用其既有方式，避免冲突。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/agent.test.ts`
Expected: FAIL（opts 不支持 / 分支不存在 / 第 4 参不存在）。

- [ ] **Step 3: tools.ts 加 KNOWLEDGE_TOOLS**

在 `FEISHU_TOOLS` 数组之后追加：
```ts
/** 只读知识库工具（chat 会话开启「知识库」时注入）。写入工具留后续计划。 */
export const KNOWLEDGE_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        '在用户已连接的 Obsidian 知识库中全文检索笔记。返回匹配笔记的路径与片段（非整篇）。' +
        '用户问及个人笔记/知识库/过往记录时调用；引用时注明笔记路径。',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: '检索关键词或短语' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_knowledge_note',
      description:
        '读取 Obsidian 知识库中指定路径笔记的完整正文（Markdown）。' +
        '先用 search_knowledge_base 拿到路径，再按需读全文。大笔记会被截断。',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'vault 内相对路径，如 "Inbox/想法.md"' },
        },
      },
    },
  },
]
```

- [ ] **Step 4: agent.ts 改 toolsForContext**

顶部 import 追加：
```ts
import { HAS_KNOWLEDGE_BASE } from '../config'
import { searchVault, readNote } from '../obsidian/api'
```
（确认 `import { FEISHU_TOOLS } from './tools'` 改为 `import { FEISHU_TOOLS, KNOWLEDGE_TOOLS } from './tools'`。）
把 `toolsForContext`（约 260 行）改为：
```ts
export function toolsForContext(kind: string | undefined, opts?: { kbEnabled?: boolean }): ChatCompletionTool[] {
  const base = FEISHU_TOOLS.filter((t) => {
    const name = (t as { function?: { name?: string } }).function?.name ?? ''
    if (CORE_TOOLS.has(name)) return true
    if (kind === 'sheet') return SHEET_TOOLS.has(name)
    if (kind === 'doc') return DOC_TOOLS.has(name)
    if (kind === 'base') return !SHEET_TOOLS.has(name) && !DOC_TOOLS.has(name)
    return false
  })
  if (opts?.kbEnabled && HAS_KNOWLEDGE_BASE) return [...base, ...KNOWLEDGE_TOOLS]
  return base
}
```
注意返回类型从 `typeof FEISHU_TOOLS` 变为 `ChatCompletionTool[]` —— 顶部需 `import type { ChatCompletionTool } from 'openai/resources'`（tools.ts 已有该类型；agent.ts 若无则补 import type）。

把 `runAgent` 内 `tools: toolsForContext(context.feishu?.kind)`（约 390 行）改为：
```ts
      tools: toolsForContext(context.feishu?.kind, { kbEnabled }),
```

- [ ] **Step 5: agent.ts 改 executeTool（加两分支）**

在 `executeTool` 的 `if (isFileLevelDelete(...)) throw …`（约 812 行）之后、`if (name === 'feishu_api_call')`（约 819 行）之前插入：
```ts
  // 知识库（只读）——chat 会话开启「知识库」时可用。错误以字符串返回（与 render_data_app 一致）。
  if (name === 'search_knowledge_base') {
    if (!settings) return 'Error: 缺少配置。'
    try {
      const rows = await searchVault(settings, String(args.query ?? ''))
      return JSON.stringify(rows)
    } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (name === 'read_knowledge_note') {
    if (!settings) return 'Error: 缺少配置。'
    try {
      return await readNote(settings, String(args.path ?? ''))
    } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}` }
  }
```

- [ ] **Step 6: agent.ts 改 buildSystemPrompt + runAgent 签名**

`buildSystemPrompt`（约 1637 行）签名加第 4 参，并在动态尾部插 KB 段：
```ts
export function buildSystemPrompt(ctx: PageContext, s: AppSettings, baseCtx?: BaseCtx, kbEnabled?: boolean): string {
```
在函数内 `selectedBlock` 之后加：
```ts
  const kbBlock = kbEnabled && HAS_KNOWLEDGE_BASE
    ? `\n\n## 知识库（本会话已启用）\n用户已连接 Obsidian 仓库。需要时用 \`search_knowledge_base(query)\` 检索笔记、\`read_knowledge_note(path)\` 读全文；引用时注明笔记路径。本会话**未开启写入**——不能新建/修改/删除笔记。检索不到就如实说明，不要编造笔记内容。`
    : ''
```
在 `return \`# 角色定义 …\`` 模板里，紧挨 `${structureBlock}${selectedBlock}` 处追加 `${kbBlock}`（实现者：在模板中定位 `selectedBlock` 的插值位置，把 `${kbBlock}` 并列其后；**不得**插进静态前缀）。

`runAgent` 签名（约 271 行）加尾参：
```ts
export async function runAgent(
  history: ChatMessage[],
  settings: AppSettings,
  context: PageContext,
  callbacks: AgentCallbacks,
  baseCtx?: BaseCtx,
  signal?: AbortSignal,
  /** 本会话是否启用知识库（chat 工具开关）。仅 ChatPanel 传入；其余调用点不传 → KB 关闭。 */
  kbEnabled?: boolean,
): Promise<void> {
```
把 `let systemPrompt = buildSystemPrompt(context, settings, baseCtx)`（约 311 行）改为：
```ts
  let systemPrompt = buildSystemPrompt(context, settings, baseCtx, kbEnabled)
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/agent.test.ts src/shared/ai/agent.dedup.test.ts`
Expected: PASS（既有用例 + 新增 KB 用例；dedup 测试不传 kbEnabled 仍正常）。

- [ ] **Step 8: gate**

Run: `npm run typecheck`
Expected: 0 错误（runAgent 尾参可选，ClipPanel/driver/tests 不受影响）。

---

## Task 10: InputBar「工具」下拉加「知识库」开关行

**Files:**
- Modify: `src/sidepanel/components/InputBar.tsx`、`src/sidepanel/components/InputBar.css`、`src/sidepanel/components/InputBar.test.tsx`（若有）
- Consumes: `FormSwitch`（`./form/FormSwitch`）、`HAS_KNOWLEDGE_BASE`（`../../shared/config`）。

**Interfaces:**
- Props 加：`kbEnabled: boolean`、`onToggleKb: (on: boolean) => void`。
- 「Tools」按钮 disabled 改为：`blocked || (!HAS_KNOWLEDGE_BASE && skills.length === 0)`（KB 可用即可点开，修掉"本地无技能→点不开"）。
- 下拉顶部加一行「知识库」开关（`HAS_KNOWLEDGE_BASE` 时），下方保留技能列表。

- [ ] **Step 1: 写失败测试（InputBar.test.tsx 若无则新建）**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InputBar from './InputBar'

vi.mock('../../shared/ai/skills', () => ({ preloadSkills: () => Promise.resolve([]) }))

describe('InputBar 知识库开关', () => {
  it('HAS_KNOWLEDGE_BASE 且无技能时仍可点开下拉，显示知识库开关', () => {
    render(<InputBar onSend={() => {}} disabled={false} kbEnabled={false} onToggleKb={() => {}} resourceKind="general" />)
    fireEvent.click(screen.getByText('Tools'))
    expect(screen.getByText('知识库')).toBeTruthy()
  })
  it('点击开关触发 onToggleKb(true)', () => {
    const toggle = vi.fn()
    render(<InputBar onSend={() => {}} disabled={false} kbEnabled={false} onToggleKb={toggle} resourceKind="general" />)
    fireEvent.click(screen.getByText('Tools'))
    fireEvent.click(screen.getByRole('switch'))
    expect(toggle).toHaveBeenCalledWith(true)
  })
})
```
（若 InputBar 用 forwardRef + 需要某些必有 props，按既有签名补齐；`HAS_KNOWLEDGE_BASE` 默认开，测试环境为 true。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/sidepanel/components/InputBar.test.tsx`
Expected: FAIL（无 kbEnabled prop / 无知识库行 / 按钮 disabled）。

- [ ] **Step 3: 改 InputBar.tsx**

顶部 import：
```ts
import { HAS_KNOWLEDGE_BASE } from '../../shared/config'
import { FormSwitch } from './form/FormSwitch'
```
`Props` 接口（约 20-40 行）加：
```ts
  /** 本会话知识库开关态（来自 active session.kbEnabled）。 */
  kbEnabled: boolean
  /** 切换本会话知识库。 */
  onToggleKb: (on: boolean) => void
```
函数参数解构（约 43 行）加 `kbEnabled, onToggleKb`。

「Tools」按钮 disabled（约 302 行）改为：
```ts
                  disabled={blocked || (!HAS_KNOWLEDGE_BASE && skills.length === 0)}
```
Tooltip 文案改：`content={HAS_KNOWLEDGE_BASE ? '工具 / 知识库' : (skills.length ? '技能建议' : '暂无可用技能')}`。

下拉内容（约 312-328 行的 `{skillsOpen && (<div className="tools-menu">…</div>)}`）改为：
```tsx
              {skillsOpen && (
                <div className="tools-menu">
                  {HAS_KNOWLEDGE_BASE && (
                    <div className="tools-menu-item tools-menu-item--toggle">
                      <FormSwitch checked={kbEnabled} onChange={onToggleKb}>
                        <span className="tools-menu-title">知识库</span>
                      </FormSwitch>
                    </div>
                  )}
                  {HAS_KNOWLEDGE_BASE && skills.length > 0 && <div className="tools-menu-divider" />}
                  {skills.slice(0, 6).map((s) => (
                    <button
                      key={s.skillId}
                      className="tools-menu-item"
                      onClick={() => { insert(s.lesson || s.intent); setSkillsOpen(false) }}
                      type="button"
                    >
                      <span className="tools-menu-title">{s.intent}</span>
                      {s.lesson && s.lesson !== s.intent && (
                        <span className="tools-menu-desc">{s.lesson}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
```

> 注：`FormSwitch` 的 `children` 渲染在开关旁（见 `FormSwitch.tsx`：`{children}` 在 switch 之后）。若其布局把「知识库」文字放在开关右侧不够美观，可在 InputBar.css 微调 `.tools-menu-item--toggle` 对齐。开关语义为本会话 KB。

- [ ] **Step 4: InputBar.css 补分隔/对齐**

```css
.tools-menu-divider { height: 1px; background: var(--color-border); margin: 4px 0; }
.tools-menu-item--toggle { display: flex; align-items: center; }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/components/InputBar.test.tsx`
Expected: PASS。

- [ ] **Step 6: gate**

Run: `npm run typecheck`
Expected: 0 错误。

---

## Task 11: ChatPanel / App 接线（kbEnabled + onToggleKb → InputBar；runAgent 传 kbEnabled）

**Files:**
- Modify: `src/sidepanel/components/ChatPanel.tsx`、`src/sidepanel/App.tsx`、（视需要）`ChatPanel.test.tsx`
- Consumes: Task 8 `sessions.setKbEnabled` + `activeSession.kbEnabled`；Task 9 `runAgent(…, kbEnabled)`；Task 10 InputBar 新 props。

**Interfaces:**
- App 给 ChatPanel 传 `kbEnabled={sessions.activeSession?.kbEnabled === true}` 与 `onToggleKb={(on) => { const id = sessions.activeSession?.id; if (id) sessions.setKbEnabled(id, on) }}`。
- ChatPanel 透传给 `<InputBar … kbEnabled onToggleKb />`；并在 `runAgentTurn` 的 `runAgent(…)` 调用末尾加 `kbEnabled`（第 7 参，紧随 `ac.signal`）。

- [ ] **Step 1: 改 ChatPanel.tsx**

`Props` 接口加：
```ts
  kbEnabled: boolean
  onToggleKb: (on: boolean) => void
```
解构加 `kbEnabled, onToggleKb`。
在 `runAgentTurn`（约 169-273 行）里，把 `runAgent(history, settings, context, { …callbacks… }, …, ac.signal)`（约 196 行的调用）末尾补 `kbEnabled`：
```ts
      await runAgent(history, settings, context, {
        // …既有 callbacks…
      }, /* baseCtx */ undefined, ac.signal, kbEnabled)
```
（实现者：先 Read `ChatPanel.tsx:190-205` 看清既有 runAgent 调用的参数顺序与 baseCtx 实参，确保 `kbEnabled` 作为第 7 参、`ac.signal` 仍为第 6 参。）
在 `<InputBar … />`（约 451-462 行）加：
```tsx
    <InputBar
      // …既有 props…
      kbEnabled={kbEnabled}
      onToggleKb={onToggleKb}
    />
```

- [ ] **Step 2: 改 App.tsx**

`<ChatPanel … />`（约 398-423 行）加：
```tsx
                  kbEnabled={sessions.activeSession?.kbEnabled === true}
                  onToggleKb={(on: boolean) => {
                    const id = sessions.activeSession?.id
                    if (id) sessions.setKbEnabled(id, on)
                  }}
```

- [ ] **Step 3: 跑相关测试**

Run: `npx vitest run src/sidepanel/components/ChatPanel.test.tsx`
（若有 ChatPanel 测试，确认未因新增 prop 报错；无则跳过。）

- [ ] **Step 4: gate**

Run: `npm run typecheck`
Expected: 0 错误。

---

## Task 12: 全量门 + 安全文档 + 交付真机验收

**Files:**
- Modify: `CLAUDE.md`（约束 #4）、`SECURITY_AUDIT.md`
- 验证：全量 `npm test` + `npm run build`。

- [ ] **Step 1: 全量门**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck 0 / 全量测试全绿 / build 成功（偶发 TLS 报错→重试）。

- [ ] **Step 2: 补安全文档（Plan 1 遗留 TODO）**

`CLAUDE.md` 约束 #4 与 `SECURITY_AUDIT.md`：把出站从两组改为**三组**——飞书（`feishuReq`/`feishuFetch` + `isFeishuOutboundAllowed`）/ LLM（`assertSafeBaseUrl`）/ **Obsidian-loopback**（`obsidianFetch` + `isObsidianOutboundAllowed`：仅 loopback/私网 + Bearer token + `network.ts` CIDR 校验 + token AES-256-GCM 独立加密键 `_obsidian_token_v1`，物理上不达公网）。写清这是"为本地集成开的、仅 loopback 的口子"。

- [ ] **Step 3: 交付用户真机验收（不自动 commit）**

向用户报告：本计划 12 任务全部完成、全量门绿、安全文档已补。给出真机验收步骤：
1. `npm run dev:ui` →「应用」tab → 知识库（未连接）→ 门禁「去设置完成配置」→ 跳设置「知识库」tab。
2. 设置「知识库」tab：三步引导 + 填端点/API Key + 测试连接 →「已连接 · 〈vault〉」。
3. 回「应用 → 知识库」→ 扁平列表 + 搜索（Ctrl+K）+ 最近/搜索；点笔记 → 详情扁平顶栏 + 编辑/删除（图标）；新建笔记（按 inbox 落点）。
4. chat 输入框「Tools」→ 下拉「知识库」开关 → 开；问一个笔记相关的问题 → agent 调 `search_knowledge_base`/`read_knowledge_note` 并引用路径。
5. 关开关 → agent 不再带 KB 工具；重载扩展 → 开关态按会话保留。
6. 设置齿轮 → 回设置「知识库」tab；高级 inbox/exclude 改完保存 → 重载不丢。

全过 → 用户授权后**仅 commit 本计划文件**（不自动 push；不夹带并发 settings 会话的改动），沿用 trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

## Self-Review（plan ↔ spec 对照）

- **spec §A（设置 tab）** → Task 3 ✅（FeishuSteps + FormField/FormInput + 测试连接 + 即时存 Key + patch 批量）。
- **spec §B（Hub 门禁）** → Task 4 ✅（disconnected→kb-gate + onGoToSettings；删 ObsidianConnectForm）。
- **spec §C（列表扁平）** → Task 5 ✅（顶栏齿轮→onGoToSettings、SearchBox、drawer-row 风）。
- **spec §D（详情扁平 + 图标复用）** → Task 6 ✅（TopBar + IconEdit/IconTrash）。
- **spec §E（公共 SearchBox）** → Task 2 ✅（组件）+ Task 5/7 ✅（采用）。
- **spec §F（图标收口）** → Task 1 ✅（+IconSearch/IconSettings/IconChevronLeft）+ Task 5/6 ✅（import 化）。
- **spec §G（chat 开关 + 只读接线）** → Task 8（session.kbEnabled）+ Task 9（agent 只读）+ Task 10（InputBar 开关）+ Task 11（wiring）✅。
- **判断点 ①②③④** → ① Task 3 新 tab；② Task 3 即时存 Key + 批量；③ Task 5 drawer-row；④ Task 10 保留向上 .tools-menu ✅。
- **不做** → 写工具未出现（仅 search/read）✅；.sc-search 未动（Task 7 仅 SessionDrawer）✅。
- **类型一致** → `onGoToSettings`（Task 4/5 一致）、`setKbEnabled(id, on)`（Task 8/11 一致）、`runAgent(…, kbEnabled)` 第 7 参（Task 9/11 一致）、`toolsForContext(kind, opts)`（Task 9 test + 调用一致）✅。
- **placeholder 扫描** → 无 TBD/TODO（Step 文字均为可执行命令 + 完整代码）；少数"实现者先 Read X 行"为定位指引（非占位），已给具体行号。
