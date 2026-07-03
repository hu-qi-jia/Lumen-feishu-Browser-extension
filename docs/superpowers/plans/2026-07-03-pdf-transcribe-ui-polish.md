# PDF 转写面板 UI 精修 — 实现计划

> **执行方式**：内联执行（executing-plans 风格），每任务 TDD + 跑门。spec 见 `docs/superpowers/specs/2026-07-03-pdf-transcribe-ui-polish.md`。

**Goal**：复用 UploadDrop / HistoryRow / 既有 Button，精修 PDF 转写面板 UI，修掉预览残留 `#`。

**Architecture**：纯 UI/CSS 改造 + 共享渲染器硬化 + 抽一个共享 HistoryRow 组件。不动任何业务逻辑、不动 pdfExtract/pdfHistory/DocCombobox/MessageList 行为。

**Tech Stack**：React 18 + TS + vitest（jsdom，无 jest-dom）。

## Global Constraints（逐条 verbatim）

- UI 无 emoji，内联 SVG 线性图标（24×24，stroke=2，Feishu/lucide 风），尺寸由父 CSS 定。
- **生成/主 CTA 不放图标**；工具/导航按钮可放图标。→ 转换(主)无图标；复制/下载/润色/删除(工具)有图标。
- 复用优先：能复用既有组件/CSS 不新建。
- 持久化键带 `_v1`（本次不动）。
- 出站只走 feishuReq/feishuFetch（本次无网络）。
- 测试约定：`*.test.ts(x)` co-located；jsdom 用 `/* @vitest-environment jsdom */`；**无 `@testing-library/jest-dom`**（用 `.toBeTruthy()`/`.tagName`）；`afterEach(cleanup)`；Button 的 label 在 `<span class="btn-label">` 里，查按钮用 `.closest('button')`。
- 提交 trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 当前分支 `feishu-ok`，直接提交。

---

## File Structure

| 文件 | 动作 |
|---|---|
| `src/sidepanel/components/Markdown.tsx` | 改：标题识别 h1–h6 正则 |
| `src/sidepanel/components/Markdown.test.tsx` | 改：补 h4–h6 用例 |
| `src/sidepanel/components/icons.tsx` | 改：加 `IconCopy`、`IconTrash` |
| `src/sidepanel/components/UploadDrop.tsx` | 改：加 `mainText?`/`hintText?` props |
| `src/sidepanel/components/HistoryRow.tsx`（新）+ `.css` + `.test.tsx` | 新建：共享历史行 |
| `src/sidepanel/components/PdfTranscribePanel.tsx` | 改：UploadDrop、结果框+内嵌开关、等宽图标按钮、高度统一、转换通栏、HistoryRow |
| `src/sidepanel/components/PdfTranscribePanel.css` | 改：新结构、删 `.sc-pdf-drop*`/`.pdf-history*`/`.pdf-result-head` |
| `src/sidepanel/components/PdfTranscribePanel.test.tsx` | 改：适配选择器 |
| `src/sidepanel/components/SlidesPanel.tsx` | 改：历史抽屉用 `<HistoryRow>` + `<IconTrash/>`，删 `.sl-deck*` 内联结构 |
| `src/sidepanel/components/SlidesPanel.css` | 改：删 `.sl-deck*` 行规则（迁移到 HistoryRow.css） |

依赖序：T1(Markdown) 独立 → T2(icons+UploadDrop 脚手架) → T3(面板，消费 T2) → T4(HistoryRow，消费 T2，迁 Slides)。

---

## Task 1：硬化 Markdown 标题识别（h1–h6）

**Files:** Modify `Markdown.tsx`、`Markdown.test.tsx`
**Interfaces:** 对外签名不变（`({children: string}) => JSX`）；行为：`#`/`##`→h2、`###`→h3（保持），新增 `####`/`#####`/`######`→h3（不再出字面 `#`）。

**Why first**：共享渲染器，最高风险；先做 + 聊天测试全绿为硬门。

- [ ] **Step 1：补失败测试** — 在 `Markdown.test.tsx` 的 describe 内加：

```tsx
  it('renders h4–h6 as h3 (no literal # leaks)', () => {
    const { container } = render(<Markdown>{'#### 深\n##### 更深\n###### 最深'}</Markdown>)
    const h3s = container.querySelectorAll('h3.md-h3')
    expect(h3s).toHaveLength(3)
    expect(container.textContent).not.toContain('#')
    expect(container.textContent).toContain('深')
    expect(container.textContent).toContain('最深')
  })
```

- [ ] **Step 2：跑，确认失败** — `npx vitest run src/sidepanel/components/Markdown.test.tsx`。预期：新用例失败（`#### 深` 当前落到 `<p>`，`#` 出现 / h3 数不对）。

