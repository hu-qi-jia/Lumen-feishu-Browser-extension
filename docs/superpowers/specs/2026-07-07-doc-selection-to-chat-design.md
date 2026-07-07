# 文档选区「添加到会话」

- 日期：2026-07-07
- 状态：设计待评审
- 分支：`feishu-ok`
- 关联：`2026-07-05-doc-image-handling-design.md`（已确立"选中文本 → `list_blocks` 文本匹配回溯定位块"的锚点路径，本设计复用）

## 1. 目标

补齐 agent 对**文档细节修改**的短板：当前 agent 只能对整篇文档做宏观操作，用户难以把"选中的某一段"交给 agent 修改。借鉴 Trae/Cursor 选中代码行直接加入会话的体验——

1. **在飞书文档页选中文本时，选区旁浮出一个「添加到会话」按钮**（不侵入飞书原生工具栏 DOM）。
2. **点击后把该选区作为输入框里的「引用卡片」chip 暂存**（可移除），用户写指令、随下一条消息一起发给 agent。
3. **chip 携带定位上下文**（选中文本 + 所在完整段落 + 最近标题），agent 据此用 `list_blocks` 文本匹配定位并就地修改。
4. **跨文档时复用现有切换弹窗**：若选区所在文档 ≠ 当前工作文档，弹 `SwitchDocDialog`（新建会话 / 继续 / 取消）。
5. **侧边栏未开时自动打开**。

v1 仅覆盖**文档类型**（`/docx/`、`/docs/`、`/wiki/`）。电子表格/多维表格留后续。

## 2. 非目标

- **不侵入飞书原生选中工具栏 DOM** —— 经评估（见 §3），代码库此前已判定 docx 编辑器 DOM（canvas/ProseMirror）读块 id 不可靠，且无任何触碰编辑器 DOM 的先例。本设计用**独立浮层**贴在选区旁，零依赖飞书内部 class。
- **不从 DOM 读 `block_id`** —— `block_id` 始终走 API（`list_blocks`）。段落/标题上下文也走 API 文本匹配，不在内容脚本里解析编辑器 DOM。
- **v1 不覆盖表格类页面**（sheet/base）—— 选区语义、定位键、工具集都不同，留作下阶段。
- **不自动发起 agent** —— chip 暂存到输入框，用户自己写指令再发送（Cursor 风格）。
- **不改现有附件/对话/鉴权链路** —— 仅在 `Attachment` 上加一个 `selection` kind 并接进既有管线（见 §4.4 回归保护）。

## 3. 现状（改动基线）

调研结论（已确认）：

- **内容脚本已是 DOM 注入器**，有两条可复用的注入先例：
  - `src/content/viz-launcher.ts:29-37` —— shadow-DOM 浮标（`host.attachShadow({mode:'open'})`，全仓唯一 `attachShadow`，见 `:31`），`position:fixed` 左下；`:23-27` 处理飞书 SPA 把 host 孤立的重建逻辑。
  - `src/content/viz-overlay.ts:56-170` —— 可拖拽浮窗，`position:fixed`、`z-index:2147483600`、直接 `document.body.appendChild`（非 shadow）。
- **选区检测已有**：`window.getSelection()?.toString()` 在 `src/content/index.ts:13`（extractContext）和 `:111`（mouseup）。**未用 `selectionchange`**（全仓无匹配）。
- **doc token 来自 URL**：`parseFeishuContext(location.href)`（`src/shared/feishu/pageUrl.ts:13-40`）→ `/docx|docs/{documentId}` = doc；`/wiki/{wikiToken}` = wiki。`block_token` 另从 URL `?table=` 读（`feishu-automation.ts:157-162`），与本设计无关。
- **消息协议**（`ARCHITECTURE.md:108-122`，全部校验 `sender.id === chrome.runtime.id`，`index.ts:33`）：
  - Side Panel → Content：`chrome.tabs.sendMessage`（如 `GET_PAGE_CONTEXT`，`index.ts:35-38`）。
  - Content → Side Panel / Background：`chrome.runtime.sendMessage`（如 `PAGE_CONTEXT_UPDATE`，`index.ts:70,114`，消费方 `App.tsx:167-169`，仅接受 `sender.tab.active===true`）。
  - Content → Background：`chrome.runtime.sendMessage`（如 `DATAVIZ_OPEN_SAVED`，`viz-launcher.ts:64`）。
