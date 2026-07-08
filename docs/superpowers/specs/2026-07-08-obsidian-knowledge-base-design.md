# Obsidian 知识库接入 — 设计文档

- 日期：2026-07-08
- 状态：草案（待用户评审）
- 关联：飞书 AI 助手浏览器扩展（MV3 / React / 无后端）

## 1. 背景与目标

把 Obsidian 作为**个人知识库**接入飞书 AI 助手扩展。Obsidian 本身是本地优先应用、官方无云 API，外部访问只能通过第三方插件。本方案用事实标准插件 [`obsidian-local-rest-api`](https://github.com/coddingtonbear/obsidian-local-rest-api) 暴露的本地 REST/MCP 接口。

两个呈现面：

1. **App Hub「知识库」页**：接入引导 + 内容列表浏览 + 笔记 CRUD/管理。
2. **chat 输入框「工具」入口里的「知识库」**：会话级开关，开启后 agent 自动具备对 vault 的检索/读写能力；chat 也支持用自然语言对知识库增删改查。

## 2. v1 范围

**做**：

- 接入引导（装插件 → 开 HTTP → 填 key → 测试连接）。
- 连接状态管理（在线/离线探测）。
- App Hub：搜索优先的内容列表 + 最近 + 笔记详情（读/编辑/新建/删除/重命名）。
- chat KB 模式：会话级开关；agent 工具 = 检索 + 读 + 写（写经确认门）。
- KB 行为策略：写入决策树、分层检索、属性/标签约定、自动建链、边界与降级。

**不做（v1.5+）**：

- rename/move 的反链自动重写（v1 降级为管理操作）。
- 向量/embedding 检索（契合「cheapest viable、不付费不 Python」）。
- 图片/二进制附件上传。
- 批量操作、完整目录树浏览器、标签聚合页。
- Obsidian 专有语法（callout/Dataview/`![[embed]]`）的完整渲染。

## 3. 总体方案

`obsidian-local-rest-api` 插件 + **HTTP 端点 `http://127.0.0.1:27123`**（不走 HTTPS，见 §4.2）+ **从侧栏进程发请求**（agent 的工具派发本就在侧栏进程内执行，与现有飞书调用同处一处；不需要走 service worker 消息转发）。

### 关键 API（来自插件 README）

| 操作 | 端点 |
|---|---|
| 探活/鉴权 | `GET /` |
| 列目录 | `GET /vault/{folder}/` |
| 读笔记 | `GET /vault/{path}` |
| 读某节 | `GET /vault/{path}/heading/{name}` |
| 整篇写/新建 | `PUT /vault/{path}` |
| 段级改（append/prepend/replace） | `PATCH /vault/{path}` + `Operation`/`Target-Type`/`Target` 头 |
| 删除 | `DELETE /vault/{path}` |
| 全文搜索（Obsidian 原生） | `POST /search/simple/?query=` |
| 结构化搜索（JsonLogic，按 frontmatter/tags/path/mtime） | `POST /search/` |
| 列标签 | `GET /tags/` |
| 在 Obsidian 打开 | `POST /open/{path}` |

> 注意：**无原生 move 端点**。重命名/移动只能 `PUT` 新路径 + `DELETE` 旧路径——这是纯文件操作，**Obsidian 的「重命名自动更新反链」不会触发**（见 §8.4）。

## 4. 连接与出站（安全边界）

现状：出站硬锁两组——飞书（`feishuFetch` + `isFeishuOutboundAllowed`）、LLM（`assertSafeBaseUrl`）。CLAUDE.md 约束 #4 + `SECURITY_AUDIT.md` 明确只有这两组。Obsidian 是**第三组**，严格隔离。

### 4.1 守卫与 fetch helper

- 新增 `src/shared/obsidian/http.ts`：
  - `obsidianFetch(url, opts, settings)`：解析 token → **先 `isObsidianOutboundAllowed(url, settings)` 守卫、再 fetch** → 带 `Authorization: Bearer <token>`。GET 带 `robustFetch` 式超时+重试；写操作不重试。**不复用 `feishuFetch`**（其域校验会拒）。
  - `resolveObsidianToken(settings)`：解密 token，缺失则抛「请到知识库页接入 Obsidian」（照抄 `feishu/auth.ts:resolveToken` 形态）。
- 新增守卫 `isObsidianOutboundAllowed(url, settings)`（放 `src/shared/config.ts`，挨着 `isFeishuOutboundAllowed`）：URL host:port 必须**精确等于**用户配的 `obsidianBaseUrl`；且该 host 必须是 loopback/私网——**复用现有 `src/shared/network.ts` 的 CIDR 允许名单**校验。v1 只允许 loopback，因此这条链路物理上漏不到公网。

### 4.2 CSP 与 host_permissions（容易踩的坑）

现状 CSP `connect-src 'self' https:` **只允许 https，会把 `http://127.0.0.1:27123` 直接拦掉**（侧栏页与 service worker 都受 CSP 约束，绕不过）。HTTPS（27124）走不通：插件用自签名证书，Chrome 119+ 对 localhost 自签名证书直接拦截且 UI 无法加例外，扩展也没有跳过 TLS 校验的 API。结论：**走 HTTP（27123），CSP 和 host_permissions 一起改**：

- `manifest.json` → `host_permissions` 追加：`http://127.0.0.1:*/*`、`http://localhost:*/*`（覆盖默认端口 27123 + 自定义端口）。
- `manifest.json` → CSP `connect-src` 追加：`http://127.0.0.1:* http://localhost:*`。
- 商店审核：这是「为本地集成开的、仅 loopback 的口子」，在更新后的 `SECURITY_AUDIT.md` 写清理由。

### 4.3 加密存储

- `AppSettings`（`src/shared/types.ts`）新增字段：
  - `obsidianBaseUrl?: string`（默认 `http://127.0.0.1:27123`）
  - `obsidianTokenEncrypted?: string`（走 `src/shared/crypto.ts:encryptField`，AES-256-GCM，与飞书 token 同级加密）
  - `obsidianInboxPath?: string`（新笔记默认落点，默认 vault 根或 `Inbox/`）
  - `obsidianExcludePaths?: string`（检索排除路径，逗号分隔 glob，见 §7.2）
  - `obsidianVaultName?: string`（展示用）
- `kbEnabled` 存 **session**（`src/sidepanel/sessions/`），不存 AppSettings（按会话走）。
- 开关 `HAS_KNOWLEDGE_BASE`（`src/shared/config.ts`，`VITE_*` + 派生，商店构建可关，本构建默认开）。

### 4.4 第 0 步：连接冒烟测试（先排雷）

PNA（Private Network Access）是唯一不确定项。实现第一步是最小 spike：加好 host_permissions + CSP + 最小 `obsidianFetch`，**从侧栏进程打 `GET http://127.0.0.1:27123/`**。通了 → 直接按本架构做；被 PNA 拦 → 把 Obsidian 调用改成 service worker 消息转发（兜底方案，文档里保留）。

### 4.5 安全文档更新

CLAUDE.md 约束 #4 + `SECURITY_AUDIT.md`：出站从两组改三组（飞书 / LLM / Obsidian-loopback），写清第三组边界（loopback-only + bearer + CIDR 校验 + token 加密）。

## 5. App Hub「知识库」页

新增 `src/sidepanel/components/obsidian/ObsidianHubPanel.tsx`；App Hub（`ScenarioPanel.tsx:143-160` 的 `groups`）加一张「知识库」`<HubCard>`，路由到该面板。接入引导 + 改连接都收在这个面板内（未连接=引导卡；已连接=齿轮重开连接表单），**v1 不另设 Settings tab**，符合「应用 hub 里做接入」的心智与「只留对话做不到的」原则。

UI 约束（项目规范）：纯 CSS、语义 class + `App.css` `--color-*` 变量；**禁用 emoji**；工具/导航按钮用飞书风 SVG 图标；创建型 CTA（如「新建笔记」）**不放图标**。

### 5.1 两态

**① 未连接 → 引导接入（清单式）**

```
┌─ 把 Obsidian 接入知识库 ──────────────┐
│ 一句话：你的 Obsidian 仓库，可被助手  │
│ 检索 / 读写。                          │
├──────────────────────────────────────┤
│ ① 装 Local REST API 社区插件   [链接] │
│ ② 设置→Local REST API→开启HTTP [?]   │
│ ③ 复制 API Key                  [?]   │
│ ④ Key:[______] 端点:127.0.0.1:27123  │
│            [测试连接]                  │
└──────────────────────────────────────┘
```

每步带复制按钮 + 内联 `[?]`：讲清「扩展无法信任自签名证书→走 HTTP，流量只在 localhost、token 仍加密存」+「检索到的笔记内容会发往你配置的 LLM」（隐私知情同意）。测试连接 = `GET /`。

**② 已连接 → 管理界面**

```
┌──────────────────────────────────────┐
│ ●已连 我的仓库          [设置] [⋮]    │  ← ●绿=在线；灰=Obsidian 未运行
├──────────────────────────────────────┤
│ [搜索] 搜索笔记…             Ctrl+K   │  ← 主入口 POST /search/simple/
├──────────────────────────────────────┤
│  最近  |  全部(目录)  |  标签         │  ← 分段；默认「最近」
├──────────────────────────────────────┤
│  笔记标题                              │
│  Folder/子目录 · 2小时前 · #tag        │
│  ─────────────────────                 │
│  …                                     │
├──────────────────────────────────────┤
│            新建笔记                    │
└──────────────────────────────────────┘
```

设计判断：**内容列表走「搜索优先（快速切换器）」范式**——vault 笔记多、侧栏窄、Obsidian 用户习惯 `Ctrl+O`。搜索当主入口，最近/目录/标签当辅助。chat 那边 KB 模式已自动检索，本页主要承担浏览+管理。

**v1 tab 范围**：搜索 + 最近（两个主 tab，覆盖 ~90%「找笔记」）；目录树、标签聚合 tab 留 v1.5（见 §2、§11）。

- **最近**：`POST /search/`（JsonLogic 按 `file.mtime` 倒序，limit 20）。
- **笔记行**：标题 + 面包屑路径 + mtime + tags。
- **Ctrl+K** 快捷键聚焦搜索。

### 5.2 笔记详情

点开一篇 → 详情面板：

- 顶部：面包屑路径 + 工具型操作（删除，带 SVG 图标）+ 编辑/保存切换。**重命名/移动在 v1 不做**（见 §7.4，避免反链断裂；要改名直接在 Obsidian 里改）。
- 正文：Markdown 阅读 ⇄ 源码编辑。v1 基础渲染；`[[wiki链接]]`、callout、Dataview 等 Obsidian 专有语法可能显示原文（标注给用户）。
- 段级编辑优先用 `PATCH`（只动一节）；整篇改用 `PUT`。

## 6. chat KB 模式（交互 A：会话级开关）

现状：`InputBar.tsx:297-329` 的「工具」按钮其实是企业版 **Skills 菜单**（往输入框塞提示词、不改 agent 行为），store 构建禁用。改造为**「能力弹层」**：

- 工具图标 → 弹层里有「知识库」开关项（用户原话「选项放在那里面」）。开启后：图标激活态、输入框挂「知识库 已启用」标记。
- 开启语义（A）：**本会话后续每条消息**，agent 自动带 KB 工具，需要时检索/读写 vault。再点关闭则收回。

### 6.1 工具注入（`src/shared/ai/`）

`toolsForContext(kind)`（`agent.ts:260`）在 `session.kbEnabled && 已连接 && HAS_KNOWLEDGE_BASE` 时，追加到 `FEISHU_TOOLS`：

- **读**：`search_knowledge_base(query)` → `/search/simple/`；`read_knowledge_note(path)` → `GET /vault/{path}`。结果走现有 `redactSensitive(truncateToolResult(...))`（`agent.ts:543`，`MAX_TOOL_RESULT_CHARS=8000`）。
- **写（chat 增删改）**：`create_note` / `update_note` / `delete_note` → 走 §7 写入策略；**复用现有 `autoConfirm` 确认门**（写 vault 需用户确认，与飞书写操作一致）。

### 6.2 系统提示

`buildSystemPrompt`（`agent.ts:1601+`）在 KB 模式时追加一段：

> 知识库已启用：用户已连接 Obsidian 仓库。需要时用 `search_knowledge_base` 检索、`read_knowledge_note` 读全文，引用时注明笔记路径。写入遵循「先检索、再提议合并/新建、必确认」；写入需经用户确认。

## 7. KB 行为策略

总原则：**检索优先、写必确认、尽量用 Obsidian 原生机制（frontmatter / wikilink / alias），不另造一套**。

### 7.1 写入策略（决策树 + 合并/拆分）

核心：**写之前永远先检索（search-before-write）**，由检索结果决定「合并还是新建」，且**绝不静默新建/覆盖**。

| 情况 | 动作 |
|---|---|
| 用户指定目标（「加到『项目管理』笔记」） | 定位 → `PATCH` append 到对应 heading 或文末 |
| 检索到**单一强匹配**（主题一致） | 提议合并，走确认门：「找到『X』，追加进去？还是新建？」 |
| 多个弱匹配 / 无匹配 | 询问用户：「没合适的，新建一篇？标题建议『…』，或指定合并到哪篇」 |
| 明显一次性短摘录 | 落到默认 inbox（`obsidianInboxPath`） |

- **合并**：`PATCH`（`Operation: append`，`Target-Type: heading`）——段级 patch，只动一节、不重写全文。**heading 目标必须用全限定路径**（`Parent\Sub`，`\` 分隔），只用叶子名在 H2+ 上会失败；重复标题会命中第一个。**合并前先取文档结构**（`GET` 正文解析标题树，或 `GET /vault/{path}/heading/{name}` 探测）拿到准确标题路径，重复/歧义时改用 block 引用（`Target-Type: block`）定位。详见 §10 的 `vault_patch` 风险。
- **拆分**：读源 → 抽取段落 → `PUT` 新笔记 → `PATCH` 源（把那段替换成 `[[新笔记]]` 链接）→ 新笔记反向链接源。比合并重，需预览+确认。
- **「把这篇文档的 XX 加到知识库」**：「这篇文档」多半是当前飞书文档。agent：抽内容 + 记飞书文档身份 → 检索 vault → 按决策树提议合并/新建 → 给新笔记打 `source: <飞书文档ID/URL>` 属性做溯源 + 自动加 wikilink。飞书与 Obsidian 由此连通。

### 7.2 检索策略（分层 + 性能；含速度纠正）

> **纠正**：最初判断「Obsidian 全文搜索为大 vault 设计」有误。实测与论坛证据：Obsidian **只对 tags/properties 建索引，正文全文搜索未完整索引**，大 vault（1 万+ 篇）全文搜索可能慢到分钟级。因此**检索以 tags/properties（已索引、快）为主轴**。

- **分层检索**：能从 query 识别 tags/properties/folder 时，**先用 JsonLogic `/search/`（元数据索引、快）缩小范围**，再在范围内做全文 `/search/simple/`。无 scope 的全库全文搜索作为兜底，且对大 vault 在接入页提示「优先用标签/属性检索」。
- **结果约束**：cap 结果数 + 走 8000 字截断 + 返回片段而非整篇（少往返、小载荷）。
- **缓存**：UI/agent 懒缓存「标签词表 + 文件夹结构」（`/tags/` + 目录列举），偶尔刷新，避免每次扫全库。
- **排除路径**（受 Smart Connections 启发）：`obsidianExcludePaths`（逗号分隔 glob，如 `Archive/**, Daily/**`），检索与列表都排除；让用户把归档/日记/草稿移出检索面，直接缓解「知识库过多」。
- **v1 不上 embedding/向量**；真要语义检索再考虑 Render API / Dataview / embedding 插件，先 defer。

### 7.3 属性与标签约定（只约束 agent 新建笔记，不强加给已有笔记）

用 Obsidian 原生 frontmatter（YAML），保留一组字段：

| 字段 | 用途 |
|---|---|
| `tags` | 原生；agent 据 query + `/tags/` 现有词表提议，不过度打 |
| `aliases` | 原生；帮搜索用别名命中，且是 §8.4 alias 合并的基础 |
| `source` | 溯源（飞书文档 ID/URL），便于「某飞书文档产生的所有笔记」检索 |
| `type` | concept / reference / inbox 等，便于按类型筛 |

这些让 JsonLogic 能精准过滤，而不是靠全文扫。

### 7.4 链接策略（自动建链 + 断链规避）

- **写入时自动建链**：合并/新建时，把检索命中的候选笔记自动写成 `[[wikilink]]`（它们天然是相关目标），图谱自然生长。
- **读取时沿链扩展**：检索拿到一篇后，可再 `read_note` 跟它的 `[[links]]`，或用 `/search/` 查反链（backlinks）补上下文——一次额外调用换相关性。
- **链接格式**：Obsidian 默认 wikilink `[[笔记名]]`；heading 用 `[[笔记#小节]]`，block 用 `[[笔记#^id]]`。非法字符 `# | ^ : %% [[ ]]` 须从标题剔除。
- **合并的优雅解（alias）**：把 A 并进 B 时，把 A 的名字加进 B 的 `aliases`，原有 `[[A]]` 仍解析到 B——原生机制，不用手动改反链。
- **⚠️ rename/move 断链**：REST 无 move，`PUT`+`DELETE` 是纯文件操作，Obsidian「重命名自动更新反链」不触发 → 反链变失效。v1 **agent 与面板都不做 rename/move**（需改名/移动直接在 Obsidian 里操作——那里的重命名会自动维护反链）；带反链自动重写的 rename/move 留 v1.5。

### 7.5 边界与降级（8 条）

1. **并发编辑冲突**：Obsidian 开着 + agent 同写一篇可能互相覆盖。缓解：写前先 `GET`（读后写）、append 用 `PATCH`；接入页提示「agent 写入时避免同时在 Obsidian 编辑同一篇」。不保证原子。
2. **Obsidian 未运行**：server 挂 → 所有 KB 操作降级，chat 顶部提示「Obsidian 未运行」；状态用 `GET /` 探活。
3. **图片/附件**：`![[image.png]]` 是二进制，v1 检索只取文本、跳过图片；带图新建 defer。
4. **隐私告知**：开 KB 模式后，检索到的笔记内容会发往用户配置的 LLM；接入页明示（知情同意），配合现有 `redactSensitive`。
5. **大笔记**：单篇超 8000 字 → `read_note` 截断；agent 改用段级读 `GET /vault/{path}/heading/{名}`。
6. **文件名安全 + 防 traversal**：agent 生成标题过白名单（剔 `# | ^ : %% [[ ]]` 及 Windows 非法字符）；路径拒绝 `../`。守卫层 + 路径净化双保险。
7. **删除安全**：删除破坏性 → 必确认；优先软删（移到 `_trash/` 或走 Obsidian 回收站）。REST `DELETE` 是否进回收站需验证，验证前一律按「需确认 + 可恢复」。
8. **多 vault 限制**：插件只服务当前打开的 vault；「知识库」= 当前 vault；用户在 Obsidian 切 vault，扩展跟着看到新的（同端口）。接入页注明。

## 8. 模块布局

```
src/shared/obsidian/
  ├── http.ts     # obsidianFetch + isObsidianOutboundAllowed + resolveObsidianToken + 路径净化
  └── api.ts      # searchVault / recentNotes / readNote / readSection / writeNote / patchNote / deleteNote / listTags / listFolder
src/sidepanel/components/obsidian/
  └── ObsidianHubPanel.tsx   # 接入引导 + 内容列表 + 笔记详情（一面板全包）
```

改动点清单：

- `manifest.json`：`host_permissions` + CSP（§4.2）。
- `src/shared/config.ts`：`isObsidianOutboundAllowed` + `HAS_KNOWLEDGE_BASE` + `BUILD_CONFIG`。
- `src/shared/types.ts`：`AppSettings` 扩展（§4.3）。
- `src/shared/ai/tools.ts`：新增 5 个 KB 工具定义。
- `src/shared/ai/agent.ts`：`toolsForContext` 注入、`executeTool` 分支、`buildSystemPrompt` KB 段。
- `src/sidepanel/components/InputBar.tsx`：工具图标改「能力弹层」+ KB 开关。
- `src/sidepanel/sessions/`：session 增 `kbEnabled`。
- `src/sidepanel/components/ScenarioPanel.tsx`：Hub 加「知识库」卡 + 路由。
- `CLAUDE.md` / `SECURITY_AUDIT.md`：第三出站组（§4.5）。

## 9. 安全与隐私

- loopback-only 守卫 + `network.ts` CIDR 校验 → 第三链路物理上不达公网。
- token 经 `crypto.ts` AES-256-GCM 加密存（与飞书 token 同级）。
- 笔记内容→LLM 在接入页明示；工具结果经 `redactSensitive` + 截断。

## 10. 待验证 / 风险

| 项 | 处置 |
|---|---|
| PNA 是否拦截侧栏→localhost | §4.4 冒烟测试先做 |
| REST `DELETE` 是否进 Obsidian 回收站 | 验证前按「确认 + 可恢复」 |
| rename/move 的反链重写 | v1.5 |
| 大 vault 全文搜索速度 | §7.2 分层 + 排除路径缓解 |
| `vault_patch`（markdown-patch）边界 | 重复标题命中第一个、代码块内 `#` 可能被误判为标题边界（[Issue #10](https://github.com/coddingtonbear/markdown-patch/issues/10)）、叶子标题名在 H2+ 失败须全限定路径 → 合并前取文档结构定准目标，歧义改用 block 引用，高风险 patch 读回校验 |
| 插件 `vault_move`（MCP）是否触发链接重写 | 仅文档，v1 不走 MCP |

## 11. 未决 / v1.5+

rename/move 反链自动重写 · 向量检索 · 图片/附件 · 批量操作 · 目录树/标签聚合页 · Obsidian 专有语法完整渲染 · Obsidian 模板集成。

---

> 注：开源调研（AI↔Obsidian 项目 CRUD/合并/互链/检索模式）仍在后台进行，结论到位后会并入 §7 与本节，当前版本基于官方文档 + REST API + 源码级子调研（Smart Connections 索引/排除机制）自洽成稿。
