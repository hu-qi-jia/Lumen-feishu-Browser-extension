# 安全审计 — Lumen 飞书文档agent

> 面向 **10 万人企业内部部署** 的上线前审计。本扩展为 Chrome MV3 侧边栏，用自然语言
> 经 OpenAI 兼容大模型驱动飞书多维表格 / 电子表格 / 文档 / 看板操作，可接入 Obsidian
> 本地知识库。
>
> **威胁模型核心**：大模型是不可信执行体。用户输入、表格/文档内容、模型输出都可能被
> 注入（prompt injection）。任何「模型说要调的 API」都必须先过本地白名单与确认门，
> 不能让一段恶意单元格内容把用户身份借去删库、转移所有权、读通讯录。
>
> 定位以「文件 + 函数」为准，行号会随改动漂移。架构与各模块职责见
> [ARCHITECTURE.md](./ARCHITECTURE.md)，开发与构建细节见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

---

## 一、核心安全模型：AI 始终以「用户本人身份」行事

这是凌驾于具体功能之上的根本安全模型，由三条原则组成：

- **P1 创建归属用户**：AI 创建的任何文档/表格/电子表格/看板都归属**用户本人**，绝不挂在应用（tenant）账户下。
- **P2 文件级删除一律拒绝**：AI **绝不**删除整张表 / 整个电子表格 / 整篇文档 / 整个云文件。
  删除整体资源必须是用户**自己在飞书里的手动行为**。内容级删除（行 / 字段 / 内容块 / 去重）
  仍允许，但需用户确认。
- **P3 权限不超过用户**：对**非用户本人的文档**，AI 的操作权限**以用户权限为准**——用户读不了
  的文档，AI 也读不了。

**实现**：`src/shared/feishu/auth.ts` 的 `resolveToken()` 只返回 `user_access_token`
（存储时经机制 4 加密，到期前透明续期并轮换 refresh_token），**彻底不再使用 tenant/app 身份**作为操作身份
——tenant 携带全部 app 权限、可触达用户无权访问的文档，正是 P3 要堵的越权面。`runToolWithFallback`
移除了向 tenant 升级的回退，权限错误直接如实上报「你的账号没有该文档权限」，绝不绕路。

**影响**：AI 要求用户先 OAuth 授权才能操作文档；未授权即明确提示授权，不再用应用身份「开箱即用」。
这是 P1/P3 的必然代价，也是 10 万人场景应有的安全姿态。

---

## 二、当前安全机制

### 1. 文件级删除硬拒
- **位置**：`src/shared/ai/agent-security.ts` → `isFileLevelDelete()`
- **行为**：`delete_table` / `delete_sheet` 一律拒绝；`feishu_api_call` 的 `DELETE` 方法、
  以及 POST `move_to_trash` 同样按文件级硬拒。**即便 `autoConfirm=true` 也不放行**
  （见机制 10）。内容级删除走确认门，不在此列。
- **测试**：`agent.test.ts` 的 `isFileLevelDelete` 用例。

### 2. 通用 API 白名单
- **位置**：`src/shared/ai/agent-security.ts` → `assertApiCallAllowed()` + `API_ALLOWED_PREFIXES`
- **行为**：`feishu_api_call` 工具的路径默认拒绝，仅放行 `bitable/sheets/docx/doc/wiki/board/drive`
  受限子路径；拒绝路径穿越 `[@\\]|\.\.|\/\//`；`API_BLOCKED` 硬阻断
  `transfer_owner` / `/permissions/` / `/im/` / `/contact/` / `/admin/`。
- **测试**：`agent.test.ts` 4 组安全门用例（白名单放行、阻断词拦截、穿越拦截、写操作进确认）。

### 3. 出站守卫
- **位置**：`src/shared/config.ts` → `isFeishuOutboundAllowed()` / `isObsidianOutboundAllowed()`；
  `src/shared/feishu/http.ts` → `feishuFetch` / `feishuUpload`
- **行为**：飞书组只允许指向配置基域（`feishu.cn`）的子域；Obsidian 组仅 loopback
 （`127.0.0.1` / `localhost`，且 origin 必须与用户配置的 `obsidianBaseUrl` 精确相等）。
  所有飞书出站请求必须经过 `feishuReq` / `feishuFetch`，**包括 token 续期端点**——
  没有任何绕过守卫的直连 `fetch`。Obsidian 走独立的 `obsidianFetch`，绝不复用 `feishuFetch`
  （其域守卫会拒 loopback）。
