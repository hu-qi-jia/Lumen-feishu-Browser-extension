# Obsidian 知识库 — UI 重做 + chat 工具只读接入（设计文档）

- 日期：2026-07-09
- 状态：草案（待用户评审）
- 关联：`docs/superpowers/specs/2026-07-08-obsidian-knowledge-base-design.md`（基线设计，Plan 1 已落地连接地基）
- 分支：`feishu-ok`（直接改，不开特性分支；不自动 commit/push）

## 0. 本次改什么

用户在 Plan 2（Hub 页）代码完成后、真机验收前给出 4 条新方向，本设计是对基线 spec **§5（App Hub 知识库页）的架构修订** + **§6（chat KB 模式）的提前 + 缩范围（只读）**：

1. 接入/连接设置从 Hub 页**搬到设置页**，单独一个分页；连接步骤样式**复用飞书配置的步骤组件**；能复用的组件尽量复用；未配置时点知识库入口**提示去设置页配置**。
2. 知识库**功能页扁平化重做**；搜索框重做（飞书风）并**抽成公共组件**；列表项做成扁平行。
3. 二级页面**返回键重做**（扁平、居左、与内容左对齐）；编辑/删除**复用现有图标**。
4. chat 输入框「工具」下拉里加「**知识库**」选项（点开下拉 → 可选连接知识库）。

**不改**（沿用基线 spec，by reference）：§3 总体方案、§4 连接与出站安全边界（loopback 第三出站组 / `obsidianFetch` / token 独立加密键）、§7 KB 行为策略（检索分层 / 排除路径 / 写入决策树）、§9 安全隐私。本设计只动 UI 架构 + chat 只读接线；**写工具（create/update/delete + 确认门）显式排除**（见 §「不做」）。

## 1. 判断点决议（已与用户确认，全按推荐）

| # | 议题 | 决议 |
|---|---|---|
| ① | 设置放新 tab vs 钻入式子页 | **新增顶层 tab「知识库」**（设置页现状全是扁平 tab、无子页模式） |
| ② | 设置页里的保存语义 | API Key 测试连接**成功即存**（独立加密键 `saveObsidianToken`）；端点/收件箱/排除路径/vault 名随设置页底部统一「保存」**批量落盘** |
| ③ | 扁平列表样式 | **`.drawer-row` 风**（透明边 + hover 浅底填充 + active primary-soft，与会话列表统一） |
| ④ | chat 下拉实现 | **保留现有向上弹的 `.tools-menu`**（输入条在底部，向上弹才对），其上加「知识库」行；**不**换成公共 `Dropdown`（它向下弹，方向反） |

---

## A. 设置页：新增「知识库」分页

设置页（`src/sidepanel/components/Settings.tsx`）`SETTINGS_TABS` 加第 6 个 tab：

```
通用 · 模型配置 · 飞书配置 · 知识库 · 数据与备份 · 外观
```

（排在「飞书配置」后——同属"接外部服务"语义。）

**新组件 `src/sidepanel/components/settings/KnowledgeBaseTab.tsx`**，遵循设置 tab 既有契约 `SettingsTabProps { form, patch, set }`（`settings/types.ts:13`），内容：

1. **连接步骤**：复用 `settings/FeishuSteps.tsx`（编号圆点 + 连线，纯展示组件）渲染 3 步引导——① 装 `Local REST API with MCP` 社区插件（带链接）② 设置→Local REST API→打开「Enable non-encrypted (HTTP) server」（带 `Tooltip` 说明为何走 HTTP）③ 复制 API Key。**替换** 现有 `ObsidianConnectForm` 里手写的 `<ol class="kb-steps">`。
2. **字段**（全部走 `FormField` + `FormInput`）：
   - 端点 `obsidianBaseUrl`（`FormInput type="url"`，placeholder `http://127.0.0.1:27123`）。
   - API Key（`FormInput type="password"`——`FormInput` 对 password **自带显隐切换**，省掉 `ObsidianConnectForm` 现在那套手写 `<label htmlFor>` + 切换按钮）。Key 不进 `AppSettings`，存独立加密键；表单里用本地临时态承载，placeholder 提示「已保存则留空沿用」。
   - 高级（可折叠）：收件箱路径 `obsidianInboxPath`、排除路径 `obsidianExcludePaths`（`FormField` 带 hint）。
