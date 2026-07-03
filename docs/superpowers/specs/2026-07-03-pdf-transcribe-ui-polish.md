# PDF 转写面板 — UI 精修（复用 + 体验）

- **日期**：2026-07-03
- **状态**：设计已确认（用户 "做吧"），待 spec 复核
- **前驱**：`2026-07-03-pdf-transcribe-redesign.md`（重设计，已实现并入库到 `3fb6009`）
- **一句话**：在已建成的 PDF 转写面板上做一轮 UI 精修——上传区复用 `UploadDrop`、结果区按钮加图标并优化布局、预览/Markdown 开关移入内容框、历史卡片复用 PPT 端组件、修掉预览里残留的 `#`。**全部走复用，遵循既有设计规范。**

---

## 1. 背景与目标

重设计已上线（`3fb6009`），功能完整，但 UI 有几处不一致与遗留：

1. 上传区是自建 `.sc-pdf-drop`（`padding:40px`，偏高），与 PPT 端 `UploadDrop` 重复且更高。
2. 结果区动作按钮（复制/下载/AI润色）无图标、不等宽、宽度与上方内容框不对齐。
3. 预览/Markdown 分段开关在内容框**外**的独立头部行，且 `min-width:180px` 偏大。
4. 历史抽屉用的是 PDF 专属 `.pdf-history-*` 卡片 + `IconX` 删除，与 PPT 端 `.sl-deck*` 卡片 + 垃圾桶不一致。
5. **预览会显示字面 `#`**：`Markdown.tsx` 只认 `# `/`## `/`### `（且须有空格），pdf2md 输出的 4 级以上标题 `#### ` 会穿透到 `<p>` 渲染出字面 `#`。

**原则**（不变）：纯前端、无后端、无付费、无 Python；UI 无 emoji、内联 SVG 线性图标；生成/主 CTA 不放图标、工具/导航按钮可放；能复用的件一律复用。

---

## 2. 逐条设计

### 2.1 上传区复用 UploadDrop（需求 1）

- 给 `UploadDrop.tsx` 加两个可选 props：`mainText?: string`、`hintText?: string`。缺省时回退当前图片文案（`点击或拖拽上传图片` / `可多选 · 最多 {max} 张`）——**PPT/ImagePicker 端零改动**。
- PDF 面板 `idle` 阶段：删掉自建 `<label className="sc-pdf-drop">`，改用 `<UploadDrop>`，传 `mainText="点击或拖入 PDF 文件"` `hintText="本地解析，不上传服务器"` `max={1} count={0}`。
- `UploadDrop` 是 `<button>` + 拖拽 stopPropagation（已防飞书页面级剪藏拦截），PDF 复用后拖拽行为不变。需把 PDF 现有 `handleFile(file)` 包成 `onFiles={(fl) => fl[0] && handleFile(fl[0])}` + `onTrigger` 打开隐藏 input（input 由 PDF 面板自己持有，因为 UploadDrop 不内置 input）。
- 高度：`UploadDrop` 现有 `padding:14px 10px`，比 `.sc-pdf-drop` 的 `40px` 矮，满足"降低高度"。不动 UploadDrop.css。
- 删除 `.sc-pdf-drop*`、`.sc-pdf-drop-ic*` CSS（仅 PDF 用）。

### 2.2 结果区按钮：图标 + 等宽 + 对齐（需求 2、3）

- 复制/下载/AI润色**已**是 `<Button>`；优化落在图标与布局：
  - 复制 → `icon={<IconCopy />}`（新增到 `icons.tsx`）。
  - 下载 → `icon={<IconDownload />}`（已存在）。
  - AI 润色 → `icon={<IconSparkles />}`（已存在，AI 语义契合）。
  - **转换**是主 CTA → **不放图标**（守全局规矩）。
- `.pdf-actions` 改为 equal-width 三等分填满容器（`display:flex; gap`，每个 `<Button className="pdf-action-btn"> flex:1`）。这样按钮组宽度 = 结果区宽度 = 上方预览/编辑框宽度，三者对齐。
- `IconCopy` 新增到 `icons.tsx`（Feishu/lucide 线性风，24×24，stroke=2）：两个错位圆角矩形 + 虚线感（标准 lucide copy 路径）。

