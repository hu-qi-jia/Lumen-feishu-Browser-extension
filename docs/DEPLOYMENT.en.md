> 🌐 **English** | [中文](DEPLOYMENT.md)

# Deployment Guide · Quick Start (Personal / Store)

> Pick your path on one page → copy the commands → get it running. Deep-dive details link to the relevant docs:
> Security model [`SECURITY_AUDIT.en.md`](SECURITY_AUDIT.en.md) · User guide [`USER_GUIDE.en.md`](USER_GUIDE.en.md)

---

## 0. Pick Your Path (30 seconds)

| You are… | Recommended mode | Where the App Secret lives | Jump to |
|---|---|---|---|
| **Personal / want the least hassle** | Pure user-token (no embedded credentials) | No secret | [§2-A](#a-pure-user-token-zero-embedded--most-secure--least-hassle) |
| **Personal / small team** | Direct connect · password-encrypted | Encrypted into the package, unlocked by password | [§2-B](#b-direct-connect--password-encrypted-personal-hardening) |

> The only difference among the two modes is **how the App Secret is handled**; everything else — build/packaging/Feishu setup — is identical.

**Two common prerequisites for all modes:**
1. **LLM Key**: Each user fills it in themselves under the extension's "⚙️ Settings" (OpenAI-compatible, DeepSeek by default) — **not a build variable**.
2. **One-time Feishu console setup**: See [§4](#4-one-time-feishu-console-setup-open-platform--your-app) (availability scope / redirect URL / permission scopes).

---

## 1. Preparation (common to all modes)

```bash
git clone <repo> && cd feishu-ai-assistant
npm install
cp .env.example .env.local          # 已被 .gitignore；下面各模式只改其中几行
```
The build output is always `dist/`. See the three packaging methods in [§3](#3-packaging-methods).

---

## 2. Personal Deployment

### A. Pure user-token (zero embedded · most secure · least hassle)
**Don't put any credentials in the package.** Users paste their own `user_access_token` under "Settings". Leave `.env.local` entirely empty and just run:
```bash
npm run build
```
Load `dist/` and you're done. Suitable for self-use / people who don't want to deal with the App Secret.

### B. Direct connect · password-encrypted (personal hardening)
The secret is encrypted into the package; the user enters an unlock passphrase once on first use. **Don't bundle it in plaintext.**
```bash
# 1) 生成密文（按提示输入 secret + 口令）
node scripts/encrypt-secret.mjs
# 2) 填 .env.local：
#    VITE_FEISHU_APP_ID=cli_xxx
#    VITE_FEISHU_APP_SECRET_ENC=<上一步输出的密文>
#    VITE_FEISHU_APP_SECRET=        # 留空
npm run build
```
Send the unified **unlock passphrase** to users along with the install instructions (they unlock once under "Settings → Feishu Auth" on first use).
> ⚠️ Plaintext `VITE_FEISHU_APP_SECRET=` is for local debugging only. **Don't distribute it** — unpacking the build reveals the secret.

---

## 3. Packaging Methods

| Method | Command | Use case |
|---|---|---|
| Unpacked directory | Load `dist/` | Personal / debugging (`chrome://extensions` → Developer mode → Load unpacked) |
| zip | `cd dist && zip -qr ../pkg.zip .` | Distribution / backup |
| **.crx** | `chrome --pack-extension dist --pack-extension-key extension-key.pem` | Pack as .crx for distribution (requires your own `extension-key.pem`) |

> 🍴 **Must-read for forks / redistribution**: the `key` field (public key) in `manifest.json` pins the **original author's extension ID**
> `jhdbgegk…`. After forking you **must replace it with your own** — either delete the `key` field to let Chrome auto-assign one, or use your own
> `extension-key.pem` (`chrome --pack-extension` generates one) to re-sign; and change the extension ID, redirect URL, etc. placeholders in the docs / `.env` examples to your own. Otherwise you'll collide with the original author's ID.

---

## 4. One-Time Feishu Console Setup (Open Platform → your app)

1. **Availability scope**: add everyone / departments / specific people — **this decides who can authorize**.
2. **Redirect URL** (security settings): `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/` (include the trailing slash; for forks, use the one matching your extension ID).
3. **Permission scopes** (permission management): enable **`offline_access` (required, otherwise the token expires in 2 hours and can't be renewed)** + as needed `bitable:app` / `docx:document` / `sheets:spreadsheet` / `drive:drive` / `wiki:wiki` / `contact:user.base:readonly`, **and check only "user identity"**.
   - **Don't**: `im` / `contact:contact` / `transfer_owner` / `permissions` / `admin` (the code also hard-blocks these).
   - To **remove delete permissions**: use fine-grained permissions on the Base and don't check "delete"; see SECURITY_AUDIT for details.
4. **Publish the app**: create a version → submit for release (otherwise only test members can authorize).

---

## 5. Build Variables Cheat Sheet

| Variable | Mode | Description |
|---|---|---|
| `VITE_FEISHU_APP_ID` | Required for all except "pure user-token" | Feishu app ID |
| `VITE_FEISHU_APP_SECRET` | Personal · direct plaintext | ⚠️ Plaintext in the package, don't distribute |
| `VITE_FEISHU_APP_SECRET_ENC` | Personal · password-encrypted | Generated by `encrypt-secret.mjs` |
| `VITE_OPENAI_ALLOWED_HOSTS` | Outbound lockdown | Pins the LLM host |
| `VITE_ALLOWED_CIDRS` | Optional | Available only on these subnets (intranet/VPN) |
| `VITE_FEISHU_OAUTH_SCOPE` | Optional | OAuth requested scopes (must match the console) |
| `VITE_MAX_TOOL_CALLS` | Optional | Per-round agent tool-call limit (default 30) |
| `VITE_CLIP_ENABLED` | Optional | Web clipper toggle (on by default, set false to disable) |

> Vite only recognizes `VITE_*` in `.env` files (it doesn't read `process.env`). For multiple config sets, use `.env.<mode>.local` + `vite build --mode <mode>`.

---

## 6. Verification & Troubleshooting

- `invalid_grant`: the authorization code expired/was reused, click authorize again.
- 403 permission error: the Feishu console scopes aren't fully enabled / "user identity" not checked / the user is outside the availability scope.
- Full-screen "Checking network access permission": `VITE_ALLOWED_CIDRS` is set but the intranet IP can't be detected (modern Chrome's mDNS prevents WebRTC from obtaining the LAN IP) — if intranet users get wrongly locked out, adjust this option or use gateway-level restrictions instead.
