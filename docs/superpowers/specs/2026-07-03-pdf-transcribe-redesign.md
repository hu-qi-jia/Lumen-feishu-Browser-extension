# PDF 转写面板 — 重设计（UI/UX + 复用）

- **日期**：2026-07-03
- **状态**：设计待用户复核
- ** predecessor**：`docs/superpowers/specs/2026-07-03-pdf-transcribe-design.md`（v1，已实现并入库）
- **一句话**：把已建成的 PDF 转写能力（pdf2md 抽取 + AI 文本润色 + 写入文档）包进一套更完整的交互——显式"选文件 → 转换"、结果区预览/Markdown 切换、按需 AI 润色、目标文档下拉（含最近文档）、转换历史。**底层模块全部复用，只重写面板 + 补少量共享件。**

---

## 1. 背景与目标

v1 面板是一条线性流：拖入即抽取、可选预润色、复制/导出/追加。用户要的 v2 是更可控、更完整的形态：

1. 上传区有上传图标；选文件后显示文件名 + PDF 卡片图标。
2. 「转换」「选择文件」分离——点转换才开始；选择文件可覆盖重选。
3. 结果区有**预览/Markdown 切换**；下方 复制/下载/AI润色/添加到文档。
4. 「添加到文档」是**下拉输入框**：可粘贴链接，也列最近文档。
5. **转换默认不润色**；转换后按需点「AI 润色」。
6. **历史记录**：复用 SlidesPanel/会话历史的抽屉形态，存历史转换。

**原则**（与项目一致）：纯前端、无后端、无付费、无 Python；能复用的件一律复用；UI 无 emoji、内联 SVG 图标；遵循既有设计规范。

---

## 2. 与 v1 的关系（复用 / 重写）

**完全复用（不动）**：
- `src/shared/pdfExtract.ts` — `extractMarkdown` / `detectScan` / `classifyPdfError`。
- `src/shared/ai/mdPolish.ts` — `polishMarkdown` / `chunkMarkdown`。
- `src/shared/feishu/parseDocRef.ts` — `parseDocTokenFromUrl`。
- `src/shared/feishu/docx.ts` — `markdownToBlocks` / `insertContentBlocks` / `listBlocks`。
- `ScenarioPanel.tsx` 的 Hub 注册条目（内容转写 → PDF 转写）保持不变。

**重写**：
- `src/sidepanel/components/PdfTranscribePanel.tsx` —— 面板主体（状态机、布局、交互全部重做）。CSS 对应调整。

**新增**：
- `src/sidepanel/pdfHistory.ts` —— 转换历史存储（照搬 `slidesStore.ts` / `recentFiles.ts` 模式）。
- `src/sidepanel/components/DocCombobox.tsx` —— 目标文档下拉输入框（combobox，方案 A）。
- `src/sidepanel/components/Markdown.tsx` —— 从 `MessageList.tsx` 抽出的共享 markdown 渲染器。
- `icons.tsx` 新增 `IconUpload`（从 `UploadDrop.tsx` 内联上传箭头提取）。

**接线改动**：
- `App.tsx` → `ScenarioPanel.tsx`：把已存在的 `recentFiles` / `onRemoveRecent` 透传给 ScenarioPanel。
- `ScenarioPanel.tsx` → `PdfTranscribePanel`：再透传 `recentFiles` / `onRemoveRecent`。

---

## 3. 复用清单（探索结论）

| 需求件 | 现状 | 处置 |
|---|---|---|
| 最近文档数据源 | `recentFiles.ts` + `useRecentFiles`（key `recentFiles_v1`，App 级，现仅喂 ChatPanel） | 透传到 PDF 面板 |
| 上传拖拽区 | `UploadDrop.tsx`（文件无关） | 直接复用 |
| 历史抽屉外壳 | `SideDrawer.tsx` | 直接复用 |
| 历史存储模式 | `slidesStore.ts`（load/save/delete + 自动存） | 照搬为 `pdfHistory.ts` |
| Markdown 渲染 | `MessageList.tsx` 内 `MarkdownText`（私有，未导出） | 抽成共享 `Markdown.tsx` |
| 图标 | `IconFileText`（文档）；上传箭头在 `UploadDrop` 内联 | 提取 `IconUpload`；文件卡片用 `IconFileText` |
| TopBar 右槽 | `rightAction`（SlidesPanel 历史按钮位） | 挂历史按钮 |
| 分段切换样式 | ScenarioPanel `.sc-target-opt` | 预览/Markdown 切换复用此样式 |
| Button | `components/Button.tsx` | 复用 |

