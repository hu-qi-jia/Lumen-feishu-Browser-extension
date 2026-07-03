# PDF 转写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an App Hub「PDF 转写」panel that turns a PDF into Markdown locally (pdf2md), optionally cleans it with a text-only LLM, then lets the user copy / export `.md` / append to a Feishu doc.

**Architecture:** A thin new panel orchestrates three small, independently-tested modules — a pdf2md wrapper (`pdfExtract.ts`), a text-LLM polish wrapper (`mdPolish.ts`), and a doc-link parser (`parseDocRef.ts`) — and reuses the existing docx.ts block pipeline (`markdownToBlocks` + `insertContentBlocks` + `listBlocks`) to append into a Feishu doc. No backend, no new egress, no Python.

**Tech Stack:** React 18 + TS + Vite + vitest; `@opendocsg/pdf2md` (MIT, pdf.js-based); existing `openai` SDK + `resolveLlmConfig`/`assertSafeBaseUrl`; existing `feishuReq`-based docx helpers.

## Global Constraints

Copied verbatim / directly from the spec (`docs/superpowers/specs/2026-07-03-pdf-transcribe-design.md`) and `CLAUDE.md`:

- **纯前端、无后端、无付费服务、无 Python** —— 全程在扩展内完成。
- **抽取本地不出站**；AI 润色只走现有 LLM 出站（`assertSafeBaseUrl` + `resolveLlmConfig`）；写入复用 `feishuReq`/`feishuFetch`。不新增任何出站。
- **只用用户身份操作**（`resolveToken(settings)`，`CLAUDE.md` 约束 1）。
- **写操作不自动重试**（`CLAUDE.md` 约束 7）—— append-to-doc 失败不静默重试。
- **UI 无 emoji、内联 SVG 图标**（`icons.tsx` / `HUB_ICONS` 风格）、复用 shadcn/M3 基建（`Button`、`TopBar`、`field-input` 等）。
- **迭代循环**（`CLAUDE.md`）：`npm run typecheck` 0 错 → `npm test` 全绿 → `npm run build` 成功。动 docx/feishu 才需 `npm run validate:server`（本特性不动服务端套件，跳过）。
- **提交**：直接在 `main` 分支（用户 2026-07-02 指定）；提交信息加 trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`；仅在用户明确许可时才 commit/push。

### v1 决策（plan-writing 阶段落地，偏离原 spec —— 执行前已向用户确认）

- **DEV-v1-1（无 Worker）**：pdf2md 在主线程运行；Web Worker 延后 Phase 2。理由：`mrmps/pdf2md` 纯浏览器 demo 证明主线程可行，而 Worker 是 §7 头号 MV3 风险；主线程让 `extractMarkdown` 可在 vitest 里用 mock 直接测。
- **DEV-v1-2（轻量目标选择器）**：v1 不接 `DocSelector`（它需要 App 级 `recentFiles`/`setWorkDoc`/follow 状态，`ScenarioPanel` 当前不持有）。改用「默认当前文档（`context.feishu.appToken`）+ 换一个（粘贴飞书文档链接/token）」。完整 `DocSelector` = Phase 2。

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `src/shared/pdfExtract.ts` | `extractMarkdown(buffer)` + `detectScan(rawMd)` — pdf2md 薄封装 + 扫描件探测 | Create |
| `src/shared/pdfExtract.test.ts` | mock pdf2md，测包装逻辑 + detectScan 纯函数 | Create |
| `src/shared/ai/mdPolish.ts` | `polishMarkdown(settings, rawMd)` + `chunkMarkdown(md)` — 文本润色 + 分块 | Create |
| `src/shared/ai/mdPolish.test.ts` | mock openai（参照 `vision.test.ts`），测 prompt 约束/返回/失败 | Create |
| `src/shared/feishu/parseDocRef.ts` | `parseDocTokenFromUrl(input)` — 从链接/token 解析文档 token | Create |
| `src/shared/feishu/parseDocRef.test.ts` | 纯函数测试 | Create |
| `src/sidepanel/components/PdfTranscribePanel.tsx` | 面板 UI：上传 → 进度 → 可编辑预览 → 复制/导出/写入 | Create |
| `src/sidepanel/components/PdfTranscribePanel.css` | 面板专属样式（drop zone 等） | Create |
| `src/sidepanel/components/PdfTranscribePanel.test.tsx` | 组件测试（jsdom，mock 所有 shared 依赖） | Create |
| `src/sidepanel/components/ScenarioPanel.tsx` | 注册新面板（4 处编辑：import / `View` 变体 / `groups` 条目 / `if` 分支） | Modify |
| `package.json` | 新增 `@opendocsg/pdf2md` 依赖 | Modify |

**复用、不新建**：`markdownToBlocks` / `insertContentBlocks` / `listBlocks`（`src/shared/feishu/docx.ts` 已有，原 spec 提的 `mdToDocBlocks.ts` 不需要）；`resolveLlmConfig`/`assertSafeBaseUrl`/`OpenAI` 调用模式（`vision.ts`）；`resolveToken`（`auth.ts`）；`Button`/`TopBar`/`field-input`。

---

## Task 1: pdf2md 抽取模块（TDD，mock pdf2md）

**Files:**
- Create: `src/shared/pdfExtract.ts`
- Create: `src/shared/pdfExtract.test.ts`
- Modify: `package.json`（新增依赖）

**Interfaces:**
- Produces: `extractMarkdown(buffer: ArrayBuffer): Promise<string>`（抛友好错误：加密/损坏）；`detectScan(rawMd: string, minChars?: number): { likelyScan: boolean; reason: string }`。

- [ ] **Step 1: 安装 pdf2md 依赖**

Run:
```bash
npm install @opendocsg/pdf2md
```
Expected: `@opendocsg/pdf2md`（v0.2.x，MIT）写入 `package.json` `dependencies`。

- [ ] **Step 2: 写失败测试 `src/shared/pdfExtract.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPdf2md = vi.fn()
vi.mock('@opendocsg/pdf2md', () => ({ default: mockPdf2md }))

