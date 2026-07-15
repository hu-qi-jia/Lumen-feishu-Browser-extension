# Lumen — 飞书文档agent

> 一站式上手见 [`README.md`](../README.md)，安全逐条见 [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md)，
> 配置全量见 [`.env.example`](../.env.example)。本文聚焦**模块结构、工具清单、字段类型、API 实测坑**
> 等深水区细节。

## 导航结构

侧边栏 4 个主标签：

| Tab | 入口 | 说明 |
|-----|------|------|
| 对话 chat | `ChatPanel` | AI 对话主界面（流式渲染、工具进度、多会话） |
| 应用 scenes | `ScenarioPanel` | 应用 Hub，下挂 5 类功能卡片 |
| 资讯 news | `NewsPanel` | GitHub Trending + 微博热搜 |
| 设置 settings | `Settings` | 6 个子 tab（通用 / 模型 / 飞书 / 知识库 / 备份 / 外观） |

## 目录结构

```
src/
├── background/
│   └── index.ts              # Service Worker — 侧边栏生命周期 + alarms + declarativeNetRequest
│
├── content/
│   ├── index.ts              # 注入飞书页面：提取 PageContext + 消息路由
│   ├── feishu-automation.ts  # DOM 自动化：点击 UI 创建仪表盘，从 URL 提取 block_token
│   ├── selection-button.ts   # 划词触发按钮（文本选中 → 弹出 AI 操作入口）
│   └── dataviz/              # 数据可视化浮窗（注入层）
│       ├── viz-launcher.ts   # 浮窗启动器（postMessage → sandbox iframe 渲染）
│       └── viz-overlay.ts    # 可拖拽/四角缩放浮窗容器（多实例管理）
│
├── sidepanel/                # React 侧边栏 UI
│   ├── main.tsx · App.tsx · App.css · index.html
│   ├── sessions/             # 多会话管理（持久化 + 按文档绑定）
│   │   ├── useSessions.ts    # hook：按 appToken 自动切会话、debounce 落盘
│   │   ├── store.ts          # chrome.storage.local 分片存储（index + 每会话消息）
│   │   └── logic.ts          # 纯 reducer：find-or-create / 删除回退（可单测）
│   ├── hooks/                # useAppSettings / useDocBinding / usePageContext / useRecentFiles / useRecentTitleBackfill / useThemeAccent / useWikiResolve
│   ├── lib/                  # autoDefault / pdfHistory / fileImportHistory / wikiResolve
│   ├── services/             # recentFiles / tabReload
│   └── components/
│       ├── chat/             # 对话 Tab（ChatPanel / MessageList / InputBar / Markdown / ConfirmDialog / DocSelector / FieldChips / ImageExportCard / ReplyActions / UndoBar / SkillSuggest / BaseContextBadge / CodeBlock）
│       ├── scenes/           # 应用 Tab
│       │   ├── ScenarioPanel.tsx     # Hub 容器（Gallery → 各子面板）
│       │   ├── DataVizPanel.tsx      # AI 看板（ECharts 浮窗）
│       │   ├── SlidesPanel.tsx       # 演示文稿（12 layout + PPTX 导出）
│       │   ├── PdfTranscribePanel.tsx# PDF 本地解析 + AI 润色
│       │   ├── FileImportPanel.tsx   # 表格文件转写（CSV/TSV/TXT → 飞书文档）
│       │   ├── SkillPanel.tsx        # 技能库（用户自定义 + 内置）
│       │   ├── SkillEditor.tsx       # 技能编辑器
│       │   └── WriteTargetSection.tsx + createTargets.ts  # 写入目标选择
│       ├── news/             # NewsPanel / GitHubTab / WeiboTab / NewsRefreshBar / useNewsData
│       ├── settings/         # Settings / SettingsTabs / GeneralTab / AiTab / FeishuTab / FeishuSteps / KnowledgeBaseTab / BackupTab / AppearanceTab / types
│       │   └── knowledge-base/  # KnowledgeBasePanel / ObsidianVaultView / ObsidianNoteDetail
│       ├── session/          # SessionDrawer / HistoryRow / DocCombobox / DocLinkField / SwitchDocDialog / SwitchSessionDialog
│       ├── shell/            # NavRail / TopBar / HubCard
│       └── ui/               # 通用原语（Button / IconButton / Dropdown / SearchBox / SegmentedTabs / Skeleton / SideDrawer / Tooltip / NetworkBlocked / ImagePicker / UploadDrop / ThemeThumb / ConfirmModal / ListView / Form* / icons / useEscapeToClose）
│
├── shared/
│   ├── ai/
│   │   ├── agent.ts          # Agent 循环（流式 + 工具执行 + 安全校验，MAX_TOOL_CALLS_PER_TURN=30）
│   │   ├── agent-executor.ts # 工具执行器（dispatch + sanitize + 回填）
│   │   ├── agent-security.ts # 安全分级（API 白名单 / 文件级删除硬拒 / 内容级删除确认 / 脱敏截断）
│   │   ├── agent-context.ts  # 工具选择层（按页面类型暴露工具子集）
│   │   ├── agent-prompt.ts   # 系统提示词构建
│   │   ├── agent-history.ts  # 历史消息组装
│   │   ├── llm.ts            # LLM 通用调用封装
│   │   ├── recipes.ts        # 本地经验（MAX_RECIPES=300）
│   │   ├── builtinSkills.ts  # 3 个内置技能
│   │   ├── userSkills.ts     # 用户技能（MAX_USER_SKILLS=50, MAX_SKILL_BYTES=16KB）
│   │   ├── redact.ts         # PII 脱敏（redactPII 无条件 + redactSensitive 受 VITE_LLM_REDACT 控制）
│   │   ├── smartfill.ts      # 智能填充（预览/应用）
│   │   ├── docaudit.ts       # 文档体检（MAX_CHARS=16000）
│   │   ├── docsummary.ts     # 文档总结（MAX_CHARS=16000）
│   │   ├── report.ts         # 数据报告
│   │   ├── mdPolish.ts       # AI 润色（POLISH_MAX_CHARS=12000）
│   │   ├── dataviz.ts        # 数据可视化 codegen
│   │   ├── slides.ts         # 幻灯片渲染
│   │   ├── slideLayouts.ts   # 12 种版式
│   │   ├── slidesExport.ts + slidesExportPptx.ts  # 幻灯片导出（PPTX）
│   │   ├── slidesThemes.ts + slidesStore.ts + slidesSources.ts + slidesImages.ts
│   │   ├── text.ts           # 文本处理
│   │   ├── tools/            # 工具定义（按产品域拆分）
│   │   │   ├── index.ts      # barrel re-export
│   │   │   ├── core.ts       # 通用（render_data_app + feishu_api_call）
│   │   │   ├── base.ts       # 多维表格 Base（22 个）
│   │   │   ├── sheet.ts      # 电子表格（14 个）
│   │   │   ├── doc.ts        # 文档（16 个）
│   │   │   ├── board.ts      # 画板（2 个）
│   │   │   ├── compose.ts    # 组合操作（12 个）
│   │   │   └── knowledge.ts  # 知识库只读（3 个）
│   │   └── *.test.ts         # 对应单测
│   │
│   ├── feishu/
│   │   ├── api.ts            # 多维表格 Base Open API（表/字段/记录/视图/仪表盘）
│   │   ├── http.ts           # 共享请求层 feishuReq（sheets/docx 复用）
│   │   ├── sheets.ts         # 电子表格 Spreadsheet API
│   │   ├── docx.ts           # 文档 Docs API（buildBlock + markdownToBlocks + insertTable）
│   │   ├── board.ts          # 画板（whiteboard）API
│   │   ├── compose.ts        # 复合操作（去重/跨表/审计等，原生缺失补齐）
│   │   ├── auth.ts           # resolveToken（只用 user_access_token）+ getValidUserToken（自动续期）
│   │   ├── appSecret.ts      # 密码加密 App Secret 解锁（PBKDF2 210k iters + AES-GCM）
│   │   ├── oauth.ts          # 扩展内 OAuth（launchWebAuthFlow → user_access_token → user_info）
│   │   ├── tenant.ts         # 租户来源记忆
│   │   ├── context.ts        # Base 结构加载（最多 6 张表并发）
│   │   ├── export.ts         # Base → 模板 JSON 导出（exportBaseAsTemplate，ID 替换为符号引用）
│   │   ├── upload.ts · media.ts   # 媒体上传
│   │   ├── undo.ts           # 撤销支持
│   │   ├── task.ts           # 异步任务轮询
│   │   ├── pageUrl.ts · parseDocRef.ts  # URL/文档引用解析
│   │   └── userAppCreds.ts   # 用户自填凭证（store 分发）
│   │
│   ├── obsidian/             # Obsidian 接入（loopback only）：api / auth / http / util
│   ├── news/                 # 资讯：alarm / github / weibo / store / translate / types
│   ├── pdf/                  # PDF 本地解析：clean / extract / imageExtract / layout / textExtract / types
│   ├── clip/                 # 文件解析（CSV/TSV/TXT → 飞书，非网页剪藏）：file.ts + types.ts
│   ├── dataviz/              # 数据可视化运行时：data / interpret / scope / send / spec / store / types
│   ├── smartfill/            # 智能填充：coerce / data / plan / types
│   ├── report/               # 报告：build / profile / types
│   ├── templates/
│   │   └── types.ts          # ScenarioTemplate 类型定义（仅类型，无内置模板/引擎）
│   ├── providers.ts          # LLM 供应商预设 + host 白名单（assertSafeBaseUrl）
│   ├── theme.ts              # 主色派生 deriveAccent
│   ├── crypto.ts             # AES-256-GCM（per-device key + 自动迁移）
│   ├── network.ts            # CIDR 访问控制（WebRTC 本地 IP 检测）
│   ├── config.ts             # 构建时常量（env vars → 类型安全对象）
│   ├── configBackup.ts       # 配置备份/恢复
│   ├── dataCleanup.ts        # 数据清理
│   ├── attachments.ts · mdClean.ts · storage.ts · url.ts
│   └── types.ts              # 公共类型（AppSettings / PageContext / ChatMessage）
│
├── sandbox/
│   └── main.ts               # 沙箱渲染（NO_EVAL 模式渲染 VizSpec；否则 new Function 跑生成代码）
│
├── viewer/
│   ├── deckViewer.html + deckViewer.ts   # 幻灯片全屏放映
│   └── vizViewer.html + vizViewer.ts     # 看板全屏预览
│
└── dev/
    ├── chrome-mock.ts        # dev:ui 模式下 Chrome API mock
    └── scenarios.ts          # 开发场景切换（base / nonBase / withSelection）

public/
├── icons/                    # 扩展图标 + logo
└── rules/
    └── news_referer.json     # declarativeNetRequest 规则（为资讯请求注入 Referer）
```