**确认不存在、需自建**：Switch 开关组件（`@radix-ui/react-switch` 已装但未封装 → 不用，改用分段样式）、Combobox（无 Popover 依赖 → 自建轻量 `DocCombobox`）。

---

## 4. 布局与状态机

### 4.1 三区布局

```
┌─ TopBar: PDF 转写 ........................ [历史⏱] ─┐
│ [上传区 / 文件卡片]                                  │
│ [转换] [选择文件]                                    │
│ ─────────── 转换后 ───────────                       │
│ [预览 | Markdown]                    （右上切换）    │
│ [渲染预览 或 可编辑 Markdown]                        │
│ [复制] [下载] [AI 润色] [添加到文档 ▼]               │
└─────────────────────────────────────────────────────┘
```

### 4.2 状态机

```
idle ─(选文件)─► selected ─(转换)─► converting ─► done
                    ▲                   │           │
                    │                 (失败)         │
                    │                   ▼           │
                    └──────── error ◄──────────────┘
selected/done ─(选择文件·覆盖)─► selected(新文件)
done ─(AI 润色按需)─► polishing ─► done(内容更新)
```

- `idle`：无文件，显示 `UploadDrop`（含 `IconUpload`）。
- `selected`：已选未转。文件卡片（文件名 + `IconFileText`）+ `[转换(主)] [选择文件]`。选择文件覆盖 → 仍 `selected`（带新文件）。
- `converting`：抽取进行中，按钮 loading。
- `done`：结果就绪。顶部保留文件卡片（紧凑）+ `[选择文件]`（重选复位到 `selected`）；下方为结果区（§5.3）。
- `error`：错误框 + 「重新选择」回 `selected`/`idle`。

### 4.3 结果区子状态

- `view: 'preview' | 'markdown'` —— 切换"渲染预览（Markdown 组件，只读）"与"Markdown 源码（textarea，可编辑）"。两者都展示 `editMd`。
- `polishing: boolean` —— AI 润色进行中。
- 内容模型：`rawMd`（抽取原文，不可变基线）；`editMd`（当前内容：初始=rawMd；AI 润色后=润色文；用户可在 markdown 视图手改）。预览视图渲染 `editMd`，markdown 视图编辑 `editMd`。

---

## 5. 逐条设计

### 5.1 上传区 + 图标（需求 1）
- `idle` 用 `UploadDrop`（复用，文件无关；其拖拽逻辑已避免被飞书页面级拖拽拦截）。
- 新增 `IconUpload`（从 `UploadDrop.tsx` 的内联上传箭头 SVG 提取到 `icons.tsx`），放上传区中央。`UploadDrop` 是否同步改用 `IconUpload`（去内联重复）为**可选项**，不阻塞——其内联图标保持可用，避免动到 SlidesPanel 共享件。
- 文案保持"点击或拖入 PDF 文件 / 本地解析，不上传服务器"。

### 5.2 文件卡片（需求 2）
- `selected`/`done` 顶部显示卡片：`IconFileText` + 文件名（`fileName`，去 `.pdf` 后缀）。
- 卡片复用既有 `.sc-*` 卡片视觉；不新建卡片组件（无通用 section-card 基件，YAGNI）。

### 5.3 转换 / 选择文件（需求 3）
- `[转换]`（primary）：`selected` → `converting` → 调 `extractMarkdown` → `detectScan`（扫描件中止，文案同 v1）→ `done`，`editMd=rawMd`。**转换时不润色**。
- `[选择文件]`：打开文件选择器；选到新文件则覆盖 `fileName`/清空结果、回到 `selected`。
- 转换结果（结果区）显示在按钮下方。
- `pdfExtract` 改为动态 `import()`（v1 final-review I-3 已落地，保持）。

### 5.4 结果区（需求 4）

**预览 / Markdown 切换**（右上）：
- 分段控件，复用 ScenarioPanel `.sc-target-opt` 的两段式样式（`预览 | Markdown`），**不引 Switch**。
- `preview`：`<Markdown>{editMd}</Markdown>`（只读渲染）。
- `markdown`：`<textarea>` 编辑 `editMd`（editing 置 dirty）。

**Markdown 组件**（预览用）：
- 把 `MessageList.tsx` 的 `MarkdownText` + 辅助函数（`inlineFormat`/`splitCells`/`isTableHeader`/`linkEl`/`linkInCode`/`safeHref`/`openExternal`）+ `.md-*` CSS 抽到 `src/sidepanel/components/Markdown.tsx`（+ `Markdown.css`）。
- `MessageList` 改为 import 共享组件（行为不变；聊天测试须保持全绿——这是抽取的风险控制点）。
- 链接点击沿用 `openUrlInNewTab`（`chrome.tabs.create`）。

