import { useEffect, useState } from 'react'
import {
  BUILD_CONFIG,
  FEISHU_API_BASE,
  HAS_APP_SECRET,
  HAS_BUILTIN_CREDS,
  HAS_ENCRYPTED_SECRET,
  HAS_MANAGED_APP_ID,
} from '../../../shared/config'
import { getTenantAccessToken } from '../../../shared/feishu/auth'
import {
  authorizeFeishuUser,
  fetchUserOpenId,
  oauthRedirectUrl,
} from '../../../shared/feishu/oauth'
import { clearUserToken, saveUserToken } from '../../../shared/feishu/auth'
import { isAppSecretLocked, lockAppSecret, unlockAppSecret } from '../../../shared/feishu/appSecret'
import { getUserAppId, hasUserAppCreds, saveUserAppCreds } from '../../../shared/feishu/userAppCreds'
import { FormField, FormInput } from '../form'
import SettingsSection from './SettingsSection'
import Tooltip from '../Tooltip'
import type { SettingsTabProps } from './types'

/** 飞书 tab：内置凭据 / 自建应用 / 加密解锁 / user_token / open_id / 授权 / 测试连接。 */
export default function FeishuTab({ form, patch, set }: SettingsTabProps) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showTokenHelp, setShowTokenHelp] = useState(false)
  const [authing, setAuthing] = useState(false)
  const [authResult, setAuthResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // Password-protected App Secret (personal hardening).
  const [secretLocked, setSecretLocked] = useState(HAS_ENCRYPTED_SECRET)
  const [unlockPwd, setUnlockPwd] = useState('')
  const [showUnlockPwd, setShowUnlockPwd] = useState(false)
  const [unlockMsg, setUnlockMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  // "Bring your own app" — public / store build ships no creds.
  const [byoAppId, setByoAppId] = useState('')
  const [byoSecret, setByoSecret] = useState('')
  const [byoSaved, setByoSaved] = useState(false)
  const [byoMsg, setByoMsg] = useState('')

  const redirectUrl = oauthRedirectUrl()

  useEffect(() => {
    if (HAS_ENCRYPTED_SECRET) void isAppSecretLocked().then(setSecretLocked)
    if (!HAS_BUILTIN_CREDS)
      void (async () => {
        const id = await getUserAppId()
        if (id) setByoAppId(id)
        setByoSaved(await hasUserAppCreds())
      })()
  }, [])

  // ── handlers ──────────────────────────────────────────────────────────────

  async function saveByoCreds() {
    if (!byoAppId.trim() || !byoSecret.trim()) {
      setByoMsg('请填写 App ID 与 App Secret')
      return
    }
    await saveUserAppCreds(byoAppId.trim(), byoSecret.trim())
    setByoSaved(true)
    setByoSecret('')
    setByoMsg('已保存（App Secret 已本机加密存储）。现在可点「用飞书账号授权」。')
  }

  async function handleUnlock() {
    setUnlockMsg(null)
    try {
      await unlockAppSecret(unlockPwd, true)
      setSecretLocked(false)
      setUnlockPwd('')
      setUnlockMsg({ ok: true, msg: '已解锁，现在可以授权/操作了' })
    } catch (err) {
      setUnlockMsg({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleLock() {
    await lockAppSecret()
    setSecretLocked(true)
    setUnlockMsg(null)
  }

  async function authorize() {
    setAuthing(true)
    setAuthResult(null)
    try {
      const { userToken, openId, name, refreshToken, expiresIn } = await authorizeFeishuUser()
      await saveUserToken({ accessToken: userToken, refreshToken, expiresIn })
      patch({ feishuOwnerOpenId: openId, feishuAccessToken: userToken })
      setAuthResult({ ok: true, msg: `已授权：${name}（open_id 已自动填入，将自动续期，记得点保存）` })
    } catch (err) {
      setAuthResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setAuthing(false)
    }
  }

  // Fallback to OAuth: derive open_id straight from the pasted user_access_token.
  async function fillOpenIdFromToken() {
    setAuthing(true)
    setAuthResult(null)
    try {
      const { openId, name } = await fetchUserOpenId(form.feishuAccessToken)
      await clearUserToken()
      patch({ feishuOwnerOpenId: openId })
      setAuthResult({ ok: true, msg: `已获取：${name}（open_id 已填入，记得点保存）` })
    } catch (err) {
      setAuthResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setAuthing(false)
    }
  }

  async function testFeishu() {
    setTesting(true)
    setTestResult(null)
    try {
      if (HAS_APP_SECRET) {
        const token = await getTenantAccessToken(
          BUILD_CONFIG.feishuAppId,
          BUILD_CONFIG.feishuAppSecret,
        )
        setTestResult({ ok: true, msg: `tenant_access_token 获取成功 (${token.slice(0, 12)}…)` })
      } else {
        const res = await fetch(`${FEISHU_API_BASE}/bitable/v1/apps/__probe__`, {
          headers: { Authorization: `Bearer ${form.feishuAccessToken}` },
        })
        const json = (await res.json()) as { code: number; msg: string }
        const authFailed = json.code === 99991677 || json.code === 99991668
        setTestResult(
          authFailed
            ? { ok: false, msg: `Token 无效或已过期 (${json.code})` }
            : { ok: true, msg: `Token 有效 (code=${json.code})` },
        )
      }
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  const feishuReady = HAS_BUILTIN_CREDS || !!form.feishuAccessToken

  return (
    <>
      {/* ── Built-in App Credentials ── */}
      {HAS_BUILTIN_CREDS ? (
        <div className="builtin-badge">
          <span className="builtin-icon">密钥</span>
          <div className="builtin-text">
            <span className="builtin-label">
              App Credentials（{HAS_MANAGED_APP_ID ? '企业代理下发' : '已内置'}）
            </span>
            <span className="builtin-sub">
              {HAS_MANAGED_APP_ID
                ? 'App ID 由企业代理按需下发、App Secret 留在服务端，无需手动配置。直接用飞书账号授权即可。'
                : '此版本已打包 App ID，无需手动配置。如需覆盖，可在下方填写 user_access_token。'}
            </span>
          </div>
        </div>
      ) : null}

      {/* Bring-your-own Feishu app — public / store build (no baked creds). */}
      {!HAS_BUILTIN_CREDS && (
        <div className="field-group byo-box">
          <label className="field-label-inline">自建飞书应用（本版本不内置凭据，请填你自己的）</label>
          <input
            className="field-input"
            type="text"
            value={byoAppId}
            onChange={(e) => setByoAppId(e.target.value)}
            placeholder="App ID：cli_xxxxxxxxxxxx"
          />
          <input
            className="field-input"
            type="password"
            value={byoSecret}
            style={{ marginTop: 6 }}
            onChange={(e) => setByoSecret(e.target.value)}
            placeholder={byoSaved ? 'App Secret（已保存，如需更新再填）' : 'App Secret'}
          />
          <div className="test-row" style={{ marginTop: 6 }}>
            <button
              className="btn-test"
              type="button"
              onClick={() => void saveByoCreds()}
              disabled={!byoAppId.trim() || !byoSecret.trim()}
            >
              保存应用凭据
            </button>
            {byoSaved && <span className="test-result test-result--ok">已配置</span>}
          </div>
          {byoMsg && <span className="field-hint">{byoMsg}</span>}
          {redirectUrl && (
            <div className="help-box" style={{ marginTop: 6 }}>
              <p>在飞书后台「安全设置 → 重定向 URL」登记（须完全一致，含末尾斜杠）：</p>
              <pre className="help-code">{redirectUrl}</pre>
              <p>
                权限管理开通（勾<b>用户身份</b>）：<code>offline_access</code> + 按需{' '}
                <code>bitable:app</code> <code>docx:document</code>{' '}
                <code>sheets:spreadsheet</code> <code>drive:drive</code>{' '}
                <code>wiki:wiki</code> <code>contact:user.base:readonly</code>；并把自己加入「可用范围」、发布应用。
              </p>
            </div>
          )}
        </div>
      )}

      {/* Password-protected App Secret (personal build): unlock before OAuth. */}
      {HAS_ENCRYPTED_SECRET && (
        <div className="unlock-box">
          <div className="unlock-head">
            <span>{secretLocked ? '已加密' : '已解锁'}</span>
            <span className="unlock-title">
              应用密钥已加密{secretLocked ? '（需输入密码解锁后才能授权/操作）' : '（已解锁）'}
            </span>
          </div>
          {secretLocked ? (
            <>
              <div className="unlock-row">
                <input
                  className="field-input"
                  type={showUnlockPwd ? 'text' : 'password'}
                  value={unlockPwd}
                  onChange={(e) => setUnlockPwd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleUnlock()
                  }}
                  placeholder="粘贴解锁密码"
                />
                <Tooltip content={showUnlockPwd ? '隐藏' : '显示，核对粘贴是否完整'} position="top">
                  <button
                    className="btn-secondary unlock-btn"
                    type="button"
                    onClick={() => setShowUnlockPwd((v) => !v)}
                  >
                    {showUnlockPwd ? '隐藏' : '显示'}
                  </button>
                </Tooltip>
                <button
                  className="btn-primary unlock-btn"
                  disabled={!unlockPwd}
                  onClick={() => void handleUnlock()}
                >
                  解锁
                </button>
              </div>
              {unlockPwd && (
                <span className="field-hint">
                  已输入 {unlockPwd.length} 个字符
                  {/\s/.test(unlockPwd) ? '（含空白，可能是粘贴多带了空格/换行）' : ''}
                </span>
              )}
            </>
          ) : (
            <button className="btn-secondary" onClick={() => void handleLock()}>
              锁定（清除本机已记住的密钥）
            </button>
          )}
          {unlockMsg && (
            <span className="field-hint" style={{ color: unlockMsg.ok ? '#389e0d' : '#d4380d' }}>
              {unlockMsg.msg}
            </span>
          )}
        </div>
      )}

      {/* User token — required when no built-in creds, optional override when present */}
      <SettingsSection title="飞书 Feishu 鉴权">
        <div className="field-group">
          <div className="help-toggle-row">
            <label className="field-label-inline">
              {HAS_BUILTIN_CREDS ? 'user_access_token（可选覆盖）' : 'user_access_token'}
            </label>
            <button className="btn-link" onClick={() => setShowTokenHelp((v) => !v)}>
              {showTokenHelp ? '收起' : '如何获取?'}
            </button>
          </div>

          {showTokenHelp && (
            <div className="help-box">
              <p>在浏览器打开飞书网页版，F12 → Console 执行：</p>
              <pre className="help-code">
                {"window.larkSuite?.globalState?.userInfo?.accessToken"}
              </pre>
              <p>
                或查看任意 API 请求的 <code>Authorization: Bearer &lt;token&gt;</code> 请求头。
              </p>
              <p className="help-note">Token 约 2 小时过期，请勿分享。存储时已加密。</p>
            </div>
          )}

          <input
            className="field-input"
            type="password"
            value={form.feishuAccessToken}
            onChange={set('feishuAccessToken')}
            placeholder={
              HAS_BUILTIN_CREDS ? '留空则使用内置凭据' : 'u-xxxxxxxxxxxxxxxxxxxxxxxx'
            }
          />
        </div>

        {/* Owner open_id */}
        <FormField label="你的 open_id（新建多维表格归属）">
          <FormInput
            type="text"
            value={form.feishuOwnerOpenId}
            onChange={set('feishuOwnerOpenId')}
            placeholder="ou_xxxxxxxxxxxxxxxx（留空则新建的表归应用所有，你看不到）"
          />
        </FormField>

        <div className="test-row">
          {(HAS_BUILTIN_CREDS || byoSaved) && (
            <button className="btn-test" onClick={authorize} disabled={authing}>
              {authing ? '授权中…' : '用飞书账号授权'}
            </button>
          )}
          <Tooltip
            content={
              form.feishuAccessToken.trim()
                ? '用上方 token 换取 open_id'
                : '请先在上方填入 user_access_token'
            }
            position="top"
          >
            <button
              className="btn-test"
              onClick={fillOpenIdFromToken}
              disabled={authing || !form.feishuAccessToken.trim()}
            >
              {authing ? '获取中…' : '用 token 取 open_id'}
            </button>
          </Tooltip>
          {authResult && (
            <span
              className={`test-result ${authResult.ok ? 'test-result--ok' : 'test-result--err'}`}
            >
              {authResult.msg}
            </span>
          )}
        </div>
        <p className="field-hint">
          授权失败时，可改用右边：在上方「user_access_token」粘贴你的 token（见「如何获取?」），
          再点【用 token 取 open_id】——无需登记重定向 URL。
        </p>

        <p className="field-hint">
          用「内置凭据 / tenant」身份新建的多维表格默认归应用所有、不在你的云空间显示。
          点上方授权后，助手新建表会自动转交给你（应用保留编辑权）；也可手填 open_id。
          {HAS_BUILTIN_CREDS && oauthRedirectUrl() && (
            <>
              <br />
              首次需在飞书开放平台「安全设置 → 重定向 URL」添加：
              <code>{oauthRedirectUrl()}</code>
            </>
          )}
        </p>

        {/* Test connection */}
        <div className="test-row">
          <button className="btn-test" onClick={testFeishu} disabled={testing || !feishuReady}>
            {testing ? '测试中…' : '测试飞书连接'}
          </button>
          {testResult && (
            <span
              className={`test-result ${testResult.ok ? 'test-result--ok' : 'test-result--err'}`}
            >
              {testResult.msg}
            </span>
          )}
        </div>

        <p className="storage-note">API Key 和 Token 使用 AES-256-GCM 加密存储</p>
      </SettingsSection>
    </>
  )
}