- **测试**：`config.test.ts`、`obsidian/http.test.ts`。

### 4. 凭据加密
- **位置**：`src/shared/crypto.ts`
- **行为**：`chrome.storage` 内的 token / secret 一律 AES-256-GCM 加密。密钥由
  `PBKDF2(chrome.runtime.id + ":" + deviceSeed, SALT, 100k, SHA-256)` 派生——
  `chrome.runtime.id` 绑定扩展，`deviceSeed` 是安装时一次性生成的 32 字节随机值，
  使派生密钥在扩展 ID 公开的情况下仍每设备唯一。`decryptField` 对损坏/非 base64 值
  返回空串不抛，保留 v1 legacy key 自动迁移。
- **威胁模型诚实声明**：`deviceSeed` 与密文同存于 `chrome.storage.local`，**不是**对本地
  恶意软件 / profile dump 的防护（此类攻击者能恢复 seed 解密）。它防御的是：随意查看、
  其他无 storage 权限的扩展/源、以及把 token 明文外发。对 App Secret 另有密码加密
  （见机制 9）。不要过度宣称「加密静态存储」。
- **测试**：`crypto.test.ts`（加解密往返、随机 IV、损坏不崩、legacy 迁移）。

### 5. CIDR 门
- **位置**：`src/shared/network.ts` → `ipInCidr()` / `checkNetworkAccess()`；
  `src/shared/config.ts` → `HAS_NETWORK_RESTRICTION`
- **行为**：构建时 `VITE_ALLOWED_CIDRS` 配置逗号分隔的 CIDR 列表。配置非空时，扩展启动
  通过 WebRTC ICE 候选探测本机 IP，若无一落在允许 CIDR 内则**锁定扩展**（部署到非企业
  网络的拷贝无法运行）。留空则不限制。
- **测试**：`network.test.ts`。

### 6. LLM host 白名单
- **位置**：`src/shared/providers.ts` → `assertSafeBaseUrl()`；
  `src/shared/config.ts` → `openaiAllowedHosts`；`vite.config.ts`（CSP 注入）
- **行为**：每次向 LLM 发请求前校验 base URL——拒绝空/不可解析 URL；强制 `https://`
  （仅 localhost 允许 http 供本地 harness）；构建时 `VITE_OPENAI_ALLOWED_HOSTS` 设了则
  只准发往这些 host（含子域），管理员可钉死端点；不设则任意 https host 放行，保留
  「自定义 OpenAI 兼容端点」功能。置后端时 CSP `connect-src` 也精确锁定到这些 host。
- **测试**：`providers.test.ts`（https 强制、localhost 例外、归一化、有/无白名单）。

### 7. PII 脱敏
- **位置**：`src/shared/ai/redact.ts`
- **行为**：
  - `redactPII`：**无条件执行**，剥离邮箱 / CN 手机 / 18 位身份证（用于隐私承诺无条件的
    外发路径，如共享技能库 payload）。
  - `redactSensitive`：受 `VITE_LLM_REDACT` 控制，开启后才对发往 LLM 的工具结果脱敏。
  - `sanitizeForLlm`：先 `capPayload`（按 `VITE_LLM_MAX_PAYLOAD_CHARS` 截断）再脱敏，
    用于模型只需读取、不必逐字回显的上下文（viz / report / slides）。
  - `truncateToolResult`：单条工具结果上限 8000 字符，防止批量 PII 外发。
- **注意**：脱敏只影响发给模型的副本，源飞书数据与回写值仍用真实值。
- **测试**：`redact.test.ts`、`redact-unconditional.test.ts`。

### 8. 沙箱隔离
- **位置**：`src/sandbox/main.ts`；`vite.config.ts`（`sandboxCsp`）；
  `src/content/dataviz/viz-overlay.ts`（浮窗 iframe）
