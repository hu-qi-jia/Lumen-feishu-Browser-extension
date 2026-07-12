// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// crypto 走 identity，避免 jsdom 里跑真 AES（obsidian 字段非密钥，本就不加密；feishu/openai 走 identity 也无妨）。
vi.mock('@/shared/crypto', () => ({ encryptField: async (s: string) => s, decryptField: async (s: string) => s }))

const store = new Map<string, unknown>()
beforeEach(() => {
  store.clear()
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        // Callbacks are optional in the real chrome.storage API; useAppSettings.saveSettings
        // calls set({...}) with no callback — tolerate both styles.
        get: (keys: string[], cb?: (r: Record<string, unknown>) => void) => {
          const r: Record<string, unknown> = {}
          for (const k of keys) if (store.has(k)) r[k] = store.get(k)
          cb?.(r)
        },
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v)
          cb?.()
        },
      },
    },
  }
})
afterEach(() => { delete (globalThis as any).chrome; vi.restoreAllMocks() })

describe('useAppSettings — obsidian fields persist', () => {
  it('saveSettings persists obsidian* and a fresh load restores them', async () => {
    const { useAppSettings } = await import('./useAppSettings')
    const { result } = renderHook(() => useAppSettings())
    await act(async () => {
      await result.current.saveSettings({
        ...result.current.settings,
        obsidianBaseUrl: 'http://127.0.0.1:9999',
        obsidianInboxPath: 'Inbox/',
        obsidianExcludePaths: 'Archive/**, Daily/**',
        obsidianVaultName: 'MyVault',
      })
    })
    // 新 hook 实例从 chrome.storage 读回。
    const { result: r2 } = renderHook(() => useAppSettings())
    await waitFor(() => expect(r2.current.settings.obsidianBaseUrl).toBe('http://127.0.0.1:9999'))
    expect(r2.current.settings.obsidianInboxPath).toBe('Inbox/')
    expect(r2.current.settings.obsidianExcludePaths).toBe('Archive/**, Daily/**')
    expect(r2.current.settings.obsidianVaultName).toBe('MyVault')
  })

  it('no stored blob → DEFAULT_SETTINGS obsidianBaseUrl (http://127.0.0.1:27123)', async () => {
    const { useAppSettings } = await import('./useAppSettings')
    const { result } = renderHook(() => useAppSettings())
    await waitFor(() => expect(result.current.settings.obsidianBaseUrl).toBe('http://127.0.0.1:27123'))
  })
})
