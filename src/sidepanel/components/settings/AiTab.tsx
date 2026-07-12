import { useState } from 'react'
import { BUILD_CONFIG } from '@/shared/config'
import {
  KNOWN_PROVIDER_HOSTS,
  assertSafeBaseUrl,
  providerForBaseUrl,
} from '@/shared/providers'
import FormField from '../ui/FormField'
import FormInput from '../ui/FormInput'
import Button from '../ui/Button'
import SettingsSection from './SettingsSection'
import type { SettingsTabProps } from './types'

/** AI 模型 tab：模型配置。仅支持 OpenAI Chat Completions 兼容端点。 */
export default function AiTab({ form, set, onSave }: SettingsTabProps) {
  const [saved, setSaved] = useState(false)

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

  return (
    <>
      {/* ── 模型配置 ── */}
      <SettingsSection title="模型配置">
        <div className="model-config-fields">
          <FormField label="API 协议">
            <FormInput
              type="text"
              value="OpenAI Chat Completions 格式"
              onChange={() => {}}
              disabled
            />
          </FormField>

          <FormField
            label="Base URL"
            hint={baseUrlNote?.msg}
            hintColor={baseUrlNote?.kind === 'error' ? '#d4380d' : baseUrlNote?.kind === 'warn' ? '#d48806' : undefined}
          >
            <FormInput type="url"
              value={form.openaiBaseUrl} onChange={set('openaiBaseUrl')}
              placeholder="https://api.deepseek.com/v1" />
          </FormField>

          <FormField label="API Key">
            <FormInput type="password"
              value={form.openaiApiKey} onChange={set('openaiApiKey')}
              placeholder="sk-…" />
          </FormField>

          <FormField label="Model">
            <>
              <FormInput type="text" list="model-suggestions"
                value={form.openaiModel} onChange={set('openaiModel')}
                placeholder={provider.models[0] || 'deepseek-v4-pro'} />
              <datalist id="model-suggestions">
                {provider.models.map((m) => <option key={m} value={m} />)}
              </datalist>
            </>
          </FormField>

          {onSave && (
            <div className="ai-save-row">
              <Button
                variant="secondary"
                block
                onClick={() => {
                  onSave(form)
                  setSaved(true)
                  setTimeout(() => setSaved(false), 1500)
                }}
              >
                {saved ? '已保存' : '保存配置'}
              </Button>
            </div>
          )}
        </div>
      </SettingsSection>
    </>
  )
}
