import { useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { encryptField, decryptField } from '../../shared/crypto'
import { HAS_ENTERPRISE_POLICY } from '../../shared/config'
import { fetchPolicy, loadPolicy, applyPolicy, FAILCLOSED_POLICY } from '../../shared/enterprisePolicy'

export interface AppSettingsApi {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
  /** Encrypt sensitive fields, persist, and update state. Does NOT switch the view — the
   *  caller (Settings onSave) decides navigation after the save resolves. */
  saveSettings: (s: AppSettings) => Promise<void>
}

/**
 * Runtime settings: load (decrypt) from chrome.storage.local on mount, layer enterprise
 * policy on top (FAIL-CLOSED until the real policy is known), and persist on save.
 */
export function useAppSettings(): AppSettingsApi {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    chrome.storage.local.get(['settings_v2'], async (r) => {
      const stored = r.settings_v2 as Record<string, string> | undefined
      if (!stored) return
      const token = await decryptField(stored.feishuAccessToken ?? '')
      const apiKey = await decryptField(stored.openaiApiKey ?? '')
      const loaded: AppSettings = {
        ...DEFAULT_SETTINGS,
        openaiBaseUrl: stored.openaiBaseUrl ?? DEFAULT_SETTINGS.openaiBaseUrl,
        openaiModel: stored.openaiModel ?? DEFAULT_SETTINGS.openaiModel,
        openaiApiKey: apiKey,
        feishuAccessToken: token,
        feishuOwnerOpenId: stored.feishuOwnerOpenId ?? '',
        templateRegistryUrl: stored.templateRegistryUrl ?? '',
        learnFromHistory: (stored.learnFromHistory as unknown as boolean | undefined) !== false,
        voiceInput: (stored.voiceInput as unknown as boolean | undefined) !== false,
        autoConfirm: (stored.autoConfirm as unknown as boolean | undefined) === true,
        llmSource: (stored.llmSource as AppSettings['llmSource']) ?? undefined,
      }
      // Enterprise central policy (applied over the just-loaded base). FAIL-CLOSED: on a
      // policy build, until the real policy is known (no cache / proxy down) we force the
      // conservative default (no auto-confirm of deletes) — a proxy outage must never loosen
      // the enterprise's controls.
      const eff = (p: Awaited<ReturnType<typeof loadPolicy>>) =>
        applyPolicy(loaded, p ?? (HAS_ENTERPRISE_POLICY ? FAILCLOSED_POLICY : null))
      setSettings(eff(await loadPolicy()))
      void fetchPolicy(loaded).then((fresh) => setSettings(eff(fresh)))
    })
  }, [])

  async function saveSettings(s: AppSettings) {
    const [encToken, encApiKey] = await Promise.all([
      encryptField(s.feishuAccessToken),
      encryptField(s.openaiApiKey),
    ])
    chrome.storage.local.set({
      settings_v2: {
        openaiBaseUrl: s.openaiBaseUrl,
        openaiModel: s.openaiModel,
        openaiApiKey: encApiKey,
        feishuAccessToken: encToken,
        // Not sensitive — persist as-is (these were silently dropped before).
        feishuOwnerOpenId: s.feishuOwnerOpenId,
        templateRegistryUrl: s.templateRegistryUrl,
        learnFromHistory: s.learnFromHistory !== false,
        voiceInput: s.voiceInput !== false,
        autoConfirm: s.autoConfirm === true,
        llmSource: s.llmSource, // managed/manual choice must persist (was dropped → switch never stuck)
      },
    })
    setSettings(s)
  }

  return { settings, setSettings, saveSettings }
}