- [ ] **Step 3：改 Markdown.tsx** — 把三段 `startsWith('### ')/'## '/'# ')` 分支合并为一条正则分支，**插在 table 分支之后、list 分支之前**：

```tsx
    } else if (/^#{1,6}\s+.+/.test(line)) {
      const m = line.match(/^(#{1,6})\s+(.*)$/)!
      const level = m[1].length
      const txt = m[2]
      if (level <= 2) {
        elements.push(<h2 key={i} className="md-h2">{inlineFormat(txt)}</h2>)
      } else {
        elements.push(<h3 key={i} className="md-h3">{inlineFormat(txt)}</h3>)
      }
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
```

  删除原有的 `} else if (line.startsWith('### ')) {...}`、`## `、`# ` 三段。检测顺序仍为：code fence → table header → **heading(正则)** → list → empty → paragraph。

- [ ] **Step 4：跑全绿** — `npx vitest run src/sidepanel/components/Markdown.test.tsx`。预期全绿（含原 `# 标题`→H2 用例）。
- [ ] **Step 5：聊天无回归** — `npx vitest run src/sidepanel/components/MessageList.test.tsx`（若存在）或 `npx vitest run src/sidepanel` 全绿。
- [ ] **Step 6：typecheck** — `npm run typecheck` 0 错。
- [ ] **Step 7：commit** — `feat(markdown): render h1–h6 headings (fix # leak in PDF preview)`

---

## Task 2：脚手架 — IconCopy / IconTrash + UploadDrop 文案 props

**Files:** Modify `icons.tsx`、`UploadDrop.tsx`
**Interfaces（Produces）**：
- `IconCopy`、`IconTrash`（`(p: SVGProps<SVGSVGElement>) => JSX`）
- `UploadDrop` 新 props `mainText?: string`、`hintText?: string`（缺省回退原值）

- [ ] **Step 1：icons.tsx** — 在 `IconHistory` 后、`KindIcon` 前加：

```tsx
export const IconCopy = (p: P) => (
  <svg {...common} {...p}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...common} {...p}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)
```

- [ ] **Step 2：UploadDrop.tsx** — props 加字段 + 文案回退：

```tsx
interface Props {
  busy: boolean
  disabled?: boolean
  max: number
  count: number
  onFiles: (files: FileList) => void
  onTrigger: () => void
  mainText?: string
  hintText?: string
}

export function UploadDrop({ busy, disabled, max, count, onFiles, onTrigger, mainText, hintText }: Props) {
  // ...（内部不变）
      <span className="sl-upload-drop-main">{busy ? '处理中…' : (mainText ?? '点击或拖拽上传图片')}</span>
      <span className="sl-upload-drop-hint">{hintText ?? `可多选 · 最多 ${max} 张`}</span>
```

- [ ] **Step 3：typecheck + 现有用例** — `npm run typecheck`；`npx vitest run src/sidepanel/components/ImagePicker`（若有）或 Slides 相关测试全绿（回退保证 PPT 端不变）。
- [ ] **Step 4：commit** — `feat(ui): add IconCopy/IconTrash, parametrize UploadDrop labels`

---

## Task 3：PdfTranscribePanel UI 重组

**Files:** Modify `PdfTranscribePanel.tsx`、`.css`、`.test.tsx`
**Interfaces（Consumes）**：`UploadDrop`（T2）、`IconCopy`/`IconDownload`/`IconSparkles`（T2/既有）、`Markdown`（T1）。

### 3.1 tsx 改动

- [ ] **Step 1：imports** — 加 `IconCopy, IconSparkles`（IconDownload、IconUpload、IconFileText 已在用）；加 `UploadDrop`；删不再用的 `IconHistory`?  保留（TopBar 历史按钮仍用）。最终 import 行：

```tsx
import UploadDrop from './UploadDrop'
import { IconUpload, IconFileText, IconHistory, IconCopy, IconDownload, IconSparkles } from './icons'
```
  （按实际 lint 去掉未用的；IconUpload 若 UploadDrop 自带图标后 PDF 不再用，则从 import 删掉——PDF 不再内联上传图标。）

- [ ] **Step 2：加 fileInputRef** — 顶部 hooks 处加 `const fileInputRef = useRef<HTMLInputElement | null>(null)`。

- [ ] **Step 3：idle 上传区换 UploadDrop** — 替换原 `<label className="sc-pdf-drop">` 整块为：