const { extractMarkdown, detectScan } = await import('./pdfExtract')

beforeEach(() => mockPdf2md.mockReset())

describe('detectScan', () => {
  it('flags near-empty text as a likely scan', () => {
    const r = detectScan('   \n  \t  ')
    expect(r.likelyScan).toBe(true)
    expect(r.reason).toContain('扫描件')
  })
  it('passes for real text', () => {
    expect(detectScan('这是一段足够长的正文内容，用于表明 PDF 有文本层。').likelyScan).toBe(false)
  })
  it('honors a custom threshold', () => {
    expect(detectScan('短文本', 100).likelyScan).toBe(true)
    expect(detectScan('短文本', 2).likelyScan).toBe(false)
  })
})

describe('extractMarkdown', () => {
  it('passes the buffer as Uint8Array and returns pdf2md output', async () => {
    mockPdf2md.mockResolvedValue('# Title\nbody')
    const out = await extractMarkdown(new TextEncoder().encode('%PDF-1.4 ...').buffer)
    expect(mockPdf2md).toHaveBeenCalledTimes(1)
    expect(mockPdf2md.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect(out).toBe('# Title\nbody')
  })
  it('maps a password/encrypted error to a friendly message', async () => {
    mockPdf2md.mockRejectedValue(new Error('Password required to decrypt'))
    await expect(extractMarkdown(new ArrayBuffer(8))).rejects.toThrow(/密码保护或损坏/)
  })
  it('rethrows other parse errors with context', async () => {
    mockPdf2md.mockRejectedValue(new Error('boom'))
    await expect(extractMarkdown(new ArrayBuffer(8))).rejects.toThrow(/PDF 解析失败/)
  })
  it('returns empty string when pdf2md yields non-string', async () => {
    mockPdf2md.mockResolvedValue(null)
    expect(await extractMarkdown(new ArrayBuffer(8))).toBe('')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/shared/pdfExtract.test.ts`
Expected: FAIL — `Cannot find module './pdfExtract'`（模块尚未实现）。

- [ ] **Step 4: 实现 `src/shared/pdfExtract.ts`**

```ts
import pdf2md from '@opendocsg/pdf2md'

/**
 * PDF → Markdown 抽取（本地、浏览器内，基于 pdf2md / pdf.js）。
 * 无出站：pdf2md 完全在设备上解析 PDF。
 *
 * v1 在主线程运行（Web Worker 延后 Phase 2 —— 见 plan DEV-v1-1）。
 */

export interface ScanResult { likelyScan: boolean; reason: string }

/** 启发式：抽取文本几乎为空 → 该 PDF 是扫描件/纯图片，pdf2md 没拿到可用文本层。
 *  扫描件返回近乎 0 字；真实文档返回大量字符。阈值 `minChars`（默认 30）按非空白字符总数。 */
export function detectScan(rawMd: string, minChars = 30): ScanResult {
  const chars = (rawMd ?? '').replace(/\s+/g, '').length
  const likelyScan = chars < minChars
  return {
    likelyScan,
    reason: likelyScan ? `未检测到文本层（仅 ${chars} 字，可能是扫描件/纯图片 PDF），pdf2md 无法提取` : '',
  }
}

/** 从 PDF 字节抽取 markdown。加密/损坏 → 抛友好错误（由上层捕获展示）。 */
export async function extractMarkdown(buffer: ArrayBuffer): Promise<string> {
  try {
    const text = await pdf2md(new Uint8Array(buffer))
    return typeof text === 'string' ? text : ''
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/password|encrypt|decrypt|permission/i.test(msg)) {
      throw new Error('PDF 受密码保护或损坏，无法解析')
    }
    throw new Error(`PDF 解析失败：${msg}`)
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/shared/pdfExtract.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: 0 错（注意：`@opendocsg/pdf2md` 可能无 TS 类型，见 Step 7 兜底）。

- [ ] **Step 7: 若缺类型声明，补 ambient 声明**

若 typecheck 报 `Could not find a declaration file for module '@opendocsg/pdf2md'`，在 `src/shared/pdfExtract.ts` 顶部加：
```ts
// @ts-expect-error — @opendocsg/pdf2md ships no types; treat its default export as a function.
```
（放在 `import pdf2md ...` 行上方。）重新 `npm run typecheck` 应为 0 错。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/shared/pdfExtract.ts src/shared/pdfExtract.test.ts
git commit -m "feat(pdf): add pdf2md-based markdown extraction module"
```
（提交信息末尾加 trailer：空行 + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。下同。）

---

## Task 2: AI 文本润色模块（TDD，mock openai）

**Files:**
- Create: `src/shared/ai/mdPolish.ts`
- Create: `src/shared/ai/mdPolish.test.ts`

**Interfaces:**
- Consumes: `AppSettings`（`../types`）、`resolveLlmConfig`（`./llmConfig`）、`assertSafeBaseUrl`（`../providers`）、`BUILD_CONFIG`（`../config`）、`OpenAI`（`openai`）—— 全部已有，参照 `vision.ts:30-58`。
- Produces: `polishMarkdown(settings: AppSettings, rawMd: string): Promise<string>`；`chunkMarkdown(md: string, maxChars?: number): string[]`。

- [ ] **Step 1: 写失败测试 `src/shared/ai/mdPolish.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mockCreate } } } }))

