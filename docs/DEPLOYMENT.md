> 🌐 [English](DEPLOYMENT.en.md) | **中文**

# 部署指南 · 快速上手（个人 / 商店）

> 一页选好你的路 → 照抄命令 → 跑起来。深入细节链到对应文档：
> 安全模型 [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) · 使用手册 [`USER_GUIDE.md`](USER_GUIDE.md)

---

## 0. 选路（30 秒）

| 你是… | 推荐模式 | App Secret 在哪 | 跳到 |
|---|---|---|---|
| **个人 / 想最省事** | 纯 user-token（不内置凭据） | 没有 secret | [§2-A](#a-纯-user-token零内置最安全最省事) |
| **个人 / 小团队** | 直连·密码加密 | 加密进包，密码解锁 | [§2-B](#b-直连密码加密个人加固) |

> 两种模式的唯一区别就是 **App Secret 怎么处理**；其余构建/打包/飞书配套完全一样。

**所有模式的两个共同前提：**
1. **大模型 Key**：每个用户在扩展「⚙️设置」里自填（OpenAI 兼容，默认 DeepSeek）——**不是构建变量**。
2. **飞书后台一次性配套**：见 [§4](#4-飞书后台一次性配套开放平台--你的应用)（可用范围 / 重定向 URL / 权限 scope）。

---

## 1. 准备（所有模式通用）

```bash
git clone <repo> && cd feishu-ai-assistant
npm install
cp .env.example .env.local          # 已被 .gitignore；下面各模式只改其中几行
```
构建产物始终是 `dist/`，三种打包方式见 [§3](#3-打包方式)。

---

## 2. 个人部署

### A. 纯 user-token（零内置·最安全·最省事）
**不在包里放任何凭据**，用户在「设置」里粘贴自己的 `user_access_token`。`.env.local` 全留空，直接：
```bash
npm run build
```
加载 `dist/` 即可。适合自用 / 不想碰 App Secret 的人。

### B. 直连·密码加密（个人加固）
secret 加密进包，用户首次输一次解锁口令。**别用明文打包**。
```bash
# 1) 生成密文（按提示输入 secret + 口令）
node scripts/encrypt-secret.mjs
# 2) 填 .env.local：
#    VITE_FEISHU_APP_ID=cli_xxx
#    VITE_FEISHU_APP_SECRET_ENC=<上一步输出的密文>
#    VITE_FEISHU_APP_SECRET=        # 留空
npm run build
```
把统一**解锁口令**随安装说明发给用户（首次在「设置 → 飞书鉴权」解锁一次）。
> ⚠️ 纯明文 `VITE_FEISHU_APP_SECRET=` 仅用于本地联调，**别分发**——解包即得 secret。

---

## 3. 打包方式

> 🧰 **图形化向导（最省事）**：`npm run package:ui` 打开 `http://localhost:8799`（仅本机），网页上选模式、改名称/图标、勾参数 → **一键打包下载 `.zip`**。底层就是下面这些命令 + 后处理 `manifest`/图标，适合不想碰命令行的同学。

| 方式 | 命令 | 用途 |
|---|---|---|
| 图形化向导 | `npm run package:ui` | 小白友好：网页选模式/改名称图标/填参数 → 一键打包下载 |
| 未打包目录 | 加载 `dist/` | 个人 / 联调（`chrome://extensions` → 开发者模式 → 加载已解压） |
| zip | `cd dist && zip -qr ../pkg.zip .` | 分发 / 备份 |
| **.crx** | `chrome --pack-extension dist --pack-extension-key extension-key.pem` | 打包成 .crx 分发（需自备 `extension-key.pem`） |

> 🍴 **Fork / 二次分发必看**：`manifest.json` 里的 `key` 字段（公钥）钉死了**原作者的扩展 ID**
> `jhdbgegk…`。你 fork 后**必须换成自己的**——删掉 `key` 字段让 Chrome 自动分配，或用自己的
> `extension-key.pem`（`chrome --pack-extension` 会生成）重新签名；并把文档/`.env` 示例里的扩展 ID、
> 重定向 URL 等占位都改成你自己的。否则会与原作者的 ID 冲突。

---

## 4. 飞书后台一次性配套（开放平台 → 你的应用）

1. **可用范围**：加全员 / 部门 / 指定人 —— **决定谁能授权**。
2. **重定向 URL**（安全设置）：`https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/`（含末尾斜杠；fork 后换成你扩展 ID 对应的）。
3. **权限 scope**（权限管理）：开 **`offline_access`（必须，否则 token 2 小时失效无法续期）** + 按需 `bitable:app` / `docx:document` / `sheets:spreadsheet` / `drive:drive` / `wiki:wiki` / `contact:user.base:readonly`，**且只勾「用户身份」**。
   - **不要**：`im` / `contact:contact` / `transfer_owner` / `permissions` / `admin`（代码也硬禁）。
   - 想**去掉删除权限**：多维表格用细粒度权限、不勾「删」；详见 SECURITY_AUDIT。
4. **发布应用**：创建版本 → 提交发布（否则只有测试成员能授权）。

---

## 5. 构建变量速查

| 变量 | 模式 | 说明 |
|---|---|---|
| `VITE_FEISHU_APP_ID` | 除"纯 user-token"外都要 | 飞书应用 ID |
| `VITE_FEISHU_APP_SECRET` | 个人·直连明文 | ⚠️ 进包明文，勿分发 |
| `VITE_FEISHU_APP_SECRET_ENC` | 个人·密码加密 | `encrypt-secret.mjs` 生成 |
| `VITE_OPENAI_ALLOWED_HOSTS` | 锁出站 | 锁死大模型 host |
| `VITE_ALLOWED_CIDRS` | 可选 | 只在这些网段可用（内网/VPN） |
| `VITE_FEISHU_OAUTH_SCOPE` | 可选 | OAuth 申请的 scope（须与后台一致） |
| `VITE_MAX_TOOL_CALLS` | 可选 | agent 单轮工具上限（默认 30） |
| `VITE_CLIP_ENABLED` | 可选 | 网页剪藏开关（默认开，设 false 关闭） |

> Vite 只认 `.env` 文件里的 `VITE_*`（不读 `process.env`）。多套配置可用 `.env.<mode>.local` + `vite build --mode <mode>`。

---

## 6. 验证 & 排错

- `invalid_grant`：授权码过期/复用，重新点授权。
- 403 权限错：飞书后台 scope 没开全 / 没勾用户身份 / 用户不在可用范围。
- 全屏「检查网络访问权限」：设了 `VITE_ALLOWED_CIDRS` 但检测不到内网 IP（现代 Chrome 的 mDNS 会让 WebRTC 取不到 LAN IP）——内网用户若被误锁，调整该项或改用网关层限制。