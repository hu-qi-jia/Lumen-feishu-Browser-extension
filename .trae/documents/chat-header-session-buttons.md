# 聊天页面顶部会话按钮与浮层动画重构

## Context

当前聊天页面顶部 header（`App.tsx:479-489`）仅有一个资源类型徽标，没有直接的"查看历史会话"和"新建会话"入口。用户必须先点 `ChatPanel` 内部的 session-bar（L292）打开浮层，再在浮层里点"＋ 新建会话"。操作链路长，且 `SessionDrawer` 复用的是全局 `.view-enter` 淡入动画（含 `translateY(6px)`），与"从左侧滑入"的直觉不符。

本次改动在 header 右上角增加两个图标按钮作为主入口，并把 `SessionDrawer` 的开关动画升级为从左向右的平滑滑入/滑出，同时保持其作为独立可复用组件的封装性。

## 修改文件清单（4 个现有文件，零新文件）

1. `src/sidepanel/App.tsx`
2. `src/sidepanel/App.css`
3. `src/sidepanel/components/SessionDrawer.tsx`
4. `src/sidepanel/components/SessionDrawer.css`

---

## 1. App.tsx — header 增加两个图标按钮

在 `<header className="app-header">`（L479-489）内，`badge-base` 之后追加两个按钮。header 是 `justify-content: flex-end`，DOM 顺序即视觉左→右：`占位 div → badge → 历史按钮 → 新建按钮`。

- **历史会话按钮**：`onClick={() => setDrawerOpen(true)}`，无 disabled。图标用 history 风格（时钟+逆时针箭头），16x16 SVG，`strokeWidth=2`，加 `aria-label="查看历史会话"`。
- **新建会话按钮**：`onClick={handleNewSession}`，`disabled={chatStreaming}`，`title` 随 busy 切换文案（"回复进行中，请稍候" / "新建会话"）。图标用 plus（双 line，与 `InputBar.tsx:287-288` 一致）。
- SVG 属性严格遵循项目约定：`width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"`。

新增 `handleNewSession`（用 `useCallback`，依赖 `chatStreaming` 与 `sessions.createSession`）：
```ts
const handleNewSession = useCallback(() => {
  if (chatStreaming) return
  sessions.createSession()
}, [chatStreaming, sessions.createSession])
```
- `createSession()`（`useSessions.ts:187-196`）已封装：生成 `crypto.randomUUID()` → 清空消息 → 切换 activeId → 持久化到 `chrome.storage.local`。无需 App.tsx 自行清空。
- busy 守卫与 `SessionDrawer` 内部（L35-36）一致，避免 streaming 中跨会话写入。

**z-index 说明**：`.drawer-overlay` 是 `z-index: 30`，header 是 `z-index: 5`，drawer 打开时遮罩覆盖 header，header 按钮不可点。所以"新建"按钮仅在 drawer 关闭时可达，不会与 drawer 内的新建按钮冲突。

---

## 2. App.css — 新增 `.header-icon-btn` 样式

紧邻 `.app-header` 块（L118 之后）新增可复用的 header 图标按钮基类（现有 header 无图标按钮基类，`.drawer-x`/`.drawer-row-btn` 都是 drawer 专属）：

- 尺寸：`width/height: 28px`、`padding: 0`、`border-radius: 8px`、`border: 1px solid transparent`、`background: transparent`、`color: var(--color-text-secondary)`。
- 过渡：`transition: background .15s ease, color .15s ease, border-color .15s ease`。
- `:hover:not(:disabled)` → `background: var(--color-surface-2); color: var(--color-text)`。
- `:active:not(:disabled)` → `background: var(--color-surface)`。
- `:disabled` → `opacity: .45; cursor: not-allowed`。
- `:focus-visible` → `outline: 2px solid var(--color-primary); outline-offset: 1px`。
- 全部用 CSS 变量，深色模式无需额外规则。

---

## 3. SessionDrawer.tsx — 滑入滑出动画（内部封装，Props 不变）

采用"组件内部 closing state + CSS transition"方案，App.tsx 的 `{drawerOpen && <SessionDrawer .../>}` 渲染逻辑完全不动。Props 仍为 `{ sessions, busy, onClose }`。

