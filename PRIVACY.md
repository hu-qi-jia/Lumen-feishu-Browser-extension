# 隐私政策

_最后更新：2026-07-15_

---

**Lumen — 飞书文档agent**（以下简称"本扩展"）是一个开源、**无自有后端**的 Chrome 扩展。作者**不收集、不存储、不传输**你的任何数据。

### 1. 我们收集什么

**不收集任何数据。** 本扩展没有作者运营的服务器，不做统计/埋点/广告/追踪，不会把你的任何信息发送给作者或第三方分析服务。

### 2. 数据存在哪

以下内容**仅保存在你本机**的浏览器存储（`chrome.storage.local`），**加密存储**，从不上传：

- 你的飞书 **App ID / App Secret**（App Secret 经设备密钥加密）；
- 飞书 **user_access_token / refresh_token**（OAuth 登录凭据，加密）；
- 你的**大模型 API Key**（加密）；
- Obsidian Local REST API 的 API Key（加密）；
- 你的设置、已保存的看板/演示、会话历史等本地数据。

卸载扩展或在设置中清除，即彻底删除上述数据。

### 3. 数据发往何处（均由你发起）

本扩展运行时只在你**主动发起操作**时产生出站请求：

1. **飞书开放平台 API**（`*.feishu.cn`）：以**你本人的身份**（user_access_token）读写你授权的多维表格/文档/电子表格——即你让助手做的操作。本扩展**只用你本人身份**，绝不使用应用/租户身份越权。
2. **你自己配置的大模型服务**（如 DeepSeek、OpenAI 兼容接口）：为完成你发起的任务，发送**必要的、有字符上限的**内容给**你自己填写的**模型服务。模型地址、密钥都由你配置，本扩展不代选、不中转。
3. **Obsidian Local REST API**（仅 `127.0.0.1` / `localhost`）：当你启用知识库功能时，连接你本机运行的 Obsidian 插件，只读检索笔记。物理上无法访问公网。
4. **GitHub / 微博 / 翻译服务**：资讯标签聚合 GitHub Trending 和微博热搜，标题可经 Bing 或你配置的大模型翻译。这些请求由 `chrome.alarms` 定时触发，不携带你的飞书或模型凭据。

本扩展**不会**把数据发给作者或任何第三方分析/广告服务。

### 4. 权限说明

| 权限 | 用途 |
|---|---|
| `identity` | 走飞书 OAuth，获取**你本人的** user_access_token |
| `storage` | 本机加密保存凭据与设置 |
| `unlimitedStorage` | 会话历史可能较大，允许超过浏览器默认配额 |
| `activeTab` / `scripting` / `content_scripts` | 在飞书页面注入侧边栏与读取当前页面上下文 |
| `host_permissions: *.feishu.cn` | 调用飞书 API |
| `host_permissions: github.com / weibo.com / edge.microsoft.com / api-edge.cognitive.microsofttranslator.com` | 资讯聚合与翻译 |
| `host_permissions: 127.0.0.1 / localhost` | 连接本机 Obsidian REST API |
| `alarms` | 资讯定时抓取 |
| `declarativeNetRequestWithHostAccess` | 微博请求注入 Referer 绕过反爬 |
| `sidePanel` | 提供侧边栏界面 |

### 5. AI 生成代码的隔离

助手生成的可视化代码在**隔离沙箱**（opaque origin）中运行，且沙箱 **无任何网络出站权限**（`connect-src 'none'`）——生成的代码即便想外发数据也发不出去。启用 `VITE_NO_REMOTE_CODE` 构建时，沙箱进一步去掉 `unsafe-eval`，仅渲染声明式规格，可诚实回答"无远端代码"。

### 6. 儿童

本扩展面向职场办公用户，不面向 13 岁以下儿童。

### 7. 变更与联系

政策更新会修改本文件顶部日期。问题请在仓库提交 issue：
https://github.com/scott987-cmd/feishu-doc-ai-assistant/issues