- **侧边栏只能由 background 开**：`chrome.sidePanel.open({tabId})` 在 `src/background/index.ts:54`（action 点击）、`:85`（右键）、`:111`（命令）。**内容脚本无 `openSidePanel` 调用**。
- **会话 = 按文档绑定**：`SessionMeta.appToken`（字段名 legacy，实际存任意资源 token）。`SessionKind = 'base'|'sheet'|'doc'|'wiki'|'ppt'`（`types.ts:91`）。存储分片 `sessions_index_v1` + `session_msgs_v1::<id>`（`store.ts`）。
- **工作文档状态机**：`src/sidepanel/hooks/useDocBinding.ts:67`。`docMode:'follow'|'pin'`（`:69`）；`liveResource = ctx.feishu?.wikiToken ?? appToken ?? spreadsheetToken ?? documentId ?? slideToken`（`:94-95`）；`effectiveResource`（`:104`，pin 用 `pinned.token`，follow 用 `heldResource ?? liveResource`）喂给 `useSessions`。`App.tsx:80` 的 `activeDocToken` = pin?`pinned.token`:`activeSession?.appToken`。
- **切换弹窗已存在两个**，标题均为「切换工作文档？」，`App.tsx:371-384` 互斥渲染：
  - **`SwitchDocDialog.tsx`（49 行）= 本设计要复用的那个**。follow 模式下、活动 tab 资源 ≠ 活动会话 appToken 时触发（`useDocBinding.ts:129-145`，`pendingSwitch` 置位于 `:143`）。文案 `当前标签页已切换到「<b>{toTitle}</b>」。是否为它新建一个会话？`。三回调：`onNew`（新建会话，`handleSwitchNew` `:199`）/`onStay`+`onCancel`（`handleSwitchStay` `:205`，rebind 当前会话到新 token）。
  - `SwitchSessionDialog.tsx` —— 历史抽屉跨文档挑选，2 选。本设计不直接用。
- **附件管线（关键复用点）**：
  - `Attachment { id, type:'image'|'file', name, mimeType, size, dataUrl?, content? }`（`types.ts:9-19`）。
  - `InputBar` 本地持有 `attachments` state（`InputBar.tsx:30`），渲染 chip（图片缩略图 / 文件名 + ×，`:173-195`），`removeAttachment`（`:121-123`），`submit()` → `onSend(text, attachments)`（`:92`）。**已有命令式 API**：`useImperativeHandle` 暴露 `insert(t)`（`:87`），供父组件塞文本。
  - **InputBar 已有 `selection` prop**（`:20-21,68-77`）：把页面选区**作为文本**自动填进 textarea（仅当输入框为空时）——与本设计的 chip 是两套机制，需避免重复（见 §4.5）。
  - `agent.ts:655-669`：附件**渲染成文本元数据**发给 LLM（`【附件：图片 …（attachment_id: …）】`），图片二进制另经 `latestAttachments`（`:335-338`）喂给图片工具（`executeDocTool` `:1343-1344,1424-1425` 找 `type==='image'`）。
- **锚点匹配先例**：`2026-07-05-doc-image-handling-design.md:19,110` 已确立"选中文本 → `list_blocks` 文本匹配回溯到块"路径，`listBlocks`（`docx.ts`）返回扁平全树（带 `parent_id`）。
- **既有约束**：纯 CSS + 语义 class + `App.css --color-*` 变量；图标手写内联 SVG；UI 无 emoji。仅用户要求时 commit。

## 4. 架构

复用现成基建（shadow-DOM 注入 / runtime 消息 / Attachment 管线 / SwitchDocDialog / list_blocks 锚点匹配）；**唯一新机制是 side-panel 就绪握手**（§4.2），其余都是"加文件 / 加分支"，无架构改动。

### 4.1 整体数据流

```
飞书文档页（选中段落）
  ① 内容脚本 selection-button.ts：selectionchange(debounce) 检测非空选区 + kind∈{doc,wiki}
     → shadow-DOM 浮层按钮，按 getRangeAt(0).getBoundingClientRect() 贴选区右上
  ② 点按钮（用户手势）→ 捕获 {kind, docToken(wikiToken|documentId), docTitle, url, selectedText}
     → chrome.runtime.sendMessage({type:'OPEN_SIDE_PANEL_WITH_SELECTION', payload})
  ▼
Background index.ts：OPEN_SIDE_PANEL_WITH_SELECTION
  → chrome.sidePanel.open({tabId})
  → 暂存 payload + 转发 SELECTION_INCOMING（带就绪握手，§4.2）
  ▼
App.tsx：收 SELECTION_INCOMING
  ├─ wikiToken → 经 RESOLVE_PAGE_RESOURCE 解析成真实 docToken
  ├─ 解析后 docToken == 当前工作文档？→ stageSelectionChip(payload)
  └─ 不等 → 复用 SwitchDocDialog（onNew/onStay 建或切会话 → stage；onCancel 丢弃）
  ▼
InputBar：selection chip 渲染（文档名 + 片段预览 + ×），用户写指令 → 发送
  ▼
docx.ts resolveSelectionContext：异步用 list_blocks 文本匹配回填 paragraphText/headingText（chip 先以 selectedText 落地，回填后刷新）
  ▼
agent.ts buildApiHistory：selection 附件渲染成【引用文档片段…】文本元数据 → 注入该轮 user 消息
  ▼
Agent：按 chip 里的选中文本+段落+标题，list_blocks 文本匹配定位、就地改写
```

