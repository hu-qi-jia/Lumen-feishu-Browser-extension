# PDF 转写面板重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已建成的 PDF 转写能力包进一套更完整的交互——选文件/转换分离、预览/Markdown 切换、按需 AI 润色、目标文档下拉（含最近文档）、转换历史。

**Architecture:** 底层模块（`pdfExtract` / `mdPolish` / `parseDocRef` / `docx`）全部复用不动；新增共享件（`Markdown` 渲染器抽自聊天、`DocCombobox`、`pdfHistory` 存储、`IconUpload`/`IconHistory`）；重写 `PdfTranscribePanel` 为 idle→selected→converting→done 状态机；把 App 已有的 `recentFiles` 透过 `ScenarioPanel` 接进来。

**Tech Stack:** React 18 + TS + Vite + vitest；Chrome MV3 扩展。无新依赖。

## Global Constraints
- 纯前端、无后端、无付费、无 Python。**不引入任何新 npm 依赖**（cheapest-viable）。
- UI **无 emoji**；图标走 `icons.tsx` 内联 stroke SVG 风格。**生成/主 CTA 按钮不放图标**（复制/下载/AI润色/添加到文档 等按钮无图标）；工具/导航按钮（历史按钮、combobox 展开钮、移除钮）保留图标。
- 测试约定：`*.test.ts(x)` 与源码同目录；vitest 默认 `'node'` env，组件测试用 `/* @vitest/environment jsdom */` docblock；**未装 `@testing-library/jest-dom`** → 用 `.toBeTruthy()`/`.toBeNull()`；组件测试 `afterEach(cleanup)`。
- **写操作不自动重试**（CLAUDE.md 约束 7）。
- `pdf2md` 保持**动态 `import()`**（pdfjs 不进主 chunk）。
- 只用用户飞书身份（`resolveToken`）；出站走既有 `feishuReq`/`assertSafeBaseUrl`。
- 提交 trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。分支 `feishu-ok`。
- 迭代门：每任务 `npm run typecheck`（0 错）→ `npm test`（全绿）→ `npm run build`（成功）。

**Spec**：`docs/superpowers/specs/2026-07-03-pdf-transcribe-redesign.md`（权威设计）。

---

## File Structure

| 文件 | 动作 | 任务 |
|---|---|---|
| `src/sidepanel/components/Markdown.tsx` + `.css` + `.test.tsx` | 新建（抽自 MessageList） | T1 |
| `src/sidepanel/components/MessageList.tsx` / `.css` | 改：去重 + import 共享 Markdown | T1 |
| `src/sidepanel/pdfHistory.ts` + `.test.ts` | 新建 | T2 |
| `src/sidepanel/components/icons.tsx` | 改：加 `IconUpload`、`IconHistory` | T2 |
| `src/sidepanel/components/DocCombobox.tsx` + `.css` + `.test.tsx` | 新建 | T3 |
| `src/sidepanel/components/PdfTranscribePanel.tsx` + `.css` + `.test.tsx` | 重写 | T4 |
| `src/sidepanel/components/ScenarioPanel.tsx` | 改：透传 recentFiles/onRemoveRecent | T4 |
| `src/sidepanel/App.tsx` | 改：传 recentFiles/onRemoveRecent 给 ScenarioPanel | T4 |

---

## Task 1: 抽出共享 Markdown 渲染器（风险隔离，先做）

**Files:**
- Create: `src/sidepanel/components/Markdown.tsx`、`src/sidepanel/components/Markdown.css`、`src/sidepanel/components/Markdown.test.tsx`
- Modify: `src/sidepanel/components/MessageList.tsx`（删被抽走的函数、改 import）、`src/sidepanel/components/MessageList.css`（移走 `.md-*` 规则）

**Why first:** 这是唯一会动到聊天渲染（`MessageList`，聊天核心）的改动，独立先做、靠聊天测试全绿把关。

- [ ] **Step 1: 写失败测试** `src/sidepanel/components/Markdown.test.tsx`

```tsx
/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Markdown from './Markdown'

describe('Markdown', () => {
  it('renders headings, paragraphs, lists', () => {
    render(<Markdown>{'# 标题\n正文\n- 项 A\n- 项 B'}</Markdown>)
    expect(screen.getByText('标题').tagName).toBe('H2')
    expect(screen.getByText('正文').tagName).toBe('P')
    expect(screen.getByText('项 A').tagName).toBe('LI')
  })
  it('renders a fenced code block', () => {
    const { container } = render(<Markdown>{'```js\nconsole.log(1)\n```'}</Markdown>)
    expect(container.querySelector('.md-code-block')).toBeTruthy()
    expect(container.querySelector('.md-code-lang')?.textContent).toBe('js')
  })
  it('renders a github-style table', () => {
    const { container } = render(<Markdown>{'| A | B |\n|---|---|\n| 1 | 2 |'}</Markdown>)
    expect(container.querySelector('.md-table')).toBeTruthy()
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
  })
  it('renders an https link as an anchor', () => {
    render(<Markdown>{'见 https://example.com 页'}</Markdown>)
    const a = document.querySelector('.md-link') as HTMLAnchorElement | null
    expect(a).toBeTruthy()
    expect(a?.href).toBe('https://example.com/')
  })
})
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run src/sidepanel/components/Markdown.test.tsx` → FAIL（找不到 `./Markdown`）。

