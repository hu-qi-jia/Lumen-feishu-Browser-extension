import { BUILD_CONFIG, HAS_MANAGED_LLM } from '../../../shared/config'
import { clearManagedLlmCache, usingManagedLlm } from '../../../shared/ai/llmConfig'
import {
  KNOWN_PROVIDER_HOSTS,
  LLM_PROVIDERS,
  assertSafeBaseUrl,
  providerForBaseUrl,
} from '../../../shared/providers'
import { FormField, FormInput, FormSelect, FormToggle } from '../form'
import SettingsSection from './SettingsSection'
import type { SettingsTabProps } from './types'

/** AI 模型 tab：模型配置。 */
export default function AiTab({ form, patch, set }: SettingsTabProps) {
  // ── LLM provider preset ──
  const provider = providerForBaseUrl(form.openaiBaseUrl)

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

  function pickProvider(id: string) {
    const p = LLM_PROVIDERS.find((x) => x.id === id)
    if (!p) return
    patch(
      p.region === 'custom'
        ? { openaiModel: p.models[0] ?? form.openaiModel } // "自定义" keeps the user's base URL
        : { openaiBaseUrl: p.baseUrl, openaiModel: p.models[0] ?? form.openaiModel },
    )
  }

  return (
    <>
      {/* ── AI 模型 ── */}
      <SettingsSection title="AI 模型（OpenAI 兼容）">
        {/* Enterprise managed-LLM: the company key is fetched from the proxy after Feishu auth —
            only members of your tenant get it. A switch lets the company still configure manually,
            unless the build locks managed (VITE_LLM_LOCK_MANAGED). */}
        {HAS_MANAGED_LLM && (() => {
          const managed = usingManagedLlm(form) // single source of truth (shared with the runtime)
          return (
            <div className="field-label" style={{ gap: 6 }}>
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

        {!usingManagedLlm(form) && (<>
          <FormField label="供应商">
            <FormSelect value={provider.id} onChange={(e) => pickProvider(e.target.value)}>
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </FormSelect>
          </FormField>

          <FormField
            label="Base URL"
            hint={baseUrlNote?.msg}
            hintColor={baseUrlNote?.kind === 'error' ? '#d4380d' : baseUrlNote?.kind === 'warn' ? '#d48806' : undefined}
          >
            <FormInput type="url"
              value={form.openaiBaseUrl} onChange={set('openaiBaseUrl')}
              placeholder="https://api.deepseek.com" />
          </FormField>

          <FormField label="API Key">
            <FormInput type="password"
              value={form.openaiApiKey} onChange={set('openaiApiKey')}
              placeholder="sk-…" />
          </FormField>

          <FormField
            label="Model"
            hint="默认国内大模型（DeepSeek）。模型 ID 可**直接输入**最新型号（预设仅作建议）；海外模型仍可在「供应商」中选择。"
          >
            <>
              <FormInput type="text" list="model-suggestions"
                value={form.openaiModel} onChange={set('openaiModel')}
                placeholder={provider.models[0] || 'deepseek-v4-pro'} />
              <datalist id="model-suggestions">
                {provider.models.map((m) => <option key={m} value={m} />)}
              </datalist>
            </>
          </FormField>
        </>)}
      </SettingsSection>
    </>
  )
}
