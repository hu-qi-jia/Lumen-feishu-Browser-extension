import { useEffect, useState } from 'react'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../../../shared/theme'
import type { AppSettings } from '../../../shared/types'
import { FormSwitch, FormToggle } from '../form'
import Dropdown from '../Dropdown'
import SettingsSection from './SettingsSection'
import type { SettingsTabProps } from './types'
import { loadNewsSettings, saveNewsSettings } from '../../../shared/news/store'
import type { TranslationEngine } from '../../../shared/news/types'

interface Props extends SettingsTabProps {
  accent: string
  onAccentChange: (hex: string) => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
  policyLocks: Set<keyof AppSettings>
}

/** 通用 tab：主题色、外观模式、自动确认。 */
export default function GeneralTab({
  form,
  patch,
  accent,
  onAccentChange,
  theme,
  onThemeChange,
  policyLocks,
}: Props) {
  const accentChanged = accent.toLowerCase() !== DEFAULT_ACCENT.toLowerCase()

  // News translation engine — stored in news_settings_v1 (separate from AppSettings), so
  // it's loaded/saved independently and takes effect immediately (like theme/accent).
  const [engine, setEngine] = useState<TranslationEngine>('bing')
  useEffect(() => { void loadNewsSettings().then((s) => setEngine(s.translationEngine)) }, [])
  const changeEngine = (value: string) => {
    const next = value as TranslationEngine
    setEngine(next)
    void loadNewsSettings().then((s) => saveNewsSettings({ ...s, translationEngine: next }))
  }

  return (
    <>
      {/* ── 主题色 ── */}
      <SettingsSection title="主题色">
        <div className="accent-row">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex}
              className={`accent-swatch ${accent.toLowerCase() === p.hex.toLowerCase() ? 'accent-swatch--active' : ''}`}
              style={{ background: p.hex }}
              title={p.name}
              aria-label={p.name}
              onClick={() => onAccentChange(p.hex)}
            />
          ))}
          <label className="accent-custom" title="自定义颜色" aria-label="自定义颜色">
            <input
              type="color"
              value={accent}
              onChange={(e) => onAccentChange(e.target.value)}
            />
          </label>
        </div>
        {accentChanged && (
          <button className="btn-link" onClick={() => onAccentChange(DEFAULT_ACCENT)}>
            恢复默认
          </button>
        )}
      </SettingsSection>

      {/* ── 外观模式 ── */}
      <SettingsSection title="外观模式">
        <FormToggle
          options={[
            { value: 'light', label: '亮色' },
            { value: 'dark', label: '深色' },
          ]}
          value={theme}
          onChange={(v) => onThemeChange(v as 'light' | 'dark')}
        />
      </SettingsSection>

      {/* ── 自动确认 ── */}
      <SettingsSection title="自动确认">
        <FormSwitch
          checked={form.autoConfirm === true}
          disabled={policyLocks.has('autoConfirm')}
          onChange={(checked) => patch({ autoConfirm: checked })}
          hint={
            <>
              开启后，删除文档内的行 / 字段 / 内容块 / 去重等操作<b>不再弹确认按钮</b>。
              文件级删除（整表 / 电子表格 / 文档 / 云文件）始终拦截。
              {policyLocks.has('autoConfirm') && <span className="field-hint">（由企业策略锁定）</span>}
            </>
          }
          hintColor={form.autoConfirm ? '#d4380d' : undefined}
        >
          删除文档内容时自动确认
        </FormSwitch>
      </SettingsSection>

      {/* ── 资讯 ── */}
      <SettingsSection title="GitHub 项目描述翻译">
        <EngineDropdown engine={engine} onChange={changeEngine} />
        <p className="field-hint">
          Bing 翻译使用免费接口，无需配置；AI 翻译使用已配置的模型，速度较慢但质量更高。翻译结果会缓存，重复刷新不会重复调用。
        </p>
      </SettingsSection>
    </>
  )
}

const ENGINE_OPTIONS: { value: TranslationEngine; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'bing', label: 'Bing 翻译（默认）' },
  { value: 'ai', label: 'AI 翻译（需配置模型密钥）' },
]

function EngineDropdown({ engine, onChange }: { engine: TranslationEngine; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const currentLabel = ENGINE_OPTIONS.find((o) => o.value === engine)?.label ?? '关闭'
  return (
    <Dropdown
      className="engine-dropdown"
      open={open}
      onOpenChange={setOpen}
      align="left"
      trigger={
        <button
          type="button"
          className={`engine-trigger${open ? ' is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="engine-trigger-label">{currentLabel}</span>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      }
    >
      {ENGINE_OPTIONS.map((o) => {
        const selected = o.value === engine
        return (
          <button
            key={o.value}
            type="button"
            className={`engine-item${selected ? ' is-active' : ''}`}
            onClick={() => { onChange(o.value); setOpen(false) }}
          >
            <span className="engine-item-label">{o.label}</span>
            {selected && (
              <svg className="engine-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        )
      })}
    </Dropdown>
  )
}