- **行为**：LLM 生成的渲染代码只在 MV3 `sandbox` 页里跑——**null/opaque 源**（无 `chrome.*`、
  拿不到 token/storage）、与飞书页 DOM 跨源隔离。CSP 承重指令 **`connect-src 'none'`**：
  无任何网络出口（fetch/XHR/WebSocket/beacon 全断）；`img-src` 不放行远程图（堵 `<img src=远程>`
  旁路）。承载 iframe 属性 **`sandbox="allow-scripts allow-modals"`**——`allow-modals` 仅为让
  「可打印报表」能 `window.print()`；**刻意不给 `allow-same-origin`**（给了就有真实源、能碰
  storage/同源资源，null 源隔离即失效）。隔离靠 null 源，不靠 `script-src`。
- **无远程代码模式**：`VITE_NO_REMOTE_CODE=1` 时去掉 `unsafe-eval`，沙箱仅渲染声明式 `VizSpec`
  （由内置 interpreter 解释，无 `new Function`）；此时可诚实回答「无远程代码」。
- **测试**：`dataviz.test.ts`（codegen 解析 / 拒禁用调用 / 非 JSON）、`dataviz/store.test.ts`。

### 9. App Secret 密码加密
- **位置**：`src/shared/feishu/appSecret.ts`；`scripts/encrypt-secret.mjs`
- **行为**：构建时用 `scripts/encrypt-secret.mjs`（PBKDF2 210k iters → AES-GCM-256）把 App
  Secret 变成密文，注入 `VITE_FEISHU_APP_SECRET_ENC`，**明文 secret 不进包**。运行时用户在
  「设置」输入密码解锁（GCM auth tag 校验密码对错），解锁后设备加密缓存（机制 4），refresh
  可跨会话用。
- **分层**：个人版允许明文 `VITE_FEISHU_APP_SECRET`（向后兼容）；企业版要求加密（`appSecretEnc`）
  或走代理。拿到公开 .crx 也只能拿到密文 + KDF 参数，需离线暴力破解密码。强密码是关键。
- **测试**：`appSecret.test.ts`（密码往返、错误密码 GCM 失败、损坏密文）。

### 10. 删除自动确认（fail-closed）
- **位置**：`src/sidepanel/components/settings/GeneralTab.tsx`；
  `src/shared/ai/agent-security.ts` → `DESTRUCTIVE_TOOLS` / `WRITE_TOOLS`
- **行为**：`autoConfirm` 默认 **false**（fail-closed）——内容级删除（`delete_record` /
  `batch_delete_records` / `delete_field` / `delete_dimension` / `delete_document_blocks` /
  `dedupe_records`）及批量写（`update_where` / `cross_table_lookup` / `smart_fill_apply`）
  默认弹确认卡。用户在「设置 → 通用 → 操作确认」开启后跳过确认。**即便开启，
  `FILE_LEVEL_DELETE_TOOLS` 仍硬拒**（机制 1），不可绕过。

### 11. 写操作不重试
- **位置**：`src/shared/feishu/http.ts` → `robustFetch()`
- **行为**：`robustFetch` 对写方法（POST/PUT/PATCH/DELETE）**绝不重试**——超时的创建可能已
  成功，重试会重复（如建两张表）；仅 GET 重试 3 次。`feishuUpload` 同样不重试。唯一的写路径
  重试例外见机制 12（私有部署 404 版本降级）。
- **测试**：`http.test.ts`（写不重试、GET 重试、超时 signal 接线）。

### 12. 私有部署 API 版本降级
- **位置**：`src/shared/feishu/api.ts` → `req()`（经 `feishuFetch`）
- **行为**：私有部署实例可能落后于 SaaS 的 API 版本。遇到 404 时自动从 `/<svc>/vN/`
  降级到更低版本（直至 `v1`）重试，使滞后实例仍可调用。降级仅对只读探活场景安全，
  不影响写操作的不重试原则。

### 13. 内部 transfer_owner（安全分层）
- **位置**：`src/shared/ai/agent-executor.ts` → `maybeTransfer()`；
  `src/shared/feishu/api.ts` → `transferBaseOwner()`