**四个动作按钮**（底部）：
- `复制`：`navigator.clipboard.writeText(editMd)`（修复 v1 M-1：await 后再报成功，失败显错）。
- `下载`：Blob 下载 `{fileName}.md`（修复 v1 M-2：`<a>` 先 `appendChild` 再 `click`）。
- `AI 润色`（按需，见 §5.5）。
- `添加到文档`（combobox，见 §5.6）。

### 5.5 AI 润色按需化（需求 5）
- 转换默认不润色。
- `done` 后点 `[AI 润色]`：`polishing=true` → `polishMarkdown(settings, rawMd)` → 成功：`editMd=润色文`、回 `preview`/当前视图；失败：显错、保留 `editMd`（raw）。
- `disabled`（无 LLM key）：`[AI 润色]` 禁用 + 授权提示（同 SmartFill/Slides 模式）。
- `editMd` 被 AI 润色覆盖属**显式动作**（非自动 toggle），不需 dirty 确认；`rawMd` 内部保留（v1 的 dirty-clobber 问题随旧 toggle 一并消失）。

### 5.6 添加到文档 — DocCombobox（需求 4，方案 A）
- 目标行 = `DocCombobox`（新组件 `src/sidepanel/components/DocCombobox.tsx`）+ 主按钮「添加到文档」。
- `DocCombobox`：文本输入框（粘贴链接/token）+ 聚焦/输入时下方弹出"最近文档"列表（`recentFiles`，按 `seen` 倒序、可过滤）；点列表项即定为目标；列表项带移除（`onRemoveRecent`）。输入经 `parseDocTokenFromUrl` 解析为 token。
- 「添加到文档」按钮：依当前目标 → `resolveToken(settings)` → `listBlocks` 找根 → `insertContentBlocks(token, doc, markdownToBlocks(editMd), root.children.length)` 追加末尾；**找不到根 block 抛错**（v1 I-2）。目标为空时按钮提示先选文档。
- 写入失败显错、不自动重试（CLAUDE.md 约束 7）。
- 默认目标：当前文档（`context.feishu?.appToken`，若 `kind==='doc'`）。

### 5.7 历史记录（需求 6）
- 存储 `src/sidepanel/pdfHistory.ts`，key `pdfHistory_v1`，cap 20：
  ```ts
  interface SavedPdf { id: string; fileName: string; markdown: string; createdAt: number }
  loadPdfs(): Promise<SavedPdf[]>; savePdf(p: SavedPdf): Promise<SavedPdf[]>; deletePdf(id: string): Promise<SavedPdf[]>
  ```
  （照搬 `slidesStore.ts`：`crypto.randomUUID()`、`createdAt`、去重更新、`slice(0, cap)`。）
- 转换完成自动 `savePdf({ fileName, markdown: rawMd })`。
- TopBar `rightAction` 挂历史按钮（`IconHistory`，复用 SlidesPanel 的时钟图标 SVG；新增到 `icons.tsx` 供 PDF 面板用。顺便让 SlidesPanel 也引用以去重——此项可选、不阻塞）。
- 抽屉：`<SideDrawer title="历史记录">`，行 = 文件名 + `timeAgo(createdAt)` + 打开/删除。点行 → 载入该条 markdown 到 `editMd`、`fileName`、进 `done`。
- 不做搜索/分组（YAGNI；若后续要，再借 `SessionDrawer` 风格）。

---

## 6. 数据流

```
选文件 → selected
转换 → extractMarkdown(ArrayBuffer) → rawMd → detectScan 中止?
                                     ↓
                        editMd=rawMd, savePdf(...) → done
                                     ↓
   [预览|Markdown] 切换 ── preview: Markdown.render(editMd)
                        └ markdown: textarea(editMd)
   复制 / 下载 / AI润色(polishMarkdown→editMd) / 添加到文档(DocCombobox→insertContentBlocks)
历史抽屉 → 选条目 → 载入 editMd/fileName → done
```

---