---

## 设计系统 / 主题

- 颜色/圆角/阴影/渐变集中在 `App.css` 的 `:root` CSS 变量（`--color-*` / `--gradient-brand` / `--shadow-*` / `--ring`），组件全部引用变量 → 改 token 即全局换肤。
- **暗色模式**：`App.tsx` 维护 `theme`('light'|'dark')，写入 `document.documentElement.dataset.theme` 并持久化到 `localStorage['fa-theme']`；`App.css` 的 `[data-theme="dark"]` 覆盖 token。
- **主色可配置**：`src/shared/theme.ts` 的 `deriveAccent(hex,isDark)` 把单个 accent hex 派生成整套品牌变量。`App.tsx` 持有 `accent` state（localStorage `fa-accent`），`useEffect([accent,theme])` 写到 `:root`；`accent===DEFAULT_ACCENT` 时清除 inline 覆盖回落默认。Settings「外观」给预设色板 + 取色器，即时生效。**所有品牌色已收敛为变量，组件内无硬编码 hex，新增 UI 一律引用变量。**
- 动效尊重 `prefers-reduced-motion`。

## 会话管理（多会话 / 按文档绑定）

会话持久化到 `chrome.storage.local`，**按文档自动绑定**：切到某飞书文档，侧边栏自动打开该文档的会话；非绑定页面用「通用会话」。