- **行为**：用户可见的 `feishu_api_call` 工具中 `/transfer_owner/` 被 `API_BLOCKED` 硬拒
  （机制 2），模型无法借注入转走所有权。但**内部** `maybeTransfer` 在新建资源
  （`create_spreadsheet` / `create_document` / `create_doc_from_markdown` / `create_whiteboard` /
  `base_table_to_sheet` / `summarize_table` / `base_to_doc_report` 等）成功后，**仅当用户
  在设置里配置了 `feishuOwnerOpenId`** 时，自动调用 `transferBaseOwner` 把新建资源转给
  **用户本人**——满足 P1（创建归属用户）。这是安全分层：模型触不到，只有用户显式配置才启用，
  且只转给用户自己。失败不抛（资源仍保留，只是挂在应用下）。
- **测试**：`harness/transfer.test.ts`。

### 14. 撤销机制
- **位置**：`src/shared/feishu/undo.ts`
- **行为**：删除前 CAPTURE 数据，删除成功后追加一条 op 到当前撤销 BATCH；用户一键「撤销」
  按逆序回放整批。覆盖两类：`records`（多维表记录 → `batch_create` 重建）、`sheetRows`
  （电子表格行 → 按原索引重新插入并写回值）。`UNDO_TTL_MS = 10 min`（超时不再提示撤销），
  `BATCH_WINDOW_MS = 2 min`（窗口内连续删除合并为一批）。回放检查点化：每个 op 成功即从
  存储批次中剔除，重试不会重复已恢复项。文件级删除（表/电子表格/文档）与文档块删除**不覆盖**
  （文档走版本历史）。
- **测试**：`undo.test.ts`。

---

## 三、manifest 权限与 CSP

### manifest.json 实际权限
```json
"permissions": ["sidePanel","storage","activeTab","identity","scripting","unlimitedStorage","alarms","declarativeNetRequestWithHostAccess"],
"host_permissions": ["https://*.feishu.cn/*","https://github.com/*","https://weibo.com/*","https://*.weibo.com/*","https://edge.microsoft.com/*","https://api-edge.cognitive.microsofttranslator.com/*","http://127.0.0.1:*/*","http://localhost:*/*"]
```

**注意：无 `contextMenus` 权限**，也无 `<all_urls>`。`activeTab` 仅在用户手势后授予当前一个
标签页的临时访问；`scripting` 用于注入内容脚本；`declarativeNetRequestWithHostAccess` 仅为
新闻源 referer 规则集（`rules/news_referer.json`）。`http://127.0.0.1:*` / `http://localhost:*`
仅为 Obsidian 本地集成开的 loopback 口子。

### CSP（`vite.config.ts` 注入，覆盖 manifest 源 CSP）
- **extension_pages**：
  `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' https://*.feishu.cn http://127.0.0.1:* http://localhost:* https:`
  - `script-src 'self'`：禁内联/eval 脚本。
  - `connect-src`：禁 http/ws 等非 https 外联（飞书 + loopback 例外），保留「自定义 https 模型端点」。
  - `style-src 'unsafe-inline'`：React 内联样式所需。
- **sandbox**：
  `sandbox allow-scripts allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'none'; child-src 'none'; frame-src 'none'; connect-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'none'`
  - `connect-src 'none'` 是承重指令：沙箱无任何网络出口。
  - `unsafe-eval` 仅为 `new Function` / ECharts 所需；`VITE_NO_REMOTE_CODE=1` 时去掉（机制 8）。
  - 隔离靠 null 源（iframe 无 `allow-same-origin`），不靠 `script-src`。

---

## 四、凭据与仓库卫生
- `.env.local`、`*token*.txt`、`feishu-app-config.txt`、`deepseek-*.txt`、`extension-key.pem`
  全部 gitignore，从不入库。
- storage 内 token/secret 经 `crypto.ts` AES-256-GCM 加密（机制 4）；App Secret 走密码加密
  （机制 9）。
- 商店构建（`VITE_WEBSTORE=1`）强制清空 baked 凭据，用户在设置里自带 App ID/Secret（BYO）。
- 隐私声明见 [PRIVACY.md](../PRIVACY.md)。

---

## 五、交叉引用
- 架构与模块职责：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 开发与构建（含 `VITE_*` 开关说明）：[DEVELOPMENT.md](./DEVELOPMENT.md)
- 用户使用指南：[USER_GUIDE.md](./USER_GUIDE.md)
- 常见问题：[FAQ.md](./FAQ.md)
- 快速上手：[QUICKSTART.md](./QUICKSTART.md)
- 隐私声明：[PRIVACY.md](../PRIVACY.md)
