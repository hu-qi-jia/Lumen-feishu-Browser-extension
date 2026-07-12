# 飞书文档AI助手 · Code Wiki

> 本文档是对 [feishu-doc-ai-assistant](https://github.com/scott987-cmd/feishu-doc-ai-assistant) 仓库全量源码的结构化解读，面向二次开发与代码维护。
> 所有文件引用均为可点击链接（`file:///`），便于在 IDE 中直接跳转。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [整体架构](#3-整体架构)
4. [目录结构](#4-目录结构)
5. [构建与运行](#5-构建与运行)
6. [配置系统](#6-配置系统)
7. [AI Agent 核心](#7-ai-agent-核心)
8. [飞书 API 层](#8-飞书-api-层)
9. [数据可视化与沙箱](#9-数据可视化与沙箱)
10. [功能模块详解](#10-功能模块详解)
11. [侧边栏 UI](#11-侧边栏-ui)
12. [安全设计](#12-安全设计)
13. [持久化与加密](#13-持久化与加密)
14. [测试体系](#14-测试体系)
15. [二次开发指南](#15-二次开发指南)

---

## 1. 项目概述

**飞书文档AI助手** 是一个 Chrome MV3 侧边栏扩展，用自然语言经 AI 直接操作**飞书多维表格(Base) / 电子表格(Sheet) / 文档(Docs)**——建表、填数、写公式、生成文档、按评论改稿、跨表查找、去重、审计，一句话搞定。还能把数据做成**网站 / 看板 / PPT / 报表**。

**核心特性：**

- **🤖 AI Agent**：~55 个工具覆盖多维表格/电子表格/文档，OpenAI 兼容接口（默认 DeepSeek），模型/Key/Base URL 运行时可配。
- **🧩 形态**：侧边栏 + 注入飞书页的内容脚本 + 后台 Service Worker + MV3 沙箱。**无后端**，运行时依赖仅 React + openai SDK。
- **🔒 安全优先**：始终以**用户本人身份**操作、绝不越权；所有权限边界**硬编码在代码里**（提示词不作安全边界）。
- **🌐 多形态部署**：个人 / Chrome 商店，全部构建时配置切换。

**许可证**：Elastic License 2.0（源代码可见，个人免费使用、可商用；禁止作为托管 SaaS 服务对外提供）。

---

## 2. 技术栈与依赖

| 类别 | 技术 |
|---|---|
| 语言 | TypeScript 5.5（strict 模式） |
| 前端框架 | React 18.3 |
| 构建工具 | Vite 5.3 + vite-plugin-web-extension 4.1 |
| 大模型 SDK | openai 4.52（OpenAI 兼容） |
| 图表 | ECharts 6.1（按需引入 bar/line/pie/scatter + 组件） |
| 测试 | Vitest 4.1 + @testing-library/react 16.3 + jsdom 29 |
| 视觉/E2E | Puppeteer 25.1（截图/UI 冒烟） + sharp 0.33（图标生成） |
| 扩展 API | @types/chrome 0.0.268 |
| 包管理 | npm（`"type": "module"`） |

依赖清单见 [package.json](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/package.json)。运行时依赖仅 4 个：`echarts` `openai` `react` `react-dom`，其余均为 devDependencies。

**npm scripts：**

| 命令 | 作用 |
|---|---|
| `npm run dev:ext` | 扩展热更新（加载到 Chrome，连真飞书） |
| `npm run dev:ui` | 纯 UI 预览（mock chrome，不连飞书，`http://localhost:5173`） |
| `npm run build` | 构建到 `dist/`（4 个入口 + manifest） |
| `npm run pack` | `build` + 打包成 `feishu-doc-ai-assistant.zip` |
| `npm run typecheck` | `tsc --noEmit`（必须 0 错） |
| `npm test` | `vitest run`（~460 用例） |
| `npm run package:ui` | 图形化打包向导（`http://localhost:8799`） |

---

## 3. 整体架构

### 3.1 四个运行入口（MV3 扩展）

```
┌─────────────────────────────────────────────────────────────────┐
│                      Chrome MV3 Extension                        │
│                                                                  │
│  ┌──────────────┐   ┌──────────────────┐   ┌─────────────────┐ │
│  │ Background   │   │ Content Script   │   │ Side Panel      │ │
│  │ Service      │◄─►│ (注入飞书页)      │◄─►│ (React 18)      │ │
│  │ Worker       │   │ - 上下文采集      │   │ - 对话/场景/剪藏 │ │
│  │ - 剪藏调度    │   │ - 浮层 launcher  │   │ - 设置/会话      │ │
│  │ - 看板/PPT    │   │ - viz-overlay    │   └────────┬────────┘ │
│  │   数据回拉    │   │   浮窗(iframe)    │            │          │
│  │ - 写回/任务    │   └────────┬─────────┘            │          │
│  └──────┬───────┘            │                      │          │
│         │                    │ postMessage            │          │
│         │            ┌───────▼──────────┐            │          │
│         │            │ Sandbox Page     │            │          │
│         │            │ (null origin)    │            │          │
│         │            │ - ECharts 渲染   │            │          │
│         │            │ - LLM 生成代码    │            │          │
│         │            │ - connect-src    │            │          │
│         │            │   'none'         │            │          │
│         │            └──────────────────┘            │          │
│         │                                            │          │
│         └────────────── shared/ (业务逻辑) ◄─────────┘          │
│                  ai/ feishu/ dataviz/ templates/ ...             │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼ (用户身份)
              ┌───────────────────────┐
              │  飞书 OpenAPI          │
              │  open.feishu.cn       │
              └───────────────────────┘
                          │
                          ▼ (OpenAI 兼容)
              ┌───────────────────────┐
              │  LLM (DeepSeek 默认)   │
              └───────────────────────┘
```

### 3.2 入口职责

| 入口 | 文件 | 职责 |
|---|---|---|
| **Background SW** | [src/background/index.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/background/index.ts) | 工具栏图标开侧边栏；剪藏（右键菜单/快捷键/截图）；**保存的看板/PPT 数据回拉并渲染**（SW 持有飞书 host 访问权）；写回（`batchUpdateRecords`）；行级任务创建；Wiki 节点解析 |
| **Content Script** | [src/content/index.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/content/index.ts) | 采集页面上下文（URL/标题/选中文字/飞书资源类型）；SPA 导航监听（MutationObserver）；点击字段→填入聊天；分发 `DATAVIZ_RENDER` 到浮层 |
| **Side Panel** | [src/sidepanel/App.tsx](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/App.tsx) | React 主应用：设置/上下文/会话/主题/标签页管理，渲染 ChatPanel / ScenarioPanel / ClipPanel / Settings |
| **Sandbox** | [src/sandbox/main.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sandbox/main.ts) | MV3 沙箱页：null origin + `connect-src:'none'`，执行 LLM 生成代码或解释声明式 `VizSpec`，渲染 ECharts 图表/看板/PPT/网站 |

### 3.3 消息流（chrome.runtime.onMessage）

扩展内部通过消息通信，主要消息类型：

| 消息类型 | 方向 | 作用 |
|---|---|---|
| `GET_PAGE_CONTEXT` | SidePanel → Content | 拉取当前页上下文 |
| `PAGE_CONTEXT_UPDATE` | Content → SidePanel | 推送上下文变化（URL/选中文字） |
| `CLIP_CAPTURE` / `CLIP_ERROR` / `CLIP_REQUEST` | Background ↔ SidePanel | 剪藏载荷传递 |
| `DATAVIZ_OPEN_SAVED` / `DATAVIZ_OPEN_DECK` | Content → Background | 请求打开已保存的看板/PPT（回拉数据） |
| `DATAVIZ_RENDER` | Background → Content → Sandbox | 渲染指令（code/spec/data） |
| `DATAVIZ_WRITE_BACK` / `DATAVIZ_ROW_ACTION` | Content → Background | 浮层提交编辑/行级任务 |
| `DATAVIZ_WRITE_RESULT` | Background → Content | 写回结果 |
| `RESOLVE_PAGE_RESOURCE` | Content → Background | Wiki 节点 → 真实资源解析 |

---

## 4. 目录结构

```
feishu-doc-ai-assistant/
├── src/
│   ├── background/index.ts          # Service Worker 入口
│   ├── content/
│   │   ├── index.ts                 # 内容脚本入口（上下文采集 + 消息分发）
│   │   ├── feishu-automation.ts     # 自动化飞书 UI（创建仪表盘）
│   │   ├── viz-overlay.ts           # 数据可视化浮层（拖拽/缩放/写回）
│   │   └── viz-launcher.ts          # 浮标 launcher（已保存看板/PPT 的入口药丸）
│   ├── sandbox/
│   │   ├── index.html               # 沙箱页 HTML
│   │   └── main.ts                  # 沙箱运行时（ECharts + ui.* 助手）
│   ├── sidepanel/
│   │   ├── App.tsx                  # 主应用
│   │   ├── main.tsx                 # React 挂载入口
│   │   ├── App.css                  # 全局样式
│   │   ├── components/              # 23 个 UI 组件（见 §11）
│   │   ├── sessions/                # 会话管理（logic/store/useSessions）
│   │   ├── wikiResolve.ts           # Wiki 节点 → 资源 的合并
│   │   └── tabReload.ts             # 标签页刷新
│   ├── shared/                      # 跨入口共享业务逻辑（见 §7-10）
│   │   ├── ai/                      # AI Agent + 工具 + 功能
│   │   ├── feishu/                  # 飞书 API 封装
│   │   ├── dataviz/                 # 数据可视化
│   │   ├── templates/               # 场景模板
│   │   ├── smartfill/               # 智能填充
│   │   ├── clip/                    # 网页剪藏
│   │   ├── report/                  # 数据报告
│   │   ├── config.ts                # 构建时配置
│   │   ├── types.ts                 # 共享类型
│   │   ├── crypto.ts                # AES-256-GCM 加密
│   │   ├── storage.ts               # chrome.storage Promise 化
│   │   ├── providers.ts             # LLM 供应商预设
│   │   ├── theme.ts                 # 主题/强调色
│   │   ├── network.ts               # CIDR 网络限制
│   │   ├── configBackup.ts          # 本地配置备份/恢复
│   │   └── url.ts                   # URL 工具
│   ├── dev/                         # UI 开发 mock（chrome-mock + scenarios）
│   ├── demo/sampleData.ts           # 示例数据
│   ├── harness/                     # 端到端测试驱动（见 §14）
│   └── vite-env.d.ts
├── docs/                            # 文档
├── scripts/                         # 构建/打包/截图/图标脚本
├── templates/                       # 内置场景模板 JSON
├── public/icons/                    # 扩展图标（sharp 生成）
├── manifest.json                    # MV3 清单
├── vite.config.ts                   # 扩展构建配置（CSP/manifest 模板化）
├── vite.ui.config.ts                # UI 开发配置
├── tsconfig.json
└── .env.example                     # 全部构建时配置项说明
```

---

## 5. 构建与运行

### 5.1 构建产物（dist/）

`npm run build` 通过 [vite.config.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/vite.config.ts) 执行 4 步构建：

| 步骤 | 产物 | 说明 |
|---|---|---|
| 1 | `dist/src/sidepanel/index.js` + `index.html` | React 侧边栏（~567 KB） |
| 2 | `dist/src/sandbox/index.js` + `index.html` | 沙箱运行时 + ECharts（~709 KB） |
| 3 | `dist/src/background/index.js` | Service Worker（~28 KB） |
| 4 | `dist/src/content/index.js` | 内容脚本（~21 KB） |
| 最后 | `dist/manifest.json` | 由 `transformManifest` 模板化生成 |

构建会自动：
- 从飞书基础域名（默认 `feishu.cn`）派生 `host_permissions` / `content_scripts.matches` / CSP `connect-src` / `web_accessible_resources.matches`。
- 合并 **extension_pages CSP** 与 **sandbox CSP**（`connect-src 'none'`，`VITE_NO_REMOTE_CODE=1` 时去掉 `unsafe-eval`）。
- 自增 `.build-no` 构建计数器，写入 manifest 第 4 段版本号（如 `1.0.4.2`）。
- `VITE_WEBSTORE=1` 时剥离 `key` 字段（商店分配 ID）并应用商标安全的名称/描述。

### 5.2 加载使用

```bash
npm install
cp .env.example .env.local      # 按需填写，可全空先跑通
npm run build                   # 产物 dist/
# chrome://extensions → 开发者模式 → 「加载已解压的扩展程序」→ 选 dist/
```

---

## 6. 配置系统

### 6.1 构建时配置（[src/shared/config.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/config.ts)）

`BUILD_CONFIG` 从 `import.meta.env.VITE_*` 读取，**Vite 在编译期字符串替换**（不存运行时）。商店构建（`VITE_WEBSTORE=1`）强制清空所有凭据字段，防止 `.env.local` 泄漏到公开包。

**关键字段：**

| 字段 | 作用 |
|---|---|
| `feishuAppId` / `feishuAppSecret` / `appSecretEnc` | 飞书应用凭据（明文 / 密码加密） |
| `llmRedact` / `llmMaxPayloadChars` | LLM 数据脱敏 / 载荷上限 |
| `openaiAllowedHosts` | LLM host 白名单（设了则 CSP 锁死 → 纯内网） |
| `allowedCidrs` | 设备内网 CIDR 门 |
| `maxToolCalls` | 单轮工具调用上限（默认 30，钳制 1–100） |
| `clipEnabled` | 网页剪藏开关（默认开） |
| `webstore` / `noRemoteCode` | 商店打包 / 禁止远程代码 |

### 6.2 派生飞书端点

```ts
export const FEISHU_API_BASE     = `https://open.${baseDomain}/open-apis`
export const FEISHU_AUTHORIZE_URL = `https://accounts.${baseDomain}/open-apis/authen/v1/authorize`
export const FEISHU_HOST_PATTERN = `*.${baseDomain}`
export function isFeishuOutboundAllowed(url: string): boolean  // 出站白名单守卫
```

### 6.3 运行时配置（AppSettings）

定义在 [src/shared/types.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/types.ts)，存于 `chrome.storage.local` 的 `settings_v2` 键（敏感字段加密）：

```ts
interface AppSettings {
  openaiBaseUrl, openaiApiKey, openaiModel   // LLM
  feishuAccessToken, feishuOwnerOpenId       // 用户 token / open_id
  templateRegistryUrl                         // 模板库
  learnFromHistory?, voiceInput?, autoConfirm? // 越用越聪明 / 语音 / Auto模式
}
```

---

## 7. AI Agent 核心

核心文件：[src/shared/ai/agent.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/agent.ts)

### 7.1 Agentic Loop（`runAgent`）

```ts
export async function runAgent(
  history: ChatMessage[],
  settings: AppSettings,
  context: PageContext,
  callbacks: AgentCallbacks,
  baseCtx?: BaseCtx,
  signal?: AbortSignal
): Promise<void>
```

**循环流程：**

1. **LLM 配置解析**：`resolveLlmConfig` → `assertSafeBaseUrl`（出站守卫，先验证再发任何对话/表内容）。
2. **System Prompt 构建**：`buildSystemPrompt` 注入页面上下文、Base 结构、选中文字（用 `<user_selected_text>` 标签防注入）。
3. **越用越聪明**：`relevantRecipes` 取本地最相关经验，注入 prompt。
4. **工具按上下文裁剪**：`toolsForContext(kind)` 只暴露当前资源类型的工具（Base/Sheet/Doc + 核心），减少误选。
5. **流式调用**：`client.chat.completions.create({ stream: true, temperature: 0.2 })`——低温保证工具选择/参数确定。
6. **工具执行**：见 §7.3。
7. **安全检查点**：`totalToolCalls >= MAX_TOOL_CALLS_PER_TURN`（默认 30）时停止并提示用户回复"继续"。
8. **经验记录**：轮次成功后 `recordRecipe` 用 LLM 提炼一句经验（仅工具名，不含数据），存本地供下次参考。

### 7.2 工具系统（[src/shared/ai/tools.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/tools.ts)）

`FEISHU_TOOLS: ChatCompletionTool[]` 定义全部 ~55 个工具。按资源类型分组：

**核心工具（CORE_TOOLS，所有页面可用）：**
- `render_data_app` — 把当前表做成看板/PPT/报表/网站浮窗
- `feishu_api_call` — 通用飞书 OpenAPI 调用（白名单限制）
- `ask_user` — 弹选项卡让用户拍板
- `create_bitable_app` / `create_spreadsheet` / `create_document` / `create_doc_from_markdown` — 创建资源

**Base 工具：** `get_app_info` `list_tables` `create_table` `delete_table` `list_fields` `create_field` `update_field` `delete_field` `list_records` `create_record` `batch_create_records` `update_record` `batch_update_records` `batch_get_records` `delete_record` `batch_delete_records` `search_records` `list_views` `create_view` `list_dashboards` `copy_dashboard` `base_to_doc_report` `base_table_to_sheet` `summarize_table` `dedupe_records` `cross_table_lookup` `update_where` `audit_table`

**Sheet 工具（SHEET_TOOLS）：** `create_spreadsheet` `get_spreadsheet` `list_sheets` `add_sheet` `delete_sheet` `read_range` `write_range` `append_rows` `fill_column` `find_replace` `set_number_format` `insert_dimension` `delete_dimension`

**Doc 工具（DOC_TOOLS）：** `create_document` `create_doc_from_markdown` `get_document_content` `list_blocks` `add_document_content` `insert_table` `insert_sheet` `delete_document_blocks`

**特殊工具：** `audit_document`（文档体检，只读） `summarize_document`（文档总结，只读） `generate_data_report`（数据分析报告→新文档）

**优化策略：**
- `READ_ONLY_TOOLS`（11 个读工具）：当一轮全是读操作时**并发执行**（而非串行），缩短"读 A、B、C"的等待。
- `CREATE_ONCE_TOOLS`：创建类工具按参数签名去重，防止模型重试导致重复创建（如两张同名表）。

### 7.3 工具执行（`executeTool`）

```ts
export async function executeTool(
  name: string, args: Record<string, unknown>,
  token: string, context: PageContext, settings?: AppSettings
): Promise<unknown>
```

**调度顺序：**
1. `isFileLevelDelete` 二次拦截（文件级删除）
2. `feishu_api_call` → `assertApiCallAllowed` + `feishuReq`
3. `SHEET_TOOLS` → `executeSheetTool`
4. `DOC_TOOLS` → `executeDocTool`
5. `render_data_app` → `generateViz`（返回 `__dataviz` 标记，侧边栏拦截渲染）
6. `generate_data_report` → `buildDataReport`
7. `audit_document` / `summarize_document` → `runDocAudit` / `runDocSummary`
8. 其余 Base 工具按 `switch(name)` 分发到 `API.*` / `Compose.*`

**身份与错误处理（`runToolWithFallback`）：**
- 始终用 `resolveToken` 返回的 **user_access_token** 执行。
- `isPermissionError` → 明确告知"你（当前账号）没有权限"，**不越权、不重试**。
- `isTokenExpiredError` → `forceRefreshUserToken` 刷新后**重试一次**；refresh_token 失效（~30 天）提示重新授权。

### 7.4 安全约束（硬编码）

| 约束 | 函数 | 说明 |
|---|---|---|
| **文件级删除拦截** | `isFileLevelDelete` | `delete_table` `delete_sheet` + 任何 `DELETE` API 一律拒绝，提示用户在飞书手动删 |
| **破坏性 API 检测** | `isDestructiveApiCall` | POST 路径含 `batch_delete`/`trash`/`move_to_trash` 或 body 含 `deleteDimension` 等 → 走确认门 |
| **通用 API 白名单** | `assertApiCallAllowed` | `API_ALLOWED_PREFIXES`（bitable/sheets/docx/doc/wiki/board/drive 文件）默认允许；`API_BLOCKED`（transfer_owner/permissions/im/contact/admin）硬阻断 |
| **确认门** | `DESTRUCTIVE_TOOLS` ∪ `WRITE_TOOLS` | 删除/批量写操作弹按钮确认卡（Auto 模式跳过内容删除确认，但永不跳过文件级拦截） |
| **结果截断** | `truncateToolResult` | 单条工具结果 ≤ 8000 字符，防批量 PII 外泄给 LLM |
| **历史净化** | `buildApiHistory` | 重建合法 OpenAI 消息序列（丢弃孤儿 tool 消息/占位 tool_calls），兼容严格 provider |
| **链接改写** | `rewriteFeishuOrigins` | 输出边界统一改写飞书资源链接到租户 origin，防模型手写裸域名导致打不开 |
| **Token 净化** | `sanitizeToken` | 校验 token 只含 `A-Za-z0-9_-` |

---

## 8. 飞书 API 层

### 8.1 HTTP 守卫（[src/shared/feishu/http.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/http.ts)）

| 函数 | 作用 |
|---|---|
| `robustFetch(url, init, method)` | 带超时（30s）的 fetch；**仅 GET 重试 3 次**，写操作（POST/PUT/PATCH/DELETE）永不重试（防重复创建） |
| `feishuFetch(method, path, token, body, params)` | 飞书请求；`isFeishuOutboundAllowed` 出站白名单守卫 |
| `feishuReq<T>(...)` | 在 `feishuFetch` 上解析 `{code,msg,data}` 信封，`code!==0` 抛错并识别 403 权限错误附 hint |

### 8.2 鉴权（[src/shared/feishu/auth.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/auth.ts)）

**安全模型核心：助手始终以用户身份操作，绝不回退 tenant。**

| 函数 | 作用 |
|---|---|
| `resolveToken(settings)` | 返回 `user_access_token`；无 token 抛错引导授权。**永不返回 tenant token**（会越权） |
| `getValidUserToken(settings)` | 优先 OAuth bundle，过期前 5 分钟自动 `refreshUserAccessToken`；回退手动粘贴 token |
| `saveUserToken` / `clearUserToken` / `loadUserToken` | OAuth bundle 持久化（加密，独立 key `_feishu_utoken_v1`） |
| `forceRefreshUserToken()` | 强制刷新（401 兜底） |
| `isPermissionError` / `isTokenExpiredError` | 按结构化错误码（`PERMISSION_CODES` / `TOKEN_EXPIRED_CODES`）+ 精确短语识别 |
| `getTenantAccessToken` / `invalidateToken` | tenant token（仅用于资源归属转交，不作为操作身份） |
| `isFeishuConfigured` | 是否已配置凭据 |

### 8.3 OAuth（[src/shared/feishu/oauth.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/oauth.ts)）

| 函数 | 作用 |
|---|---|
| `authorizeFeishuUser()` | 启动 OAuth（`chrome.identity.launchWebAuthFlow`），强制 `offline_access` scope |
| `refreshUserAccessToken(refreshToken)` | 刷新 token（直连） |
| `fetchUserOpenId(userToken)` | 从 `authen/v1/user_info` 取 open_id（用于资源归属转交） |
| `oauthRedirectUrl()` | 重定向 URL（固定扩展 ID） |

### 8.4 Base API（[src/shared/feishu/api.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/api.ts)）

26 个函数封装飞书多维表格 OpenAPI：`getApp` `createApp` `listTables` `createTable` `deleteTable` `listFields` `createField` `updateField` `deleteField` `listRecords` `createRecord` `batchCreateRecords` `updateRecord` `deleteRecord` `batchUpdateRecords` `batchGetRecords` `batchDeleteRecords` `parseFilterFormula` `searchRecords` `getWikiNode` `listViews` `createView` `transferBaseOwner` `addBaseMember` `listDashboards` `copyDashboard`。

### 8.5 电子表格（[src/shared/feishu/sheets.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/sheets.ts)）

13 个函数：`createSpreadsheet` `getSpreadsheet` `listSheets` `addSheet` `deleteSheet` `readRange` `writeRange` `appendRows` `fillColumn` `findReplace` `setNumberFormat` `insertDimension` `deleteDimension`。

### 8.6 文档（[src/shared/feishu/docx.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/docx.ts)）

17 个函数：`buildBlock` `markdownToBlocks` `createDocument` `createDocFromMarkdown` `getDocumentContent` `getDocumentMeta` `listBlocks` `insertBlocks` `buildTableDescendants` `insertTable` `hasMarkdownTable` `markdownToSegments` `insertSegments` `insertContentBlocks` `splitSheetToken` `insertSheet` `deleteBlocks`。`insertContentBlocks` 会把文本块里夹带的 Markdown 表格自动展开为真实飞书表格。

### 8.7 复合操作（[src/shared/feishu/compose.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/compose.ts)）

11 个函数，封装飞书无原生单 API 的能力：

| 函数 | 作用 |
|---|---|
| `applyInBatches` | 分批写（每批 ≤500），**部分失败不上抛**，返回 `{done, failed, remaining}` |
| `cellToString` / `cellToNumber` | 单元格值扁平化 |
| `fetchAllRecords` / `searchAllRecords` | 分页拉全量（带 cap） |
| `tableToSheet` | Base 表 → 电子表格 |
| `summarizeTable` | 表汇总（group_by + metrics）→ 新电子表格 |
| `dedupeRecords` | 去重（支持 `dry_run` 预览） |
| `crossTableLookup` | 跨表查找回填（VLOOKUP，支持 `on_multiple: first/join/skip`，可自动建列） |
| `updateWhere` | 按条件批量更新 |
| `auditTable` | 数据质量审计（必填空缺/重复/数值异常 3σ） |

### 8.8 其他飞书模块

| 文件 | 作用 |
|---|---|
| [appSecret.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/appSecret.ts) | 密码加密的 App Secret 解锁（PBKDF2→AES-GCM） |
| [userAppCreds.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/userAppCreds.ts) | 商店版用户自填 App ID/Secret |
| [task.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/task.ts) | 创建任务（看板行级快捷操作） |
| [undo.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/undo.ts) | 删除撤销（`captureRecords`/`captureSheetRows`/`saveDeleteUndo`，10 分钟内可恢复） |
| [export.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/export.ts) | 导出 |
| [im.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/im.ts) | IM（受限） |
| [tenant.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/tenant.ts) | 租户 origin 记忆（`rememberTenantOrigin`，建文档链接用） |
| [pageUrl.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/pageUrl.ts) | `parseFeishuContext` 解析 URL → 资源类型（base/sheet/doc/wiki） |
| [context.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/feishu/context.ts) | Base 结构 → prompt 文本（`ctxToPrompt`） |

---

## 9. 数据可视化与沙箱

### 9.1 沙箱运行时（[src/sandbox/main.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sandbox/main.ts)）

**隔离机制：** MV3 sandbox 页，null/opaque origin，无 `chrome.*`，CSP `connect-src 'none'`——LLM 生成代码即使拿到数据也发不出去。iframe `<iframe sandbox="allow-scripts allow-modals">`（**故意不给 `allow-same-origin`**）。

**两条渲染路径：**

1. **Legacy 代码路径**（`NO_EVAL=false`，自分发/商店全功能版）：`execViz(code, data, theme, datasets)` 用 `new Function(...)` 执行 LLM 生成的 render 函数体（自动解包 `function`/箭头包裹，统一参数名）。
2. **声明式 VizSpec 路径**（`NO_EVAL=true`，商店无远程代码版）：`runSpec(root, spec, data, theme)` 用内置解释器渲染 `VizSpec`，CSP 去掉 `unsafe-eval`，可诚实回答"无远程代码"。

**`ui.*` 助手对象**（可靠交互由我方代码负责，模型只提供纯数据/reducer）：

| 方法 | 作用 |
|---|---|
| `ui.table(el, rows, opts)` | 交互数据表（搜索/排序/分页/可编辑单元格/行级操作） |
| `ui.chart(el, option)` | ECharts 图表（自动 dispose 旧实例 + 强调色注入） |
| `ui.dashboard(el, spec)` | 响应式看板（筛选条 + KPI 卡 + 图表 + 表，模型只给纯 reducer） |
| `ui.tabs(el, items)` | 标签页 |
| `ui.slides(el, list, rows)` | 幻灯片演示（前后翻页/键盘/点击翻页/自动播放/PDF 导出） |

**写回机制：** 单表 Base 看板可声明列 `editable`，编辑暂存 `drafts` Map，点"提交"→ `DATAVIZ_WRITE_BACK` → background `batchUpdateRecords`。`coerceCell` 按字段类型（Number/Checkbox/DateTime）转换字符串单元格回 JSON 类型。

### 9.2 VizSpec 声明式规范（[src/shared/dataviz/spec.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/dataviz/spec.ts)）

```ts
type VizSpec = ChartSpec | RawChartSpec | TableSpec | DashboardSpec | SiteSpec | SlidesSpec
```

- `ChartSpec`：`chartType: bar/line/pie/scatter` + `SeriesSpec`（dimension + measure 聚合）
- `DashboardSpec`：filters + kpis + charts + table
- `SiteSpec`：title + sections (hero/section) + dashboard（AI 建站）
- `validateSpec(input, fields)` 结构化校验模型输出，`referencedFields` 提取引用字段

### 9.3 解释器（[src/shared/dataviz/interpret.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/dataviz/interpret.ts)）

`num` `evalFilter` `evalAggregate`（count/countDistinct/sum/avg/min/max + where）`formatValue` `groupSeries` `buildOption`（VizSpec → ECharts option）`actionTemplate`。

### 9.4 数据层（[src/shared/dataviz/data.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/dataviz/data.ts)）

`inferColType`（推断列类型）`docOf` `deriveVizSource`（从 PageContext 推导数据源）`fetchVizData`（取单表数据 + schema）`fetchDocDatasets`（取多表数据集，用于多表建站）。

### 9.5 持久化与匹配

| 文件 | 函数 | 作用 |
|---|---|---|
| [store.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/dataviz/store.ts) | `loadVizList` `replaceVizList` `saveViz` `deleteViz` | 已保存看板 CRUD（`dataviz_v1`） |
| [scope.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/dataviz/scope.ts) | `vizDocKey` `ctxDocKey` `ctxScopeKey` `vizMatchesCtx` `savedVizMatchesCtx` `deckScopeKey` | 看板与页面资源的匹配（决定浮标显示） |
| [send.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/dataviz/send.ts) | `sendVizToActiveTab` | 向当前标签页发渲染指令 |
| [types.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/dataviz/types.ts) | `SavedViz` 等类型 | |

### 9.6 AI 生成（[src/shared/ai/dataviz.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/dataviz.ts)）

| 函数 | 作用 |
|---|---|
| `generateViz(settings, input)` | 根据表结构 + 用户描述生成看板代码/VizSpec |
| `generateSite(settings, input)` | AI 建站 |
| `planSite(...)` | 先出方案（标题/章节/字段/问题）让用户确认 |
| `buildSiteCheatsheet()` | 沙箱设计系统速查表（喂给 LLM 让生成的站点统一好看） |
| `hasForbiddenCalls(code)` | 检测生成代码是否含禁止调用 |

---

## 10. 功能模块详解

### 10.1 LLM 调用

**[llm.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/llm.ts)**：`chatComplete`（一次性，plain fetch，SW 可用）`chatCompleteStream`（流式，支持取消）。

**[providers.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/providers.ts)**：`LLM_PROVIDERS`（DeepSeek/Qwen/GLM/Moonshot/OpenAI/自定义）`DEFAULT_PROVIDER`（DeepSeek）`assertSafeBaseUrl`（LLM 出站守卫：必须 https，host 白名单校验）`KNOWN_PROVIDER_HOSTS`。

### 10.2 越用越聪明

**[recipes.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/recipes.ts)**（本地经验）：`bigrams` `similarity`（二元组相似度）`relevantRecipes`（取最相关 k 条）`mergeRecipe` `formatRecipes`（注入 prompt）`loadRecipes` `recordRecipe`（成功后记录，LLM 提炼一句经验，仅工具名不含数据，最多 300 条）`clearRecipes` `recipeCount`。

### 10.3 文档功能

**[docaudit.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/docaudit.ts)**（文档体检）：`AuditIssue` `AuditResult` `DEFAULT_AUDIT_CHECK`（可编辑持久化）`loadAuditCheck` `saveAuditCheck` `normalizeAuditIssues` `auditDocument` `runDocAudit`（通读文档找逻辑断点/未定义术语/前后矛盾/遗留 TODO/过期数据/空小节）。

**[docsummary.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/docsummary.ts)**（文档总结）：`DEFAULT_SUMMARY_PROMPT`（可编辑持久化）`loadSummaryPrompt` `saveSummaryPrompt` `summarizeDoc` `runDocSummary`。

### 10.4 PPT 幻灯片

**[slides.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/slides.ts)**：`Slide`（8 种 layout: title/section/bullets/two-col/quote/stats/chart/embed）`sanitizeSlides` `generateSlides` `adjustSlide` `runDocToSlides`（文档转 PPT）`generateSlidesFromData` `savedDashboardEmbeds`（已保存看板作为 embed slide）`runTableToSlides`（表转 PPT）。

**[slidesStore.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/slidesStore.ts)**：`SavedDeck` `loadDecks` `replaceDecks` `saveDeck` `deleteDeck`（`slides_decks_v1`）。

### 10.5 智能填充（[src/shared/smartfill/](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/smartfill/)）

| 文件 | 函数 | 作用 |
|---|---|---|
| [smartfill.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/smartfill.ts) | `buildPrompt` `inferFills` | AI 参考同行其他列推断空缺值 |
| [coerce.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/smartfill/coerce.ts) | `isFillable` `coerceValue` | 类型转换（单选/多选只落已有选项，数字/日期解析失败跳过） |
| [data.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/smartfill/data.ts) | `resolveFillSource` `fetchFields` `fetchFillableFields` `fetchFillContext` | 取字段/数据上下文 |
| [plan.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/smartfill/plan.ts) | `buildPlan` `applyPlan` | 构建填充计划 + 应用（预览每一处再写回，按飞书实际确认计数） |

### 10.6 数据分析报告

**[report/build.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/report/build.ts)**：`buildDataReport`（读表 → 本地统计摘要 → AI 写带真实数字的分析报告 → 新文档 + 文末源数据表）。
**[ai/report.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/report.ts)**：`ReportInput` `generateReport`（生成 Markdown 报告）。
**[report/profile.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/report/profile.ts)**：统计摘要（均值/分布/异常）。

### 10.7 网页剪藏（[src/shared/clip/](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/clip/)）

| 文件 | 函数 | 作用 |
|---|---|---|
| [capture.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/clip/capture.ts) | `captureClip` `captureClipScrolling` `mergeTableRows` | 抓取当前页（选中/可读文本/整表滚动加载），手势触发 + activeTab |
| [file.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/clip/file.ts) | `parseCsv` `rowsToMarkdown` `fileToClip` | CSV/TSV/文本文件导入（拖入） |
| [types.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/clip/types.ts) | `ClipCapture` `MAX_CLIP_CHARS=50000` | |

**[vision.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/vision.ts)**：`imageToMarkdown`（截图 OCR，视觉模型）`isVisionUnsupportedError`。

### 10.8 场景模板（[src/shared/templates/](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/templates/)）

| 文件 | 函数/类型 | 作用 |
|---|---|---|
| [engine.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/templates/engine.ts) | `executeTemplate` | 执行模板（建库：表结构 + 示例数据 + 仪表盘） |
| [registry.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/templates/registry.ts) | `sanitizeRemoteTemplate` `fetchRemoteTemplates` `mergeTemplates` `clearRegistryCache` `getCacheInfo` | 远程模板库（单 bundle.json 或 index.json 目录） |
| [builtin/](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/templates/builtin/) | `crm.ts` `ecommerce.ts` `project.ts` `index.ts` | 内置 CRM/电商/项目管理模板 |
| [types.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/templates/types.ts) | `ScenarioTemplate` `TemplateTableDef` `TemplateFieldDef` `TemplateViewDef` `TemplateDashboard` `CreationResult` 等 | |

### 10.9 其他 AI 模块

| 文件 | 函数 | 作用 |
|---|---|---|
| [redact.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/redact.ts) | `redactPII` `redactSensitive` `capPayload` `sanitizeForLlm` | 脱敏（CN 手机/邮箱/身份证/银行卡），LLM 载荷上限 |
| [text.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/text.ts) | `stripFences` | 剥离代码围栏 |

---

## 11. 侧边栏 UI

### 11.1 主应用（[src/sidepanel/App.tsx](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/App.tsx)）

管理：
- **设置**（`settings_v2` 加载/保存，敏感字段加密）
- **上下文**（`refreshCtx` 跟随标签页/SPA 导航；Wiki 节点解析缓存；doc/sheet 真实标题拉取）
- **会话**（`useSessions`，按飞书资源绑定，wikiToken 优先作稳定 key）
- **主题/强调色**（light/dark + 7 预设强调色，localStorage 持久化）
- **标签页**（chat/scenes/clip，按页面类型默认切换，但绝不打断进行中的对话/构建/剪藏）
- **网络检查**（CIDR 限制时 `checkNetworkAccess`）
- **拖入文件**（CSV/TSV → `fileToClip` → 剪藏流程）

### 11.2 组件清单（[src/sidepanel/components/](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/../sidepanel/components/)）

| 组件 | 作用 |
|---|---|
| [ChatPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/ChatPanel.tsx) | 对话主面板（流式 + 工具调用展示 + 确认卡 + 选择卡 + 撤销条） |
| [ScenarioPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/ScenarioPanel.tsx) | 场景入口（模板 + AI 建站 + 数据报告 + 看板 + PPT + 智能填充 + 文档体检/总结） |
| [ClipPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/ClipPanel.tsx) | 剪藏面板（预览 + AI 整理 + 写入飞书） |
| [Settings](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/Settings.tsx) | 设置（LLM/飞书鉴权/模板库/主题/各种开关） |
| [SessionDrawer](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/SessionDrawer.tsx) | 会话列表抽屉 |
| [MessageList](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/MessageList.tsx) | 消息列表渲染 |
| [InputBar](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/InputBar.tsx) | 输入栏（含语音输入 🎤） |
| [ConfirmDialog](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/ConfirmDialog.tsx) | 破坏性操作确认卡 |
| [ChoiceDialog](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/ChoiceDialog.tsx) | ask_user 选项卡 |
| [AISitePanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/AISitePanel.tsx) | AI 建站面板 |
| [DataVizPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/DataVizPanel.tsx) | 数据看板面板 |
| [SlidesPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/SlidesPanel.tsx) | PPT 幻灯片面板 |
| [DataReportPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/DataReportPanel.tsx) | 数据报告面板 |
| [SmartFillPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/SmartFillPanel.tsx) | 智能填充面板 |
| [DocAuditPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/DocAuditPanel.tsx) | 文档体检面板 |
| [DocSummaryPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/DocSummaryPanel.tsx) | 文档总结面板 |
| [UndoBar](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/UndoBar.tsx) | 撤销条（删除后 10 分钟内可恢复） |
| [BaseContextBadge](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/BaseContextBadge.tsx) | Base 上下文徽章 |
| [NetworkBlocked](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/NetworkBlocked.tsx) | 网络受限提示 |
| [DemoPanel](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/DemoPanel.tsx) | 示例体验面板（无需登录） |
| [Skeleton](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/Skeleton.tsx) | 骨架屏 |
| [useEscapeToClose](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/components/useEscapeToClose.ts) | Esc 关闭 hook |

### 11.3 会话管理（[src/sidepanel/sessions/](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/sessions/)）

- [logic.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/sessions/logic.ts)：会话索引逻辑（`SessionIndex` / `SessionMeta`，按 appToken 绑定）
- [store.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/sessions/store.ts)：`chrome.storage.local` 持久化
- [useSessions.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sidepanel/sessions/useSessions.ts)：React hook

---

## 12. 安全设计

**核心原则：助手始终以用户本人身份操作，权限边界全部代码强制（提示词不作安全边界）。**

### 12.1 七大硬约束（见 [CLAUDE.md](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/CLAUDE.md)）

| # | 约束 | 实现位置 |
|---|---|---|
| 1 | **只用用户身份** | `auth.ts resolveToken` 绝不回退 tenant |
| 2 | **文件级删除拒绝** | `agent.ts isFileLevelDelete`；内容删除走确认门 `DESTRUCTIVE_TOOLS` |
| 3 | **通用 API 白名单** | `assertApiCallAllowed` / `API_BLOCKED`（禁 im/通讯录/权限/所有权） |
| 4 | **出站只走 feishuReq/feishuFetch** | 出站守卫 + 重试；LLM 走 `assertSafeBaseUrl` |
| 5 | **沙箱隔离** | 生成代码在 opaque origin + `connect-src:'none'`，不加 `allow-same-origin` |
| 6 | **secret 不进明文包** | 加密 `appSecretEnc` |
| 7 | **写操作不自动重试** | `robustFetch` 只重试 GET |

### 12.2 出站锁定（双重）

- **代码层**：`isFeishuOutboundAllowed`（飞书域）+ `assertSafeBaseUrl`（LLM，可选 host 白名单）
- **CSP 层**：`connect-src 'self' https://*.${baseDomain} [LLM hosts | https:]`

`VITE_OPENAI_ALLOWED_HOSTS` → 出站锁定。

### 12.3 凭据保护（两档）

| 档位 | 配置 | secret 位置 |
|---|---|---|
| 明文 | `VITE_FEISHU_APP_SECRET` | 打进包（.crx 视为机密） |
| 密码加密 | `VITE_FEISHU_APP_SECRET_ENC` | 密文进包，用户输密码解锁（PBKDF2→AES-GCM） |

### 12.4 数据脱敏

- `redactSensitive`：CN 手机/邮箱/身份证/银行卡脱敏（`VITE_LLM_REDACT=1` 时作用于发往 LLM 的副本，源数据不动）
- `truncateToolResult`：单条工具结果 ≤ 8000 字符
- `llmMaxPayloadChars`：LLM prompt 载荷硬上限

### 12.5 防 Prompt 注入

- 选中文字用 `<user_selected_text>` 标签隔离，明确"非操作指令"
- System Prompt 明确拒绝"忽略上面的规则"等注入
- 通用 API 默认拒绝白名单（不依赖模型遵守）

---

## 13. 持久化与加密

### 13.1 加密（[src/shared/crypto.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/crypto.ts)）

- **算法**：AES-256-GCM
- **密钥派生**：PBKDF2(`chrome.runtime.id` + ":" + `deviceSeed`, SALT, 100k, SHA-256)
- **双因子密钥材料**：`chrome.runtime.id`（绑扩展）+ `deviceSeed`（32 字节随机，每安装一次，存 `_device_seed`）
- **迁移**：旧数据（仅 runtime.id）用 legacy key 解密，下次保存自动迁移
- **威胁模型**（诚实声明）：防 casual inspection / 其他扩展 / 明文 token；**不防**本地 malware（deviceSeed 与密文同存于 chrome.storage）

| 函数 | 作用 |
|---|---|
| `encryptField(plain)` | 返回 `base64(iv[12] ‖ ciphertext)`，空输入返回 `''` |
| `decryptField(b64)` | 先用当前 key，失败用 legacy key，再失败返回 `''`（不抛错） |

### 13.2 持久化（[src/shared/storage.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/storage.ts)）

`storageGet` / `storageSet`：Promise 化的 `chrome.storage.local`，吞错误。

### 13.3 存储键（均带 `_v1`/`_v2` 版本后缀，改 schema 需迁移）

| 键 | 内容 |
|---|---|
| `settings_v2` | AppSettings（敏感字段加密） |
| `_feishu_utoken_v1` | OAuth token bundle（加密） |
| `_device_seed` | 设备种子（加密密钥材料） |
| `dataviz_v1` | 已保存看板/网站 |
| `slides_decks_v1` | 已保存 PPT |
| `recipes_v1` | 本地经验 |
| `audit_check_v1` / `summary_prompt_v1` | 文档体检/总结的自定义 prompt |
| `TENANT_ORIGIN_KEY` | 租户 origin |

---

## 14. 测试体系

### 14.1 单元测试（Vitest，~460 用例）

测试文件与源码同目录（`*.test.ts` / `*.test.tsx`），覆盖：
- AI：`agent.test.ts` `dataviz.test.ts` `docaudit.test.ts` `docsummary.test.ts` `recipes.test.ts` `redact.test.ts` `report.test.ts` `slides.test.ts` `smartfill.test.ts` `text.test.ts` `vision.test.ts`
- 飞书：`api.test.ts` `appSecret.test.ts` `compose.live.test.ts` `compose.unit.test.ts` `docx.test.ts` `http.test.ts` `im.test.ts` `live.test.ts` `pageUrl.test.ts` `task.test.ts` `undo.test.ts` `userAppCreds.test.ts` `utoken.test.ts`
- 其他：`config.test.ts` `configBackup.test.ts` `crypto.test.ts` `clip/*` `dataviz/*` `smartfill/*` `templates/*` `theme.test.ts` `network.test.ts` `providers.test.ts` `url.test.ts` `features-validate.test.ts` `redact-unconditional.test.ts`

### 14.2 端到端测试（[src/harness/](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/harness/)）

- [driver.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/harness/driver.ts)：测试驱动（mock 飞书 API）
- [templates.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/harness/templates.ts)：测试模板
- 场景：`smoke.test.ts` `compose.test.ts` `docx.test.ts` `hr-template.e2e.test.ts` `replicate.test.ts` `report.test.ts` `rich.test.ts` `sheets.test.ts` `transfer.test.ts`

### 14.3 迭代循环（每次改完都跑）

```bash
npm run typecheck   # 必须 0 错
npm test            # 必须全绿
npm run build       # 必须成功（偶发 TLS 报错→重试）
```

---

## 15. 二次开发指南

### 15.1 开发循环

```bash
npm run dev:ui      # 浏览器直看侧边栏（mock chrome，不连飞书）
npm run dev:ext     # 扩展热更新（加载到 Chrome，连真飞书）
npm run typecheck && npm test   # 改完必跑
```

### 15.2 关键扩展点

| 需求 | 改动位置 |
|---|---|
| 加一个 AI 工具 | [tools.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/tools.ts) 定义 + [agent.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/agent.ts) `executeTool` switch + 对应 API |
| 加一个 LLM 供应商 | [providers.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/providers.ts) `LLM_PROVIDERS` |
| 加一个场景模板 | [templates/builtin/](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/templates/builtin/) + `index.ts` |
| 加一个沙箱渲染类型 | [spec.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/dataviz/spec.ts) 新 kind + [interpret.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/dataviz/interpret.ts) + [sandbox/main.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/sandbox/main.ts) `runSpec` |
| 改 System Prompt | [agent.ts](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/src/shared/ai/agent.ts) `buildSystemPrompt` |

### 15.3 安全卡点（改动需同步更新 SECURITY_AUDIT.md + 单测）

- `isFileLevelDelete` / `assertApiCallAllowed` / `resolveToken` / `assertSafeBaseUrl` / `isFeishuOutboundAllowed`
- 沙箱 CSP（不加 `allow-same-origin`）
- 写操作不重试

### 15.4 高频地雷（先怀疑）

- **导出 PDF 没反应** → sandbox `allow-modals` 需 iframe 属性 + `vite.config.ts` CSP 两层都有
- **token 2h 失效** → OAuth 必须含 `offline_access`（`oauth.ts` 已强制）
- **环境变量没生效** → Vite 只读 `.env` 文件的 `VITE_*`，不读 `process.env`；用 `--mode` + `.env.<mode>.local`
- **构建偶发 TLS 报错** → 重试（`read ECONNRESET` 是 vite-plugin-web-extension 处理 manifest 时的网络问题）

### 15.5 提交约定

- 仅在用户要求时才 commit/push；先开分支再改默认分支
- 提交结束语：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **切勿提交** `*.pem` / `.env.*` / `*password*.txt`（已 gitignore）

### 15.6 Fork / 自建分发

必须替换 [manifest.json](file:///e:/个人项目/feishu/feishu-doc-ai-assistant/manifest.json) 的 `key`（生成自己的扩展 ID/签名私钥）：

```bash
openssl genrsa 2048 > my-extension-key.pem
openssl rsa -in my-extension-key.pem -pubout -outform DER | openssl base64 -A
# 替换 manifest.json 的 "key" 字段
```

并改掉文档中的扩展 ID / 重定向 URL / `ALLOW_ORIGIN` 占位。

---

*本文档基于仓库全量源码梳理，最后更新于构建版本 v1.0.4.2。*