### 2.3 开关移入内容框 + 缩小（需求 4）

- 撤掉 `.pdf-result-head` 独立头部行。新建 `.pdf-result-box` 作为预览/编辑的容器：
  ```
  .pdf-result-box { position: relative; max-height: 40vh; overflow: auto; padding: 12px 14px; background:surface; border; radius }
  ```
- 分段开关 `.sc-target-opts` 放进 `.pdf-result-box`，`position:absolute; top:6px; right:8px; z-index:1`，贴在框右上角内部。
- 缩小开关：去掉 `.pdf-view-toggle { min-width:180px }`；新增 `.pdf-view-toggle` 小型化覆盖（`min-width:auto`，`.sc-target-opt` padding 收到 `3px 8px`，字号略降）。
- 预览内容顶部加右内边距防与开关重叠：预览/编辑区首行不顶到开关。

### 2.4 预览/编辑高度统一（附加 A）

- 现状：preview `max-height:40vh` 滚动；markdown `<textarea rows={16}>` 固定高。切换跳变。
- 统一：`.pdf-result-box` 统一 `max-height:40vh; overflow:auto`；textarea 改 `rows` 较大值（如 12）+ 自身高度由 box 的 max-height 约束（`box-sizing:border-box; width:100%; min-height:100%`），使两视图视觉等高、滚动一致。

### 2.5 转换主行动突出（附加 B）

- `selected`/`converting` 阶段：**转换** 用 `<Button variant="primary" block>`（通栏主 CTA）；**选择文件** 降为下方次级 `<Button>`（非 block，左对齐或居中）。
- 现 `done` 阶段仅显示"选择文件"，文案改成 **"换一个"**（更准，附加 C）；行为不变（清 pickedFile + 回 idle）。

### 2.6 历史卡片 + 删除按钮复用 PPT（需求 5）

- 抽共享组件 `src/sidepanel/components/HistoryRow.tsx`（+ 复用 SessionDrawer.css 既有 `.drawer-row-btn`）：
  ```ts
  interface HistoryRowProps {
    name: string
    meta?: string                 // 副标题/时间，可空
    active?: boolean
    onOpen: () => void
    onDelete?: () => void
    deleteDisabled?: boolean
    openDisabled?: boolean
    openTitle?: string
  }
  ```
  结构沿用 Slides 现有 `.sl-deck`：`<div className="sl-deck [--active]">` > `<button className="sl-deck-main">{name, meta}</button>` + `<span className="sl-deck-actions">` > `<button className="drawer-row-btn" aria-label="删除"><IconTrash/></button>`。删除按钮 **hover 才显现**（沿用 `.sl-deck:hover .sl-deck-actions{opacity:1}`）。
- `IconTrash` 新增到 `icons.tsx`（垃圾桶：lid + body，标准 lucide trash-2 路径）。同时把 `SlidesPanel.tsx` 历史抽屉里的内联垃圾桶 SVG 换成 `<IconTrash />`（去重，行为/视觉不变）。
- PDF 历史抽屉：删 `.pdf-history`/`.pdf-history-row`/`.pdf-history-main`/`.pdf-history-name`/`.pdf-history-time`/`.pdf-history-empty` 一整套 bespoke 类与 CSS，改用 `<HistoryRow>`。`name = p.fileName + '.pdf'`，`meta = timeAgo(p.createdAt)`，`onOpen/openHistory`、`onDelete/removeHistory`。
- 空态文案保留："还没有转换过的文件"（用 Slides 同款 `.sl-decks-empty` 风格或保留一行 `<p>`）。

### 2.7 修预览残留 `#`（需求 2 附带 bug）

- `Markdown.tsx` 标题识别：把三段 `startsWith('### ')/'## '/'# ')` 合并为一条正则 `/^(#{1,6})\s+(.+)$/`：
  - level ∈ {1,2} → `<h2 className="md-h2">`
  - level ∈ {3,4,5,6} → `<h3 className="md-h3">`
  - 映射到现有 `.md-h2`/`.md-h3` 两级（CSS 无需新增；聊天渲染行为不变——`#`/`##` 仍 h2、`###` 仍 h3）。
