import { BUILD_CONFIG, HAS_MANAGED_LLM } from '../../../shared/config'
import { clearManagedLlmCache, usingManagedLlm } from '../../../shared/ai/llmConfig'
import {
  KNOWN_PROVIDER_HOSTS,
  assertSafeBaseUrl,
  providerForBaseUrl,
} from '../../../shared/providers'
import { FormField, FormInput, FormToggle } from '../form'
import SettingsSelect from './SettingsSelect'
import SettingsSection from './SettingsSection'
import type { SettingsTabProps } from './types'

/** AI 模型 tab：模型配置。 */
export default function AiTab({ form, patch, set }: SettingsTabProps) {
  // ── LLM provider preset ──
  const provider = providerForBaseUrl(form.openaiBaseUrl)
  const llmFormat = form.llmFormat ?? 'openai'

  // Endpoint safety hint: an error (blocked at send time) vs a soft warning for an
  // unknown but otherwise-valid https host — the user's chat/table data is sent here.
  const baseUrlNote = (() => {
    const v = form.openaiBaseUrl?.trim()
    if (!v) return null
    try {
      assertSafeBaseUrl(v, BUILD_CONFIG.openaiAllowedHosts)
    } catch (err) {
      return { kind: 'error' as const, msg: err instanceof Error ? err.message : String(err) }
    }
    try {
      const host = new URL(v).hostname.toLowerCase()
      if (!KNOWN_PROVIDER_HOSTS.includes(host)) {
        return { kind: 'warn' as const, msg: `「${host}」非内置厂商，对话与表格内容会发送至此地址，请确认可信。` }
      }
    } catch { /* unparseable handled above */ }
    return null
  })()

  return (
    <>
      {/* ── 模型配置 ── */}
      <SettingsSection title="模型配置">
        {/* Enterprise managed-LLM: the company key is fetched from the proxy after Feishu auth —
            only members of your tenant get it. A switch lets the company still configure manually,
            unless the build locks managed (VITE_LLM_LOCK_MANAGED). */}
        {HAS_MANAGED_LLM && (() => {
          const managed = usingManagedLlm(form) // single source of truth (shared with the runtime)
          return (
            <div className="field-label" style={{ gap: 6, fontWeight: 600 }}>
              <span>大模型配置来源</span>
              {BUILD_CONFIG.llmLockManaged ? (
                <span className="field-hint">由企业统一下发并锁定（不可手动配置）。</span>
              ) : (
                <FormToggle
                  options={[
                    { value: 'managed', label: '企业统一' },
                    { value: 'manual', label: '手动配置' },
                  ]}
                  value={managed ? 'managed' : 'manual'}
                  onChange={(v) => patch({ llmSource: v as 'managed' | 'manual' })}
                />
              )}
              {managed && (
                <span className="field-hint">
                  模型由企业统一提供，用本企业飞书账号授权后自动获取，无需填写 Key。
                  {' '}<button type="button" className="btn-link" onClick={() => void clearManagedLlmCache()}>重新获取</button>
                </span>
              )}
            </div>
          )
        })()}

        {!usingManagedLlm(form) && (
          <div className="model-config-fields">
            <FormField label="API 协议">
              <SettingsSelect
                ariaLabel="API 协议"
                options={[
                  { value: 'openai', label: 'OpenAI Chat Completions 格式' },
                  { value: 'anthropic', label: 'Anthropic Messages 格式' },
                ]}
                value={llmFormat}
                onChange={(v) => patch({ llmFormat: v as 'openai' | 'anthropic' })}
              />
            </FormField>

            <FormField
              label="Base URL"
              hint={baseUrlNote?.msg}
              hintColor={baseUrlNote?.kind === 'error' ? '#d4380d' : baseUrlNote?.kind === 'warn' ? '#d48806' : undefined}
            >
              <FormInput type="url"
                value={form.openaiBaseUrl} onChange={set('openaiBaseUrl')}
                placeholder={llmFormat === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com/v1'} />
            </FormField>

            <FormField label="API Key">
              <FormInput type="password"
                value={form.openaiApiKey} onChange={set('openaiApiKey')}
                placeholder={llmFormat === 'anthropic' ? 'sk-ant-…' : 'sk-…'} />
            </FormField>

            <FormField label="Model">
              <>
                <FormInput type="text" list="model-suggestions"
                  value={form.openaiModel} onChange={set('openaiModel')}
                  placeholder={llmFormat === 'anthropic' ? 'claude-sonnet-4-20250514' : (provider.models[0] || 'deepseek-v4-pro')} />
                <datalist id="model-suggestions">
                  {provider.models.map((m) => <option key={m} value={m} />)}
                </datalist>
              </>
            </FormField>
          </div>
        )}
      </SettingsSection>
    </>
  )
}
