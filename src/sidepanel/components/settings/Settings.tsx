import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings } from '@/shared/types'
import { loadPolicy, policyLockedKeys } from '@/shared/enterprisePolicy'
import GeneralTab from './GeneralTab'
import AiTab from './AiTab'
import FeishuTab from './FeishuTab'
import KnowledgeBaseTab from './KnowledgeBaseTab'
import BackupTab from './BackupTab'
import AppearanceTab from './AppearanceTab'
import SettingsTabs from './SettingsTabs'
import type { SettingsTabId } from './types'
import './Settings.css'

const SETTINGS_TABS = [
  { id: 'general', label: '通用' },
  { id: 'ai', label: '模型配置' },
  { id: 'feishu', label: '飞书配置' },
  { id: 'knowledgeBase', label: '知识库' },
  { id: 'backup', label: '数据与备份' },
  { id: 'appearance', label: '外观' },
] as const

interface Props {
  settings: AppSettings
  /** Current brand accent hex (UI-only preference, persisted to localStorage). */
  accent: string
  onAccentChange: (hex: string) => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
  onSave: (s: AppSettings) => void
}

export default function Settings({
  settings,
  accent,
  onAccentChange,
  theme,
  onThemeChange,
  onSave,
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

  // Auto-save: persist form changes immediately (debounced). No Save button — edits take
  // effect as you type. `onSave` is kept in a ref so only `form` changes trigger the timer
  // (otherwise a new onSave identity from the parent after each save would re-fire it).
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    const t = setTimeout(() => { void onSaveRef.current(form) }, 400)
    return () => clearTimeout(t)
  }, [form])

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="settings">
      <div className="settings-header">
        <h2>设置</h2>
      </div>

      <SettingsTabs tabs={SETTINGS_TABS} active={tab} onChange={(id) => setTab(id as SettingsTabId)} variant="underline" />

      <div className="settings-body">
        {/* Enterprise policy notice — always visible regardless of tab. */}
        {policyNotice && (
          <section className="settings-section">
            <p className="field-hint" style={{ color: 'var(--color-warning-strong)' }}>
              {policyNotice}
            </p>
          </section>
        )}

        {tab === 'general' && (
          <GeneralTab form={form} patch={patch} set={set} policyLocks={policyLocks} />
        )}

        {tab === 'ai' && (
          <AiTab form={form} patch={patch} set={set} />
        )}

        {tab === 'feishu' && <FeishuTab form={form} patch={patch} set={set} />}

        {tab === 'knowledgeBase' && <KnowledgeBaseTab form={form} patch={patch} set={set} />}

        {tab === 'backup' && <BackupTab />}

        {tab === 'appearance' && (
          <AppearanceTab
            accent={accent}
            onAccentChange={onAccentChange}
            theme={theme}
            onThemeChange={onThemeChange}
          />
        )}
      </div>
    </div>
  )
}
