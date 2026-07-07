# 文档选区「添加到会话」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在飞书文档页选中文本时，选区旁浮出「添加到会话」按钮；点击后把选区作为输入框里的可移除「引用卡片」chip 暂存，用户写指令发送给 agent，agent 据卡片里的选中文本+段落+标题用 list_blocks 文本匹配定位并修改。

**Architecture:** 内容脚本 shadow-DOM 浮层按钮（仿 viz-launcher）→ background 开侧边栏+暂存（仿 CLIP_REQUEST）→ App 收件、比对工作文档（不一致复用 SwitchDocDialog）、暂存为 `type:'selection'` 的 Attachment chip → InputBar 消费 → agent.ts 把 selection 附件渲染成文本元数据。选区上下文（段落/标题）走 API 文本匹配（list_blocks），不碰编辑器 DOM。

**Tech Stack:** Chrome MV3 content script / service worker / React 18 side panel / TypeScript / vitest（纯函数单测）。

## Global Constraints

- **只用用户身份**：所有飞书 API 走 `resolveToken(settings)`（user_access_token），不回退 tenant。
- **UI 纯 CSS + 语义 class + `App.css --color-*` 变量**；图标手写内联 SVG；**UI 无 emoji**。
- **出站只走飞书**：新增的 list_blocks / getWikiNode 调用复用既有 `feishuReq`/`getWikiNode`，不新增出站。
- **消息校验 `sender.id === chrome.runtime.id`**（内容脚本侧）/ `sender.id !== chrome.runtime.id → return`（侧边栏侧）。
- **测试约定**：项目 ~460 用例全是**纯函数**单测（vitest，无 Chrome/网络）。本计划对**纯函数**走 TDD（selectionToAttachment / tryAddSelectionAttachment / resolveSelectionContext / attachmentToMetaData）；React 组件接线、内容脚本 DOM、background 中继用 `npm run typecheck` + `npm run build` + dev 验证（`dev:ui` 验 UI、`dev:ext` 真机验内容脚本）。
- **迭代循环（每个任务末尾）**：`npm run typecheck`（0 错）→ `npm test`（全绿）→ `npm run build`（成功，偶发 TLS 报错重试）。改完才提交。
- **提交**：当前分支 `feishu-ok`，直接提交不开特性分支；提交结束语 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。**仅在用户要求时才 commit/push**——本计划的 commit 步骤默认只 `git add` + 准备好 commit message，是否真正提交等用户确认（或在执行模式里按约定）。
- **不改 manifest / vite.config**：内容脚本 bundle 由 vite-plugin-web-extension 自动并入既有 content_scripts 入口（`src/content/index.ts`）。

---

## Task 1: 数据模型 + selection→Attachment 纯函数

**Files:**
- Modify: `src/shared/types.ts`（`Attachment` 类型 + 新增 `DocSelectionPayload` / `SelectionAttachmentData`）
- Modify: `src/shared/attachments.ts`（新增 `selectionToAttachment` / `tryAddSelectionAttachment` / `MAX_SELECTION_CHIPS`）
- Test: `src/shared/attachments.test.ts`（新建）

**Interfaces:**
- Produces: `AttachmentType`（含 `'selection'`）、`Attachment.selection?: SelectionAttachmentData`、`DocSelectionPayload`、`MAX_SELECTION_CHIPS = 5`、`selectionToAttachment(payload, ctx?)`、`tryAddSelectionAttachment(current, payload)`。后续 Task 3/4/9 依赖这些。

- [ ] **Step 1: 写失败测试** `src/shared/attachments.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { selectionToAttachment, tryAddSelectionAttachment, MAX_SELECTION_CHIPS } from './attachments'
import type { DocSelectionPayload } from './types'

const payload = (over: Partial<DocSelectionPayload> = {}): DocSelectionPayload => ({
  kind: 'doc', docToken: 'DOC123', docTitle: '我的文档', url: 'https://x.feishu.cn/docx/DOC123',
  selectedText: '选中片段', ...over,
})

describe('selectionToAttachment', () => {
  it('builds a selection Attachment with the payload text', () => {
    const a = selectionToAttachment(payload())
    expect(a.type).toBe('selection')
    expect(a.selection?.selectedText).toBe('选中片段')
    expect(a.selection?.docToken).toBe('DOC123')
    expect(a.selection?.paragraphText).toBeUndefined()
  })
  it('merges resolved paragraph/heading context when given', () => {
    const a = selectionToAttachment(payload(), { paragraphText: '整段', headingText: '标题A' })
    expect(a.selection?.paragraphText).toBe('整段')
    expect(a.selection?.headingText).toBe('标题A')
  })
})

describe('tryAddSelectionAttachment', () => {
  it('appends when under the limit and not a duplicate', () => {
    const r = tryAddSelectionAttachment([], payload())
    expect(r.added).toBe(true)
    expect(r.attachments).toHaveLength(1)
    expect(r.attachments[0].type).toBe('selection')
  })
  it('rejects an exact duplicate (same docToken + selectedText)', () => {
    const base = tryAddSelectionAttachment([], payload()).attachments
    const r = tryAddSelectionAttachment(base, payload())
    expect(r.added).toBe(false)
    expect(r.reason).toBe('dup')
    expect(r.attachments).toHaveLength(1)
  })
  it('rejects when the selection-chip cap is reached', () => {
    let atts: import('./types').Attachment[] = []
    for (let i = 0; i < MAX_SELECTION_CHIPS; i++) {
      atts = tryAddSelectionAttachment(atts, payload({ selectedText: `片段${i}` })).attachments
    }
    expect(atts.filter((a) => a.type === 'selection')).toHaveLength(MAX_SELECTION_CHIPS)
    const r = tryAddSelectionAttachment(atts, payload({ selectedText: '多出来的' }))
    expect(r.added).toBe(false)
    expect(r.reason).toBe('limit')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/attachments.test.ts`
Expected: FAIL（`selectionToAttachment` / `tryAddSelectionAttachment` 未导出；`Attachment` 不接受 `type:'selection'`，TS 报错）。

- [ ] **Step 3: 扩展类型** `src/shared/types.ts`

把 `Attachment` 接口（当前 `src/shared/types.ts:9-19`）改为：

```ts
export interface SelectionAttachmentData {
  kind: 'doc' | 'wiki'
  /** Resolved to the underlying doc token (wiki → obj_token) before staging, so list_blocks works. */
  docToken: string
  docTitle: string
  url: string
  selectedText: string
  /** Resolved async from list_blocks text-match; undefined until then. */
  paragraphText?: string
  headingText?: string
}

/** Wire payload sent content-script → background → side panel (no resolved context yet). */
export interface DocSelectionPayload {
  kind: 'doc' | 'wiki'
  docToken: string
  docTitle: string
  url: string
  selectedText: string
}

export type AttachmentType = 'image' | 'file' | 'selection'

export interface Attachment {
  id: string
  type: AttachmentType
  name: string
  mimeType: string
  size: number
  /** Base64 data URL for image attachments. */
  dataUrl?: string
  /** Text content for file attachments (csv/tsv/txt). */
  content?: string
  /** type === 'selection' — a doc snippet staged as chat context. */
  selection?: SelectionAttachmentData
}
```

