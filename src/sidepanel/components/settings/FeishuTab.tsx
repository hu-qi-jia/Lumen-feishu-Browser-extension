import { useEffect, useMemo, useState } from 'react'
import {
  BUILD_CONFIG,
  HAS_APP_SECRET,
  HAS_BUILTIN_CREDS,
  HAS_ENCRYPTED_SECRET,
} from '@/shared/config'
import { clearUserToken, getTenantAccessToken, saveUserToken } from '@/shared/feishu/auth'
import { feishuFetch } from '@/shared/feishu/http'
import { isAppSecretLocked, lockAppSecret, unlockAppSecret } from '@/shared/feishu/appSecret'
import { getUserAppId, getUserAppSecret, hasUserAppCreds, saveUserAppCreds } from '@/shared/feishu/userAppCreds'
import {
  authorizeFeishuUser,
  fetchUserOpenId,
  oauthRedirectUrl,
} from '@/shared/feishu/oauth'
import FormField from '../ui/FormField'
import FormInput from '../ui/FormInput'
import Button from '../ui/Button'
import CodeBlock from '../chat/CodeBlock'
import Tooltip from '../ui/Tooltip'
import FeishuSteps from './FeishuSteps'
import type { SettingsTabProps } from './types'

const PERMISSION_SCOPES = `{
  "scopes": {
    "tenant": [
      "admin:app.visibility",
      "base:app:copy",
      "base:app:create",
      "base:app:read",
      "base:app:update",
      "base:block:create",
      "base:block:delete",
      "base:block:read",
      "base:block:update",
      "base:history:read",
      "base:workspace:list",
      "bitable:app",
      "bitable:app:readonly",
      "board:whiteboard:node:create",
      "board:whiteboard:node:delete",
      "board:whiteboard:node:read",
      "board:whiteboard:node:update",
      "contact:contact.base:readonly",
      "contact:department.base:readonly",
      "contact:user.assign_info:read",
      "contact:user.base:readonly",
      "contact:user.basic_profile:readonly",
      "contact:user.department:readonly",
      "contact:user.dotted_line_leader_info.read",
      "contact:user.email:readonly",
      "contact:user.employee:readonly",
      "contact:user.employee_id:readonly",
      "contact:user.employee_number:read",
      "contact:user.gender:readonly",
      "contact:user.id:readonly",
      "contact:user.job_family:readonly",
      "contact:user.job_level:readonly",
      "contact:user.phone:readonly",
      "contact:user.subscription_ids:write",
      "contact:user.user_geo",
      "docx:document",
      "docx:document.block:convert",
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "drive:drive",
      "drive:drive.metadata:readonly",
      "drive:drive.search:readonly",
      "drive:drive:readonly",
      "drive:drive:version",
      "drive:drive:version:readonly",
      "sheets:spreadsheet",
      "sheets:spreadsheet.meta:read",
      "sheets:spreadsheet.meta:write_only",
      "sheets:spreadsheet:create",
      "sheets:spreadsheet:read",
      "sheets:spreadsheet:readonly",
      "sheets:spreadsheet:write_only",
      "slides:presentation:create",
      "slides:presentation:read",
      "slides:presentation:update",
      "slides:presentation:write_only",
      "wiki:wiki",
      "wiki:wiki:readonly"
    ],
    "user": [
      "board:whiteboard:node:create",
      "board:whiteboard:node:delete",
      "board:whiteboard:node:read",
      "board:whiteboard:node:update",
      "docx:document",
      "docx:document.block:convert",
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "offline_access",
      "wiki:wiki"
    ]
  }
}`

