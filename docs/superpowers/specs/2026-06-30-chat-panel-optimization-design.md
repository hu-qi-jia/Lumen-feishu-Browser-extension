# Chat 页优化设计（2026-06-30）

## 决策摘要

| 项 | 决定 |
|---|---|
| 任务 2 根因 | 会话 `activeId` 跟随「当前激活标签页的资源 token」，回答期间/结束时资源一变就静默跳走。单标签页单文档不切 tab 不会跳。 |
| 默认模式 | `follow`（跟随标签页）+ 切换弹窗 |
| 弹窗触发 | follow 模式 + 当前会话已有消息 + 活动标签页资源 ≠ 会话绑定资源 + 非流式中 |
| 弹窗「否」语义 | ② 会话改绑到新文档、保留聊天历史 |
| 图标 | 全程内联 SVG，不用 emoji/字符图标 |

## 任务 1：文档默认页精简

文件：`src/sidepanel/components/MessageList.tsx` 的 `GUIDE.doc`

- `title: ''`、`sub: ''`
- `examples: ['总结要点', '加一个代码块示例', '在文末加引用说明']`
- `Welcome`：`title` 为空时不渲染标题（`sub` 已条件渲染）。

## 任务 2 + 3：工作文档下拉框 + 固定/跟随模式 + 切换弹窗

### 状态（App.tsx，独立持久化键 `docBinding_v1`）

- `docMode: 'follow' | 'pin'`（默认 `follow`）
- `pinned: { token, title, kind } | null`

### 资源来源

- `liveResource` = 现有 `rawResource`（去抖后的活动标签页资源）
- `effectiveResource` = `docMode === 'pin' ? pinned?.token : liveResource`
- 传给 `useSessions(effectiveResource, streaming)` 取代原 `activeResource`

### follow 模式的切换拦截（核心修复）

- `sessionResource` = `sessions.activeSession?.appToken`
- follow 模式下，`liveResource` 变化且 ≠ `sessionResource` 且当前会话有消息且非流式：
  - 不立即把 `liveResource` 传下去，保持 `effectiveResource = sessionResource`，置 `pendingSwitch = { from, to, toTitle }`
- `pendingSwitch` 期间渲染 `SwitchDocDialog`：
  - 「是」→ 清 `pendingSwitch`；为 `liveResource` 新建会话（`createSession` 会绑定该 token 并切换）
  - 「否」→ `rebindSession(activeId, liveResource, title)`：更新 `session.appToken` + `byAppToken` 映射，保留消息；清 `pendingSwitch`
  - 自动消失：`liveResource` 回到 `sessionResource` → 清 `pendingSwitch`
- 空会话（无消息）：直接跟随，不弹窗。

### pin 模式

- `effectiveResource = pinned.token`，忽略 `liveResource`。
- pin 的文档没有打开的标签页：Agent 走 API 仍可读写；BaseContextBadge 读不到结构时静默兜底。

### 下拉框（ChatPanel topbar 左侧）

- 触发器：当前工作文档标题 + 模式标识 + chevron。
- 打开时 `chrome.tabs.query` 枚举当前窗口飞书标签页 → `parseFeishuContext(url)` 取 token/kind，`tab.title` 作显示。
- 菜单项：每个飞书标签页（选中 = pin 该文档）；底部「跟随标签页」（切 follow）。
- 复用 InputBar skills-menu 的外部点击关闭模式。

### 弹窗组件

- 独立文件 `SwitchDocDialog.tsx`，复用 `ConfirmDialog.css` overlay + `useEscapeToClose`。
- props：`{ fromTitle, toTitle, onNew, onStay, onCancel }`。

### useSessions 新增方法

- `rebindSession(sessionId, newAppToken, title)`：更新 `session.appToken`、`byAppToken`（删旧映射、设新映射），若 `title` 提供且未解析过则更新标题。

## 任务 4：调用工具组件统一

文件：`MessageList.tsx` + `MessageList.css`

- 把 `ToolCallIndicator`（药丸）与 `ToolResult`（卡片）统一为同一种「工具步骤」卡片：高度 ~30px、统一字体、细边 surface 底。
- 状态区分：`calling` = 转圈 + 「调用中」+ 工具名；`done` = 对勾/叉 + 工具名 + 可展开结果。
- 去冗余：tc-start 指示消息若其后已跟有 tool 结果消息 → 不再单独渲染（完成态只显示结果卡）。
- 飞书风格：克制配色、`--color-surface`/`--color-border`、`--color-primary`/`--color-success`/`--color-error`。

## 不改动

- base/sheet/none 的 Welcome 内容。
- Agent 消息流（`runAgent` 回调签名不变）。
- 会话持久化 schema（`docBinding_v1` 独立键，不动 `settings_v2`）。

## 自检

`npm run typecheck` → `npm test`（含 MessageList/ChatPanel/useSessions 相关）→ `npm run build`。