- **存储分片**：`sessions_index_v1`（轻量索引：sessions/activeId/byAppToken/generalId）+ `session_msgs_v1::<id>`（每会话消息，懒读、debounce 写）。见 `sessions/store.ts`。
- **状态提升到 App**：会话状态在 `App` 的 `useSessions(activeAppToken, streaming)` hook 里（不放 ChatPanel——它随 tab 切换会卸载）。`ChatPanel` 改为受控。
- **自动切换**：hook 监听 `ctx.feishu.appToken` 变化 → find-or-create 对应会话。**streaming 期间延迟切换**（回复完才跟随浏览器导航），避免流式 chunk 写进别的会话。
- **标题 = 文档名**：新建会话用占位标题，拿到 `appName` 后回填（用户手动重命名后不再被覆盖）。
- **纯逻辑**：`sessions/logic.ts` 是无副作用 reducer，有单测。

## 消息协议

所有消息均校验 `sender.id === chrome.runtime.id`，拒绝外部来源。

```
Side Panel ──chrome.tabs.sendMessage──▶ Content Script
         ◀──────────sendResponse─────────────┘
  GET_PAGE_CONTEXT     → PageContext { url, appToken, tableId, viewId, selectedText }
  CREATE_DASHBOARD_UI  → { blockToken, created }（DOM 自动化）
  DATAVIZ_RENDER       → { vizId, code, data }（注入浮窗 + 沙箱 iframe）

Content Script ──chrome.runtime.sendMessage──▶ Side Panel
  PAGE_CONTEXT_UPDATE  → PageContext（SPA 导航时推送，仅接受当前 active tab）
```

---

## AI Agent 设计

### 执行流程