### 新增内部状态与逻辑
- `mounted`（初始 false）、`closing`（初始 false）、`timerRef`（setTimeout 句柄）。
- **挂载即滑入**：`useEffect` 中用 `requestAnimationFrame(() => setMounted(true))`。必须隔一帧，否则浏览器把"初始位移→目标位移"合并成一次绘制，transition 不触发。
- **滑出再卸载**：新增 `requestClose`：`if (closing) return; setClosing(true); timerRef.current = setTimeout(onClose, 220)`。组件内所有原本调 `onClose()` 的位置（遮罩 onClick、× 按钮、新建按钮、switchTo 后的 onPick）改为调 `requestClose()`。
- **卸载清理**：`useEffect` return 里 `clearTimeout(timerRef.current)`，避免卸载后仍调 `onClose` 触发 React 警告。
- **派生 className**：`const open = mounted && !closing`；遮罩加 `drawer-overlay--open`，抽屉加 `drawer--open`。
- **移除** `.drawer` 上的 `view-enter` 类（它的 `translateY(6px)` 会和 `translateX` 叠加错乱）。

### Props 不调整
动画状态是内部实现细节，不泄漏到 Props。`onClose` 语义不变（仍表示"请把我卸载"），只是调用时机被 `requestClose` 延迟了一个动画周期（220ms）。

---

## 4. SessionDrawer.css — transition 与 open 修饰类

- `.drawer` 基类加：`transform: translateX(-100%); transition: transform .22s cubic-bezier(.2,.7,.3,1); will-change: transform;`。
- 新增 `.drawer--open { transform: translateX(0); }`。
- `.drawer-overlay` 基类加：`opacity: 0; transition: opacity .22s ease;`。
- 新增 `.drawer-overlay--open { opacity: 1; }`。
- 末尾加无障碍：`@media (prefers-reduced-motion: reduce) { .drawer, .drawer-overlay { transition-duration: 0s; } }`。
- 220ms 与 setTimeout 时长一致，确保滑出动画跑完才 unmount。

---

## 5. 性能考虑

- `handleNewSession` 用 `useCallback` 且依赖 `sessions.createSession`（hook 内已 `useCallback` 稳定）+ `chatStreaming`，handler 引用稳定。
- header 两个按钮内联在 App.tsx，streaming 时会随父组件重渲染，但只是两个 16px 内联 SVG，渲染成本极低，不抽 `memo` 子组件（抽出去反而要传多个 props，得不偿失）。
- `SessionDrawer` 是条件渲染（非热列表），加 `memo` 无意义；新增 `mounted`/`closing` 是局部 state，不影响父组件重渲染。
- `requestClose` 用 `if (closing) return` 幂等化，连点遮罩不会叠 setTimeout。
- `will-change: transform` 仅加在 `.drawer`，drawer 卸载即释放，不会常驻造成层爆炸。

---

## 6. 需注意的坑

1. **rAF 必须有**：少了那一帧，enter transition 静默失效（元素直接出现在终点，无动画）。
2. **`view-enter` 必须从 `.drawer` 移除**：否则 keyframes 的 `translateY` 会和 transition 的 `translateX` 叠加，动画错乱。
3. **退出期间遮罩仍可点**：`requestClose` 幂等化处理。
4. **ChatPanel 已有 `onOpenSessions` 入口**（App.tsx:627），header 按钮是第二个入口，两者都调 `setDrawerOpen(true)`，无冲突 —— drawer 已开时再调 true 是 no-op。

---

## 验证方法

1. **类型检查**：`npm run typecheck` 0 错误。
2. **单元测试**：`npm test`，重点关注 `src/sidepanel/components/ScenarioPanel.test.tsx`、`src/sidepanel/sessions/useSessions.test.tsx` 通过。
3. **构建**：`npm run build` 成功生成 dist。
4. **手动验证**（在 Chrome 扩展开发者模式加载 dist）：
   - header 右上角可见两个图标按钮，悬停有背景色反馈。
   - 点历史按钮：drawer 从左平滑滑入，遮罩淡入。
   - 点遮罩 / × 按钮 / 选择某会话：drawer 平滑滑出后卸载。
   - 点新建按钮：当前聊天清空，会话标题变为"新会话"，可正常发送消息。
   - streaming 回复时：新建按钮 disabled，历史按钮仍可点。
   - 深色模式下按钮样式正确。