### 4.2 Side-panel 就绪握手（唯一新机制）

侧边栏可能未 mount。background 收到 `OPEN_SIDE_PANEL_WITH_SELECTION` 后：

1. `chrome.sidePanel.open({ tabId })`（按钮点击即用户手势，满足 MV3 手势要求）。
2. 把 payload 存进 background 模块级 `pendingSelection` 变量。
3. 立即 `chrome.runtime.sendMessage({type:'SELECTION_INCOMING', payload})`（面板已开则直接收到）。
4. 侧边栏 `App.tsx` mount 后发 `SIDEPANEL_READY`；background 收到后若 `pendingSelection` 还在，重发一次 `SELECTION_INCOMING` 并清空。
5. 兜底：`pendingSelection` 带 ~3s TTL，超时丢弃（避免陈旧选区污染下次开面板）。

> 即"推一次 + ready 拉一次"双保险，覆盖"面板已开 / 刚打开未 mount"两种情况。

### 4.3 内容脚本浮层按钮（新文件 `src/content/selection-button.ts`）

- **初始化**：由 `src/content/index.ts` 引入并启动（仿 viz-launcher/viz-overlay 的引入方式）；content script bundle 由 vite-plugin-web-extension 自动并入既有 content_scripts 入口，**不改 manifest**。
- **显示判定**：debounce ~150ms 的 `selectionchange` + 现有 `mouseup`。仅当 `parseFeishuContext().kind ∈ {'doc','wiki'}` 且 `getSelection().toString().trim()` 非空且选区在文档正文区时显示按钮。
- **定位**：`getSelection().getRangeAt(0).getBoundingClientRect()` → 按钮 `position:fixed` 置于选区矩形右上方，避开飞书原生工具栏常规位置（通常左/上）。滚动/选区变化/收起选区 → 重定位或隐藏。
- **隔离**：复用 `viz-launcher.ts:31` 的 `attachShadow({mode:'open'})` + `position:fixed` host；SPA 孤立时照 `viz-launcher.ts:23-27` 重建。
- **样式**：纯 CSS、语义 class、`--color-*` 变量、内联 SVG 图标、无 emoji；紧凑「添加到会话」按钮 + 短文案。
- **捕获发送**：点击 → `chrome.runtime.sendMessage({ type:'OPEN_SIDE_PANEL_WITH_SELECTION', payload:{ kind, docToken, docTitle, url, selectedText } })`。`docToken` = wikiToken（wiki 页）或 documentId（docx 页）；`docTitle` 取 `document.title`（飞书文档页 title 即文档名）。

### 4.4 数据模型（`src/shared/types.ts`）

扩展 `Attachment`，最小侵入接进既有管线：

```ts
export type AttachmentType = 'image' | 'file' | 'selection'
export interface Attachment {
  id: string
  type: AttachmentType
  name: string
  mimeType: string
  size: number
  dataUrl?: string
  content?: string
  /** type === 'selection' 时填充。paragraphText/headingText 由 resolveSelectionContext 异步回填。 */
  selection?: {
    kind: 'doc' | 'wiki'
    docToken: string         // wiki 已解析为底层 docToken
    docTitle: string
    url: string
    selectedText: string
    paragraphText?: string
    headingText?: string
  }
}
```

- `size` 对 selection 无意义，填 0；`mimeType` 填 `'text/x-feishu-selection'` 之类的占位。
- ChatMessage 已有 `attachments?`（`types.ts:30`），无需改消息结构。

### 4.5 侧边栏暂存与跨文档切换（`App.tsx` + `useDocBinding.ts` + `InputBar.tsx`）