```
用户消息
  │
  ▼
buildSystemPrompt()          # 注入角色定义、作用域、当前 Base 结构
  │
  ▼
OpenAI Streaming API
  ├─ text chunk → onChunk() → 流式渲染
  └─ tool_calls
       ▼
  checkDestructiveConfirmation()   # 破坏性工具：扫描用户消息确认词
       ▼
  sanitizeToken()                  # 所有 ID 参数正则校验 [A-Za-z0-9_-]
       ▼
  executeTool() → 飞书 API          # agent-executor.ts 分发
       ▼
  truncateToolResult()             # 截断防 PII 外泄
       ▼
  结果回填 msgs[] → 下一轮循环
       │
  MAX_TOOL_CALLS_PER_TURN=30 → 超出停下让用户回复「继续」
```

### 交互式弹窗

两个入口，都靠「runAgent 在工具循环里 `await` 一个可选回调 → ChatPanel 用 `pending* state + Promise` 实现弹窗 → 按钮点击 resolve」这套机制：

1. **新建 Base 确认** —— `requestConfirmation?(req): Promise<'new'|'current'|'cancel'>`。执行 `create_bitable_app` 前 await，让用户选 新建独立 Base / 加到当前 Base / 取消。组件 `ConfirmDialog`。
2. **ask_user 通用选项卡** —— `askUser?(req): Promise<string>`，由 `ask_user` 工具驱动：LLM 觉得意图不明/缺信息/多方案需拍板时，自己生成 `question` + 2-4 个 `options` 调用它，runAgent 拦截（不走 executeTool）→ await `askUser` → 把用户选中的 label 作为 `{user_choice}` 回传。

两个回调都**可选**：harness/测试不传时不会卡住。

### 工具列表（71 个，跨 7 个分组）

**Core（2）** — `core.ts`
| 工具 | 说明 |
|------|------|
| `render_data_app` | 生成数据可视化小程序代码（交沙箱渲染） |
| `feishu_api_call` | 通用飞书 API 调用（受白名单 + 删除硬拒约束） |

**Base / 多维表格（22）** — `base.ts`
| 分类 | 工具 |
|------|------|
| App | `get_app_info` `create_bitable_app`（以用户身份创建，直接归用户） |
| 表 | `list_tables` `create_table` `delete_table` † `update_table` |
| 字段 | `list_fields` `create_field` `update_field` `delete_field` † |
| 记录 | `list_records` `create_record` `batch_create_records` `update_record` `batch_update_records` `search_records` `delete_record` † `batch_delete_records` † |
| 视图 | `list_views` `create_view` |
| 仪表盘 | `list_dashboards` `copy_dashboard`（整盘复制，唯一可用写操作） |

**Sheet / 电子表格（14）** — `sheet.ts`，`spreadsheet_token` + `range`("{sheet_id}!A1:C10")，scope `sheets:spreadsheet`

> **公式（实测修正）**：飞书把纯 `"=A2*B2"` 字符串当**文本**存（不计算），真公式须写成 `{type:'formula',text:'=...'}`。`sheets.ts` 的 `normalizeCell` 自动把 `=` 开头的字符串转成公式对象，所以 `write_range`/`append_rows` 直接传 Excel 语法即可。读取时 `read_range` 用 `valueRenderOption=FormattedValue`，否则默认返回公式表达式而非计算结果。range 不接受裸单格（用 `C2:C2` 不能用 `C2`）。

| 分类 | 工具 |
|------|------|
| 表格 | `create_spreadsheet` `get_spreadsheet` |
| 工作表 | `list_sheets` `add_sheet` `delete_sheet` † `rename_sheet` |
| 单元格 | `read_range` `write_range` `append_rows` `fill_column`（整列公式填充） `find_replace` `set_number_format` |
| 行列 | `insert_dimension` `delete_dimension` † |

**Doc / 文档（16）** — `doc.ts`，`document_id`，scope `docx:document`

> **Markdown → 文档**（`docx.ts` 的 `markdownToBlocks` + `createDocFromMarkdown`）：解析 # 标题、-/* 列表、1. 有序、> 引用、```代码```、--- 分割线、- [ ] 待办，及内联 `**粗**`/`*斜*`/`` `码` ``。块类型码已 live 验证（text2 / h1-3=3-5 / bullet12 / ordered13 / code14 / quote15 / todo17 / divider22）；注意 quote 的字段名是 `quote` 不是 `quote_container`。

| 分类 | 工具 |
|------|------|
| 文档 | `create_document` `create_doc_from_markdown`（Markdown 一键成文） `get_document_content` `copy_document` |
| 块 | `list_blocks` `add_document_content` `update_document_block` `delete_document_blocks` † |
| 插入块 | `insert_table` `insert_sheet` `insert_bitable` `insert_callout` `insert_iframe` `insert_image` `replace_image` `export_doc_images` |