- [ ] **Step 3: 新建 `Markdown.tsx`**（把 MessageList 里 `MarkdownText` + 全部辅助函数原样搬来；`MarkdownText` 重命名导出为默认 `Markdown`，props `{ text: string }` 改为 `{ children: string }`）

```tsx
import type { ReactNode, MouseEvent } from 'react'
import { openUrlInNewTab } from '../../shared/url'
import './Markdown.css'

/** Hand-rolled minimal markdown → React (headings, lists, tables, code, links).
 *  Extracted from MessageList so chat + PDF preview share one renderer. */
export default function Markdown({ children }: { children: string }) {
  const lines = children.split('\n')
  const elements: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++ }
      const joined = codeLines.join('\n').trim()
      const codeUrl = safeHref(joined)
      if (codeUrl && !/\s/.test(joined)) {
        elements.push(<p key={i} className="md-p">{linkEl(codeUrl, codeUrl, i)}</p>)
      } else {
        elements.push(
          <pre key={i} className="md-code-block">
            {lang && <span className="md-code-lang">{lang}</span>}
            <code>{codeLines.join('\n')}</code>
          </pre>,
        )
      }
    } else if (isTableHeader(lines, i)) {
      const header = splitCells(line)
      let j = i + 2
      const rows: string[][] = []
      while (j < lines.length && lines[j].trim().startsWith('|')) { rows.push(splitCells(lines[j])); j++ }
      elements.push(
        <table key={i} className="md-table">
          <thead><tr>{header.map((h, k) => <th key={k}>{inlineFormat(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{header.map((_, ci) => <td key={ci}>{inlineFormat(r[ci] ?? '')}</td>)}</tr>)}</tbody>
        </table>,
      )
      i = j - 1
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="md-h3">{inlineFormat(line.slice(4))}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="md-h2">{inlineFormat(line.slice(3))}</h2>)
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="md-h2">{inlineFormat(line.slice(2))}</h2>)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<li key={i} className="md-li">{inlineFormat(line.slice(2))}</li>)
    } else if (line.trim() === '') {
      elements.push(<br key={i} />)
    } else {
      elements.push(<p key={i} className="md-p">{inlineFormat(line)}</p>)
    }
    i++
  }
  return <div className="md-content">{elements}</div>
}

const safeHref = (url: string): string | null => (/^https?:\/\//i.test(url) ? url : null)

function splitCells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}
function isTableHeader(lines: string[], i: number): boolean {
  const sep = lines[i + 1]
  return lines[i].trim().startsWith('|') && !!sep && sep.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(sep)
}
function openExternal(e: MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault()
  openUrlInNewTab(href)
}
function linkEl(href: string, label: string, key: ReactNode) {
  return <a key={key} className="md-link" href={href} target="_blank" rel="noreferrer" onClick={(e) => openExternal(e, href)}>{label}</a>
}
function linkInCode(inner: string, key: ReactNode): ReactNode | null {
  const md = inner.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (md && safeHref(md[2])) return linkEl(safeHref(md[2])!, md[1], key)
  const href = safeHref(inner.trim())
  return href ? linkEl(href, inner.trim(), key) : null
}
function inlineFormat(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('`') && part.endsWith('`')) {
      const inner = part.slice(1, -1)
      return linkInCode(inner, i) ?? <code key={i} className="md-code">{inner}</code>
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    const mdLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (mdLink) {
      const href = safeHref(mdLink[2])
      return href ? linkEl(href, mdLink[1], i) : mdLink[1]
    }
    if (safeHref(part)) return linkEl(part, part, i)
    return part
  })
}
```

- [ ] **Step 4: 新建 `Markdown.css`** — 把 `MessageList.css` 里**所有以 `.md-` 开头的选择器规则**整段搬到 `Markdown.css`（`.md-content` / `.md-h2` / `.md-h3` / `.md-p` / `.md-code` / `.md-code-block` / `.md-code-lang` / `.md-table` / `.md-li` / `.md-link` 等）。读 `MessageList.css`，逐条剪切过来；`MessageList.css` 里这些规则删除。`MessageList.tsx` 不再需要单独为 md 引 CSS（`Markdown` 自带）。

- [ ] **Step 5: 改 `MessageList.tsx`** — 删除被抽走的函数（`MarkdownText`、`safeHref`、`splitCells`、`isTableHeader`、`openExternal`、`linkEl`、`linkInCode`、`inlineFormat`）；在文件顶部 import 区加 `import Markdown from './Markdown'`；把用到 `<MarkdownText text={...} />` 的地方改为 `<Markdown>{...}</Markdown>`（`text` prop 内容移到 children）。`openUrlInNewTab` 的 import 若 MessageList 不再直接用则删（grep 确认）。

