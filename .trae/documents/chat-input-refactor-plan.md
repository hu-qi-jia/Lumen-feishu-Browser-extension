# 聊天输入框重构计划（更新版）

## 摘要

用户要求将项目中的聊天输入框改为 ChatGPT 风格并抽离为可复用组件，同时保留现有功能并把文件/图片上传能力反映到输入框中。经前期实施，核心重构已基本完成：输入框已抽离为 `InputBar` 组件、样式已改为圆角卡片、附件上传与拖拽已接入、消息类型与 Agent 历史转换已支持附件。本计划聚焦剩余收尾工作：修复因附件支持而失败的单元测试，并将左下角 `Tools` 按钮从占位状态接入现有技能建议能力。

## 当前状态分析

- **已完成**
  - `src/shared/types.ts`：新增 `Attachment` 类型，`ChatMessage` 扩展 `attachments?: Attachment[]`。
  - `src/shared/attachments.ts`（新建）：`fileToAttachment` 解析图片/文本文件、`attachmentsToContentParts` 转换 OpenAI content parts、压缩与大小限制逻辑。
  - `src/shared/ai/agent.ts`：`buildApiHistory` 将带附件的用户消息转为 `ChatCompletionContentPart[]`。
  - `src/sidepanel/components/InputBar.tsx`：已抽离为独立组件，实现圆角卡片、`+` 附件按钮、`Tools` 按钮、语音按钮、圆形发送按钮、拖拽上传、附件 chip、错误提示。
  - `src/sidepanel/components/InputBar.css`：ChatGPT 风格样式。
  - `src/sidepanel/components/ChatPanel.tsx`：`handleSend` 接收附件并构造 `ChatMessage`。
  - `src/sidepanel/components/MessageList.tsx` + `.css`：用户气泡中渲染附件。

- **待完成**
  - `src/shared/ai/agent.test.ts` 中 `buildApiHistory > passes through a plain user/assistant conversation unchanged` 测试失败：当前实现将纯文本用户消息也转为 `[{ type: 'text', text: ... }]` 数组，而测试期望保持字符串 `content`。
  - `Tools` 按钮当前为 `disabled` 占位，需按用户选择接入现有 `SkillSuggest` 技能建议菜单。

- **不在本次范围**
  - 其他面板（AI 建站、数据报告、数据可视化、文档审计、文档总结、幻灯片、智能填充）中的 `<textarea>` 属于场景配置输入，不属于聊天输入框，保持原样。

## 关键设计决策

| 决策点 | 方案 |
|---|---|
| `Tools` 按钮 | 点击后展开技能建议浮层/下拉菜单，内容与现有 `SkillSuggest` 一致；选中后将技能文本通过 `InputBarHandle.insert()` 填入输入框。无数据时按钮可保持禁用并提示「暂无可用技能」。 |
| 纯文本用户消息的 API 历史 | 为保持与旧测试及不支持多模态模型的最大兼容性，`buildApiHistory` 对无附件的用户消息继续使用字符串 `content`；仅当存在附件时才使用 `ChatCompletionContentPart[]`。 |
| 附件内容转换 | 已复用 `attachmentsToContentParts`；图片作为 `image_url`，文本文件作为带文件名的 `text` part。 |
| vision fallback | 当前实现中图片直接作为 `image_url` 发送；若后续遇到不支持 vision 的模型，由外层调用方处理。本次不新增 fallback 逻辑，避免扩大范围。 |

## 拟修改内容

### 1. `src/shared/ai/agent.ts`

#### 修改 `buildApiHistory` 的无附件 user 消息处理

当前逻辑对所有 user 消息都构造 content parts 数组：

```ts
if (m.role === 'user') {
  const parts: ChatCompletionContentPart[] = []
  if (m.content?.trim()) parts.push({ type: 'text', text: m.content })
  for (const a of m.attachments ?? []) { ... }
  out.push({ role: 'user', content: parts.length ? parts : '' })
}
```

改为：仅当存在附件时才使用数组；否则保持原有字符串行为：

```ts
if (m.role === 'user') {
  const attachments = m.attachments ?? []
  if (attachments.length === 0) {
    out.push({ role: 'user', content: m.content ?? '' })
  } else {
    const parts: ChatCompletionContentPart[] = []
    if (m.content?.trim()) parts.push({ type: 'text', text: m.content })
    for (const a of attachments) { ... }
    out.push({ role: 'user', content: parts.length ? parts : '' })
  }
}
```

这样可让旧测试通过，同时不影响带附件的多模态消息。

### 2. `src/sidepanel/components/InputBar.tsx`

#### Props 扩展

新增 `resourceKind` 与 `onPickSkill`（或直接复用 `onInsert`）：

```ts
interface Props {
  onSend: (text: string, attachments: Attachment[]) => void
  onClear: () => void
  disabled: boolean
  voiceEnabled?: boolean
  selection?: string
  /** 当前资源类型，用于加载对应技能建议。 */
  resourceKind?: string
}
```

#### 内部新增状态

- `skills: Skill[]`：当前资源类型的技能列表。
- `skillsOpen: boolean`：Tools 菜单是否展开。
- `skillsLoading: boolean`。
- `skillsError: string`。