**Board / 画板（2）** — `board.ts`
| 工具 | 说明 |
|------|------|
| `create_whiteboard` | 创建白板 |
| `get_whiteboard_info` | 读取白板信息 |

**Compose / 组合（12）** — `compose.ts`，读全量记录后本地计算，写回经飞书 batch 接口（单批上限 500，`compose.ts` 内 `chunk` 自动分批；读全量 cap=5000，返回带 `capped` 标志）

| 工具 | 说明 |
|------|------|
| `base_table_to_sheet` | Base 表 → 电子表格 |
| `summarize_table` | 分组聚合/数据透视 → 新电子表格 |
| `base_to_doc_report` | 读 Base 结构 → 生成汇总文档（内容生成非导出） |
| `generate_data_report` | 数据报告生成 |
| `audit_document` | 文档体检（检空缺/重复/离群，`MAX_CHARS=16000`，可输出文档） |
| `summarize_document` | 文档总结（`MAX_CHARS=16000`） |
| `dedupe_records` † | 按 `key_fields` 组合去重。**破坏性**，建议先 `dry_run=true` 预览 `duplicate_groups`/`to_delete` 再确认 |
| `cross_table_lookup` | 跨表 VLOOKUP：源表键去目标表匹配，回填 `into_field`（不存在则自动建文本列）。多命中按 `on_multiple`=first/join/skip 处理 |
| `update_where` | 按条件批量改：全量命中→对每条写 `set`→batch_update。支持 `dry_run` 预览 |
| `audit_table` | 数据质量体检：检 `required_fields` 空缺、`unique_fields` 重复、`numeric_outlier_fields` 的 3σ 离群值。`output=doc` 时生成报告文档 |
| `smart_fill_preview` | AI 智能填充预览（不写） |
| `smart_fill_apply` | 应用预览的填充计划（写回） |

**Knowledge / 知识库（3）** — `knowledge.ts`（只读，走 Obsidian loopback）
| 工具 | 说明 |
|------|------|
| `search_knowledge_base` | 全文检索 |
| `list_knowledge_notes` | 列目录 |
| `read_knowledge_note` | 读笔记 |

> 三种产品 token/工具不可混用；非 Base 工具在 `executeTool` 里经 `SHEET_TOOLS`/`DOC_TOOLS` 分发，绕开 Base 的 `app_token` 守卫。`cross_table_lookup` 的 `source_table_id`/`target_table_id` 不叫 `table_id`，case 内单独 `sanitizeToken`。

† = 破坏性工具，需用户明确确认才执行。当前集合：`delete_table` / `delete_field` / `delete_record` / `batch_delete_records` / `delete_sheet` / `delete_dimension` / `delete_document_blocks` / `dedupe_records`。

---

## 安全设计

> 权限边界**全部硬编码在代码里**（提示词不作安全边界）。逐条审计 + 攻击场景见
> [SECURITY_AUDIT.md](SECURITY_AUDIT.md)；这里只列代码层卡点的落点。

| 卡点 | 位置 | 作用 |
|------|------|------|
| 身份 = 用户本人 | `auth.ts resolveToken` | 只用 user_access_token，不回退 tenant（权限不超用户） |
| 禁文件级删除 | `agent-security.ts` | `delete_table` / `delete_sheet` 等整表/电子表格/文档/`feishu_api_call` DELETE 一律硬拒；内容级删除走确认门 |
| 删除/写确认门 | `agent-security.ts` 破坏性门 | 内容删除/写弹按钮确认；**Auto 模式**(`settings.autoConfirm`，默认 false fail-closed)自动确认；文件级不受影响 |
| 通用 API 白名单 | `agent-security.ts` | `API_ALLOWED_PREFIXES` 默认拒绝 + `API_BLOCKED` 硬阻断（transfer_owner / permissions / im / contact / admin）+ 路径穿越 |
| 出站守卫 | `network.ts isFeishuOutboundAllowed` + `providers.ts isObsidianOutboundAllowed`（loopback-only）+ `assertSafeBaseUrl` + CSP | 只准连飞书 + 大模型 + 本地 Obsidian |
| 上下文来源 | `App.tsx onMessage` | 只接受**当前窗口 active tab** 的 PAGE_CONTEXT_UPDATE（防后台 tab 串扰） |
| 工具调用上限 | `agent.ts` | 每轮默认 30（可配 `VITE_MAX_TOOL_CALLS`），到顶停下让用户确认继续 |
| 凭据加密 | `crypto.ts` | AES-256-GCM，密钥 = PBKDF2(扩展ID + 每设备随机 seed)；加密 token/secret |
| App Secret | `appSecret.ts` | 明文 / 密码加密 两档；密码档 PBKDF2 210k iters + AES-GCM |
| PII 脱敏 | `redact.ts` | `redactPII` 无条件 + `redactSensitive` 受 `VITE_LLM_REDACT` 控制；`truncateToolResult` 截断防 PII 批量外泄 |
| CIDR 门 | `network.ts` | `VITE_ALLOWED_CIDRS` 限定浏览器本地 IP 所在网段，否则锁定扩展 |
| LLM host 白名单 | `providers.ts` | `VITE_OPENAI_ALLOWED_HOSTS` 限定模型 API host，同时锁 CSP connect-src |
| 沙箱隔离 | `sandbox/main.ts` | sandbox `connect-src 'none'`；`VITE_NO_REMOTE_CODE=1` 时去掉 `unsafe-eval`，仅渲染声明式 VizSpec |

