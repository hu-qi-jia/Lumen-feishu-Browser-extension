import React, { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { loadPolicy, policyLockedKeys } from '../../shared/enterprisePolicy'
import GeneralTab from './settings/GeneralTab'
import AiTab from './settings/AiTab'
import FeishuTab from './settings/FeishuTab'
import BackupTab from './settings/BackupTab'
import SettingsTabs from './SettingsTabs'
import type { SettingsTabId } from './settings/types'
import './Settings.css'

const SETTINGS_TABS = [
  { id: 'general', label: '偏好' },
  { id: 'ai', label: '模型配置' },
  { id: 'feishu', label: '飞书配置' },
  { id: 'backup', label: '备份' },
] as const

interface Props {
  settings: AppSettings
  /** Current brand accent hex (UI-only preference, persisted to localStorage). */
  accent: string
  onAccentChange: (hex: string) => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
  onSave: (s: AppSettings) => void
  onCancel: () => void
}

export default function Settings({
  settings,
  accent,
  onAccentChange,
  theme,
  onThemeChange,
  onSave,
  onCancel,
}: Props) {
  const [form, setForm] = useState<AppSettings>({ ...settings })
  const [tab, setTab] = useState<SettingsTabId>('general')

  // Enterprise policy — the notice banner + locked keys (read by GeneralTab / AiTab).
  const [policyLocks, setPolicyLocks] = useState<Set<keyof AppSettings>>(new Set())
  const [policyNotice, setPolicyNotice] = useState('')

  useEffect(() => {
    void loadPolicy().then((p) => {
      setPolicyLocks(policyLockedKeys(p))
      setPolicyNotice(p?.notice || '')
    })
  }, [])

  // Shared form helpers — tabs mutate `form` through these.
  const patch = useCallback(
    (p: Partial<AppSettings>) => setForm((f) => ({ ...f, ...p })),
    [],
  )

  const set =
    (k: keyof AppSettings) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="settings">
      <div className="settings-header">
        <h2>设置</h2>
      </div>

      <SettingsTabs tabs={SETTINGS_TABS} active={tab} onChange={(id) => setTab(id as SettingsTabId)} />

      <div className="settings-body">
        {/* Enterprise policy notice — always visible regardless of tab. */}
        {policyNotice && (
          <section className="settings-section">
            <p className="field-hint" style={{ color: '#d48806' }}>
              {policyNotice}
            </p>
          </section>
        )}

        {tab === 'general' && (
          <GeneralTab
            form={form}
            patch={patch}
            set={set}
            accent={accent}
            onAccentChange={onAccentChange}
            theme={theme}
            onThemeChange={onThemeChange}
            policyLocks={policyLocks}
          />
        )}

        {tab === 'ai' && (
          <AiTab form={form} patch={patch} set={set} policyLocks={policyLocks} />
        )}

        {tab === 'feishu' && <FeishuTab form={form} patch={patch} set={set} />}

        {tab === 'backup' && <BackupTab />}
      </div>

      <div className="settings-footer">
        <span
          className="settings-version"
          title="当前运行的扩展版本（用于确认是否已加载新构建）"
        >
          v
          {typeof chrome !== 'undefined' && chrome.runtime?.getManifest
            ? chrome.runtime.getManifest().version
            : 'dev'}
        </span>
        <button className="btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-save" onClick={() => onSave(form)}>
          Save
        </button>
      </div>
    </div>
  )
}