```tsx
        {phase === 'idle' && (
          <>
            <input type="file" accept=".pdf,application/pdf" hidden ref={fileInputRef} data-testid="pdf-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            <UploadDrop busy={false} max={1} count={0}
              mainText="点击或拖入 PDF 文件" hintText="本地解析，不上传服务器"
              onFiles={(fl) => { const f = fl[0]; if (f) handleFile(f) }}
              onTrigger={() => fileInputRef.current?.click()} />
          </>
        )}
```

- [ ] **Step 4：selected/converting 动作行 — 转换通栏 + 选择文件次级** — 替换原 `{(selected||converting||done) && (...)}` 整块为两段：

```tsx
        {(phase === 'selected' || phase === 'converting') && (
          <div className="pdf-action-row pdf-action-stack">
            <Button variant="primary" block onClick={handleConvert} disabled={phase === 'converting'} loading={phase === 'converting'}>
              {phase === 'converting' ? '转换中…' : '转换'}
            </Button>
            <Button variant="ghost" block onClick={() => { pickedFile.current = null; setPhase('idle') }}>选择文件</Button>
          </div>
        )}

        {phase === 'done' && (
          <div className="pdf-action-row">
            <Button variant="ghost" block onClick={() => { pickedFile.current = null; setPhase('idle') }}>换一个文件</Button>
          </div>
        )}
```

- [ ] **Step 5：done 结果区 — 结果框 + 内嵌开关 + 等宽图标按钮** — 替换原 `{phase === 'done' && (...)}` 整块为：

```tsx
        {phase === 'done' && (
          <div className="pdf-result">
            <div className="pdf-result-box" data-testid="pdf-result-box">
              <div className="sc-target-opts pdf-view-toggle">
                <button className={`sc-target-opt${view === 'preview' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('preview')}>预览</button>
                <button className={`sc-target-opt${view === 'markdown' ? ' sc-target-opt--active' : ''}`} onClick={() => setView('markdown')}>Markdown</button>
              </div>
              <div className="pdf-result-content">
                {view === 'preview'
                  ? <Markdown>{editMd}</Markdown>
                  : <textarea className="field-input sc-pdf-editor" data-testid="pdf-editor" value={editMd} onChange={(e) => setEditMd(e.target.value)} />}
              </div>
            </div>
            <div className="pdf-actions">
              <Button className="pdf-action-btn" icon={<IconCopy />} onClick={handleCopy}>复制</Button>
              <Button className="pdf-action-btn" icon={<IconDownload />} onClick={handleExport}>下载</Button>
              <Button className="pdf-action-btn" icon={<IconSparkles />} onClick={handlePolish} disabled={disabled} loading={polishing}>AI 润色</Button>
            </div>
            {disabled && <p className="sc-pdf-hint">AI 润色需要 API Key——请先在「设置」里完成 API Key / 飞书授权。</p>}
            <DocCombobox recentFiles={recentFiles} onRemoveRecent={onRemoveRecent}
              target={target} onTargetChange={setTarget} onConfirm={handleAddToDoc} writing={writing} />
          </div>
        )}
```

- [ ] **Step 6：历史抽屉换 HistoryRow** — 见 Task 4（此处先留现有 PDF 历史 JSX，T4 统一替换）。**或**在本步直接替换（依赖 T4 的 HistoryRow 已存在）。为避免前后依赖，**把 PDF 历史的 HistoryRow 替换放到 Task 4**，本步保持 PDF 历史 JSX 不变。

### 3.2 CSS 改动（PdfTranscribePanel.css）

- [ ] **Step 7**：删 `.sc-pdf-drop`、`.sc-pdf-drop:hover`、`.sc-pdf-drop-ic`、`.sc-pdf-drop-ic svg` 四条（保留 `.sc-pdf-hint`、`.sc-pdf-progress`、`.sc-pdf-editor`）。
- [ ] **Step 8**：删 `.pdf-result-head`、`.pdf-view-toggle { ...min-width:180px }`、`.pdf-preview { ... }`（preview 容器被 result-box 取代）。
- [ ] **Step 9**：加（替换 preview/result-head 区段）：

```css
/* ── result region ────────────────────────────────────────────────────── */
.pdf-result { margin-top: 8px; }
.pdf-result-box {
  position: relative;
  max-height: 40vh; overflow: auto;
  padding: 12px 14px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e3e3e3);
  border-radius: 8px;
  font-size: 13.5px; line-height: 1.6; color: var(--color-text, #222);
}
.pdf-result-content { padding-top: 2px; }
/* Floating preview/markdown toggle — small, top-right inside the box */
.pdf-view-toggle { position: absolute; top: 6px; right: 8px; z-index: 1; min-width: auto; padding: 2px; }
.pdf-view-toggle .sc-target-opt { padding: 3px 10px; font-size: 11.5px; }