- **App 收 `SELECTION_INCOMING`**：
  1. 若 `payload.kind === 'wiki'`，经现有 `RESOLVE_PAGE_RESOURCE`（background `index.ts:188`，viz-launcher 已在用）把 wikiToken 解析为真实 docToken；docx 页直接用 documentId。
  2. **doc 比对**：解析后 docToken vs 当前工作文档 token（`effectiveResource`；若工作文档本身是 wiki，亦解析后比对）。相等 → `stageSelectionChip`。
  3. **不等** → 复用 `SwitchDocDialog`：把 payload 暂存进 `pendingSelectionForSwitch`，置 `pendingSwitch` 弹窗。
     - `onNew`（新建会话）/`onStay`（rebind）→ 工作文档切到选区文档 → `stageSelectionChip`。
     - `onCancel`（**取消 = 丢弃**，已确认）→ 丢弃 payload，不加 chip。
  - 复用方式：在 `useDocBinding` 暴露一个 `triggerSwitchForSelection(payload)` 入口，内部走现有 `setPendingSwitch`（`:143`）机制 + 把目标 token/title 设为选区文档，使现有 `SwitchDocDialog` 渲染与回调链（`App.tsx:377-383`）原样复用。
  - **文案注意**：`SwitchDocDialog` 现有文案是 `当前标签页已切换到「X」。是否为它新建一个会话？`——假设是**标签页切换**。但本设计的触发场景通常是 **pin 模式**（chat 绑定在 doc Y、用户在 doc X 选区），标签页并没切换，照搬文案会误导。给 `SwitchDocDialog` 加一个可选 `variant: 'tab-switch' | 'selection'`（或 `reasonText` prop）：selection 变体文案改为 `选区来自「X」，但当前工作文档是「Y」。是否切换工作文档？`，三选项语义（新建/继续/取消）不变。
- **stageSelectionChip**：
  - chip 状态**提升到 App 层**（与 sessions 同级，不随 ChatPanel/InputBar 卸载），避免切会话/切 tab 丢 chip。
  - 调 InputBar 新命令式 API `addSelection(payload)`（仿现有 `insert`，`InputBar.tsx:87`），往 `attachments` push 一个 `selection` 附件。
  - **上限 5 个**（已确认）：超出给轻提示，不再加。
  - **去重**：同 docToken + selectedText 完全相同的 chip 不重复堆。
  - **抑制重复文本填充**：stage chip 时设一次性标志，抑制 InputBar 当次的 `selection` prop 文本自动填充（`InputBar.tsx:68-77`），避免选区既进 chip 又被填进 textarea。
- **InputBar chip 渲染**（`InputBar.tsx:173-195` 加分支 + `InputBar.css`）：selection chip 显示 文档名 + 标题（若有）+ 片段预览（截断 ~40 字）+ × 移除。复用现有 `.attachment-chip` 视觉骨架。

### 4.6 段落/标题上下文解析（`src/shared/feishu/docx.ts`，纯函数 + 单测）

新增 `resolveSelectionContext(docToken, selectedText, token): Promise<{paragraphText?, headingText?}>`：

- `listBlocks(docToken)` 拉全树 → 线性化为 `(block_id, block_type, text)` 序列。
- 找文本**包含** selectedText（退化用最大子串重叠）的块 → `paragraphText` = 该块完整文本。
- 从该块向前找最近的 heading 块（block_type 3/4/5）→ `headingText`。
- 失败（选区已被改写 / 无重叠）→ 返回空，agent 兜底走 `ask_user`（已有工具）确认；chip 仍带 selectedText + heading 提升唯一性。
- **纯逻辑可单测**（符合项目 ~460 用例的纯函数测试风格）。

回填时机：chip 先以 selectedText 落地（立即可见），`resolveSelectionContext` 异步完成后刷新对应 chip 的 paragraphText/headingText（用户无感）。

### 4.7 Agent 集成（`src/shared/ai/agent.ts`）

- `buildApiHistory`（`:655-669`）附件元数据循环加 `selection` 分支，渲染成（仿现有 `【附件：…】` 风格）：
  ```
  【引用文档片段｜文档：<docTitle>｜标题：<headingText 或「（无）」>】
  所在段落：<paragraphText 或「（见选中内容）」>
  选中的内容：
  <selectedText>
  ```
- 系统提示词（`:1607` 附近，现有附件说明那一段）补一句：用户消息里的「引用文档片段」是要修改的目标，用 `list_blocks` 文本匹配定位、就地改写；不确定时用 `ask_user`。
- selection 附件**不进**图片工具的 `latestAttachments` 数据分发（`:335-338`）——它只是文本上下文，无需二进制。

## 5. v1 范围