const { polishMarkdown, chunkMarkdown } = await import('./mdPolish')
const { DEFAULT_SETTINGS } = await import('../types')

beforeEach(() => mockCreate.mockReset())

describe('chunkMarkdown', () => {
  it('returns [] for empty input', () => {
    expect(chunkMarkdown('')).toEqual([])
  })
  it('returns a single chunk under the limit', () => {
    expect(chunkMarkdown('hello')).toEqual(['hello'])
  })
  it('splits header-less long text into chunks ≤ maxChars', () => {
    const big = 'a'.repeat(30000)
    const chunks = chunkMarkdown(big, 12000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(12000)
    expect(chunks.join('')).toBe(big)
  })
  it('keeps section boundaries when splitting', () => {
    const sec = '## Section\n' + 'x'.repeat(8000)
    const md = [sec, sec, sec].join('\n')
    const chunks = chunkMarkdown(md, 12000)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const c of chunks) expect(c).toContain('## Section')
  })
})

describe('polishMarkdown', () => {
  it('embeds the 只清理不补造 constraint in the system prompt', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'cleaned' } }] })
    await polishMarkdown(DEFAULT_SETTINGS, 'raw')
    const messages = mockCreate.mock.calls[0][0].messages
    expect(messages[0].content).toContain('只清理')
    expect(messages[0].content).toContain('不补造')
    expect(messages[1].content).toBe('raw')
  })
  it('returns the cleaned text for a single chunk', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '## 标题\n正文' } }] })
    expect(await polishMarkdown(DEFAULT_SETTINGS, 'raw')).toBe('## 标题\n正文')
  })
  it('joins multiple chunks with blank lines', async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: 'A' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'B' } }] })
    const big = 'a'.repeat(30000) // forces >1 chunk at default 12000
    const out = await polishMarkdown(DEFAULT_SETTINGS, big)
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(out).toBe('A\n\nB')
  })
  it('throws when the model returns empty', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] })
    await expect(polishMarkdown(DEFAULT_SETTINGS, 'raw')).rejects.toThrow(/未返回内容/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/shared/ai/mdPolish.test.ts`
Expected: FAIL — `Cannot find module './mdPolish'`。

- [ ] **Step 3: 实现 `src/shared/ai/mdPolish.ts`**

```ts
import OpenAI from 'openai'
import type { AppSettings } from '../types'
import { assertSafeBaseUrl } from '../providers'
import { BUILD_CONFIG } from '../config'
import { resolveLlmConfig } from './llmConfig'

/** 单块最大字符数（约 ~4k token，留足上下文余量）。 */
const POLISH_MAX_CHARS = 12000

const POLISH_PROMPT =
  '你是一个 Markdown 清理助手。下面给你一段从 PDF 中抽取的 Markdown，可能存在断句、错位、乱码、破损的表格/列表/标题层级等问题。请：\n' +
  '- 修复上述问题，保证语义通顺，不改变原意。\n' +
  '- 只清理、不补造：不得添加原文没有的内容，不得臆测或编造任何数据。\n' +
  '- 直接输出清理后的 Markdown，不要加任何解释、前言或代码围栏。'

/** 按二级标题（`## `）/ 分页符（`---`）边界把长文档切成 ≤ maxChars 的块；无标题则按长度切。纯函数。 */
export function chunkMarkdown(md: string, maxChars = POLISH_MAX_CHARS): string[] {
  if (!(md ?? '').length) return []
  if (md.length <= maxChars) return [md]
  const parts = md.split(/(^## .+$|^---$)/m) // 保留分隔符为独立元素
  const chunks: string[] = []
  let buf = ''
  for (const p of parts) {
    if ((buf + p).length > maxChars && buf) { chunks.push(buf); buf = p }
    else buf += p
  }
  if (buf) chunks.push(buf)
  return chunks
}

/** 纯文本润色：复用 vision.ts 的调用模式（resolveLlmConfig + assertSafeBaseUrl + OpenAI）。
 *  文本进、文本出，无需视觉模型。长文档自动分块、逐块润色后拼接。失败由上层降级到 rawMd。 */
export async function polishMarkdown(settings: AppSettings, rawMd: string): Promise<string> {
  const cfg = await resolveLlmConfig(settings)
  const baseURL = assertSafeBaseUrl(cfg.baseUrl, BUILD_CONFIG.openaiAllowedHosts)
  const client = new OpenAI({ baseURL, apiKey: cfg.apiKey, dangerouslyAllowBrowser: true })
  const chunks = chunkMarkdown(rawMd)
  const out: string[] = []
  for (const chunk of chunks) {
    const resp = await client.chat.completions.create({
      model: cfg.model,
      stream: false,
      messages: [
        { role: 'system', content: POLISH_PROMPT },
        { role: 'user', content: chunk },
      ],
    })
    const text = resp.choices[0]?.message?.content?.trim() ?? ''
    if (!text) throw new Error('模型未返回内容。')
    out.push(text)
  }
  return out.join('\n\n')
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/shared/ai/mdPolish.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 0 错；全绿（新用例 + 既有 ~460 用例）。

- [ ] **Step 6: Commit**

```bash
git add src/shared/ai/mdPolish.ts src/shared/ai/mdPolish.test.ts
git commit -m "feat(pdf): add text-LLM markdown polish module"
```

---

## Task 3: 文档链接/token 解析（TDD，纯函数）

**Files:**
- Create: `src/shared/feishu/parseDocRef.ts`
- Create: `src/shared/feishu/parseDocRef.test.ts`

**Interfaces:**
- Produces: `parseDocTokenFromUrl(input: string): { token: string } | null`。

- [ ] **Step 1: 写失败测试 `src/shared/feishu/parseDocRef.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parseDocTokenFromUrl } from './parseDocRef'

describe('parseDocTokenFromUrl', () => {
  it('parses a docx URL with query string', () => {
    expect(parseDocTokenFromUrl('https://abc.feishu.cn/docx/DOCM1234567890abc?from=copy')).toEqual({ token: 'DOCM1234567890abc' })
  })
  it('parses a /docs/ URL', () => {
    expect(parseDocTokenFromUrl('https://abc.feishu.cn/docs/DOCMabcdef1234')).toEqual({ token: 'DOCMabcdef1234' })
  })
  it('accepts a bare token', () => {
    expect(parseDocTokenFromUrl('DOCMabcdef1234')).toEqual({ token: 'DOCMabcdef1234' })
  })
  it('returns null for empty / garbage', () => {
    expect(parseDocTokenFromUrl('')).toBeNull()
    expect(parseDocTokenFromUrl('not a link at all!!!')).toBeNull()
  })
  it('returns null for non-doc paths', () => {
    expect(parseDocTokenFromUrl('https://abc.feishu.cn/sheets/shtXXXX')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/shared/feishu/parseDocRef.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 `src/shared/feishu/parseDocRef.ts`**

```ts
/** 从粘贴的飞书文档链接或裸 token 解析出文档 token。
 *  支持 `https://*.feishu.cn/(docx|docs|wiki)/TOKEN[?...]` 与裸 token（无 `/` `?`）。
 *  v1 仅处理文档；wiki 节点 token 需额外解析（Phase 2）。 */
export function parseDocTokenFromUrl(input: string): { token: string } | null {
  const s = (input ?? '').trim()
  if (!s) return null
  // 裸 token：无分隔符、足够长、字母数字/-_。
  if (!/[/?#]/.test(s) && /^[\w-]{10,}$/.test(s)) return { token: s }
  const m = s.match(/\/(?:docx|docs|wiki)\/([A-Za-z0-9]+)/)
  return m ? { token: m[1] } : null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/shared/feishu/parseDocRef.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/feishu/parseDocRef.ts src/shared/feishu/parseDocRef.test.ts
git commit -m "feat(pdf): add feishu doc-ref parser"
```

---

## Task 4: PdfTranscribePanel 面板（TDD 组件测试）

**Files:**
- Create: `src/sidepanel/components/PdfTranscribePanel.tsx`
- Create: `src/sidepanel/components/PdfTranscribePanel.css`
- Create: `src/sidepanel/components/PdfTranscribePanel.test.tsx`

**Interfaces:**
- Consumes: `extractMarkdown` / `detectScan`（Task 1）、`polishMarkdown`（Task 2）、`parseDocTokenFromUrl`（Task 3）、`markdownToBlocks` / `insertContentBlocks` / `listBlocks`（`../../shared/feishu/docx`）、`resolveToken`（`../../shared/feishu/auth`）、`Button`/`TopBar`（`./`）。
- Produces: `export default function PdfTranscribePanel(props: { settings: AppSettings; context: PageContext; disabled: boolean; onBack: () => void })` —— 与 `SlidesPanel`/`SmartFillPanel` 同款 props 契约（`ScenarioPanel.tsx` 传入）。

- [ ] **Step 1: 写失败组件测试 `src/sidepanel/components/PdfTranscribePanel.test.tsx`**

```tsx
/* @vitest-environment jsdom */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockExtract = vi.fn()
const mockDetect = vi.fn()
vi.mock('../../shared/pdfExtract', () => ({ extractMarkdown: mockExtract, detectScan: mockDetect }))
const mockPolish = vi.fn()
vi.mock('../../shared/ai/mdPolish', () => ({ polishMarkdown: mockPolish }))
const mockListBlocks = vi.fn()
const mockInsertContent = vi.fn()
vi.mock('../../shared/feishu/docx', () => ({
  markdownToBlocks: vi.fn((md: string) => [{ text: md, style: 'text' as const }]),
  insertContentBlocks: mockInsertContent,
  listBlocks: mockListBlocks,
}))
const mockResolveToken = vi.fn()
vi.mock('../../shared/feishu/auth', () => ({ resolveToken: mockResolveToken }))

const PdfTranscribePanel = (await import('./PdfTranscribePanel')).default
const { DEFAULT_SETTINGS } = await import('../../shared/types')

function ctx() {
  return { feishu: { kind: 'doc', appToken: 'CURDOC', isBase: false }, url: 'https://x.feishu.cn/docx/CURDOC' } as any
}
function pickFile(name = 'demo.pdf') {
  fireEvent.change(screen.getByTestId('pdf-input'), {
    target: { files: [new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' })] },
  })
}

beforeEach(() => {
  mockExtract.mockReset(); mockDetect.mockReset(); mockPolish.mockReset()
  mockListBlocks.mockReset(); mockInsertContent.mockReset(); mockResolveToken.mockReset()
})

describe('PdfTranscribePanel', () => {
  it('extracts → polishes → shows polished text in editor', async () => {
    mockExtract.mockResolvedValue('# T\nbody')
    mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockPolish.mockResolvedValue('# T\nbody (polished)')
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByTestId('pdf-editor')).toBeInTheDocument())
    expect((screen.getByTestId('pdf-editor') as HTMLTextAreaElement).value).toContain('polished')
    expect(mockPolish).toHaveBeenCalledWith(DEFAULT_SETTINGS, '# T\nbody')
  })

  it('aborts with a message on scan detection (no editor)', async () => {
    mockExtract.mockResolvedValue('   ')
    mockDetect.mockReturnValue({ likelyScan: true, reason: '未检测到文本层（可能是扫描件）' })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByText(/未检测到文本层/)).toBeInTheDocument())
    expect(screen.queryByTestId('pdf-editor')).not.toBeInTheDocument()
  })

  it('falls back to raw markdown when polish fails', async () => {
    mockExtract.mockResolvedValue('raw text here')
    mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockPolish.mockRejectedValue(new Error('boom'))
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByTestId('pdf-editor')).toBeInTheDocument())
    expect((screen.getByTestId('pdf-editor') as HTMLTextAreaElement).value).toContain('raw text here')
    expect(screen.getByText(/AI 润色失败/)).toBeInTheDocument()
  })

  it('appends to the current doc via listBlocks + insertContentBlocks', async () => {
    mockExtract.mockResolvedValue('# T\nbody')
    mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockPolish.mockResolvedValue('# T\nbody')
    mockResolveToken.mockResolvedValue('USER_TOKEN')
    mockListBlocks.mockResolvedValue({ items: [{ block_id: 'CURDOC', children: ['b1', 'b2'] }] })
    mockInsertContent.mockResolvedValue({ blocks_inserted: 1 })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByTestId('pdf-editor')).toBeInTheDocument())
    fireEvent.click(screen.getByText('添加到文档'))
    await waitFor(() => expect(mockInsertContent).toHaveBeenCalled())
    // appended at the END: index = root children length = 2
    expect(mockInsertContent).toHaveBeenCalledWith('USER_TOKEN', 'CURDOC', expect.any(Array), 2)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/sidepanel/components/PdfTranscribePanel.test.tsx`
Expected: FAIL — 组件模块不存在。

- [ ] **Step 3: 实现 `src/sidepanel/components/PdfTranscribePanel.css`**

```css
.sc-pdf-drop {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 40px 16px; margin: 16px 0;
  border: 1.5px dashed var(--muted-border, #d0d0d0); border-radius: 12px;
  cursor: pointer; color: var(--muted-fg, #888); text-align: center;
}
.sc-pdf-drop:hover { border-color: var(--accent, #3370ff); color: var(--accent, #3370ff); }
.sc-pdf-hint { font-size: 12px; opacity: .8; }
.sc-pdf-progress { padding: 24px 0; text-align: center; color: var(--muted-fg, #888); }
.sc-pdf-editor { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; resize: vertical; box-sizing: border-box; }
.sc-pdf-target-row { display: flex; align-items: center; gap: 8px; margin: 12px 0; }
```

- [ ] **Step 4: 实现 `src/sidepanel/components/PdfTranscribePanel.tsx`**

```tsx
import React, { useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import { resolveToken } from '../../shared/feishu/auth'
import { extractMarkdown, detectScan } from '../../shared/pdfExtract'
import { polishMarkdown } from '../../shared/ai/mdPolish'
import { markdownToBlocks, insertContentBlocks, listBlocks } from '../../shared/feishu/docx'
import { parseDocTokenFromUrl } from '../../shared/feishu/parseDocRef'
import TopBar from './TopBar'
import Button from './Button'
import './PdfTranscribePanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
}

type Phase = 'idle' | 'extracting' | 'polishing' | 'done' | 'error'

interface DocTarget { token: string; title: string }

export default function PdfTranscribePanel({ settings, context, disabled, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [rawMd, setRawMd] = useState('')
  const [polishedMd, setPolishedMd] = useState('')
  const [editMd, setEditMd] = useState('')
  const [polishEnabled, setPolishEnabled] = useState(true)
  const [polishFailed, setPolishFailed] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [fileName, setFileName] = useState('document')
  const [target, setTarget] = useState<DocTarget | null>(
    context.feishu?.kind === 'doc' && context.feishu?.appToken
      ? { token: context.feishu.appToken, title: '当前文档' }
      : null,
  )
  const [showTargetInput, setShowTargetInput] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [writing, setWriting] = useState(false)

  async function handleFile(file: File) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { setError('请上传 PDF 文件。'); setPhase('error'); return }
    setFileName(file.name.replace(/\.pdf$/i, ''))
    setPhase('extracting'); setError(''); setInfo('')
    try {
      const buf = await file.arrayBuffer()
      const md = await extractMarkdown(buf)
      setRawMd(md)
      const scan = detectScan(md)
      if (scan.likelyScan) { setError(scan.reason); setPhase('error'); return }
      if (polishEnabled) {
        setPhase('polishing')
        try {
          const polished = await polishMarkdown(settings, md)
          setPolishedMd(polished); setEditMd(polished); setPolishFailed(false)
        } catch {
          setPolishedMd(md); setEditMd(md); setPolishFailed(true)
          setInfo('AI 润色失败，已显示原始抽取结果。')
        }
      } else {
        setPolishedMd(md); setEditMd(md)
      }
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setPhase('error')
    }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(editMd)
    setInfo('已复制到剪贴板。')
  }
  function handleExport() {
    const blob = new Blob([editMd], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${fileName}.md`; a.click()
    URL.revokeObjectURL(url)
  }
  async function handleAddToDoc() {
    if (!target?.token) { setShowTargetInput(true); return }
    setWriting(true); setError(''); setInfo('')
    try {
      const token = await resolveToken(settings)
      const doc = target.token
      const view = await listBlocks(token, doc)
      const root = (view.items as Array<{ block_id?: string; children?: string[] }>)
        .find(b => b.block_id === doc)
      const index = root?.children?.length ?? 0
      await insertContentBlocks(token, doc, markdownToBlocks(editMd), index)
      setInfo(`已写入「${target.title}」末尾。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWriting(false)
    }
  }
  function handlePickTarget() {
    const ref = parseDocTokenFromUrl(targetInput)
    if (!ref) { setError('无法识别文档链接或 token'); return }
    setTarget({ token: ref.token, title: '指定文档' })
    setShowTargetInput(false); setError('')
  }

  return (
    <div className="scenario-panel view-enter" key="pdf">
      <TopBar title="PDF 转写" onBack={onBack} />
      <div className="sc-detail-body">
        {phase === 'idle' && (
          <label className="sc-pdf-drop" data-testid="pdf-drop">
            <input
              type="file" accept=".pdf,application/pdf" hidden data-testid="pdf-input"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
            />
            <p>点击或拖入 PDF 文件</p>
            <p className="sc-pdf-hint">本地解析，不上传服务器</p>
          </label>
        )}
        {(phase === 'extracting' || phase === 'polishing') && (
          <div className="sc-pdf-progress" data-testid="pdf-progress">
            {phase === 'extracting' ? '正在解析 PDF…' : '正在 AI 润色…'}
          </div>
        )}
        {phase === 'error' && (
          <div className="sc-error-box">
            <div className="sc-error-title">无法转写</div>
            <div className="sc-error-msg">{error}</div>
            <Button variant="primary" onClick={() => setPhase('idle')}>重新选择</Button>
          </div>
        )}
        {phase === 'done' && (
          <>
            {polishFailed && <div className="sc-refresh-err">{info}</div>}
            <label className="sc-input-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox" checked={polishEnabled}
                onChange={e => {
                  setPolishEnabled(e.target.checked)
                  setEditMd(e.target.checked ? polishedMd : rawMd)
                }}
              />
              <span className="sc-input-label">启用 AI 润色</span>
            </label>
            <textarea
              className="field-input sc-pdf-editor" data-testid="pdf-editor"
              value={editMd} onChange={e => setEditMd(e.target.value)} rows={16}
            />
            <div className="sc-pdf-target-row">
              <span className="sc-inputs-label">目标：{target ? target.title : '未选择'}</span>
              {!showTargetInput && (
                <button className="sc-refresh-btn" onClick={() => setShowTargetInput(true)}>换一个</button>
              )}
            </div>
            {showTargetInput && (
              <div className="sc-input-field">
                <input
                  className="field-input" data-testid="target-input"
                  value={targetInput} onChange={e => setTargetInput(e.target.value)}
                  placeholder="粘贴飞书文档链接或 token"
                />
                <Button variant="primary" onClick={handlePickTarget}>确定</Button>
              </div>
            )}
            <div className="sc-done-actions">
              <Button variant="primary" onClick={handleCopy}>复制</Button>
              <Button onClick={handleExport}>导出 .md</Button>
              <Button onClick={handleAddToDoc} disabled={writing}>
                {writing ? '写入中…' : '添加到文档'}
              </Button>
            </div>
            {error && <div className="sc-refresh-err">{error}</div>}
            {!error && polishFailed && <div className="sc-registry-info">{info}</div>}
            {!error && !polishFailed && info && <div className="sc-registry-info">{info}</div>}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/sidepanel/components/PdfTranscribePanel.test.tsx`
Expected: PASS（4 个用例）。

- [ ] **Step 6: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 0 错；全绿。

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/PdfTranscribePanel.tsx src/sidepanel/components/PdfTranscribePanel.css src/sidepanel/components/PdfTranscribePanel.test.tsx
git commit -m "feat(pdf): add PdfTranscribePanel UI (extract → polish → copy/export/append)"
```

---

## Task 5: 注册到 App Hub（ScenarioPanel）

**Files:**
- Modify: `src/sidepanel/components/ScenarioPanel.tsx`（4 处编辑）

**Interfaces:**
- Consumes: `PdfTranscribePanel`（Task 4）。

- [ ] **Step 1: 加 import（顶部，第 15 行 `SlidesPanel` 之后）**

在 `import SlidesPanel from './SlidesPanel'` 下加一行：
```ts
import PdfTranscribePanel from './PdfTranscribePanel'
```

- [ ] **Step 2: 加 `View` 变体（第 38 行 `| { mode: 'slides' }` 之后）**

```ts
  | { mode: 'slides' }
  | { mode: 'pdfTranscribe' }
```

- [ ] **Step 3: 加 HubCard 条目（在 `groups` 数组里，`build` 组之后插入新组，`requires: 'any'`）**

在 `const groups: Grp[] = [ ... ]` 内，`build` 组之后加：
```ts
      { key: 'pdf', label: '内容转写', requires: 'any', feats: [
        { icon: 'file', title: 'PDF 转写', desc: '把 PDF 抽成 Markdown，AI 润色后写入文档', go: () => setView({ mode: 'pdfTranscribe' }) },
      ] },
```
（`HUB_ICONS.file` 已存在，`ScenarioPanel.tsx:61`。`requires: 'any'` → 任何页面都全亮显示。）

- [ ] **Step 4: 加路由分支（第 213-215 行 `slides` 分支之后）**

```tsx
  if (view.mode === 'pdfTranscribe') {
    return <PdfTranscribePanel settings={settings} context={context} disabled={disabled} onBack={() => setView({ mode: 'hub' })} />
  }
```

- [ ] **Step 5: typecheck + 全量测试 + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: 0 错；全绿；build 成功（偶发 TLS 报错 → 重试）。

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/components/ScenarioPanel.tsx
git commit -m "feat(pdf): register PdfTranscribePanel in App Hub"
```

- [ ] **Step 7: 真机端到端验证（= §7 风险 1 的 spike）**

这是 pdf.js / pdf2md 在 MV3 侧边栏真实环境下的首次验证（前面 Task 全是 mock 的单元测试）。按记忆 [[devui-testui-windows]]：在真实扩展里验证。

1. `npm run dev:ext`（构建扩展），Chrome `chrome://extensions` 加载 `dist/`（开发者模式）。
2. 打开任意飞书文档页（或任意页面），打开侧边栏，切到「应用」tab。
3. 确认新增「内容转写 → PDF 转写」卡片，点击进入面板。
4. 拖入一个**含文本层**的真实 PDF → 应出现「正在解析…」→「正在 AI 润色…」→ 编辑器显示润色后 Markdown。
5. 拖入一个**扫描件/纯图片** PDF → 应显示「未检测到文本层…」并中止（不崩）。
6. 点「复制」「导出 .md」各验一次；点「添加到文档」→ 确认内容追加到当前文档**末尾**。
7. 点「换一个」→ 粘贴另一文档链接 → 确认能切目标并写入。

**若 pdf.js worker 在 MV3 报错**（CSP / `worker-src` / 找不到 worker）—— 这是 §7 头号风险的实战暴露：
- 优先兜底：在 `pdfExtract.ts` 里检测环境、必要时走 pdf.js 的 `disableWorker`（主线程解析）降级。pdf2md 内部用的是 pdf.js；如需禁用其 worker，查 `node_modules/@opendocsg/pdf2md` 源里对 `GlobalWorkerOptions` 的设置点。
- 记录现象 + 兜底方案，回填本 plan 与 spec 的风险章节。

---

## Self-Review（plan 自检，已执行）

**1. Spec 覆盖**：
- §2.1 抽取 → Task 1 ✓；扫描件探测 → Task 1 `detectScan` + Task 4 中止分支 ✓。
- §2.2 AI 润色（prompt 约束 / 分块 / 失败降级 / 开关）→ Task 2 + Task 4 ✓。
- §2.3 输出（复制 / 导出 / 添加到指定文档=默认当前+换一个）→ Task 4 ✓；可编辑预览 → Task 4 `textarea` ✓；缩略图 → 审阅结论「v1 不做」，本 plan 不含 ✓。
- §3 组件 → pdfExtract / mdPolish 已建；`mdToDocBlocks` 经核实复用 `docx.ts`，未新建（spec §3 注「若已有则复用」）✓。
- §5 错误处理 → 各 Task 的 catch + 友好文案 ✓。
- §6 测试 → vitest，mock pdf2md / mock openai / 纯函数 / jsdom 组件测试 ✓。
- §7 风险 1（MV3 worker）→ Task 5 Step 7 真机 spike ✓。

**2. 占位扫描**：无 TBD/TODO；每步含实际代码或确切命令。

**3. 类型一致性**：
- `extractMarkdown(buffer: ArrayBuffer): Promise<string>`、`detectScan(rawMd, minChars?): {likelyScan, reason}` —— Task1 定义、Task4 消费一致 ✓。
- `polishMarkdown(settings, rawMd): Promise<string>`、`chunkMarkdown(md, maxChars?): string[]` ✓。
- `parseDocTokenFromUrl(input): {token} | null` ✓。
- 面板 props `{settings, context, disabled, onBack}` 与 SlidesPanel 契约一致 ✓。

**两处偏离已在「v1 决策」标注**（DEV-v1-1 无 Worker、DEV-v1-2 轻量选择器），执行前需用户确认；确认后同步回 spec。