/** 飞书 tab：分步骤引导完成自建应用 → 后台配置 → 鉴权 → 测试连接。 */
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
        const [id, secret, saved] = await Promise.all([
          getUserAppId(),
          getUserAppSecret(),
          hasUserAppCreds(),
        ])
        if (id) setByoAppId(id)
        if (secret) setByoSecret(secret)
        setByoSaved(saved)
      })()
  }, [])

  const feishuReady = HAS_BUILTIN_CREDS || !!form.feishuAccessToken || byoSaved

  // ── handlers ──────────────────────────────────────────────────────────────

  async function saveByoCreds() {
    if (!byoAppId.trim() || !byoSecret.trim()) {
      setByoMsg('请填写 App ID 与 App Secret')
      return
    }
    await saveUserAppCreds(byoAppId.trim(), byoSecret.trim())
    setByoSaved(true)
    setByoMsg('已保存（App Secret 已本机加密存储）。现在可继续下一步并「用飞书账号授权」。')
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
      setAuthResult({ ok: true, msg: `已授权：${name}（open_id 已自动填入，将自动续期）` })
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
      setAuthResult({ ok: true, msg: `已获取：${name}（open_id 已填入）` })
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
        // 用 feishuFetch 走出站守卫（保留原始 Response 以读取错误码区分 token 有效/无效）
        const res = await feishuFetch('GET', '/bitable/v1/apps/__probe__', form.feishuAccessToken)
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

  const builtinBadge = useMemo(
    () =>
      HAS_BUILTIN_CREDS ? (
        <div className="builtin-badge">
          <span className="builtin-icon">密钥</span>
          <div className="builtin-text">
            <span className="builtin-label">
              App Credentials（已内置）
            </span>
            <span className="builtin-sub">
              此版本已打包 App ID，无需手动配置。如需覆盖，可在下方填写 user_access_token。
            </span>
          </div>
        </div>
      ) : null,
    [],
  )

  const steps = useMemo(
    () => [
      {
        title: '自建飞书应用',
        description: '请到飞书开发平台-开发者后台创建企业自建应用',
        content: (
          <div className="field-group byo-box">
            {builtinBadge}
            {!HAS_BUILTIN_CREDS && (
              <>
                <FormField label="APP ID">
                  <FormInput
                    type="text"
                    value={byoAppId}
                    onChange={(e) => setByoAppId(e.target.value)}
                    placeholder="cli_xxxxxxxxxxxx"
                  />
                </FormField>
                <FormField label="APP Secret">
                  <FormInput
                    type="password"
                    value={byoSecret}
                    onChange={(e) => setByoSecret(e.target.value)}
                    placeholder={byoSaved ? '已保存，如需更新可修改' : '输入 App Secret'}
                  />
                </FormField>
                <Button
                  variant="primary"
                  block
                  onClick={() => void saveByoCreds()}
                  disabled={!byoAppId.trim() || !byoSecret.trim()}
                >
                  保存应用凭据
                </Button>
                {byoMsg && <span className="field-hint">{byoMsg}</span>}
              </>
            )}
          </div>
        ),
      },
      {
        title: '应用配置',
        description: '登记重定向 URL 并开通权限',
        content: (
          <div className="feishu-config-help">
            <p className="feishu-config-text">
              在飞书后台「安全设置 → 重定向 URL」登记：
            </p>
            {redirectUrl && <CodeBlock code={redirectUrl} />}
            <p className="feishu-config-text">
              权限管理开通，权限范围参考下方代码块，可复制后批量导入：
            </p>
            <CodeBlock code={PERMISSION_SCOPES} scrollable />
            <p className="feishu-config-text">
              并把自己加入「可用范围」、发布应用。
            </p>
          </div>
        ),
      },
      {
        title: '账户授权',
        description: '授权账号或填入 user_access_token',
        content: (
          <div className="field-group">
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
                      <FormInput
                        type={showUnlockPwd ? 'text' : 'password'}
                        value={unlockPwd}
                        onChange={(e) => setUnlockPwd(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleUnlock()
                        }}
                        placeholder="粘贴解锁密码"
                      />
                      <Tooltip content={showUnlockPwd ? '隐藏' : '显示，核对粘贴是否完整'} position="top">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="unlock-btn"
                          onClick={() => setShowUnlockPwd((v) => !v)}
                        >
                          {showUnlockPwd ? '隐藏' : '显示'}
                        </Button>
                      </Tooltip>
                      <Button
                        variant="primary"
                        size="sm"
                        className="unlock-btn"
                        disabled={!unlockPwd}
                        onClick={() => void handleUnlock()}
                      >
                        解锁
                      </Button>
                    </div>
                    {unlockPwd && (
                      <span className="field-hint">
                        已输入 {unlockPwd.length} 个字符
                        {/\s/.test(unlockPwd) ? '（含空白，可能是粘贴多带了空格/换行）' : ''}
                      </span>
                    )}
                  </>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => void handleLock()}>
                    锁定（清除本机已记住的密钥）
                  </Button>
                )}
                {unlockMsg && (
                  <span className="field-hint" style={{ color: unlockMsg.ok ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {unlockMsg.msg}
                  </span>
                )}
              </div>
            )}

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
                <CodeBlock code="window.larkSuite?.globalState?.userInfo?.accessToken" />
                <p>
                  或查看任意 API 请求的 <code>Authorization: Bearer &lt;token&gt;</code> 请求头。
                </p>
                <p className="help-note">Token 约 2 小时过期，请勿分享。存储时已加密。</p>
              </div>
            )}

            <FormInput
              type="password"
              value={form.feishuAccessToken}
              onChange={set('feishuAccessToken')}
              placeholder={HAS_BUILTIN_CREDS ? '留空则使用内置凭据' : 'u-xxxxxxxxxxxxxxxxxxxxxxxx'}
            />

            <FormField label="open_id">
              <FormInput
                type="text"
                value={form.feishuOwnerOpenId}
                onChange={set('feishuOwnerOpenId')}
                placeholder="ou_xxxxxxxxxxxxxxxx（留空则新建的表归应用所有，你看不到）"
              />
            </FormField>

            <div className="feishu-btn-row">
              {(HAS_BUILTIN_CREDS || byoSaved) && (
                <Button variant="primary" block onClick={authorize} disabled={authing}>
                  {authing ? '授权中…' : '飞书账户授权'}
                </Button>
              )}
              <Tooltip
                content={
                  form.feishuAccessToken.trim()
                    ? '用上方 token 换取 open_id'
                    : '请先在上方填入 user_access_token'
                }
                position="top"
              >
                <Button
                  variant="secondary"
                  block
                  onClick={fillOpenIdFromToken}
                  disabled={authing || !form.feishuAccessToken.trim()}
                >
                  {authing ? '获取中…' : 'token取open_id'}
                </Button>
              </Tooltip>
            </div>
            {authResult && (
              <span
                className={`test-result ${authResult.ok ? 'test-result--ok' : 'test-result--err'}`}
              >
                {authResult.msg}
              </span>
            )}
            <p className="field-hint">
              授权失败时，可填入 user_access_token 并点击「token取open_id」获取 open_id，无需登记重定向 URL。
            </p>
            <p className="field-hint">
              使用内置凭据/tenant 身份新建的表格默认归应用所有。点击上方授权后，助手新建的表格将自动转交给你。
            </p>
          </div>
        ),
      },
      {
        title: '测试飞书链接',
        description: '验证连接是否可用',
        content: (
          <div className="field-group">
            <div className="test-row">
              <Button variant="secondary" block onClick={testFeishu} disabled={testing || !feishuReady}>
                {testing ? '测试中…' : '测试飞书连接'}
              </Button>
              {testResult && (
                <span
                  className={`test-result ${testResult.ok ? 'test-result--ok' : 'test-result--err'}`}
                >
                  {testResult.msg}
                </span>
              )}
            </div>
            <p className="storage-note">API Key 和 Token 使用 AES-256-GCM 加密存储</p>
          </div>
        ),
      },
    ],
    [
      builtinBadge,
      byoAppId,
      byoSecret,
      byoSaved,
      byoMsg,
      redirectUrl,
      secretLocked,
      unlockPwd,
      showUnlockPwd,
      unlockMsg,
      showTokenHelp,
      form.feishuAccessToken,
      form.feishuOwnerOpenId,
      authing,
      authResult,
      testing,
      testResult,
      feishuReady,
    ],
  )

  return (
    <div className="feishu-tab">
      <FeishuSteps steps={steps} current={null} />
    </div>
  )
}