3. **测试连接** 按钮（复用 `Button`）：取当前表单端点 +（已填 Key ? 已填 : `getObsidianToken()`）调 `pingObsidian`，三态提示沿用 `ObsidianConnectForm` 现有逻辑（!ok→"无法连接…HTTP server(27123)"；ok&!auth→"API Key 无效"；ok&auth→"已连接 · 〈vault〉"）。
4. **保存语义**（判断点 ②）：
   - 测试连接**成功** → `saveObsidianToken(key)`（仅当用户填了 Key）+ `patch({ obsidianBaseUrl, obsidianVaultName })` 进 form（vault 名随连接结果回填）。
   - 收件箱/排除路径通过 `patch` 进 form，随设置页底部统一「保存」（`Settings.onSave(form)` → `saveSettings`）批量落盘。
   - 即：Key 即时存（与独立加密键的语义一致，不进批量 blob）；其余字段批量存（与其余 tab 一致）。

**删除**：`src/sidepanel/components/ObsidianConnectForm.tsx` / `.css` / `.test.tsx`（接入 UI 已整体搬进本 tab）。

---

## B. Hub「知识库」入口：未配置 → 门禁引导去设置

`KnowledgeBasePanel.tsx` 现状已是 `<TopBar title="知识库">` + loading/connected/disconnected 三态。改造：

- **connected** → `<ObsidianVaultView>`（不变，见 §C 重做）。
- **disconnected** → **门禁空态**（不再是 `ObsidianConnectForm`）：一句话「尚未连接 Obsidian 知识库」+ 主按钮「去设置完成配置」→ 调新 prop `onGoToSettings()`。
- props 变化：移除 `saveSettings?`（接入已不在本页），新增 `onGoToSettings: () => void`。`data-testid` 保留 `kb-loading`；门禁态给 `kb-gate`；connected 仍是 `kb-vault-view`。
- **wiring**：`ScenarioPanel` 把一个跳设置的回调透下来。`ScenarioPanel` 本身是 Hub 子视图（`setView({mode:'knowledgeBase'})`），要跳到设置 tab 需 App 层 `setTab('settings')`——在 `App.tsx` 给 `ScenarioPanel` 加 `onGoToSettings={() => setTab('settings')}`，`ScenarioPanel` 透给 `KnowledgeBasePanel`。

> ping 依赖仍只挂 `settings.obsidianBaseUrl`（token 在独立键），连接成功后 `saveSettings` 换引用不触发重 ping——此既有修正（回归测试已锁）继续保留。

---

## C. 知识库列表页：扁平化重做（`ObsidianVaultView.tsx/.css`）

- **顶栏**：去掉自定义 `.kb-vault-head`，对齐全站 `TopBar`——`title` = vault 名（`settings.obsidianVaultName || 'Obsidian'`），`rightAction` = 一个「设置」齿轮按钮（复用新 `IconSettings`，`aria-label="设置"`，`onClick={onGoToSettings}`）。**onDisconnected 回调改为 onGoToSettings**（齿轮不再在本页重开接入表单，而是去设置 tab）。
- **搜索框**：换成新公共组件 `<SearchBox>`（§E），保留 Ctrl+K 聚焦（`SearchBox` 透 `autoFocus`/ref）。
- **列表项**：从描边卡片 `.kb-row` 改为 `.drawer-row` 风扁平行（判断点 ③）——透明边、`border-radius var(--radius-sm)`、hover `background var(--color-surface)`、active `background var(--color-primary-soft)`；标题 12.5px/600，路径/片段/时间副行 10–11px muted。`ObsidianVaultView.css` 里 `.kb-list/.kb-row` 重写为此风（或直接复用 `.drawer-row*` 同名 class）。
- 「最近 / 搜索」tab 保留；「新建笔记」CTA 仍**无图标**（创建型 CTA 规范）。

---

## D. 笔记详情页：扁平 + 复用图标（`ObsidianNoteDetail.tsx/.css`）

- **顶栏**：去掉 `.kb-detail-head` + 描边方块 `.kb-icon-btn` 返回键，换 `<TopBar>`：
  - `title` = `isNew ? '新建笔记' : path`。
  - `rightAction` = 操作按钮组：查看态显示「编辑」（`IconEdit`）；已有笔记显示「删除」（`IconTrash`）。
  - 返回 = `TopBar` 自带的 `BackButton`（无框、居左、`color text-secondary→primary on hover`，天然与下方内容左对齐）。
- **编辑/删除图标**：改 import 自 `icons.tsx` 的 `IconEdit` / `IconTrash`（现在详情页是内联复制粘贴的同款 SVG）。
- 其余行为不变：读（Markdown 预览）⇄ 源码编辑；保存 `PUT`（新建按 `obsidianInboxPath` 落点——既有修正保留）；删除 `window.confirm`→`DELETE`；保存仍是纯文字 CTA（无图标）。