/* Equal-width action buttons — group spans the result width (matches the box above) */
.pdf-actions { display: flex; gap: 8px; margin-top: 10px; }
.pdf-action-btn { flex: 1 1 0; min-width: 0; }

.pdf-action-stack { display: flex; flex-direction: column; gap: 8px; }
```

- [ ] **Step 10**：保留 `.pdf-file-card*`、`.pdf-action-row { margin: 8px 0 12px; }`。

### 3.3 测试

- [ ] **Step 11**：`PdfTranscribePanel.test.tsx` — 读现文件，把引用 `pdf-drop` 的选择器改为 `.sl-upload-drop` 或继续用 `pdf-input`（hidden input 仍在，testid 保留）；把引用 `pdf-preview` 的改为 `pdf-result-box`。确认：选文件→转换→done、预览/markdown 切换、AI 润色禁用 三个核心用例仍绿。
- [ ] **Step 12**：跑 `npx vitest run src/sidepanel/components/PdfTranscribePanel.test.tsx` 全绿。
- [ ] **Step 13**：`npm run typecheck` 0 错。
- [ ] **Step 14**：commit — `feat(pdf): reuse UploadDrop, reflow result actions, in-box toggle`

---

## Task 4：抽 HistoryRow + 迁 Slides/PDF 历史抽屉

**Files:** Create `HistoryRow.tsx`/`.css`/`.test.tsx`；Modify `SlidesPanel.tsx`/`.css`、`PdfTranscribePanel.tsx`/`.css`
**Interfaces（Produces）**：

```ts
interface HistoryRowProps {
  name: string
  meta?: string
  active?: boolean
  onOpen: () => void
  onDelete?: () => void
  deleteDisabled?: boolean
  openDisabled?: boolean
  openTitle?: string
}
```
默认导出 `HistoryRow`。

- [ ] **Step 1：写测试** — `HistoryRow.test.tsx`：

```tsx
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import HistoryRow from './HistoryRow'

afterEach(cleanup)

describe('HistoryRow', () => {
  it('renders name and meta', () => {
    render(<HistoryRow name="报告.pdf" meta="3 分钟前" onOpen={() => {}} />)
    expect(screen.getByText('报告.pdf')).toBeTruthy()
    expect(screen.getByText('3 分钟前')).toBeTruthy()
  })
  it('clicking the main button triggers onOpen', () => {
    const onOpen = vi.fn()
    render(<HistoryRow name="x" onOpen={onOpen} />)
    fireEvent.click(screen.getByText('x').closest('button')!)
    expect(onOpen).toHaveBeenCalledOnce()
  })
  it('delete button triggers onDelete and is labeled 删除', () => {
    const onDelete = vi.fn()
    render(<HistoryRow name="x" onOpen={() => {}} onDelete={onDelete} />)
    const del = screen.getByLabelText('删除')
    expect(del).toBeTruthy()
    fireEvent.click(del)
    expect(onDelete).toHaveBeenCalledOnce()
  })
  it('applies active class', () => {
    const { container } = render(<HistoryRow name="x" onOpen={() => {}} active />)
    expect(container.querySelector('.hr-row--active')).toBeTruthy()
  })
})
```

- [ ] **Step 2：写组件** — `HistoryRow.tsx`：

```tsx
import { IconTrash } from './icons'
import './HistoryRow.css'

interface HistoryRowProps {
  name: string
  meta?: string
  active?: boolean
  onOpen: () => void
  onDelete?: () => void
  deleteDisabled?: boolean
  openDisabled?: boolean
  openTitle?: string
}

