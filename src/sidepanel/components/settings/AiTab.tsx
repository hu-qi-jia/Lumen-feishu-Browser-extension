import { useEffect, useState } from 'react'
import { BUILD_CONFIG, HAS_MANAGED_LLM } from '../../../shared/config'
import { clearManagedLlmCache, usingManagedLlm } from '../../../shared/ai/llmConfig'
import { clearRecipes, recipeCount } from '../../../shared/ai/recipes'
import {
  KNOWN_PROVIDER_HOSTS,
  LLM_PROVIDERS,
  assertSafeBaseUrl,
  providerForBaseUrl,
} from '../../../shared/providers'
import type { AppSettings } from '../../../shared/types'
import { FormCheckbox, FormField, FormInput, FormSelect, FormToggle } from '../form'
import SettingsSection from './SettingsSection'
import type { SettingsTabProps } from './types'

interface Props extends SettingsTabProps {
  policyLocks: Set<keyof AppSettings>
}

/** AI 模型 tab：模型配置、场景模版库、越用越聪明（本地经验）。 */
export default function AiTab({ form, patch, set, policyLocks }: Props) {
  // ── 越用越聪明：本地经验条数 + 清空 ──
  const [recipeN, setRecipeN] = useState<number | null>(null)
  useEffect(() => { void recipeCount().then(setRecipeN) }, [])
  async function handleClearRecipes() {
    await clearRecipes()
    setRecipeN(0)
  }

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

      {/* ── 场景模版库 ── */}
      <SettingsSection title="场景模版库">
        <FormField
          label="模版库地址"
          hint={<>留空使用内置模版。填写<b>任意可访问的地址</b>（HTTPS，或 http://localhost 本地测试），「场景」Tab 即可拉取。支持单文件 bundle（一个 .json 内含全部模版）或 index.json + 多文件两种格式。</>}
        >
          <FormInput
            type="text"
            value={form.templateRegistryUrl}
            onChange={set('templateRegistryUrl')}
            placeholder="https://… 或 http://localhost:8787/registry.json"
          />
        </FormField>
      </SettingsSection>

      {/* ── 越用越聪明（本地经验记忆） ── */}
      <SettingsSection title="越用越聪明（本地经验）">
        <FormCheckbox
          checked={form.learnFromHistory !== false}
          disabled={policyLocks.has('learnFromHistory')}
          onChange={(checked) => patch({ learnFromHistory: checked })}
          hint={<>每次任务成功后，仅在<b>本机</b>把「做了什么 + 下次怎么做最稳」提炼成一条经验（不含表格/文档数据），下次遇到相似任务自动参考、少走弯路。最多积累 <b>300</b> 条，已积累 <b>{recipeN ?? '…'}</b> 条。</>}
        >
          <>记住成功的操作套路，下次自动参考
          {policyLocks.has('learnFromHistory') && <span className="field-hint">（由企业策略锁定）</span>}</>
        </FormCheckbox>
        <button className="btn-secondary" onClick={() => void handleClearRecipes()} style={{ alignSelf: 'flex-start' }}>
          清空学到的经验
        </button>
      </SettingsSection>
    </>
  )
}