---

## AI 小程序 / Data App（沙箱小程序）

把当前多维表格/电子表格的数据，用一句话做成飞书页面上的悬浮窗**小程序**——生成的是**只读渲染**代码（不写飞书，写表交给 Smart Fill / 对话工具）。

**数据流（4 个上下文）**

```
侧边栏(有 chrome.*/token/LLM key)
  generateViz() 一次性 codegen → {name, code}
  fetchVizData() listRecords/readRange → {schema, rows}
  chrome.tabs.sendMessage(tabId, {DATAVIZ_RENDER, vizId, code, data})
  ↓
内容脚本(*.feishu.cn)：注入可拖拽/四角缩放浮窗 + 沙箱 iframe；按 vizId 多实例；
  iframe.postMessage({code,data,nonce})；回 RENDER_OK/ERR → 转回侧边栏
  ↓
沙箱页(src/sandbox，MV3 sandbox.pages)：null 源、无 chrome.*、connect-src 'none'；
  内置 ECharts(treeshake)；new Function 执行生成代码渲染（NO_EVAL 模式则只渲染 VizSpec）
```

- **代码与数据分离**：保存的是 `render(data,echarts,container,theme)` 代码（`SavedViz`，存 `chrome.storage.local`）；数据每次**实时重拉**。重开 = 拉新数据 + 跑旧代码，**零 LLM、数据永远最新**。
- **触发**：应用 Hub「AI 看板」+ 对话工具 `render_data_app`；**调整 = 对当前代码做最小改动**（把现有代码回传给模型，只改用户点名的那一处）。
- **多实例**：一页可挂多个独立小程序（各自浮标、各自浮窗）；单看板内可含多图（CSS Grid，多个 echarts 实例）。

**安全**：生成的是 LLM 代码，但跑在锁死的沙箱里 —— `connect-src 'none'`（**拿了数据也发不出去**）、null 源（**无 token/storage/chrome.* 访问**）、与飞书页 DOM 跨源隔离；另有 `fetch|import|WebSocket` 静态拒绝兜底。详见 SECURITY_AUDIT。

**容量（实测量级，非硬上限）**：保存看板数百个（受 `chrome.storage.local` ~10MB 约束）；同时打开浮窗约 5–10 个舒适（每个独立沙箱 iframe，RAM 决定）；单看板内 4–9 个图最佳。**没打开的看板几乎不占资源**。

## AI 智能填充 / Smart Fill

在**多维表格 / 电子表格**里选一列，AI 参考同行其它列（+ 已填好的行作示例）推断该列**空缺**的值，预览后写回。返回的是**结构化值**（不是代码），全程在侧边栏本地完成——无沙箱、无内容脚本。

通过 `smart_fill_preview` / `smart_fill_apply` 两个 compose 工具暴露给 agent。

**数据流（全部 side-panel-local）**
```
读：fetchFillContext(source) —— Base: listFields(类型/选项)+fetchAllRecords(带 record_id)
                              Sheet: readRange(表头=字段，行号=写键)
     按目标列把行分成「空缺=待填」/「已填=示例」
推断：分批(每批~40行)送 LLM —— schema+选项 + K 条示例 + 待填行(各带稳定 key)
     → inferFills() 解析 {fills:[{key,value}]} → Map<key, 原始值>
校验：coerceValue() 按字段类型强制——单选/多选必须命中已有选项(否则跳过、绝不新建)；
     key→写键(record_id / 行号)本地映射(模型从不见写键)
预览：组装 FillPlan（proposed[] + skipped[]）渲染——此步绝不写
应用：applyPlan() → resolveToken 分流：
     Base  → batchUpdateRecords（分批500，按 record_id 去重、按 data.records 实计数）
     Sheet → 重读目标列区间→只覆盖仍为空的单元格→writeRange 一次写回
```