export default function HistoryRow({ name, meta, active, onOpen, onDelete, deleteDisabled, openDisabled, openTitle }: HistoryRowProps) {
  return (
    <div className={`hr-row${active ? ' hr-row--active' : ''}`}>
      <button className="hr-main" type="button" onClick={onOpen} disabled={openDisabled} title={openTitle}>
        <span className="hr-name">{name}</span>
        {meta && <span className="hr-meta">{meta}</span>}
      </button>
      {onDelete && (
        <span className="hr-actions">
          <button className="drawer-row-btn" type="button" aria-label="删除" onClick={onDelete} disabled={deleteDisabled}>
            <IconTrash />
          </button>
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 3：写 CSS** — `HistoryRow.css`（从 SlidesPanel.css 的 `.sl-deck*` 规则平移改名；`.drawer-row-btn` 由 SessionDrawer.css 全局提供）：

```css
.hr-row { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: var(--radius); border: 1px solid transparent; }
.hr-row:hover { background: var(--color-surface); }
.hr-row--active { background: var(--color-primary-soft); border-color: var(--color-primary-border); }
.hr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; background: none; border: none; text-align: left; cursor: pointer; font-family: inherit; padding: 0; }
.hr-main:disabled { cursor: default; }
.hr-name { font-size: 12.5px; font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hr-meta { font-size: 10.5px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hr-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .15s ease; }
.hr-row:hover .hr-actions { opacity: 1; }
```

- [ ] **Step 4：跑 HistoryRow 测试** — `npx vitest run src/sidepanel/components/HistoryRow.test.tsx` 全绿。
- [ ] **Step 5：迁 SlidesPanel.tsx** — 历史抽屉里 `{[...decks].sort(...).map((d) => (<div className="sl-deck ...">...</div>))}` 整块替换为：

```tsx
            {[...decks].sort((a, b) => b.createdAt - a.createdAt).map((d) => (
              <HistoryRow key={d.id}
                name={d.name}
                meta={`${sourceLabel(d)} · ${timeAgo(d.createdAt)}`}
                active={activeDeckId === d.id}
                onOpen={() => openSaved(d)}
                onDelete={() => remove(d)}
                deleteDisabled={busy}
                openDisabled={busy}
                openTitle="在新标签页展示这套幻灯片"
              />
            ))}
```

  imports 加 `import HistoryRow from './HistoryRow'`、`IconTrash` 不需要（HistoryRow 自带）；删除 SlidesPanel 不再用的内联垃圾桶 SVG。
- [ ] **Step 6：迁 SlidesPanel.css** — 删除 `.sl-deck`、`.sl-deck:hover`、`.sl-deck--active`、`.sl-deck-main`、`.sl-deck-main:disabled`、`.sl-deck-name`、`.sl-deck-meta`、`.sl-deck-actions`、`.sl-deck:hover .sl-deck-actions` 这些行规则（已迁移到 HistoryRow.css）。保留 `.sl-decks`、`.sl-decks-empty`（容器）。SlidesPanel.tsx 加 `import './HistoryRow.css'`?  不需要——HistoryRow 组件自己 import 了，全局 bundle 即加载。
- [ ] **Step 7：迁 PdfTranscribePanel.tsx 历史抽屉** — `.pdf-history` 整块替换为：

```tsx
          <div className="pdf-history-list">
            {pdfs.length === 0 && <p className="pdf-history-empty">还没有转换过的文件</p>}
            {[...pdfs].sort((a, b) => b.createdAt - a.createdAt).map((p) => (
              <HistoryRow key={p.id}
                name={`${p.fileName}.pdf`}
                meta={timeAgo(p.createdAt)}
                onOpen={() => openHistory(p)}
                onDelete={() => removeHistory(p.id)}
              />
            ))}
          </div>
```

  imports 加 `import HistoryRow from './HistoryRow'`；删除 IconX（若 PDF 别处不再用——TopBar/DocCombobox 各自的 × 用的别处；确认 PdfTranscribePanel 内 IconX 是否还有其它用处，无则从 import 去掉）。
- [ ] **Step 8：迁 PdfTranscribePanel.css** — 删除 `.pdf-history`、`.pdf-history-row`、`.pdf-history-row:last-child`、`.pdf-history-main`、`.pdf-history-main:hover`、`.pdf-history-name`、`.pdf-history-time` 全部。保留/改名 `.pdf-history-empty`（仍用）。把容器 `.pdf-history` 改名 `.pdf-history-list { display:flex; flex-direction:column; gap:2px; }`（沿用原容器意图）。
- [ ] **Step 9：跑相关测试** — `npx vitest run src/sidepanel/components/SlidesPanel` 与 `PdfTranscribePanel.test.tsx`、`HistoryRow.test.tsx` 全绿。
- [ ] **Step 10**：`npm run typecheck` 0 错。
- [ ] **Step 11**：commit — `refactor(ui): extract HistoryRow, reuse in Slides + PDF history`

---

## Final gate（全部任务后）

- [ ] `npm run typecheck` — 0 错
- [ ] `npx vitest run` — 全绿（596+4 新增 passed / 32 skipped / 0 failed；含 MessageList/Slides 聊天回归）
- [ ] `npm run build` — 成功；`find dist -name "*.js" -exec wc -c {} \;` 确认 `pdfjs.js` 仍 ~1.6MB 独立懒加载 chunk、主入口未膨胀异常
- [ ] 自检：转换主 CTA 无图标；复制/下载/润色有图标；开关在结果框内右上且小；按钮组与框等宽；历史卡片 = PPT 风格 + 垃圾桶 hover 显现；预览 h4+ 不出 `#`。