---

## E. 公共 `SearchBox` 组件

- **新组件** `src/sidepanel/components/SearchBox.tsx`（+ `.css`），以 `SessionDrawer` 的 `.drawer-search`（前导放大镜 + 无框输入 + 清除叉 + `:focus-within` 描边）为蓝本。
- props：`{ value: string; onChange: (v: string) => void; onSearch?: () => void; placeholder?: string; autoFocus?: boolean; inputRef?: React.Ref<HTMLInputElement> }`。Enter 触发 `onSearch`；非空显示清除叉。
- **采用处**：新 KB 列表页（替换 `.kb-search`）+ `SessionDrawer`（替换 `.drawer-search`，顺手统一、验证公共件）。
- **不动**：`ScenarioPanel` 的 `.sc-search`（无图标、视觉不同，本次不迁移）。

---

## F. 图标收口（`icons.tsx`）

- 给 `src/sidepanel/components/icons.tsx` 补缺失图标：`IconSearch`、`IconSettings`（齿轮）、`IconChevronLeft`（返回箭头 `polyline 15 18 9 12 15 6`）——现 KB 页全是内联复制。
- KB 两页（列表的齿轮/搜索、详情的返回/编辑/删除）全部改 import 自 `icons.tsx`，清掉内联 SVG。
- `IconEdit`/`IconTrash`/`IconPlus` 已在 `icons.tsx`（直接用）。

---

## G. chat「工具」下拉 + 知识库只读接线（判断点 ④ + 用户选「开关 + 只读接线」）

### G.1 InputBar 下拉改造（`src/sidepanel/components/InputBar.tsx`）

现状「Tools」按钮（`InputBar.tsx:297-329`）是技能建议菜单（扳手图标 + 自有向上弹 `.tools-menu`，点条目 `insert()` 塞文本）。改造：

- 下拉顶部加一行 **「知识库」开关**（`HAS_KNOWLEDGE_BASE` 时显示）：`FormSwitch` + 文案；勾选态来自 `kbEnabled`，`onChange` → `onToggleKb`。
- 下方保留技能建议列表（若有）。两段都用现有 `.tools-menu`/`.tools-menu-item` 样式，开关行可加一个 `.tools-menu-section` 分隔。
- **关键修正**：现按钮 `disabled={blocked || skills.length === 0}`（本地构建技能为空 → 永远点不开）。改为 **`disabled={blocked || (!HAS_KNOWLEDGE_BASE && skills.length === 0)}`**——KB 可用即可点开。
- props 新增：`kbEnabled: boolean; onToggleKb: (on: boolean) => void`（InputBar 现无 session/settings 访问，由 `ChatPanel` 透下来）。

### G.2 会话态（`src/shared/types.ts` + `src/sidepanel/sessions/useSessions.ts`）

- `SessionMeta` 加 `kbEnabled?: boolean`（默认 false）。
- `SessionsApi` 加 setter `setKbEnabled(sessionId, on)`（写 `chrome.storage.local`，键带版本号；按 CLAUDE.md「改 schema 要迁移」升 storage schema 版本）。
- 新建会话默认 `kbEnabled=false`。

### G.3 agent 只读接线（`src/shared/ai/`）— 全部只读、无需确认门

- `tools.ts`：新增 2 个工具定义 `search_knowledge_base(query)`、`read_knowledge_note(path)`（描述、参数 schema）。
- `agent.ts`：
  - `toolsForContext`：当 `kbEnabled && 已连接(token 解得出) && HAS_KNOWLEDGE_BASE` 时，把这 2 个工具追加到返回集。
  - `executeTool`：加 2 分支——`search_knowledge_base` → `searchVault(settings, query)`；`read_knowledge_note` → `readNote(settings, path)`。结果走现有 `redactSensitive(truncateToolResult(...))`（`MAX_TOOL_RESULT_CHARS`）。
  - `buildSystemPrompt`：KB 模式追加一段（"知识库已启用：可 `search_knowledge_base` 检索、`read_knowledge_note` 读全文，引用注明笔记路径；本会话未开启写入"）。
  - `runAgent` / 调用链：把 `kbEnabled` 从 active session 透进 `runAgent`（扩展签名 or 经 context），进而到 `toolsForContext` / `buildSystemPrompt`。
- **接线前提**：`settings` 已在 `runAgent` 入参；`kbEnabled` 需新增入参。`ChatPanel.runAgentTurn` 从 active session 取 `kbEnabled` 传入。