## 7. 组件与文件清单

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/sidepanel/components/Markdown.tsx` + `.css` | 新建（抽自 MessageList） | 共享 markdown→HTML 渲染 |
| `src/sidepanel/components/MessageList.tsx` | 改：import 共享 Markdown | 去重，行为不变 |
| `src/sidepanel/components/icons.tsx` | 改：加 `IconUpload`（+可选 `IconHistory`） | 图标 |
| `src/sidepanel/components/UploadDrop.tsx` | 改（可选）：用 `IconUpload` 去重 | 上传区 |
| `src/sidepanel/pdfHistory.ts` | 新建 | 历史存储 |
| `src/sidepanel/components/DocCombobox.tsx` | 新建 | 目标文档下拉输入框 |
| `src/sidepanel/components/PdfTranscribePanel.tsx` | 重写 | 面板主体（状态机/布局/交互） |
| `src/sidepanel/components/PdfTranscribePanel.css` | 改 | 新布局样式 |
| `src/sidepanel/components/PdfTranscribePanel.test.tsx` | 改 | 新流程测试 |
| `src/sidepanel/App.tsx` | 改：透传 recentFiles/onRemoveRecent 给 ScenarioPanel | 接线 |
| `src/sidepanel/components/ScenarioPanel.tsx` | 改：props 加 recentFiles/onRemoveRecent，转发给 PDF 面板 | 接线 |

---

## 8. 错误处理

| 场景 | 处理 |
|---|---|
| 加密/损坏 PDF | `classifyPdfError` 文案（同 v1） |
| 扫描件（无文本层） | `detectScan` 中止 + 提示（同 v1） |
| AI 润色失败/限流 | 保留 raw、显错（不阻断其它动作） |
| 无 LLM key | `[AI 润色]` 禁用 + 授权提示 |
| 链接/token 无法识别 | "无法识别文档链接或 token" |
| 找不到文档根 block | 抛"无法确定文档末尾位置…"（I-2） |
| 写入失败 | 显错、不重试（约束 7） |
| 复制失败 | 显"复制失败"（M-1 修复） |

---

## 9. 测试（vitest）

- `pdfHistory.test.ts`：`loadPdfs/savePdf/deletePdf` 纯函数（dedup、cap、排序），参照 `slidesStore` 测试。
- `DocCombobox.test.tsx`：渲染输入 + 最近列表、点列表项填入、移除项、非法输入不触发选择。
- `Markdown.test.tsx`：渲染标题/列表/表格/代码/链接（从 MessageList 既有覆盖迁移/补全）。
- `PdfTranscribePanel.test.tsx`（重写）：
  - 选文件 → selected → 转换 → done（不润色，断言 `polishMarkdown` 未被调）。
  - AI 润色按需：点按钮 → 调 `polishMarkdown` → editMd 更新；`disabled` 时按钮禁用。
  - 预览/Markdown 切换：切换后 DOM 反映 textarea vs 渲染容器。
  - 添加到文档：combobox 选最近文档 → `insertContentBlocks` 末尾追加；找不到根抛错。
  - 历史：转换后 `savePdf` 被调；抽屉打开、点条目载入。
- 全局门：`typecheck` 0 错、`npm test` 全绿（**含聊天 MessageList 测试**——验证 Markdown 抽取无回归）、`build` 成功。

---

## 10. 范围外 / 风险

**范围外**（留后续）：
- 历史搜索/分组（SessionDrawer 风格）。
- "撤销润色"按钮（`rawMd` 已内部保留，可后加）。
- 多文件批量。
- DocCombobox 的 wiki 节点类型解析（`resolveWikiKind`，ChatPanel 有；v2 仅按 token 写入）。

**风险**：
1. **Markdown 抽取动到聊天渲染**（MessageList）——最高风险。缓解：纯机械抽取 + 共享 CSS + 聊天测试全绿为硬门；列为独立首个任务。
2. recentFiles 透传改 App/ScenarioPanel props 签名——波及面小但需 typecheck 全过。
3. pdf.js 在 MV3 侧边栏（v1 §7 风险 1）仍待真机验证；本重设计不改 `pdfExtract`，风险不变。

---

## 11. 实现决策

- **预览渲染**：抽 `MessageList.MarkdownText` 为共享件，**不装 markdown 库**（cheapest-viable）。
- **目标选择器**：自建轻量 `DocCombobox`（方案 A），**不装 shadcn Combobox / Popover / cmdk**。
- **预览/Markdown 切换**：复用 `.sc-target-opt` 分段样式，**不封装 Switch**。
- **历史**：照搬 SlidesPanel 模式（`pdfHistory_v1` + `SideDrawer` + 自动存）。
- 执行：subagent-driven（每任务 implementer + reviewer + whole-branch review），同 v1。