- **做**：文档 `/docx/`、`/docs/`、`/wiki/`（解析为底层 doc）；1~5 个引用 chip；跨文档复用 `SwitchDocDialog`（取消=丢弃）；侧边栏未开自动打开；selectionchange + mouseup 双触发。
- **不做**：sheet/base；DOM 读 block_id；选区跨多块的精细多块定位（先按"主包含块"处理）；chip 跨标签页/跨会话的复杂归并（chip 提升到 App 层即满足当前会话存活）。

## 6. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| 侧边栏未 mount 丢消息 | §4.2 推一次 + ready 拉一次双保险 + TTL 兜底 |
| `sidePanel.open` 手势要求 | 按钮点击即用户手势；open 失败 → 浮层 toast 提示"请先打开侧边栏" |
| `selectionchange` 高频抖动 | debounce 150ms；空选区/非正文区立即隐藏 |
| chip 跨会话切换丢失 | chip 状态提升到 App 层，不随 ChatPanel 卸载 |
| 文本匹配定位失败（选区被改写/重复文本） | chip 带 heading 提升唯一性；agent 兜底 `ask_user` |
| 与 InputBar `selection` 文本自动填充重复 | stage 时一次性抑制（§4.5） |
| wiki 与 docx 同一底层文档被判成不同文档 | 比对前双方都经 wiki 解析（§4.5 步骤 1-2） |
| 飞书编辑器非 contenteditable（纯 canvas）导致 getSelection 取不到 | 现有 `index.ts:13,111` 已验证 doc 页 `getSelection().toString()` 有值（image-handling 依赖 `context.selectedText`）；若个别页取空，按钮不显示即可，不报错 |

## 7. 回归保护

- **附件管线**：`selection` 是 `AttachmentType` 新增枚举值；现有 image/file 分支（InputBar 渲染、agent 元数据、图片工具分发）均按 `type===` 精确匹配，不受影响。现有 ~460 测试应全绿。
- **会话/工作文档**：`SwitchDocDialog` 复用其既有渲染与回调，不改动其语义；仅新增一个外部触发入口。
- **内容脚本**：新文件独立，不动 viz-launcher/viz-overlay/feishu-automation；仅在 index.ts 加一行引入。
- **build/manifest**：不改 manifest，不改 vite.config；content bundle 自动并入。
- **迭代循环**：`npm run typecheck`（0 错）→ `npm test`（全绿，补 resolveSelectionContext 单测）→ `npm run build`（成功）→ 真机联调（飞书文档页，dev:ui 无法验内容脚本，需 `dev:ext` 加载 dist 真机验证）。

## 8. 落地清单与顺序

| # | 层 | 文件 | 改动 |
|---|---|---|---|
| 1 | 类型 | `src/shared/types.ts` | `AttachmentType` 加 `'selection'` + `selection?` 字段 |
| 2 | UI | `src/sidepanel/components/InputBar.tsx` | selection chip 渲染分支 + `addSelection` 命令式 API + 抑制重复填充 |
| 3 | UI | `src/sidepanel/components/InputBar.css` | chip 样式 |
| 4 | API | `src/shared/feishu/docx.ts` | `resolveSelectionContext`（纯函数） |
| 5 | 测试 | `src/shared/feishu/docx.test.ts`（新/补） | resolveSelectionContext 单测 |
| 6 | Agent | `src/shared/ai/agent.ts` | buildApiHistory selection 元数据分支 + 系统提示词补一句 |
| 7 | 内容脚本 | `src/content/selection-button.ts`（新） | 浮层按钮 + selectionchange + 发消息 |
| 8 | 内容脚本 | `src/content/index.ts` | 引入并初始化 selection-button |
| 9 | Background | `src/background/index.ts` | OPEN_SIDE_PANEL_WITH_SELECTION + 握手 + open panel |
| 10 | 侧边栏 | `src/sidepanel/App.tsx` | SELECTION_INCOMING 收件 + wiki 解析 + doc 比对 + stage |
| 11 | 侧边栏 | `src/sidepanel/hooks/useDocBinding.ts` | `triggerSwitchForSelection` 入口（复用 setPendingSwitch） |
| 12 | 侧边栏 | `src/sidepanel/components/SwitchDocDialog.tsx` | 加 `variant`/`reasonText` prop + selection 变体文案（三选项语义不变） |

**实现顺序**：①(#1-3) 数据模型 + chip 渲染（dev:ui 手塞 chip 看效果）→ ②(#4-6) agent 元数据 + resolveSelectionContext 单测 → ③(#7-9) 内容脚本浮层 + background 中继 → ④(#10-11) doc 比对 + SwitchDocDialog 复用 → ⑤ 真机联调（`dev:ext`，飞书文档页）。