- [ ] **Step 4: 实现纯函数** 在 `src/shared/attachments.ts` 末尾追加（紧跟现有 `attachmentsToContentParts`）：

```ts
import type { Attachment, DocSelectionPayload } from './types'   // 已有 Attachment import，合并即可；DocSelectionPayload 新增

/** Max removable selection chips staged in the input box at once. */
export const MAX_SELECTION_CHIPS = 5

/** Build a selection Attachment from a wire payload (+optional resolved context). */
export function selectionToAttachment(
  payload: DocSelectionPayload,
  ctx?: { paragraphText?: string; headingText?: string },
): Attachment {
  return {
    id: crypto.randomUUID(),
    type: 'selection',
    name: payload.docTitle || '文档片段',
    mimeType: 'text/x-feishu-selection',
    size: 0,
    selection: {
      kind: payload.kind,
      docToken: payload.docToken,
      docTitle: payload.docTitle,
      url: payload.url,
      selectedText: payload.selectedText,
      paragraphText: ctx?.paragraphText,
      headingText: ctx?.headingText,
    },
  }
}

/** Pure: try to append a selection chip, enforcing the cap + exact-duplicate dedup.
 *  Returns the new attachment list + whether it was added (and why not). */
export function tryAddSelectionAttachment(
  current: Attachment[],
  payload: DocSelectionPayload,
): { attachments: Attachment[]; added: boolean; reason?: 'dup' | 'limit' } {
  const selCount = current.filter((a) => a.type === 'selection').length
  if (selCount >= MAX_SELECTION_CHIPS) return { attachments: current, added: false, reason: 'limit' }
  const dup = current.some(
    (a) => a.type === 'selection' && a.selection?.docToken === payload.docToken && a.selection?.selectedText === payload.selectedText,
  )
  if (dup) return { attachments: current, added: false, reason: 'dup' }
  return { attachments: [...current, selectionToAttachment(payload)], added: true }
}
```

> 注：`attachments.ts` 顶部第 1 行已是 `import type { Attachment } from './types'`，把它改成同时引入 `DocSelectionPayload`。`crypto.randomUUID()` 在 vitest 的 node/jsdom 环境可用（Node 18+）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/shared/attachments.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 6: 全量校验 + 提交**

```bash
npm run typecheck && npm test && npm run build
```
Expected: typecheck 0 错；test 全绿；build 成功。
```bash
git add src/shared/types.ts src/shared/attachments.ts src/shared/attachments.test.ts
git commit -m "feat(selection): add 'selection' attachment type + staging helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 选区段落/标题上下文解析（纯函数 + list_blocks 包装）

**Files:**
- Modify: `src/shared/feishu/docx.ts`（新增 `resolveSelectionContext` 纯函数 + `fetchSelectionContext` 异步包装）
- Test: `src/shared/feishu/docx.test.ts`（补一个 describe）

**Interfaces:**
- Consumes: `listBlocks(token, documentId)`（`src/shared/feishu/docx.ts:148`，已存在，返回 `{ items: unknown[], ... }`）。
- Produces: `resolveSelectionContext(blocks: unknown[], selectedText: string): { paragraphText?: string; headingText?: string }`（纯）、`fetchSelectionContext(token, documentId, selectedText): Promise<同>`。Task 9（App 回填 chip）调用 `fetchSelectionContext`。

**Block 文本结构（已核实，见 agent.ts:1251 / slidesImages.ts:32）：** 文本块 `block_type=2` 文本在 `block.text.elements[].text_run.content`；标题块 `block_type=3/4/5` 文本在 `block.heading1/heading2/heading3.elements[].text_run.content`。

- [ ] **Step 1: 写失败测试** 在 `src/shared/feishu/docx.test.ts` 顶部 import 加上 `resolveSelectionContext`，文件末尾追加：

```ts
import { resolveSelectionContext } from './docx'   // 合并到第 2 行既有 import