### G.4 wiring 全链

`App.tsx`（own `useSessions`）→ `ChatPanel`（active session + `setKbEnabled`）→ `InputBar`（`kbEnabled` + `onToggleKb`）。`onGoToSettings` 同 §B 由 App 透给 ScenarioPanel。

---

## 文件改动清单

**新增**
- `src/sidepanel/components/settings/KnowledgeBaseTab.tsx`（+ 复用 Settings.css / 必要时局部 class）
- `src/sidepanel/components/SearchBox.tsx` + `.css`
- `src/shared/ai/` 内 KB 工具定义（`tools.ts` 加，或新文件）

**修改**
- `src/sidepanel/components/Settings.tsx`（+「知识库」tab）
- `src/sidepanel/components/KnowledgeBasePanel.tsx`（disconnected→门禁；props：去 `saveSettings`、加 `onGoToSettings`）
- `src/sidepanel/components/ScenarioPanel.tsx`（透 `onGoToSettings`）
- `src/sidepanel/App.tsx`（透 `onGoToSettings`、`useSessions` 的 `setKbEnabled` 到 ChatPanel）
- `src/sidepanel/components/ObsidianVaultView.tsx/.css`（顶栏 TopBar + 齿轮、SearchBox、`.drawer-row` 风列表、图标 import）
- `src/sidepanel/components/ObsidianNoteDetail.tsx/.css`（TopBar 顶栏、`IconEdit`/`IconTrash` import、去 `.kb-detail-head`/`.kb-icon-btn`）
- `src/sidepanel/components/icons.tsx`（+ `IconSearch`/`IconSettings`/`IconChevronLeft`）
- `src/sidepanel/components/SessionDrawer.tsx`（采用 `SearchBox`）
- `src/sidepanel/components/InputBar.tsx`（下拉加 KB 开关行 + 修正 disabled 条件 + 新 props）
- `src/sidepanel/components/ChatPanel.tsx`（透 `kbEnabled`/`onToggleKb` 到 InputBar；`runAgentTurn` 传 `kbEnabled`）
- `src/shared/types.ts`（`SessionMeta.kbEnabled`；storage schema 版本）
- `src/sidepanel/sessions/useSessions.ts`（`setKbEnabled` setter）
- `src/shared/ai/agent.ts`（`toolsForContext`/`executeTool`/`buildSystemPrompt`/`runAgent` 签名）
- `src/shared/ai/tools.ts`（KB 工具定义）
- 配套测试：各改/新增组件的 `.test.tsx`（门禁态、SearchBox、KB tab 测试连接、InputBar 开关、`setKbEnabled`、agent 注入/执行/提示）

**删除**
- `src/sidepanel/components/ObsidianConnectForm.tsx` / `.css` / `.test.tsx`

**文档（沿用基线、待办不变）**
- `CLAUDE.md` 约束 #4 + `SECURITY_AUDIT.md` 第三出站组（Obsidian-loopback）—— Plan 1 遗留 TODO，本次仍顺手补。

---

## 测试要点（行为级）

- 设置「知识库」tab：步骤渲染、字段双向绑定、测试连接三态、成功存 Key + 回填 vault。
- `KnowledgeBasePanel`：未连接→`kb-gate` + 「去设置」回调；已连接→`kb-vault-view`；baseUrl 不变不重 ping（既有回归保留）。
- `SearchBox`：value/onChange、Enter→onSearch、清除叉显隐。
- 列表/详情：扁平行渲染、TopBar + BackButton 存在、编辑/删除用 `IconEdit`/`IconTrash`（按 role/name 可达）、删除 confirm、新建按 inbox 落点。
- `InputBar`：`HAS_KNOWLEDGE_BASE` 时技能为空仍可点开；开关 `onChange` 透出；关时下拉仍可开。
- `useSessions.setKbEnabled`：写后 reload 不丢。
- agent：`kbEnabled=false` 不注入 KB 工具；`true`+已连接 注入；`executeTool` 两分支调到 mock 的 `searchVault`/`readNote`；`buildSystemPrompt` 含 KB 段。

## 不做（显式排除 / 留下一步）

- chat 写笔记工具（`create_note`/`update_note`/`delete_note` + 确认门）—— 基线 spec §6.1/§7.1 的写半边，本次只做读。
- `ObsidianVaultView` 的目录树/标签聚合 tab（基线 §11 v1.5）。
- rename/move 反链重写（基线 §7.4 / §11）。
- `.sc-search` 迁移到 `SearchBox`（视觉不同，本次不动）。