- **只填空白**（默认）：覆盖开关默认关；空缺判定用 `cellToString().trim()===''`（与 `auditTable` 一致）。
- **真实计数**：Base 写入数取自飞书返回的 `data.records`（飞书可能 code 0 却只生效一部分）；少于申请数即如实报「N 处未写入」。
- **可填类型**：Base 文本/数字/单选/多选/日期/勾选/电话/链接（公式/查找/自动编号/关联/附件/人员/系统字段排除）；Sheet 各列按文本。
- **大表**：单次预览 inferred 上限 ~300 行，应用后再次预览接着填余下；读 cap 5000。

---

## 鉴权与身份模型（安全核心）

> 助手始终以用户本人 `user_access_token` 操作，不使用 tenant 身份。逐条见
> [SECURITY_AUDIT.md](SECURITY_AUDIT.md)。

- **P1 创建归属用户**：以用户身份创建 → 新建文档直接归用户，无需转交。
- **P3 权限不超用户**：`auth.ts resolveToken()` 只返回 user_access_token（无 tenant 分支）；用户读不了的文档助手也读不了；权限错误如实上报，不回退 tenant。
- **OAuth 自动续期**：Settings「用飞书账号授权」→ `oauth.ts` 走 `chrome.identity.launchWebAuthFlow` → `authen/v2/oauth/token` 换 user_access_token + refresh_token（加密存储，到期前 5 分钟自动续期）→ `user_info` 拿 open_id。
- **重定向 URL**：`chrome.identity.getRedirectURL()` = `https://<ext-id>.chromiumapp.org/`，登记到应用「安全设置 → 重定向 URL」。
- **App Secret 两档**：明文 `VITE_FEISHU_APP_SECRET`（进包）/ 密码加密 `VITE_FEISHU_APP_SECRET_ENC`（`scripts/encrypt-secret.mjs` 生成，运行时输密码解锁，PBKDF2 210k iters）。Webstore 分发时两者均留空，用户在 Settings 自填。

## 字段类型速查

| type | 名称 | type | 名称 |
|------|------|------|------|
| 1 | 文本 | 13 | 电话 |
| 2 | 数字 | 15 | URL |
| 3 | 单选 | 17 | 附件 |
| 4 | 多选 | 20 | 公式 |
| 5 | 日期（Unix ms） | **1005** | **自动编号** |
| 7 | 复选框 | 1001–1004 | 系统字段（只读） |
| 11 | 人员 | 18/19/21 | 单向关联 / 查找引用 / 双向关联（需 property） |

> **注意：自动编号是 `1005`，不是 `21`**（21 是双向关联 DuplexLink）。早期 `api.ts` 枚举曾把 21 误标为 AutoNumber，导致建表报 `code=800074092 DuplexLink field property is null`，已修正。关联/查找类（18/19/21）需 `property` 指向目标表，引擎会跳过此类无 property 字段。

> **公式字段（type=20）**：在字段对象上传 `formula_expression`，用**被引用字段的准确名称**直接写表达式（如 `数量*单价`）。**必须用字段名**，不能用 `CurrentValue.[…]` 或字段 ID（实测那样会建出空公式、记录值为 null）。建表时把公式字段排在它依赖的字段之后。`create_field` / `create_table` 工具均已暴露该参数。

> `update_field`：飞书更新字段 API 要求 body 同时带 `field_name` 和 `type`，而 LLM 通常只传变更项。`executeTool` 会先 `list_fields` 取当前字段，回填缺失的 `field_name`/`type` 后再调用，避免 400。

---

## 应用 / 资讯 / 设置

### 应用（Scenes）— 5 类功能卡片

| 卡片 | 组件 | 说明 |
|------|------|------|
| 数据可视化 | `DataVizPanel` | ECharts 看板浮窗（详见「AI 小程序」节） |
| 演示文稿 | `SlidesPanel` | 12 种 layout + PPTX 导出（`slidesExportPptx.ts`），全屏放映走 `viewer/deckViewer` |
| 内容转写 | `PdfTranscribePanel` + `FileImportPanel` | PDF 本地解析 + AI 润色（`mdPolish.ts`）；CSV/TSV/TXT 写入飞书文档 |
| 技能库 | `SkillPanel` / `SkillEditor` | 用户自定义技能（Markdown，`MAX_USER_SKILLS=50` / `MAX_SKILL_BYTES=16KB`）+ 3 个内置（`builtinSkills.ts`） |
| 知识库 | `KnowledgeBasePanel` | Obsidian loopback 接入（受 `HAS_KNOWLEDGE_BASE` 门控） |

### 资讯（News）

- 数据源：GitHub Trending + 微博热搜（`news/github.ts` / `news/weibo.ts`）。
- 定时抓取：`chrome.alarms`（`news/alarm.ts`）。
- Referer 注入：`declarativeNetRequest` + `public/rules/news_referer.json`（绕过反爬）。
- 翻译引擎：off / Bing / AI（`news/translate.ts`，设置「通用」tab 配置）。
- 缓存：`news/store.ts`。