- 检测顺序不变：code fence → table header → **heading（正则）** → list → empty → paragraph。
- 不处理 setext（`===`/`---` 下划线标题）——pdf2md 走 ATX，YAGNI；真机若出现再补。
- 不处理 `#标题`（无空格）——markdown 规范要求空格，无空格视为字面 `#`（如"Issue #5"）。

---

## 3. 改动文件清单

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/sidepanel/components/Markdown.tsx` | 改 | 标题识别硬化（h1–h6 正则） |
| `src/sidepanel/components/Markdown.test.tsx` | 改 | 补 h4–h6、保持 h1–h3 测试 |
| `src/sidepanel/components/icons.tsx` | 改 | 加 `IconCopy`、`IconTrash` |
| `src/sidepanel/components/UploadDrop.tsx` | 改 | 加 `mainText?`/`hintText?` props（回退兼容） |
| `src/sidepanel/components/HistoryRow.tsx`（新）+ 测试 | 新建 | 共享历史行组件 |
| `src/sidepanel/components/PdfTranscribePanel.tsx` | 改 | UploadDrop、结果框+内嵌开关、等宽图标按钮、高度统一、转换通栏、HistoryRow |
| `src/sidepanel/components/PdfTranscribePanel.css` | 改 | 新结构样式、删 `.sc-pdf-drop*`/`.pdf-history*`/`.pdf-result-head` |
| `src/sidepanel/components/PdfTranscribePanel.test.tsx` | 改 | 适配新结构（drop 测试改触发 UploadDrop 的 onFiles/onTrigger） |
| `src/sidepanel/components/SlidesPanel.tsx` | 改 | 历史抽屉用 `<HistoryRow>` + `<IconTrash/>`，删内联 SVG |

不动：`DocCombobox`（已是 Button、布局保持）、`MessageList`（硬化向后兼容）、`pdfExtract`、`pdfHistory`、`App`/`ScenarioPanel` 接线（recentFiles 已通）。

---

## 4. 测试（vitest）

- `Markdown.test.tsx`：`#### 深` → `H3`（不再出字面 `#`）；`##### x`/`###### x` → `H3`；保持 `# 标题`→`H2`、`## `→`H2`、`### `→`H3`、表格/代码/链接用例全绿。
- `HistoryRow.test.tsx`（新）：渲染 name/meta、点 main 触发 onOpen、点删除触发 onDelete、删除按钮 hover 显现（jsdom 不测 hover，断言 `.drawer-row-btn` 存在 + `aria-label`）。
- `PdfTranscribePanel.test.tsx`：上传改走 UploadDrop（`onFiles`/`onTrigger`）；结果区三个动作按钮存在且带图标（断言按钮文案）；预览/Markdown 切换仍在（断言 preview/editor testid）。
- 全局门：`typecheck` 0、`npm test` 全绿（**含聊天 MessageList**，验证 Markdown 硬化无回归）、`build` 成功、`pdfjs` 仍独立懒加载 chunk（本次不动 pdfExtract，应不变）。

---

## 5. 范围外 / 风险

**范围外**：
- AI 润色与导出的视觉分组（D，用户未选）。
- setext 标题、`#无空格` 标题。
- 上传后的页数/大小展示（YAGNI）。
- dropzone 在 done 阶段接受拖拽覆盖。

**风险**：
1. **Markdown 硬化动到聊天渲染**——最高风险。缓解：映射到既有 h2/h3 两级、聊天测试全绿为硬门；列为首个任务。
2. **HistoryRow 抽取动到已上线 Slides**——结构机械照搬，行为不变；SlidesPanel 测试须保持全绿。
3. UploadDrop 加 props——缺省回退，PPT/ImagePicker 不应受影响；typecheck + 相关测试覆盖。
4. pdf2md 实际输出未真机确认（`#` 根因假设是 h4+）；硬化对 h1–h6 全覆盖，无论根因都修。真机仍需验。