- [ ] **Step 6: 跑门** — `npm run typecheck`（0 错）→ `npx vitest run src/sidepanel/components/Markdown.test.tsx`（4 passed）→ `npm test`（**重点：聊天 MessageList 相关测试全绿**）→ `npm run build`。

- [ ] **Step 7: 提交** — `git add` 上述新建+改动文件（不含无关 spec working-tree 改动）。subject：`refactor(chat): extract shared Markdown renderer for reuse`。

---

## Task 2: pdfHistory 存储 + 上传/历史图标

**Files:**
- Create: `src/sidepanel/pdfHistory.ts`、`src/sidepanel/pdfHistory.test.ts`
- Modify: `src/sidepanel/components/icons.tsx`

- [ ] **Step 1: 写失败测试** `src/sidepanel/pdfHistory.test.ts`（vitest 默认 node env；mock `chrome.storage.local`，参照 `recentFiles`/`slidesStore` 既有测试写法）

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadPdfs, savePdf, deletePdf, MAX_PDFS } from './pdfHistory'

const store: Record<string, unknown> = {}
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  ;(globalThis as any).chrome = {
    storage: { local: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
        const r: Record<string, unknown> = {}
        for (const k of keys) r[k] = store[k]
        cb(r)
      },
      set: (obj: Record<string, unknown>, cb: () => void) => { Object.assign(store, obj); cb() },
    } },
  }
})

