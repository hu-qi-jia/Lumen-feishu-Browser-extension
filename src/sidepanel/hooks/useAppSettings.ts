import { useEffect, useState } from 'react'
import type { AppSettings } from '@/shared/types'
import { DEFAULT_SETTINGS } from '@/shared/types'
import { encryptField, decryptField } from '@/shared/crypto'

export interface AppSettingsApi {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
  /** Encrypt sensitive fields, persist, and update state. Does NOT switch the view — the
   *  caller (Settings onSave) decides navigation after the save resolves. */
  saveSettings: (s: AppSettings) => Promise<void>
}

/**
 * Runtime settings: load (decrypt) from chrome.storage.local on mount, and persist on save.
 */
export function useAppSettings(): AppSettingsApi {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    chrome.storage.local.get(['settings_v2'], async (r) => {
      const stored = r.settings_v2 as Record<string, string> | undefined
      if (!stored) return
      const token = await decryptField(stored.feishuAccessToken ?? '')
      const apiKey = await decryptField(stored.openaiApiKey ?? '')
      setSettings({
        ...DEFAULT_SETTINGS,
        openaiBaseUrl: stored.openaiBaseUrl ?? DEFAULT_SETTINGS.openaiBaseUrl,
        openaiModel: stored.openaiModel ?? DEFAULT_SETTINGS.openaiModel,
        openaiApiKey: apiKey,
        feishuAccessToken: token,
        feishuOwnerOpenId: stored.feishuOwnerOpenId ?? '',
        learnFromHistory: (stored.learnFromHistory as unknown as boolean | undefined) !== false,
        autoConfirm: (stored.autoConfirm as unknown as boolean | undefined) === true,
        skipSwitchDocPrompt: (stored.skipSwitchDocPrompt as unknown as boolean | undefined) === true,
        llmFormat: 'openai',
        obsidianBaseUrl: stored.obsidianBaseUrl ?? DEFAULT_SETTINGS.obsidianBaseUrl,
        obsidianInboxPath: stored.obsidianInboxPath ?? DEFAULT_SETTINGS.obsidianInboxPath,
        obsidianExcludePaths: stored.obsidianExcludePaths ?? DEFAULT_SETTINGS.obsidianExcludePaths,
        obsidianVaultName: stored.obsidianVaultName ?? DEFAULT_SETTINGS.obsidianVaultName,
      })
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
        learnFromHistory: s.learnFromHistory !== false,
        autoConfirm: s.autoConfirm === true,
        skipSwitchDocPrompt: s.skipSwitchDocPrompt === true,
        llmFormat: s.llmFormat ?? 'openai',
        // Obsidian 接入（非密钥；API Key 走独立加密键 _obsidian_token_v1，不在此 blob）
        obsidianBaseUrl: s.obsidianBaseUrl,
        obsidianInboxPath: s.obsidianInboxPath,
        obsidianExcludePaths: s.obsidianExcludePaths,
        obsidianVaultName: s.obsidianVaultName,
      },
    })
    setSettings(s)
  }

  return { settings, setSettings, saveSettings }
}