describe('resolveSelectionContext — 选中文本 → 所在段落 + 最近标题', () => {
  // block 文本结构与 listBlocks 一致：text→block.text.elements[].text_run.content；
  // heading(3/4/5)→block.heading{1,2,3}.elements[].text_run.content
  const txt = (id: string, content: string) => ({ block_id: id, block_type: 2, text: { elements: [{ text_run: { content } }] } })
  const h = (id: string, level: number, content: string) => ({ block_id: id, block_type: 2 + level, [`heading${level}`]: { elements: [{ text_run: { content } }] } })

  it('返回选区所在段落 + 其上方最近的标题', () => {
    const blocks = [h('h1', 1, '报告'), txt('t1', '封面说明'), h('h2', 2, '数据'), txt('t2', '本月销售额为 100 万')]
    expect(resolveSelectionContext(blocks, '销售额为 100')).toEqual({ paragraphText: '本月销售额为 100 万', headingText: '数据' })
  })
  it('选区落在标题本身 → paragraphText 与 headingText 都是该标题文本', () => {
    const blocks = [txt('t0', '前言'), h('h1', 1, '重要章节'), txt('t1', '内容')]
    expect(resolveSelectionContext(blocks, '重要章节')).toEqual({ paragraphText: '重要章节', headingText: '重要章节' })
  })
  it('选区上方无标题 → headingText 为 undefined', () => {
    const blocks = [txt('t1', '开头第一段内容')]
    expect(resolveSelectionContext(blocks, '第一段')).toEqual({ paragraphText: '开头第一段内容', headingText: undefined })
  })
  it('无任何块包含选区 → 返回空对象', () => {
    const blocks = [txt('t1', '无关内容')]
    expect(resolveSelectionContext(blocks, '不存在的片段')).toEqual({})
  })
  it('空选区 → 返回空对象', () => {
    expect(resolveSelectionContext([txt('t1', 'x')], '   ')).toEqual({})
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/feishu/docx.test.ts`
Expected: FAIL（`resolveSelectionContext` 未导出）。

- [ ] **Step 3: 实现纯函数 + 异步包装** 在 `src/shared/feishu/docx.ts` 的 `listBlocks`（:148-162）下方插入：

```ts
/** 文本块/标题块的文本 key（飞书 docx）：text→'text'，heading(3/4/5)→'heading1'/'heading2'/'heading3'。 */
function blockTextKey(blockType: number): string | null {
  if (blockType === 2) return 'text'
  if (blockType >= 3 && blockType <= 5) return `heading${blockType - 2}`
  return null
}
/** 读取一个块的纯文本（text/heading 块），其余块类型返回 ''。 */
function readBlockText(block: Record<string, unknown>): string {
  const key = blockTextKey(block.block_type as number)
  if (!key) return ''
  const el = block[key] as { elements?: Array<{ text_run?: { content?: string } }> } | undefined
  return (el?.elements ?? []).map((e) => e?.text_run?.content ?? '').join('')
}

/** 纯：在扁平块列表里，按 selectedText 文本匹配定位「所在完整段落 + 最近上方标题」。
 *  无 DOM 依赖（block_id 始终走 API 的既定原则）；list_blocks 已是扁平有序列表。 */
export function resolveSelectionContext(
  blocks: unknown[],
  selectedText: string,
): { paragraphText?: string; headingText?: string } {
  const needle = (selectedText ?? '').trim()
  if (!needle) return {}
  const list = blocks as Record<string, unknown>[]
  let lastHeading: string | undefined
  for (const b of list) {
    const bt = b.block_type as number
    const isHeading = bt >= 3 && bt <= 5
    const text = readBlockText(b)
    if (isHeading && text) lastHeading = text
    if (text && text.includes(needle)) {
      return { paragraphText: text, headingText: isHeading ? text : lastHeading }
    }
  }
  return {}
}

/** 异步包装：拉取文档块后跑 resolveSelectionContext。paragraphText/headingText 回填到 chip。 */
export async function fetchSelectionContext(
  token: string,
  documentId: string,
  selectedText: string,
): Promise<{ paragraphText?: string; headingText?: string }> {
  const { items } = await listBlocks(token, documentId)
  return resolveSelectionContext(items, selectedText)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/feishu/docx.test.ts`
Expected: PASS（新 describe 全绿，原有用例不回归）。

- [ ] **Step 5: 全量校验 + 提交**

```bash
npm run typecheck && npm test && npm run build
git add src/shared/feishu/docx.ts src/shared/feishu/docx.test.ts
git commit -m "feat(selection): resolve selected text to paragraph + nearest heading via list_blocks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: InputBar 渲染 selection chip + 消费暂存选区

**Files:**
- Modify: `src/sidepanel/components/InputBar.tsx`（扩展 `InputBarHandle`、加 `stagedSelection` prop、chip 渲染分支、抑制文本自动填充）
- Modify: `src/sidepanel/components/InputBar.css`（selection chip 样式）

**Interfaces:**
- Consumes: `tryAddSelectionAttachment`、`selectionToAttachment`（Task 1）、`DocSelectionPayload`（Task 1）。
- Produces: `InputBarHandle` 新增 `addSelection(payload: DocSelectionPayload): boolean`；InputBar 接收新 props `stagedSelection?: DocSelectionPayload | null`、`onStagedConsumed?: () => void`。Task 9/10（ChatPanel/App）传入这些 props。

> 设计要点：chip 状态保留在 InputBar 本地 `attachments` state（与 image/file 一致）。ChatPanel 在会话切换时**不卸载**（只换 `messages` prop），所以 chip 自然跨会话存活——无需提升到 App（比 spec 更简，且与现有附件行为一致）。

- [ ] **Step 1: 扩展 InputBarHandle + props** `src/sidepanel/components/InputBar.tsx`

把第 8-9 行的 handle 接口改为：

```ts
/** Imperative handle so parents (e.g. a field picker) can drop text into the box. */
export interface InputBarHandle {
  insert: (t: string) => void
  /** Stage a doc-selection chip programmatically. Returns false if rejected (cap/dup). */
  addSelection: (payload: DocSelectionPayload) => boolean
}
```

在顶部 import 增补：

```ts
import type { Attachment, DocSelectionPayload } from '../../shared/types'
import { fileToAttachment, validateAttachmentCount, tryAddSelectionAttachment } from '../../shared/attachments'
```
（第 2 行原 `import { fileToAttachment, validateAttachmentCount } from '../../shared/attachments'` 合并为上面这行。）

把 `Props`（:11-23）加两个字段：

```ts
interface Props {
  onSend: (text: string, attachments?: Attachment[]) => void
  disabled: boolean
  busy?: boolean
  onStop?: () => void
  selection?: string
  resourceKind?: string
  /** A doc selection staged for the next send (App drives this on SELECTION_INCOMING). Consumed once. */
  stagedSelection?: DocSelectionPayload | null
  /** Fired after stagedSelection is consumed (added or rejected) so App can clear it. */
  onStagedConsumed?: () => void
}
```

解构参数（:25-28）加上新 props：

```ts
const InputBar = forwardRef<InputBarHandle, Props>(function InputBar(
  { onSend, disabled, busy, onStop, selection, resourceKind, stagedSelection, onStagedConsumed },
  ref,
) {
```

- [ ] **Step 2: 实现 addSelection + 消费 stagedSelection**

在 `insert` 函数（:79-84）下方加 `addSelection`：

```ts
function addSelection(payload: DocSelectionPayload): boolean {
  let added = false
  setAttachments((prev) => {
    const r = tryAddSelectionAttachment(prev, payload)
    added = r.added
    return r.attachments
  })
  suppressSelectionFillRef.current = true // 抑制当次页面选区文本自动填充，避免选区既进 chip 又填进 textarea
  textareaRef.current?.focus()
  return added
}
```

在 `useImperativeHandle`（:86-87）把 `addSelection` 加进 handle：

```ts
useImperativeHandle(ref, () => ({ insert, addSelection }), [insert, addSelection])
```

在组件内（`lastInsertedRef` 声明处 :36 附近）加一个抑制标志：

```ts
const suppressSelectionFillRef = useRef(false)
```

把现有「自动填充页面选区」effect（:68-77）开头加抑制判断：

```ts
// Auto-fill the user's page selection into the box
useEffect(() => {
  const sel = (selection ?? '').trim()
  if (!sel) return
  if (suppressSelectionFillRef.current) { suppressSelectionFillRef.current = false; return }
  const filled = sel + ' '
  if (textRef.current === '' || textRef.current === lastInsertedRef.current) {
    lastInsertedRef.current = filled
    setText(filled)
    textareaRef.current?.focus()
  }
}, [selection])
```

在 `useImperativeHandle` 之后加消费 `stagedSelection` 的 effect：

```ts
// Consume an App-staged doc selection (SELECTION_INCOMING) → push a selection chip once.
useEffect(() => {
  if (!stagedSelection) return
  addSelection(stagedSelection)
  onStagedConsumed?.()
}, [stagedSelection])  // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: chip 渲染分支** 把附件渲染块（:175-193）的 chip 内部改为支持 selection：

```tsx
{attachments.map((a) => (
  <div key={a.id} className="attachment-chip">
    {a.type === 'image' && a.dataUrl ? (
      <img className="attachment-thumb" src={a.dataUrl} alt={a.name} />
    ) : a.type === 'selection' && a.selection ? (
      <span className="attachment-sel" title={a.selection.selectedText}>
        <span className="attachment-sel-doc">{a.selection.docTitle || '文档片段'}</span>
        <span className="attachment-sel-text">{a.selection.selectedText}</span>
      </span>
    ) : (
      <span className="attachment-name">{a.name}</span>
    )}
    <Tooltip content="移除附件">
      <button className="attachment-remove" onClick={() => removeAttachment(a.id)} aria-label="移除附件" type="button">
        ×
      </button>
    </Tooltip>
  </div>
))}
```

- [ ] **Step 4: chip 样式** 在 `src/sidepanel/components/InputBar.css` 的 `.attachment-name` 规则（:66-71）之后插入：

```css
.attachment-sel {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-width: 220px;
  padding: 1px 2px;
}
.attachment-sel-doc {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachment-sel-text {
  font-size: 11px;
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

- [ ] **Step 5: 校验**

```bash
npm run typecheck && npm run build
```
Expected: typecheck 0 错（注意 `addSelection` 进了 `useImperativeHandle` 的依赖数组，可能触发现有 lint 注释约定；本项目用 `// eslint-disable-next-line` 处理，TS 不报错即可）；build 成功。
> UI 验证留到 Task 10 联调（InputBar 需经 ChatPanel 传入 stagedSelection 才能触发）。本任务无新纯函数测试（chip 逻辑的 `tryAddSelectionAttachment` 已在 Task 1 覆盖）。

- [ ] **Step 6: 提交**

```bash
git add src/sidepanel/components/InputBar.tsx src/sidepanel/components/InputBar.css
git commit -m "feat(selection): render + consume selection chips in InputBar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: agent 把 selection 附件渲染成文本元数据 + 系统提示词补一句

**Files:**
- Modify: `src/shared/ai/agent.ts`（抽出纯函数 `attachmentToMetaData` + 在 buildApiHistory 里调用 + 新增 selection 分支；系统提示词加一条）
- Test: `src/shared/ai/agent.test.ts`（补 `attachmentToMetaData` 用例）

**Interfaces:**
- Consumes: `Attachment`（含新 `selection` 字段，Task 1）。
- Produces: 导出 `attachmentToMetaData(a: Attachment): string | null`。`buildApiHistory`（:619-681）改为调用它。image/file 输出**逐字不变**（回归保护），selection 新增。

- [ ] **Step 1: 写失败测试** 在 `src/shared/ai/agent.test.ts` 顶部 import 加 `attachmentToMetaData`，文件末尾追加：

```ts
import { attachmentToMetaData } from './agent'   // 合并到既有 agent import

describe('attachmentToMetaData — 附件 → 文本元数据（喂给 LLM）', () => {
  it('image：原样输出图片占位串', () => {
    const a = { id: 'att1', type: 'image', name: 'a.png', mimeType: 'image/png', size: 0, dataUrl: 'data:image/png;base64,xxx' }
    expect(attachmentToMetaData(a as any)).toBe(`【附件：图片 a.png（attachment_id: att1）】`)
  })
  it('file：原样输出文件占位串（含前导换行）', () => {
    const a = { id: 'f1', type: 'file', name: 'd.csv', mimeType: 'text/csv', size: 3, content: 'x,y\n1,2' }
    expect(attachmentToMetaData(a as any)).toBe(`\n\n【附件：d.csv】\nx,y\n1,2`)
  })
  it('selection（带标题+段落）：输出引用文档片段块', () => {
    const a = { id: 's1', type: 'selection', name: '我的文档', mimeType: 'text/x-feishu-selection', size: 0,
      selection: { kind: 'doc', docToken: 'D1', docTitle: '我的文档', url: 'u', selectedText: '选中内容', paragraphText: '整段文字', headingText: '标题A' } }
    expect(attachmentToMetaData(a as any)).toBe(
      `【引用文档片段｜文档：我的文档｜标题：标题A】\n所在段落：整段文字\n选中的内容：\n选中内容`,
    )
  })
  it('selection（无标题/段落）：省略对应字段', () => {
    const a = { id: 's2', type: 'selection', name: '文档片段', mimeType: 'text/x-feishu-selection', size: 0,
      selection: { kind: 'doc', docToken: 'D1', docTitle: '', url: 'u', selectedText: '选中内容' } }
    expect(attachmentToMetaData(a as any)).toBe(
      `【引用文档片段｜文档：当前文档】\n选中的内容：\n选中内容`,
    )
  })
  it('未知/缺数据 → null', () => {
    expect(attachmentToMetaData({ id: 'x', type: 'image', name: 'a', mimeType: '', size: 0 } as any)).toBe(null) // 无 dataUrl
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/agent.test.ts`
Expected: FAIL（`attachmentToMetaData` 未导出）。

- [ ] **Step 3: 抽出 attachmentToMetaData** 在 `src/shared/ai/agent.ts` 的 `buildApiHistory`（:619）上方插入纯函数：

```ts
/** 把一个附件渲染成喂给 LLM 的文本元数据。image/file 输出与历史完全一致（回归保护）；
 *  selection 是新增：把用户选中的文档片段（带定位上下文）作为可编辑目标交给 agent。
 *  返回 null 表示该附件无可渲染元数据（调用方跳过）。 */
export function attachmentToMetaData(a: Attachment): string | null {
  if (a.type === 'image' && a.dataUrl) return `【附件：图片 ${a.name}（attachment_id: ${a.id}）】`
  if (a.type === 'file' && a.content) return `\n\n【附件：${a.name}】\n${a.content}`
  if (a.type === 'selection' && a.selection) {
    const s = a.selection
    const head = s.headingText ? `｜标题：${s.headingText}` : ''
    const para = s.paragraphText ? `\n所在段落：${s.paragraphText}` : ''
    return `【引用文档片段｜文档：${s.docTitle || '当前文档'}${head}】${para}\n选中的内容：\n${s.selectedText}`
  }
  return null
}
```

- [ ] **Step 4: buildApiHistory 改用该函数** 把 `buildApiHistory` 里附件循环（:667-673）替换为：

```ts
        for (const a of attachments) {
          const meta = attachmentToMetaData(a)
          if (meta) bits.push(meta)
        }
```

（删掉原本的 `if (a.type === 'image' ...) else if (a.type === 'file' ...)` 三行；逻辑等价且新增 selection。`Attachment` 类型顶部已 import，:3。）

- [ ] **Step 5: 系统提示词补一句** 在 `src/shared/ai/agent.ts` 系统提示词「用户上传的图片」那条（:1607）下方加一条：

```ts
  - **用户消息里的「引用文档片段」**是用户在文档里选中后加入会话的内容（带文档名/标题/段落/选中内容）。这是用户想让你修改的目标：用 list_blocks 拉全文，按"选中的内容"文本匹配定位到块、就地改写；位置拿不准就用 ask_user 确认，不要瞎改无关段落。
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/agent.test.ts`
Expected: PASS（新用例 + 原有用例全绿——抽函数是等价改写，buildApiHistory 行为不变）。

- [ ] **Step 7: 全量校验 + 提交**

```bash
npm run typecheck && npm test && npm run build
git add src/shared/ai/agent.ts src/shared/ai/agent.test.ts
git commit -m "feat(selection): render selection attachments as agent context metadata

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: SwitchDocDialog 加 selection 变体文案

**Files:**
- Modify: `src/sidepanel/components/SwitchDocDialog.tsx`

**Interfaces:**
- Produces: `SwitchDocDialog` 新增可选 prop `variant?: 'tab-switch' | 'selection'`（默认 `'tab-switch'`，行为不变）。Task 9 复用 selection 变体。

> 三个按钮（新建会话 / 在当前会话继续 / 关闭）语义不变，只有正文文案随 variant 变。selection 变体描述「选区来自 X，但当前工作文档不同」。

- [ ] **Step 1: 加 variant prop + 文案分支** 把 `src/sidepanel/components/SwitchDocDialog.tsx` 的 Props（:5-15）与组件改为：

```tsx
interface Props {
  /** Title of the document the active tab just switched to (tab-switch) OR the doc the
   *  selection came from (selection). */
  toTitle: string
  /** 「新建会话」— open a fresh session bound to the target document. */
  onNew: () => void
  /** 「在当前会话继续」— re-bind the current session to the target document (keep its history). */
  onStay: () => void
  /** Dismiss. tab-switch defaults to "stay"; selection defaults to "cancel/drop". */
  onCancel: () => void
  /** Copy variant. 'tab-switch' (default) = follow-mode tab navigation; 'selection' = a doc
   *  selection arrived while the work doc differs. Button semantics are identical. */
  variant?: 'tab-switch' | 'selection'
}

export default function SwitchDocDialog({ toTitle, onNew, onStay, onCancel, variant = 'tab-switch' }: Props) {
  useEscapeToClose(onCancel)
  const msg = variant === 'selection' ? (
    <>选区来自「<b>{toTitle}</b>」，但当前工作文档不同。是否切换工作文档？</>
  ) : (
    <>当前标签页已切换到「<b>{toTitle}</b>」。是否为它新建一个会话？</>
  )
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <Tooltip content={variant === 'selection' ? '取消，不添加' : '在当前会话继续'} position="bottom">
          <button className="confirm-x" onClick={onCancel} type="button" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </Tooltip>
        <div className="confirm-icon"></div>
        <h3 className="confirm-title">切换工作文档？</h3>
        <p className="confirm-msg">{msg}</p>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--primary" onClick={onNew} type="button">新建会话</button>
          <button className="confirm-btn confirm-btn--secondary" onClick={onStay} type="button">在当前会话继续</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 校验 + 提交**

```bash
npm run typecheck && npm run build
git add src/sidepanel/components/SwitchDocDialog.tsx
git commit -m "feat(selection): add 'selection' copy variant to SwitchDocDialog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
（无纯函数可测；渲染正确性在 Task 10 联调验证。）

---

## Task 6: useDocBinding 增加选区触发的跨文档切换

**Files:**
- Modify: `src/sidepanel/hooks/useDocBinding.ts`

**Interfaces:**
- Consumes: `DocSelectionPayload`（Task 1）、`sessions.createSession` / `sessions.rebindSession`（既有 `SessionsApi`）。
- Produces: `DocBindingApi` 新增 `pendingSelectionSwitch: SelectionSwitch | null` + `triggerSwitchForSelection(s)` / `handleSelectionSwitchNew()` / `handleSelectionSwitchStay()` / `handleSelectionSwitchCancel()`。Task 9（App）消费 `pendingSelectionSwitch` 渲染 selection 变体弹窗。

> `SelectionSwitch` 携带**已解析**的 docToken（wiki 已在 App 解析为底层 doc）+ docTitle + 原始 payload（供确认后 stage chip）。

- [ ] **Step 1: 类型 + state + handlers** 在 `src/sidepanel/hooks/useDocBinding.ts`：

顶部 import 增补（第 2 行已有 `PageContext, SessionKind, SessionMeta`，加上 `DocSelectionPayload`）：

```ts
import type { PageContext, SessionKind, SessionMeta, DocSelectionPayload } from '../../shared/types'
```

在 `PinnedDoc` 接口（:12）下方加：

```ts
/** A doc selection that arrived while the work doc differs — drives the selection-variant
 *  SwitchDocDialog. docToken is already wiki-resolved (→ underlying doc). */
export interface SelectionSwitch {
  docToken: string
  docTitle: string
  payload: DocSelectionPayload
}
```

在 `DocBindingApi`（:37-54）加成员：

```ts
  pendingSelectionSwitch: SelectionSwitch | null
  triggerSwitchForSelection: (s: SelectionSwitch) => void
  handleSelectionSwitchNew: () => void
  handleSelectionSwitchStay: () => void
  handleSelectionSwitchCancel: () => void
```

在 `useDocBinding` 里 `pendingSessionSwitch` state（:73）旁加：

```ts
  const [pendingSelectionSwitch, setPendingSelectionSwitch] = useState<SelectionSwitch | null>(null)
```

在 `handleSwitchStay`（:205-211）下方加三个 handler：

```ts
  // Selection-driven cross-doc switch (selection-variant SwitchDocDialog). 「新建会话」opens a
  // fresh session for the selection's doc; 「在当前会话继续」re-binds the active session to it.
  // App stages the selection chip AFTER whichever runs (the chip is input-local, session-agnostic).
  function triggerSwitchForSelection(s: SelectionSwitch) { setPendingSelectionSwitch(s) }
  function handleSelectionSwitchNew() {
    const s = pendingSelectionSwitch
    setPendingSelectionSwitch(null)
    if (s) sessions.createSession({ appToken: s.docToken, title: s.docTitle, kind: 'doc' })
  }
  function handleSelectionSwitchStay() {
    const s = pendingSelectionSwitch
    setPendingSelectionSwitch(null)
    const sid = sessions.activeSession?.id
    if (s && sid) sessions.rebindSession(sid, s.docToken, s.docTitle)
  }
  function handleSelectionSwitchCancel() { setPendingSelectionSwitch(null) }
```

把 return 对象（:246-251）补上新增成员：

```ts
  return {
    docMode, pinned, sessions, chatContext,
    pendingSwitch, pendingSessionSwitch, setPendingSessionSwitch,
    pendingSelectionSwitch, triggerSwitchForSelection,
    handleSelectionSwitchNew, handleSelectionSwitchStay, handleSelectionSwitchCancel,
    handleNewSession, handleFollowTabs, setWorkDoc, handleSwitchNew, handleSwitchStay,
    handlePickSession, confirmSessionSwitch,
  }
```

- [ ] **Step 2: 校验 + 提交**

```bash
npm run typecheck && npm test && npm run build
```
Expected: typecheck 0 错；test 全绿（无新纯函数，既有 logic.test.ts 不受影响——`ensureSession`/`removeSession` 未改）；build 成功。

```bash
git add src/sidepanel/hooks/useDocBinding.ts
git commit -m "feat(selection): add selection-driven cross-doc switch to useDocBinding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 内容脚本浮层「添加到会话」按钮

**Files:**
- Create: `src/content/selection-button.ts`
- Modify: `src/content/index.ts`（加 side-effect import）

**Interfaces:**
- Consumes: `parseFeishuContext(location.href)`（`src/shared/feishu/pageUrl.ts:13`）。
- Produces: 发 `chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL_WITH_SELECTION', payload: DocSelectionPayload })`。Task 8（background）消费。无导出（纯 side-effect 模块，仿 viz-launcher 由 index.ts 引入）。

> 浮层用 shadow DOM 隔离（仿 `viz-launcher.ts:31`），按选区 `getBoundingClientRect()` 定位，`selectionchange` + `mouseup` 双触发（debounce 150ms）。只在 `kind ∈ {'doc','wiki'}` 且选区非空时显示。

- [ ] **Step 1: 写 selection-button.ts**

```ts
/**
 * Floating "添加到会话" button shown next to a text selection in Feishu DOC/WIKI pages.
 * Shadow-DOM isolated (mirrors viz-launcher) so Feishu's page CSS can't reach in. On click,
 * asks the background to open the side panel + stage the selection as a chat chip.
 *
 * v1: docs only (docx / wiki). Sheets/base are out of scope (different selection semantics).
 */
import { parseFeishuContext } from '../shared/feishu/pageUrl'

let host: HTMLDivElement | null = null   // shadow host (page-fixed)
let btn: HTMLButtonElement | null = null  // the button inside the shadow root
let refreshTimer: ReturnType<typeof setTimeout> | undefined

/** 'doc' | 'wiki' on a doc/wiki page, else null. */
function docKind(): 'doc' | 'wiki' | null {
  const f = parseFeishuContext(location.href)
  if (!f) return null
  return f.kind === 'doc' || f.kind === 'wiki' ? f.kind : null
}

function currentSelection(): { text: string; rect: DOMRect } | null {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!text || !sel || sel.rangeCount === 0) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return null // collapsed / hidden
  return { text, rect }
}

function ensureButton(): HTMLButtonElement {
  // Rebuild if the host was orphaned — Feishu's SPA can replace document.body (mirrors viz-launcher).
  if (btn && host?.isConnected) return btn
  if (host) { try { host.remove() } catch { /* detached */ } }
  host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483600;display:none;'
  const shadow = host.attachShadow({ mode: 'open' })
  btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = '添加到会话'
  btn.style.cssText =
    'display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:none;border-radius:8px;' +
    'cursor:pointer;background:#4f6bff;color:#fff;box-shadow:0 4px 14px rgba(79,107,255,.4);' +
    "font:12px/1 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;white-space:nowrap;"
  const icon = document.createElement('span')
  icon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
  btn.prepend(icon.firstChild as Node)
  btn.onclick = onClick
  shadow.appendChild(btn)
  document.body.appendChild(host)
  return btn
}

function onClick() {
  const kind = docKind()
  const sel = currentSelection()
  if (!kind || !sel) { hide(); return }
  const f = parseFeishuContext(location.href)
  const docToken = (f?.kind === 'wiki' ? f.wikiToken : f?.documentId) ?? ''
  if (!docToken) { hide(); return }
  try {
    chrome.runtime.sendMessage({
      type: 'OPEN_SIDE_PANEL_WITH_SELECTION',
      payload: { kind, docToken, docTitle: document.title || '', url: location.href, selectedText: sel.text },
    })
  } catch { /* runtime unavailable */ }
  hide()
}

function position(rect: DOMRect) {
  if (!host) return
  // Top-right of the selection rect, clamped into the viewport (avoid the native toolbar's
  // usual top/left spot). A 40px offset puts it just above the selection.
  const left = Math.min(Math.max(rect.right - 60, 6), window.innerWidth - 140)
  const top = Math.max(rect.top - 40, 6)
  host.style.left = `${left}px`
  host.style.top = `${top}px`
}

function show(rect: DOMRect) { ensureButton(); position(rect); if (host) host.style.display = '' }
function hide() { if (host) host.style.display = 'none' }

function refresh() {
  if (!docKind() || !currentSelection()) { hide(); return }
  show(currentSelection()!.rect)
}

// selectionchange covers both mouse-drag and keyboard selection; debounce (fires often mid-drag).
document.addEventListener('selectionchange', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150) })
// Some selections finalize on mouseup without a trailing selectionchange beat.
document.addEventListener('mouseup', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150) })
// Hide on scroll / resize so the button never drifts off the selection.
window.addEventListener('scroll', hide, { passive: true, capture: true })
window.addEventListener('resize', hide, { passive: true })
```

- [ ] **Step 2: 在 index.ts 引入** `src/content/index.ts` 顶部 import 区（:1-6）末尾加一行：

```ts
import './selection-button'
```

（与 `import { refreshLauncher } from './viz-launcher'` 并列；本模块无导出，纯 side-effect。vite-plugin-web-extension 会把它打进既有 content_scripts bundle，无需改 manifest。）

- [ ] **Step 3: 校验**

```bash
npm run typecheck && npm run build
```
Expected: typecheck 0 错；build 成功（content bundle 含新模块）。
> 内容脚本 DOM 行为**无法在 dev:ui 或单测验证**——留到 Task 10 用 `dev:ext` 在真机飞书文档页验证（选中文字→按钮出现→点击）。

- [ ] **Step 4: 提交**

```bash
git add src/content/selection-button.ts src/content/index.ts
git commit -m "feat(selection): floating 'add to chat' button on Feishu doc selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: background 中继——开侧边栏 + 暂存选区（仿 CLIP_REQUEST）

**Files:**
- Modify: `src/background/index.ts`

**Interfaces:**
- Consumes: `OPEN_SIDE_PANEL_WITH_SELECTION`（Task 7 发）、`DocSelectionPayload`（Task 1）。
- Produces: 开侧边栏 + 暂存 `pendingSelection` + 推送 `SELECTION_INCOMING`；响应 `SELECTION_REQUEST`（Task 9 在 App mount 后拉取，覆盖"面板未就绪"竞态）。

> 完全镜像既有 CLIP 模式（`background/index.ts:155-163` 的 `CLIP_REQUEST` 暂存+拉取，:54/85/111 的 `chrome.sidePanel.open({tabId})`）。TTL 3s 兜底防陈旧选区。

- [ ] **Step 1: 加暂存变量 + 两个 listener** 在 `src/background/index.ts` 顶部 import 区找到类型引入处，补 `DocSelectionPayload`（若 background 未引 types，加 `import type { DocSelectionPayload } from '../shared/types'`）。

在 `RESOLVE_PAGE_RESOURCE` listener（:187-205）附近新增两个独立 listener（每个 listener 只认自己的 type，return undefined 让别的 listener 继续）：

```ts
// ─── Selection → side panel: open the panel + stash the payload so the panel can pull it on
// mount (mirrors the CLIP_REQUEST pattern — covers the open→message race where the panel
// isn't listening yet). The button click is the user gesture MV3 requires for sidePanel.open.
let pendingSelection: { payload: DocSelectionPayload; at: number } | null = null
const SELECTION_TTL_MS = 3000

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'OPEN_SIDE_PANEL_WITH_SELECTION') return undefined
  const payload = msg.payload as DocSelectionPayload | undefined
  if (!payload?.docToken || !payload?.selectedText) return undefined
  pendingSelection = { payload, at: Date.now() }
  const tabId = sender.tab?.id
  if (tabId != null) chrome.sidePanel.open({ tabId }).catch(() => {})
  // Best-effort push to an already-open panel (no-op if none listening yet — the pull covers it).
  try { chrome.runtime.sendMessage({ type: 'SELECTION_INCOMING', payload }) } catch { /* panel not open */ }
  return undefined
})

// Panel pulls the pending selection on mount (handles the open→message race), one-shot + TTL.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'SELECTION_REQUEST') return undefined
  const s = pendingSelection
  pendingSelection = null
  if (s && Date.now() - s.at > SELECTION_TTL_MS) { sendResponse(null); return false } // stale → drop
  sendResponse(s?.payload ?? null)
  return false
})
```

- [ ] **Step 2: 校验 + 提交**

```bash
npm run typecheck && npm run build
git add src/background/index.ts
git commit -m "feat(selection): background relay — open side panel + stash selection (CLIP pattern)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
（background 行为在 Task 10 真机联调验证。）

---

## Task 9: App 接线——收件、wiki 解析、工作文档比对、暂存/切换、回填上下文 + ChatPanel 透传

**Files:**
- Modify: `src/sidepanel/App.tsx`（onMsg 加 SELECTION_INCOMING；新增 stagedSelection/selectionSwitch state + handleSelectionIncoming + resolveWikiToDoc + 回填 effect；弹窗 mutex 加 selection 变体分支；ChatPanel 透传新 props）
- Modify: `src/sidepanel/components/ChatPanel.tsx`（Props 加 `stagedSelection` / `onStagedConsumed`，透传给 InputBar）

**Interfaces:**
- Consumes: Task 1（DocSelectionPayload）、Task 2（fetchSelectionContext）、Task 3（InputBar stagedSelection props）、Task 5（SwitchDocDialog variant）、Task 6（doc.pendingSelectionSwitch + handlers）、Task 8（SELECTION_INCOMING / SELECTION_REQUEST）。既有：`resolveToken`、`getWikiNode`、`wikiToFeishu`、`cleanDocTitle`、`useDocBinding` 返回的 `doc` / `sessions`、`wikiCacheRef`、`settings`。

> 这是把前 8 个任务串起来的集成任务。验不了单测——靠 typecheck + build + Task 10 真机。

- [ ] **Step 1: ChatPanel 透传 props** `src/sidepanel/components/ChatPanel.tsx`：

在 `Props`（:28 起）加两个字段（找到 `disabled: boolean` 那块，紧随其它字段加）：

```ts
  /** A doc selection staged from the page (SELECTION_INCOMING) — consumed once by InputBar. */
  stagedSelection?: DocSelectionPayload | null
  onStagedConsumed?: () => void
```

顶部 import 加 `DocSelectionPayload`（ChatPanel 已 import `PageContext` 等自 `../../shared/types`，合并即可）。

在既有 `<InputBar ref={inputRef} ... />`（:414-422）上**只新增两个 prop**，其余既有 prop（ref/onSend/disabled/busy/selection/resourceKind，以及若已存在的 onStop 等）原样保留、不要改：

```tsx
        stagedSelection={stagedSelection}
        onStagedConsumed={onStagedConsumed}
```

- [ ] **Step 2: App 加 state + handler + 回填 + 透传** `src/sidepanel/App.tsx`：

顶部 import 增补（合并到既有同源 import）：

```ts
import type { DocSelectionPayload } from '../shared/types'
import { fetchSelectionContext } from '../shared/feishu/docx'
import { getWikiNode } from '../shared/feishu/api'
import { wikiToFeishu } from './hooks/useWikiResolve'
import { resolveToken } from '../shared/feishu/auth'
```
（`cleanDocTitle` 已 import；`settings` / `wikiCacheRef` / `doc` / `sessions` 在组件内已有。确认 `getWikiNode` / `resolveToken` / `wikiToFeishu` 未被重复 import。）

在组件内（`applyCtx` / 其它 state 附近）加：

```ts
const [stagedSelection, setStagedSelection] = useState<DocSelectionPayload | null>(null)

// 工作文档 token（wiki 优先解析为底层 doc token 再比对，避免 wiki↔docx 同一篇被误判）。
const activeDocToken = docMode === 'pin' ? (doc.pinned?.token ?? null) : (doc.sessions.activeSession?.appToken ?? null) // 已有同款计算则复用，勿重复
function workDocResolvedToken(): string | null {
  const t = activeDocToken
  if (!t) return null
  return wikiCacheRef.current.get(t)?.documentId ?? t
}

// wiki 节点 → 底层 doc token（复用 useDocBinding:155-166 的 getWikiNode + wikiToFeishu 套路 + 共享缓存）。
async function resolveWikiToDoc(wikiToken: string): Promise<string | undefined> {
  const cached = wikiCacheRef.current.get(wikiToken)
  if (cached?.documentId) return cached.documentId
  try {
    const token = await resolveToken(settings)
    const res = (await getWikiNode(token, wikiToken)) as { node?: { obj_type: string; obj_token: string } }
    const f = wikiToFeishu(res.node?.obj_type ?? '', res.node?.obj_token ?? '')
    return f?.documentId
  } catch { return undefined }
}

// 收到页面选区：解析 wiki → 比对工作文档 → 直接暂存 或 触发 selection-variant 切换弹窗。
async function handleSelectionIncoming(payload: DocSelectionPayload) {
  let docToken = payload.docToken
  let kind = payload.kind
  if (kind === 'wiki') {
    const real = await resolveWikiToDoc(payload.docToken)
    if (real) { docToken = real; kind = 'doc' }
  }
  const resolved: DocSelectionPayload = { ...payload, kind, docToken }
  if (docToken === workDocResolvedToken()) {
    setStagedSelection(resolved)
  } else {
    doc.triggerSwitchForSelection({ docToken, docTitle: payload.docTitle, payload: resolved })
  }
}
```

> 注：若 App 已有 `activeDocToken` 计算（见 useDocBinding 调研里 App.tsx:80 的写法），直接复用那个变量，不要重复声明——上面 `activeDocToken` 那行仅在不存在时新增。`docMode` / `doc.pinned` 在 App 内可用（`doc = useDocBinding(...)`，:72）。

- [ ] **Step 3: onMsg 收 SELECTION_INCOMING** 把 onMsg listener（:158-170）在 `PAGE_CONTEXT_UPDATE` 判断**之前**加一个分支：

```ts
      if (msg.type === 'SELECTION_INCOMING') {
        void handleSelectionIncoming(msg.payload as DocSelectionPayload)
        return
      }
      if (msg.type !== 'PAGE_CONTEXT_UPDATE') return
```

并在该 effect（mount）里，仿 CLIP_REQUEST 的拉取（:174-181）加一段 SELECTION_REQUEST 拉取，覆盖面板刚打开、push 未被听到的竞态：

```ts
      chrome.runtime.sendMessage({ type: 'SELECTION_REQUEST' }).then((resp) => {
        const p = resp as DocSelectionPayload | null
        if (p) void handleSelectionIncoming(p)
      }).catch(() => { /* no background / no pending */ })
```

- [ ] **Step 4: 回填段落/标题上下文** 在组件内加一个 effect：当 `stagedSelection` 落地后，异步用 list_blocks 回填 paragraphText/headingText 到 InputBar 里对应 chip。由于 chip 在 InputBar 本地 state，最简方案是通过命令式 `inputRef`——但 App 不持有 inputRef（ChatPanel 持有）。因此改用：回填结果合并进 `stagedSelection` 后**再次 stage**（InputBar 的 `tryAddSelectionAttachment` 会因 selectedText 相同判为 dup 而跳过）——不可行。

  正确做法：让回填在 InputBar 内部完成（InputBar 已 import `fetchSelectionContext`？否）。为避免穿透 inputRef，把回填做在 ChatPanel：ChatPanel 持有 `inputRef`，给 InputBar 加一个 `enrichSelection(docToken, selectedText)` 命令式方法。**但**更简单且符合既有"prop 驱动"风格的是：跳过自动回填作为 v1——chip 先只带 selectedText（agent 仍能用 list_blocks 自行匹配，系统提示词已说明）。**v1 不做自动回填**，paragraphText/headingText 留空；`fetchSelectionContext` 仍保留供后续增强。

  → 本步骤 v1 **不写回填 effect**（YAGNI）。`fetchSelectionContext` 已在 Task 2 实现并测试，作为后续增强的现成入口。在 `handleSelectionIncoming` 里**不调用**它。`fetchSelectionContext` 的 import 仅用于类型可发现性——若 TS 报 unused，**移除该 import**（Task 2 已独立测过该函数）。

  执行：若 Step 2 加的 `import { fetchSelectionContext }` 未被使用，删除它（避免 unused import 报错）。

- [ ] **Step 5: 弹窗 mutex 加 selection 变体 + 透传 stagedSelection 给 ChatPanel**

把弹窗 mutex（:371-384）改为三分支（selection 优先于 tab-switch）：

```tsx
      {doc.pendingSessionSwitch ? (
        <SwitchSessionDialog
          docTitle={doc.pendingSessionSwitch.title}
          onConfirm={() => { void doc.confirmSessionSwitch().then(() => setDrawerOpen(false)) }}
          onCancel={() => doc.setPendingSessionSwitch(null)}
        />
      ) : doc.pendingSelectionSwitch ? (
        <SwitchDocDialog
          variant="selection"
          toTitle={doc.pendingSelectionSwitch.docTitle || '当前文档'}
          onNew={() => { const p = doc.pendingSelectionSwitch?.payload ?? null; doc.handleSelectionSwitchNew(); setStagedSelection(p) }}
          onStay={() => { const p = doc.pendingSelectionSwitch?.payload ?? null; doc.handleSelectionSwitchStay(); setStagedSelection(p) }}
          onCancel={doc.handleSelectionSwitchCancel}
        />
      ) : doc.pendingSwitch && !chatStreaming ? (
        <SwitchDocDialog
          toTitle={cleanDocTitle(ctx.title) || '当前文档'}
          onNew={doc.handleSwitchNew}
          onStay={doc.handleSwitchStay}
          onCancel={doc.handleSwitchStay}
        />
      ) : null}
```

> 顺序要点：`onNew`/`onStay` 里 handler 内部会 `setPendingSelectionSwitch(null)`，所以**必须先用局部变量取出 payload，再调 handler，最后 stage**——否则 handler 清空后取不到 payload。上面两行的 `const p = …; doc.handle…(); setStagedSelection(p)` 即此顺序。

把 `<ChatPanel>`（:327-349）加两个 prop：

```tsx
                <ChatPanel
                  /* …既有 props 不动… */
                  stagedSelection={stagedSelection}
                  onStagedConsumed={() => setStagedSelection(null)}
                />
```

- [ ] **Step 6: 校验**

```bash
npm run typecheck && npm test && npm run build
```
Expected: typecheck 0 错（注意删除未用的 `fetchSelectionContext` import）；test 全绿；build 成功。

- [ ] **Step 7: 提交**

```bash
git add src/sidepanel/App.tsx src/sidepanel/components/ChatPanel.tsx
git commit -m "feat(selection): wire SELECTION_INCOMING → stage chip / cross-doc switch in App

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 真机联调（dev:ext，飞书文档页）

**Files:** 无代码改动——验证清单。

> 内容脚本 + 侧边栏开/关 + 跨进程消息只能在真实扩展里验证（`dev:ui` 验不了内容脚本）。按记忆 `devui-testui-windows.md`：`dev:ui` 只能验 UI 静态；内容脚本走 `dev:ext` 加载 `dist/` 真机验。

- [ ] **Step 1: 构建 + 加载扩展**

```bash
npm run build
```
在 `chrome://extensions` 开发者模式下「加载已解压」选 `dist/`（若已加载，点刷新重新加载）。确认 `dist/` 里 `src/content/selection-button.*` 与 manifest content_scripts 入口存在。

- [ ] **Step 2: 文档页选区 → 按钮**

打开一篇飞书文档（`/docx/...`），选中一段文字：
- [ ] 选区右上方出现「添加到会话」蓝色按钮（带 → 图标，无 emoji）。
- [ ] 换选别处，按钮跟随移动；点空白取消选区，按钮消失。
- [ ] 上下滚动时按钮隐藏（不漂移）。

- [ ] **Step 3: 侧边栏已开 → stage chip**

先点扩展图标打开侧边栏（停在**同一篇**文档的会话），再到文档页选中一段点按钮：
- [ ] 侧边栏输入框出现一个引用 chip（文档名 + 选中片段预览 + ×）。
- [ ] 输入框 textarea **没有**被自动填入选区文本（抑制生效）。
- [ ] 点 chip 的 × 可移除；连点 5 次不同选区后再点第 6 次，不再新增（达到上限）。
- [ ] 同一段连点两次，第二次不新增（去重）。

- [ ] **Step 4: 发送给 agent**

带一个 chip + 写一句指令（如"把这段改得更简洁"）发送：
- [ ] 控制台/网络可见 agent 收到的 user 消息里含「【引用文档片段｜文档：…】…选中的内容：…」。
- [ ] agent 用 list_blocks 定位并改写了**选中段落**（而非整篇）。

- [ ] **Step 5: 侧边栏未开 → 自动打开**

关掉侧边栏，在文档页选中一段点按钮：
- [ ] 侧边栏自动打开，且 chip 已 stage（SELECTION_REQUEST 拉取覆盖了竞态）。

- [ ] **Step 6: 跨文档 → 切换弹窗**

把侧边栏工作文档 pin 到文档 A（会话顶部下拉 pin，或在 A 的会话里停留），再到文档 B 选中一段点按钮：
- [ ] 弹出 selection 变体的「切换工作文档？」弹窗，文案为「选区来自「B」，但当前工作文档不同…」。
- [ ] 点「新建会话」→ 新建 B 的会话 + chip 进输入框；点「在当前会话继续」→ 当前会话 rebind 到 B + chip 进输入框；点关闭/Esc → 取消、不加 chip。

- [ ] **Step 7: wiki 页**

打开知识库里的文档（`/wiki/...`），选中一段点按钮：
- [ ] chip 能正常 stage；agent 能 list_blocks 读到内容（说明 wiki→doc 解析生效）。

- [ ] **Step 8: 回归**

- [ ] 既有图片/文件附件 chip 仍正常（上传、发送、agent 看到原样元数据）。
- [ ] `npm test` 仍全绿；既有会话切换/`SwitchDocDialog`（tab-switch 变体）文案未变。

- [ ] **Step 9: 联调通过后提交（如有微小样式/文案微调）**

```bash
git add -A
git commit -m "chore(selection): real-device tweaks after dev:ext verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
（无改动则跳过。）

---

## 备注：与 spec 的偏差

- **chip 状态位置**：spec §4.5 写「chip 状态提升到 App 层」。实现改为保留在 InputBar 本地 `attachments` state——因为 ChatPanel 在会话切换时**不卸载**（只换 `messages` prop），chip 自然跨会话存活，且与既有 image/file 附件行为一致，改动更小。（切 tab 到 settings/scenes 再回来会丢——但这是既有附件的限制，非本特性引入。）
- **段落/标题自动回填**：spec §4.6 设计了 chip 落地后异步回填 paragraphText/headingText。v1 **不做自动回填**（YAGNI）——chip 只带 selectedText，agent 仍能用 list_blocks 自行匹配（系统提示词已说明）。`fetchSelectionContext` 已实现+测试，作为后续增强的现成入口。
- **wiki 工作文档比对**：spec §4.5 说双方都解析。实现里 selection 侧解析 wiki→doc；工作文档侧用共享 wiki 缓存尽力解析（`wikiCacheRef.current.get(t)?.documentId ?? t`）。未解析的 wiki 工作文档可能触发一次多余弹窗——v1 可接受（弹窗非破坏性）。