describe('pdfHistory', () => {
  it('savePdf inserts newest-first and dedups by id', async () => {
    await savePdf({ id: 'a', fileName: 'a.pdf', markdown: '# A', createdAt: 1 })
    await savePdf({ id: 'b', fileName: 'b.pdf', markdown: '# B', createdAt: 2 })
    let list = await loadPdfs()
    expect(list.map((x) => x.id)).toEqual(['b', 'a'])
    await savePdf({ id: 'a', fileName: 'a.pdf', markdown: '# A2', createdAt: 3 })
    list = await loadPdfs()
    expect(list.map((x) => x.id)).toEqual(['a', 'b'])   // dedup + lifted to front
    expect(list.find((x) => x.id === 'a')?.markdown).toBe('# A2')
  })
  it('caps at MAX_PDFS', async () => {
    for (let i = 0; i < MAX_PDFS + 3; i++) await savePdf({ id: `id${i}`, fileName: `${i}.pdf`, markdown: '', createdAt: i })
    expect((await loadPdfs()).length).toBe(MAX_PDFS)
  })
  it('deletePdf removes by id', async () => {
    await savePdf({ id: 'a', fileName: 'a.pdf', markdown: '', createdAt: 1 })
    await savePdf({ id: 'b', fileName: 'b.pdf', markdown: '', createdAt: 2 })
    const list = await deletePdf('a')
    expect(list.map((x) => x.id)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: 跑确认失败** — `npx vitest run src/sidepanel/pdfHistory.test.ts` → FAIL（找不到 `./pdfHistory`）。

- [ ] **Step 3: 新建 `src/sidepanel/pdfHistory.ts`**（照搬 `slidesStore.ts` 结构，去掉 `scheduleBackup`——PDF 历史纯本地；key `pdfHistory_v1`，cap 20）

```ts
/** Saved PDF→Markdown conversions (PDF 转写历史). Local-only — a past conversion can be
 *  reopened without re-parsing. Mirrors slidesStore / recentFiles patterns. */
export interface SavedPdf {
  id: string
  fileName: string
  markdown: string
  createdAt: number
}

const KEY = 'pdfHistory_v1'
export const MAX_PDFS = 20

function get(): Promise<SavedPdf[]> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res([]); return }
      chrome.storage.local.get([KEY], (r) => res(Array.isArray(r?.[KEY]) ? (r[KEY] as SavedPdf[]) : []))
    } catch { res([]) }
  })
}
function set(list: SavedPdf[]): Promise<void> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res(); return }
      chrome.storage.local.set({ [KEY]: list }, () => res())
    } catch { res() }
  })
}

export async function loadPdfs(): Promise<SavedPdf[]> {
  return get()
}
/** Upsert (dedup by id → lift to front) and cap at MAX_PDFS. Returns the new list. */
export async function savePdf(p: SavedPdf): Promise<SavedPdf[]> {
  const list = await get()
  const next = [p, ...list.filter((x) => x.id !== p.id)].slice(0, MAX_PDFS)
  await set(next)
  return next
}
export async function deletePdf(id: string): Promise<SavedPdf[]> {
  const next = (await get()).filter((x) => x.id !== id)
  await set(next)
  return next
}
```

- [ ] **Step 4: 跑测试** — `npx vitest run src/sidepanel/pdfHistory.test.ts` → 3 passed。

- [ ] **Step 5: 加图标到 `icons.tsx`**（在 `IconList` 之后、`KindIcon` 之前插入两个导出；风格与现有一致）

```tsx
export const IconUpload = (p: P) => (
  <svg {...common} {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

export const IconHistory = (p: P) => (
  <svg {...common} {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <line x1="12" y1="7" x2="12" y2="12" />
    <line x1="12" y1="12" x2="15.5" y2="14" />
  </svg>
)
```
（`IconHistory` = SlidesPanel 历史时钟图标；额外加两根表针让它更像"历史/时间"。SlidesPanel 改用此导出为**可选 polish**，不属本任务。）

- [ ] **Step 6: 跑门** — `npm run typecheck` → `npm test` → `npm run build`。

- [ ] **Step 7: 提交** — `feat(pdf): add pdfHistory store + IconUpload/IconHistory`。

---

## Task 3: DocCombobox（目标文档下拉输入框）

**Files:**
- Create: `src/sidepanel/components/DocCombobox.tsx`、`src/sidepanel/components/DocCombobox.css`、`src/sidepanel/components/DocCombobox.test.tsx`

**Interfaces:**
- Consumes: `RecentFile`（`../recentFiles`）、`parseDocTokenFromUrl`（T1 前）、`KindIcon`/`IconX`（icons）、`Button`。
- Produces: `export interface DocTarget { token: string; title: string }`（供 T4 复用）；默认导出组件。

- [ ] **Step 1: 写失败测试** `DocCombobox.test.tsx`

```tsx
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import DocCombobox from './DocCombobox'

const RECENT = [
  { token: 'tokA', title: '需求文档', kind: 'doc', seen: 3 },
  { token: 'tokB', title: '周报', kind: 'sheet', seen: 2 },
]
afterEach(cleanup)

describe('DocCombobox', () => {
  it('lists recent docs on focus and picks one', () => {
    const onTargetChange = vi.fn()
    render(<DocCombobox recentFiles={RECENT} target={null} onTargetChange={onTargetChange} onConfirm={() => {}} />)
    fireEvent.focus(screen.getByTestId('dc-input'))
    fireEvent.click(screen.getByText('需求文档'))
    expect(onTargetChange).toHaveBeenCalledWith({ token: 'tokA', title: '需求文档' })
  })
  it('parses a pasted link into a token', () => {
    const onTargetChange = vi.fn()
    render(<DocCombobox recentFiles={[]} target={null} onTargetChange={onTargetChange} onConfirm={() => {}} />)
    fireEvent.change(screen.getByTestId('dc-input'), { target: { value: 'https://x.feishu.cn/docx/ABC123defgh' } })
    expect(onTargetChange).toHaveBeenCalledWith({ token: 'ABC123defgh', title: 'https://x.feishu.cn/docx/ABC123defgh' })
  })
  it('calls onTargetChange(null) for unparseable input', () => {
    const onTargetChange = vi.fn()
    render(<DocCombobox recentFiles={[]} target={null} onTargetChange={onTargetChange} onConfirm={() => {}} />)
    fireEvent.change(screen.getByTestId('dc-input'), { target: { value: '乱七八糟' } })
    expect(onTargetChange).toHaveBeenCalledWith(null)
  })
  it('fires onConfirm from the 添加到文档 button', () => {
    const onConfirm = vi.fn()
    render(<DocCombobox recentFiles={[]} target={{ token: 't', title: 'x' }} onTargetChange={() => {}} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByText('添加到文档'))
    expect(onConfirm).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑确认失败** — `npx vitest run src/sidepanel/components/DocCombobox.test.tsx` → FAIL。

- [ ] **Step 3: 新建 `DocCombobox.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { RecentFile } from '../recentFiles'
import { parseDocTokenFromUrl } from '../../shared/feishu/parseDocRef'
import { KindIcon, IconX } from './icons'
import Button from './Button'
import './DocCombobox.css'

export interface DocTarget { token: string; title: string }

interface Props {
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
  target: DocTarget | null
  onTargetChange: (t: DocTarget | null) => void
  onConfirm: () => void
  writing?: boolean
}

export default function DocCombobox({ recentFiles, onRemoveRecent, target, onTargetChange, onConfirm, writing }: Props) {
  const [text, setText] = useState(target?.title ?? '')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setText(target?.title ?? '') }, [target])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function onText(v: string) {
    setText(v)
    const parsed = parseDocTokenFromUrl(v)
    onTargetChange(parsed ? { token: parsed.token, title: v } : null)
  }
  function pick(f: RecentFile) {
    onTargetChange({ token: f.token, title: f.title })
    setText(f.title)
    setOpen(false)
  }
  const q = text.trim().toLowerCase()
  const filtered = q ? recentFiles.filter((f) => f.title.toLowerCase().includes(q) || f.token.toLowerCase().includes(q)) : recentFiles

  return (
    <div className="dc-combobox" ref={rootRef}>
      <div className="dc-input-wrap">
        <input
          className="field-input dc-input" data-testid="dc-input"
          value={text} placeholder="粘贴文档链接或选择最近文档"
          onFocus={() => setOpen(true)} onChange={(e) => onText(e.target.value)}
        />
        <button type="button" className="dc-chevron" onClick={() => setOpen((o) => !o)} aria-label="展开最近文档">▾</button>
        {open && filtered.length > 0 && (
          <div className="dc-dropdown" data-testid="dc-dropdown">
            {filtered.map((f) => (
              <div key={f.token} className="dc-row" onClick={() => pick(f)}>
                <span className="dc-row-icon"><KindIcon kind={f.kind} /></span>
                <span className="dc-row-title">{f.title}</span>
                {onRemoveRecent && (
                  <button type="button" className="dc-row-x" aria-label="移除"
                    onClick={(e) => { e.stopPropagation(); onRemoveRecent(f.token) }}>
                    <IconX />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <Button variant="primary" onClick={onConfirm} disabled={writing} loading={writing}>添加到文档</Button>
    </div>
  )
}
```

- [ ] **Step 4: 新建 `DocCombobox.css`**（下拉浮层、行 hover、移除钮；与既有 `.sc-*` 视觉一致）

```css
.dc-combobox { display: flex; gap: 8px; align-items: stretch; margin-top: 8px; }
.dc-input-wrap { position: relative; flex: 1; }
.dc-input { width: 100%; }
.dc-chevron { position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: var(--muted, #888); cursor: pointer; padding: 2px 4px; }
.dc-dropdown { position: absolute; left: 0; right: 0; top: calc(100% + 2px); z-index: 20;
  background: var(--surface, #fff); border: 1px solid var(--border, #e3e3e3); border-radius: 8px;
  max-height: 220px; overflow-y: auto; box-shadow: 0 4px 14px rgba(0,0,0,.08); }
.dc-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; }
.dc-row:hover { background: var(--hover, #f5f5f5); }
.dc-row-icon { display: inline-flex; color: var(--muted, #888); }
.dc-row-icon svg { width: 16px; height: 16px; }
.dc-row-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-row-x { background: none; border: none; color: var(--muted, #999); cursor: pointer; display: inline-flex; padding: 2px; border-radius: 4px; }
.dc-row-x svg { width: 14px; height: 14px; }
.dc-row-x:hover { color: var(--danger, #d33); }
```

- [ ] **Step 5: 跑门** — typecheck → `npx vitest run src/sidepanel/components/DocCombobox.test.tsx`（4 passed）→ `npm test` → build。

- [ ] **Step 6: 提交** — `feat(pdf): add DocCombobox (link input + recent-docs dropdown)`。

---

## Task 4: 重写 PdfTranscribePanel + 接 recentFiles

**Files:**
- Rewrite: `src/sidepanel/components/PdfTranscribePanel.tsx`、`src/sidepanel/components/PdfTranscribePanel.css`、`src/sidepanel/components/PdfTranscribePanel.test.tsx`
- Modify: `src/sidepanel/components/ScenarioPanel.tsx`、`src/sidepanel/App.tsx`

**Interfaces:**
- Consumes: T1 `Markdown`、T2 `pdfHistory`(`loadPdfs`/`savePdf`/`deletePdf`/`SavedPdf`) + `IconUpload`/`IconHistory`、T3 `DocCombobox`+`DocTarget`；既有 `extractMarkdown`/`detectScan`（动态 import）、`polishMarkdown`、`parseDocTokenFromUrl`、`markdownToBlocks`/`insertContentBlocks`/`listBlocks`、`resolveToken`、`TopBar`/`Button`/`SideDrawer`、`RecentFile`。
- Produces: 面板 props 新增 `recentFiles: RecentFile[]`、`onRemoveRecent?: (token: string) => void`（ScenarioPanel/App 透传）。

- [ ] **Step 1: 写失败测试** `PdfTranscribePanel.test.tsx`（jsdom；mock 同 v1：pdfExtract 动态 import 也被 `vi.mock` 拦截）

```tsx
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const mockExtract = vi.fn(); const mockDetect = vi.fn()
vi.mock('../../shared/pdfExtract', () => ({ extractMarkdown: mockExtract, detectScan: mockDetect }))
const mockPolish = vi.fn()
vi.mock('../../shared/ai/mdPolish', () => ({ polishMarkdown: mockPolish }))
const mockListBlocks = vi.fn(); const mockInsertContent = vi.fn()
vi.mock('../../shared/feishu/docx', () => ({
  markdownToBlocks: vi.fn((md: string) => [{ text: md, style: 'text' as const }]),
  insertContentBlocks: mockInsertContent, listBlocks: mockListBlocks,
}))
const mockResolveToken = vi.fn()
vi.mock('../../shared/feishu/auth', () => ({ resolveToken: mockResolveToken }))
const mockSavePdf = vi.fn(); const mockLoadPdfs = vi.fn(); const mockDeletePdf = vi.fn()
vi.mock('../pdfHistory', () => ({ loadPdfs: mockLoadPdfs, savePdf: mockSavePdf, deletePdf: mockDeletePdf }))

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
  mockSavePdf.mockReset(); mockLoadPdfs.mockReset(); mockDeletePdf.mockReset()
  mockLoadPdfs.mockResolvedValue([])
  mockSavePdf.mockImplementation(async (p: any) => [p])
})
afterEach(cleanup)

describe('PdfTranscribePanel', () => {
  it('select → convert (no polish by default) → result; savePdf recorded', async () => {
    mockExtract.mockResolvedValue('# T\nbody'); mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} recentFiles={[]} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByText('转换')).toBeTruthy())
    fireEvent.click(screen.getByText('转换'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
    expect(mockPolish).not.toHaveBeenCalled()
    expect(mockSavePdf).toHaveBeenCalled()
  })
  it('AI 润色 on demand updates content', async () => {
    mockExtract.mockResolvedValue('# T\nbody'); mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockPolish.mockResolvedValue('# T\nbody (润色)')
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} recentFiles={[]} onBack={() => {}} />)
    pickFile(); fireEvent.click(screen.getByText('转换'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
    fireEvent.click(screen.getByText('AI 润色'))
    await waitFor(() => expect(mockPolish).toHaveBeenCalled())
  })
  it('disables AI 润色 when disabled (no key)', async () => {
    mockExtract.mockResolvedValue('# T'); mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={true} recentFiles={[]} onBack={() => {}} />)
    pickFile(); fireEvent.click(screen.getByText('转换'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
    expect((screen.getByText('AI 润色') as HTMLButtonElement).disabled).toBe(true)
  })
  it('adds to the selected recent doc at end index', async () => {
    mockExtract.mockResolvedValue('# T'); mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockResolveToken.mockResolvedValue('USER_TOKEN')
    mockListBlocks.mockResolvedValue({ items: [{ block_id: 'CURDOC', children: ['b1', 'b2'] }] })
    mockInsertContent.mockResolvedValue({ blocks_inserted: 1 })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} recentFiles={[{ token: 'CURDOC', title: '当前文档', kind: 'doc', seen: 1 }]} onBack={() => {}} />)
    pickFile(); fireEvent.click(screen.getByText('转换'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
    fireEvent.click(screen.getByText('添加到文档'))
    await waitFor(() => expect(mockInsertContent).toHaveBeenCalled())
    expect(mockInsertContent).toHaveBeenCalledWith('USER_TOKEN', 'CURDOC', expect.any(Array), 2)
  })
  it('opens history drawer and loads a past conversion', async () => {
    mockLoadPdfs.mockResolvedValue([{ id: 'h1', fileName: '旧文件', markdown: '# 旧内容', createdAt: 1 }])
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} recentFiles={[]} onBack={() => {}} />)
    await waitFor(() => expect(mockLoadPdfs).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('历史记录'))
    await waitFor(() => expect(screen.getByText('旧文件')).toBeTruthy())
    fireEvent.click(screen.getByText('旧文件'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
  })
})
```

- [ ] **Step 2: 跑确认失败** — `npx vitest run src/sidepanel/components/PdfTranscribePanel.test.tsx` → FAIL。

- [ ] **Step 3: 重写 `PdfTranscribePanel.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PageContext } from '../../shared/types'
import type { RecentFile } from '../recentFiles'
import { resolveToken } from '../../shared/feishu/auth'
import { polishMarkdown } from '../../shared/ai/mdPolish'
import { markdownToBlocks, insertContentBlocks, listBlocks } from '../../shared/feishu/docx'
import { loadPdfs, savePdf, deletePdf, type SavedPdf } from '../pdfHistory'
import TopBar from './TopBar'
import Button from './Button'
import SideDrawer from './SideDrawer'
import Markdown from './Markdown'
import DocCombobox, { type DocTarget } from './DocCombobox'
import { IconUpload, IconFileText, IconHistory, IconX } from './icons'
import './PdfTranscribePanel.css'

interface Props {
  settings: AppSettings
  context: PageContext
  disabled: boolean
  onBack: () => void
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
}

type Phase = 'idle' | 'selected' | 'converting' | 'done' | 'error'
type View = 'preview' | 'markdown'

export default function PdfTranscribePanel({ settings, context, disabled, onBack, recentFiles, onRemoveRecent }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState('document')
  const [rawMd, setRawMd] = useState('')
  const [editMd, setEditMd] = useState('')
  const [view, setView] = useState<View>('preview')
  const [polishing, setPolishing] = useState(false)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [target, setTarget] = useState<DocTarget | null>(
    context.feishu?.kind === 'doc' && context.feishu?.appToken
      ? { token: context.feishu.appToken, title: '当前文档' } : null,
  )
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pdfs, setPdfs] = useState<SavedPdf[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadPdfs().then(setPdfs) }, [])

  function handleFile(file: File) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { setError('请上传 PDF 文件。'); setPhase('error'); return }
    setFileName(file.name.replace(/\.pdf$/i, ''))
    setRawMd(''); setEditMd(''); setError(''); setInfo('')
    setPhase('selected')
    // keep the same File picked via the hidden input available for conversion:
    if (inputRef.current) inputRef.current.files = null
    pickedFile.current = file
  }
  const pickedFile = useRef<File | null>(null)

  async function handleConvert() {
    const file = pickedFile.current
    if (!file) return
    setPhase('converting'); setError(''); setInfo('')
    try {
      const { extractMarkdown, detectScan } = await import('../../shared/pdfExtract')
      const buf = await file.arrayBuffer()
      const md = await extractMarkdown(buf)
      const scan = detectScan(md)
      if (scan.likelyScan) { setError(scan.reason); setPhase('error'); return }
      setRawMd(md); setEditMd(md); setView('preview'); setPhase('done')
      setPdfs(await savePdf({ id: crypto.randomUUID(), fileName, markdown: md, createdAt: Date.now() }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setPhase('error')
    }
  }

  async function handlePolish() {
    setPolishing(true); setError(''); setInfo('')
    try {
      const polished = await polishMarkdown(settings, rawMd)
      setEditMd(polished); setInfo('已 AI 润色。')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setPolishing(false) }
  }

  async function handleCopy() {
    try { await navigator.clipboard.writeText(editMd); setInfo('已复制到剪贴板。') }
    catch { setError('复制失败，请手动选择复制。') }
  }
  function handleExport() {
    const blob = new Blob([editMd], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${fileName}.md`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }
  async function handleAddToDoc() {
    if (!target?.token) { setInfo('请先选择目标文档。'); return }
    setWriting(true); setError(''); setInfo('')
    try {
      const token = await resolveToken(settings)
      const doc = target.token
      const v = await listBlocks(token, doc)
      const root = (v.items as Array<{ block_id?: string; children?: string[] }>).find((b) => b.block_id === doc)
      if (!root?.children) throw new Error('无法确定文档末尾位置，请确认链接指向飞书文档。')
      await insertContentBlocks(token, doc, markdownToBlocks(editMd), root.children.length)
      setInfo(`已写入「${target.title}」末尾。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setWriting(false) }
  }

  function openHistory(p: SavedPdf) {
    setFileName(p.fileName); setRawMd(p.markdown); setEditMd(p.markdown)
    pickedFile.current = null; setError(''); setInfo('已载入历史记录。')
    setPhase('done'); setHistoryOpen(false)
  }
  async function removeHistory(id: string) { setPdfs(await deletePdf(id)) }

  // drag handlers (stopPropagation so Feishu's page-level clip handler doesn't hijack)
  const stop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation() }
  function onDrop(e: React.DragEvent) {
    stop(e)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  return (
    <div className="scenario-panel view-enter" key="pdf">
      <TopBar title="PDF 转写" onBack={onBack} rightAction={
        <button className="sc-history-btn" onClick={() => setHistoryOpen(true)} aria-label="历史记录" title="历史记录">
          <IconHistory />
        </button>
      } />
      <div className="sc-detail-body">
        {phase === 'idle' && (
          <label className="sc-pdf-drop" data-testid="pdf-drop"
            onDragEnter={stop} onDragOver={stop} onDragLeave={stop} onDrop={onDrop}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" hidden data-testid="pdf-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            <span className="sc-pdf-drop-ic"><IconUpload /></span>
            <p>点击或拖入 PDF 文件</p>
            <p className="sc-pdf-hint">本地解析，不上传服务器</p>
          </label>
        )}

        {phase !== 'idle' && (
          <div className="pdf-file-card">
            <span className="pdf-file-ic"><IconFileText /></span>
            <span className="pdf-file-name">{fileName}.pdf</span>
          </div>
        )}

        {phase === 'converting' && <div className="sc-pdf-progress">正在解析 PDF…</div>}

        {phase === 'error' && (
          <div className="sc-error-box">
            <div className="sc-error-title">无法转写</div>
            <div className="sc-error-msg">{error}</div>
            <Button variant="primary" onClick={() => setPhase(pickedFile.current ? 'selected' : 'idle')}>重新选择</Button>
          </div>
        )}

        {(phase === 'selected' || phase === 'converting' || phase === 'done') && (
          <div className="sc-done-actions pdf-action-row">
            {phase !== 'done' && (
              <Button variant="primary" onClick={handleConvert} disabled={phase === 'converting'} loading={phase === 'converting'}>
                {phase === 'converting' ? '转换中…' : '转换'}
              </Button>
            )}
            <Button onClick={() => { pickedFile.current = null; setPhase('idle') }}>选择文件</Button>
          </div>
        )}

        {phase === 'done' && (
          <div className="pdf-result">
            <div className="pdf-result-head">
              <div className="sc-target-opts pdf-view-toggle">
                <button className={`sc-target-opt${view === 'preview' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('preview')}>预览</button>
                <button className={`sc-target-opt${view === 'markdown' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('markdown')}>Markdown</button>
              </div>
            </div>
            {view === 'preview'
              ? <div className="pdf-preview" data-testid="pdf-preview"><Markdown>{editMd}</Markdown></div>
              : <textarea className="field-input sc-pdf-editor" data-testid="pdf-editor" value={editMd} onChange={(e) => setEditMd(e.target.value)} rows={16} />}
            <div className="sc-done-actions pdf-actions">
              <Button onClick={handleCopy}>复制</Button>
              <Button onClick={handleExport}>下载</Button>
              <Button onClick={handlePolish} disabled={disabled} loading={polishing}>AI 润色</Button>
            </div>
            {disabled && <p className="sc-pdf-hint">AI 润色需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}
            <DocCombobox recentFiles={recentFiles} onRemoveRecent={onRemoveRecent}
              target={target} onTargetChange={setTarget} onConfirm={handleAddToDoc} writing={writing} />
          </div>
        )}

        {error && phase !== 'error' && <div className="sc-refresh-err">{error}</div>}
        {!error && info && phase === 'done' && <div className="sc-registry-info">{info}</div>}
      </div>

      {historyOpen && (
        <SideDrawer title="历史记录" onClose={() => setHistoryOpen(false)}>
          <div className="pdf-history">
            {pdfs.length === 0 && <p className="pdf-history-empty">还没有转换过的文件</p>}
            {[...pdfs].sort((a, b) => b.createdAt - a.createdAt).map((p) => (
              <div className="pdf-history-row" key={p.id}>
                <button className="pdf-history-main" onClick={() => openHistory(p)}>
                  <span className="pdf-history-name">{p.fileName}</span>
                  <span className="pdf-history-time">{timeAgo(p.createdAt)}</span>
                </button>
                <button className="drawer-row-btn" onClick={() => removeHistory(p.id)} aria-label="删除"><IconX /></button>
              </div>
            ))}
          </div>
        </SideDrawer>
      )}
    </div>
  )
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
```

> 注意：`pickedFile` 用 `useRef` 持有用户选中的 File（label 的隐藏 input 在 `selected`/`done` 阶段已不在 DOM，但 File 对象由 ref 保留，供 `handleConvert` 用）。`crypto.randomUUID()` 在扩展页面可用。

- [ ] **Step 4: 更新 `PdfTranscribePanel.css`** — 加 `.pdf-file-card` / `.pdf-file-ic` / `.pdf-file-name` / `.pdf-action-row` / `.pdf-result` / `.pdf-result-head` / `.pdf-view-toggle` / `.pdf-preview`（预览容器限高可滚：`max-height: 40vh; overflow:auto;`）/ `.pdf-history` / `.pdf-history-row` / `.pdf-history-main` / `.pdf-history-name` / `.pdf-history-time` / `.pdf-history-empty`。沿用 v1 的 `.sc-pdf-drop` / `.sc-pdf-hint` / `.sc-pdf-progress` / `.sc-pdf-editor`。保留 `.sc-target-opts`/`.sc-target-opt`（来自 ScenarioPanel 全局样式）。

- [ ] **Step 5: 改 `ScenarioPanel.tsx`**
  - `Props` 接口加：`recentFiles: RecentFile[]` 和 `onRemoveRecent?: (token: string) => void`（顶部 `import type { RecentFile } from '../recentFiles'`）。
  - `<PdfTranscribePanel ... />` 分支（`view.mode === 'pdfTranscribe'`）加 `recentFiles={recentFiles}` 和 `onRemoveRecent={onRemoveRecent}`。

- [ ] **Step 6: 改 `App.tsx`**
  - 找到渲染 `<ScenarioPanel ... />` 处，加 `recentFiles={recentFiles}` 和 `onRemoveRecent={removeFromRecent}`（这两个在 App 已由 `useRecentFiles` 解构出，见 App.tsx 顶部）。若 `removeFromRecent` 未解构则补解构。

- [ ] **Step 7: 跑门** — `npm run typecheck`（0 错）→ `npx vitest run src/sidepanel/components/PdfTranscribePanel.test.tsx`（5 passed）→ `npm test`（全绿）→ `npm run build`（成功；确认 pdfjs 仍为独立 chunk、未被静态打进主入口）。

- [ ] **Step 8: 提交** — `feat(pdf): redesign panel (select→convert, preview/md toggle, on-demand polish, doc combobox, history)`。

---

## Self-Review（plan 自检）

**1. Spec 覆盖**：
- 需求 1（上传图标）→ T4 `IconUpload` 在 drop zone ✓。
- 需求 2（文件名+卡片图标）→ T4 `pdf-file-card` + `IconFileText` ✓。
- 需求 3（转换/选择文件分离、覆盖重选）→ T4 状态机 selected→converting→done ✓。
- 需求 4（预览/Markdown 切换 + 4 按钮 + combobox）→ T4 toggle + T3 DocCombobox ✓；预览用 T1 Markdown ✓。
- 需求 5（默认不润色、按需）→ T4 `handlePolish`，转换不调 polish ✓。
- 需求 6（历史）→ T2 pdfHistory + T4 SideDrawer ✓。
- 最近文档 → T4 接线（App→ScenarioPanel→面板）✓。

**2. 占位扫描**：无 TBD/TODO；每步含实际代码或确切命令。

**3. 类型一致性**：`DocTarget` 在 T3 定义、T4 import ✓；`SavedPdf` 在 T2 定义、T4 import ✓；`RecentFile` 来自既有 `recentFiles.ts` ✓；面板 props 新增 `recentFiles`/`onRemoveRecent` 与 ScenarioPanel/App 透传一致 ✓。

**4. 依赖序**：T1（Markdown）独立 → T2（pdfHistory/icons）独立 → T3（DocCombobox，依赖 icons）→ T4（面板，依赖 T1/T2/T3）。可顺序执行。

**5. 风险控制**：T1（聊天回归）为独立首任务、聊天测试全绿为硬门 ✓；pdfjs 动态 import 保持 ✓；写操作不重试（`handleAddToDoc` catch 显错）✓；CTA 按钮无图标 ✓。