#### 新增效果

`useEffect` 监听 `resourceKind` 变化，调用 `preloadSkills(resourceKind || 'general')` 加载技能；无数据时 Tools 按钮保持禁用并提示「暂无可用技能」。

#### Tools 按钮交互

- 点击 Tools 按钮切换 `skillsOpen`。
- 展开一个小浮层/下拉菜单，列出最多 4-6 条技能：`s.intent` 作为标题，`s.lesson` 作为副标题。
- 点击某条技能后：调用 `insert(...)` 将其文本填入输入框，关闭菜单，聚焦输入框。
- 点击浮层外部或按 Esc 关闭菜单。

#### 渲染结构（Tools 区域）

```tsx
<div className="toolbar-left">
  {/* 附件按钮保持现有 */}
  <div className="tools-menu-wrap">
    <button
      className="btn-tools"
      onClick={() => setSkillsOpen((v) => !v)}
      disabled={disabled || skills.length === 0}
      title={skills.length ? '技能建议' : '暂无可用技能'}
      type="button"
      tabIndex={-1}
    >
      <svg>...</svg>
      <span>Tools</span>
    </button>
    {skillsOpen && (
      <div className="tools-menu">
        {skills.map((s) => (
          <button
            key={s.skillId}
            className="tools-menu-item"
            onClick={() => { insert(s.lesson || s.intent); setSkillsOpen(false) }}
            type="button"
          >
            <span className="tools-menu-title">{s.level === 'playbook' ? '🧩 ' : ''}{s.intent}</span>
            {s.lesson && s.lesson !== s.intent && (
              <span className="tools-menu-desc">{s.lesson}</span>
            )}
          </button>
        ))}
      </div>
    )}
  </div>
</div>
```

### 3. `src/sidepanel/components/InputBar.css`

新增 Tools 菜单样式：

- `.tools-menu-wrap`：`position: relative`。
- `.tools-menu`：绝对定位在按钮上方或下方，白色背景、圆角 12px、细边框、阴影，最大宽度 280px，最大高度 240px 可滚动。
- `.tools-menu-item`：左对齐按钮，hover 背景色，标题与描述分行显示。
- 保持 `.btn-tools` 现有外观，仅去掉 `cursor: not-allowed` 和固定 `opacity: .65`（改为 `:disabled` 时生效）。

### 4. `src/sidepanel/components/ChatPanel.tsx`

更新 `InputBar` 调用，传入 `resourceKind`：

```tsx
<InputBar
  ref={inputRef}
  onSend={handleSend}
  disabled={disabled || streaming}
  onClear={() => setMessages([])}
  voiceEnabled={WEB_SPEECH_ALLOWED && settings.voiceInput !== false}
  selection={context.selectedText}
  resourceKind={context.feishu?.kind ?? 'general'}
/>
```

### 5. `src/shared/ai/agent.test.ts`

更新 `buildApiHistory` 的第二个测试用例，使其反映新行为：

```ts
it('passes through a plain user/assistant conversation unchanged', () => {
  const out = buildApiHistory([
    msg({ role: 'user', content: 'hi' }),
    msg({ role: 'assistant', content: 'hello' }),
  ])
  expect(out).toEqual([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ])
})
```

该断言在 `agent.ts` 修改后将直接通过。 Optionally 可新增一个测试用例覆盖带附件用户消息的 content parts 转换：

```ts
it('converts user messages with attachments to content parts', () => {
  const out = buildApiHistory([
    msg({
      role: 'user',
      content: 'explain',
      attachments: [{ id: '1', type: 'image', name: 'a.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,abc', size: 100 }],
    }),
  ])
  expect(out).toEqual([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'explain' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'auto' } },
      ],
    },
  ])
})
```

## 验证步骤

1. **类型检查**：`npm run typecheck`
2. **单元测试**：`npm run test`（重点关注 `agent.test.ts`）
3. **构建**：`npm run build`
4. **手动 UI 检查清单**：
   - [ ] 输入框为大圆角白色容器，placeholder 为 "Message..."
   - [ ] 左下角有 `+` 附件按钮和 `Tools` 按钮
   - [ ] 无可用技能时 Tools 按钮禁用；有技能时点击展开菜单
   - [ ] 选中技能后文本被填入输入框
   - [ ] 右下角有 clear、mic、圆形发送按钮
   - [ ] 未输入且无附件时发送按钮禁用
   - [ ] 选择 CSV/TSV/TXT 后显示文件名 chip，可删除
   - [ ] 选择图片后显示缩略图，可删除
   - [ ] 发送后消息列表正确显示附件
   - [ ] 纯文本用户消息的 `buildApiHistory` 输出保持字符串 content
   - [ ] 语音输入、清空会话、页面选中文本自动填充、字段 chip 插入保持可用
   - [ ] 会话切换/刷新后附件能从 storage 恢复

## 关键修改文件

- `src/shared/ai/agent.ts`
- `src/shared/ai/agent.test.ts`
- `src/sidepanel/components/InputBar.tsx`
- `src/sidepanel/components/InputBar.css`
- `src/sidepanel/components/ChatPanel.tsx`