### 设置（6 个 tab）

| Tab | 组件 | 说明 |
|-----|------|------|
| 通用 | `GeneralTab` | `autoConfirm`（默认 false）+ `learnFromHistory` + GitHub 翻译引擎 |
| 模型配置 | `AiTab` | OpenAI 兼容端点（base_url / api_key / model） |
| 飞书设置 | `FeishuTab` + `FeishuSteps` | App ID / App Secret / OAuth 授权 |
| 知识库 | `KnowledgeBaseTab` | Obsidian REST API 配置 |
| 数据与备份 | `BackupTab` | 备份/恢复（`configBackup.ts`）+ 数据清理（`dataCleanup.ts`） |
| 外观 | `AppearanceTab` | 主题（light/dark）+ 强调色 |

---

## 环境变量汇总

全部构建时变量见 [`.env.example`](../.env.example)：

| 变量 | 说明 |
|------|------|
| `VITE_FEISHU_APP_ID` | 飞书 App ID |
| `VITE_FEISHU_APP_SECRET` | 明文 App Secret（进包，个人构建） |
| `VITE_FEISHU_APP_SECRET_ENC` | 密码加密 App Secret（运行时解锁） |
| `VITE_OPENAI_ALLOWED_HOSTS` | LLM host 白名单（同时锁 CSP connect-src） |
| `VITE_LLM_REDACT` | =1 时对送 LLM 的数据做 PII 脱敏 |
| `VITE_LLM_MAX_PAYLOAD_CHARS` | 单次 LLM payload 字符硬上限 |
| `VITE_MAX_TOOL_CALLS` | 每轮工具调用上限（默认 30，clamp 1–100） |
| `VITE_FEISHU_OAUTH_SCOPE` | OAuth scope（空格分隔；`offline_access` 始终请求） |
| `VITE_ALLOWED_CIDRS` | 网段白名单（CIDR，不匹配则锁定扩展） |
| `VITE_NO_REMOTE_CODE` | =1 时去掉 `unsafe-eval`，仅渲染声明式 VizSpec |
| `VITE_WEBSTORE` | =1 时 strip manifest `key`，适用商店分发 |
| `VITE_STORE_NAME` / `VITE_STORE_DESC` | 商店构建的名称/摘要 |
| `VITE_CLIP_ENABLED` | **配置残留，功能已删除**（网页剪藏已移除，留空即可） |

---

## 开发指引

> **路径别名**：全项目使用 `@/` 前缀映射 `src/`（如 `@/shared/ai/tools/base`）。

### 调试 UI（无需加载扩展）

```bash
npm run dev:ui
# 打开 http://localhost:5173/dev.html
# 浏览器控制台可用 scenarios.base() / scenarios.nonBase() 切换场景
```

### 调试扩展

```bash
npm run dev:ext
# 在 chrome://extensions 加载 dist/，代码变更自动重载
```

### 修改 Agent 工具

- 新增工具：在 `tools/` 对应分组文件（`core` / `base` / `sheet` / `doc` / `board` / `compose` / `knowledge`）中添加定义，并在 `tools/index.ts` 的 barrel export 中注册 + `agent-executor.ts` `executeTool()` 添加 case。
- 破坏性工具：description 加 `[破坏性]` 前缀，并加入 `DESTRUCTIVE_TOOLS` Set。
- 所有 ID 参数命名为 `app_token` / `table_id` / `field_id` / `record_id` 以触发 `sanitizeToken` 自动校验。

### 测试

```bash
npm run typecheck    # tsc --noEmit（构建用 esbuild 不做类型检查，类型回归靠这步兜底）
npm run test         # vitest run — 覆盖纯安全逻辑 + 各模块单测
```

当前状态：**837 passed / 31 skipped / 4 failed（2 个文件）**。

实跑集成测试（打真实飞书 API，默认跳过）：
- `feishu/live.test.ts` — 经 `executeTool` 跑 create_table / update_field 回填 / delete_table / 批量记录读写
- 需应用开通 `bitable:app`，凭证读自 `feishu-app-config.txt`
- 运行：`FEISHU_LIVE=1 npx vitest run src/shared/feishu/live.test.ts`
- 自检权限：`node scripts/check-perm.mjs`

Agent 端到端 harness（DeepSeek + 飞书 API，默认跳过）：
- `harness/` — 用自然语言驱动 `runAgent`，覆盖 Base/Sheet/Doc/Compose 各域的真实工具链
- LLM 配置读自 `deepseek-v4-pro.txt`，模型默认 `deepseek-v4-pro`，可用 `LLM_MODEL` 覆盖
- 运行：`REPLICATE_LIVE=1 npx vitest run src/harness/replicate.test.ts`
