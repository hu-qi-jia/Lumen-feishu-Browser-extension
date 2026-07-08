// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'
import Settings from './Settings'

afterEach(cleanup)

function renderSettings(overrides: Partial<Parameters<typeof Settings>[0]> = {}) {
  const props = {
    settings: { ...DEFAULT_SETTINGS },
    accent: '#4f6bff',
    onAccentChange: vi.fn(),
    theme: 'light' as const,
    onThemeChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  return { ...render(<Settings {...props} />), props }
}

describe('Settings — LLM provider preset', () => {
  /** Click a tab by its visible label. */
  function switchToTab(container: HTMLElement, label: string) {
    const tabs = [...container.querySelectorAll('.settings-tab')]
    const tab = tabs.find((t) => t.textContent === label)!
    fireEvent.click(tab)
  }

  /** Click the "AI 模型" tab — these fields are gated behind tab navigation. */
  function switchToAiTab(container: HTMLElement) {
    switchToTab(container, '模型配置')
  }

  it('defaults Base URL to DeepSeek', () => {
    const { container } = renderSettings()
    switchToAiTab(container)
    const url = container.querySelector('input[type="url"]') as HTMLInputElement
    expect(url.value).toBe('https://api.deepseek.com')
  })

  it('model field is free-text (input, not locked select)', () => {
    const { container } = renderSettings()
    switchToAiTab(container)
    // Model is an <input list=model-suggestions>, so any latest id can be typed
    expect(container.querySelector('input[list="model-suggestions"]')).toBeTruthy()
  })
})

describe('Settings — appearance accent', () => {
  it('clicking a swatch on the 外观 tab calls onAccentChange with a hex', () => {
    const onAccentChange = vi.fn()
    const { container } = renderSettings({ onAccentChange })
    const tabs = [...container.querySelectorAll('.settings-tab')]
    const appearanceTab = tabs.find((t) => t.textContent === '外观')!
    fireEvent.click(appearanceTab)
    const swatches = container.querySelectorAll('.accent-swatch')
    expect(swatches.length).toBeGreaterThan(1)
    fireEvent.click(swatches[1])
    expect(onAccentChange).toHaveBeenCalledOnce()
    expect(onAccentChange.mock.calls[0][0]).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('Settings — data cleanup (backup tab)', () => {
  // 数据与备份 tab reads/writes chrome.storage.local for the data-cleanup feature; mock it so the
  // section mounts with real data and the clear button actually invokes storage.remove.
  function mockChromeStorage(seed: Record<string, unknown> = {}) {
    const store: Record<string, unknown> = { ...seed }
    const removed: string[][] = []
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: (keys: unknown, cb: (r: Record<string, unknown>) => void) => {
            if (keys === null || keys === undefined) { cb({ ...store }); return }
            const ks = Array.isArray(keys) ? keys : [keys]
            const o: Record<string, unknown> = {}
            for (const k of ks) if (k in store) o[k as string] = store[k as string]
            cb(o)
          },
          set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(store, items); cb?.() },
          remove: (keys: string | string[], cb?: () => void) => {
            const ks = Array.isArray(keys) ? keys : [keys]
            removed.push(ks)
            for (const k of ks) delete store[k as string]
            cb?.()
          },
        },
      },
      runtime: { getManifest: () => ({ version: 'test' }) },
    })
    return { removed, store }
  }
  afterEach(() => vi.unstubAllGlobals())

  it('renders the data-cleanup section with a 清除全部数据 button on the 数据与备份 tab', () => {
    mockChromeStorage({ sessions_index_v1: { x: 1 } })
    const { container, getByText } = renderSettings()
    const tabs = [...container.querySelectorAll('.settings-tab')]
    const backupTab = tabs.find((t) => t.textContent === '数据与备份')!
    fireEvent.click(backupTab)
    expect(getByText('清除全部数据')).toBeTruthy()
  })

  it('clearing requires a two-step confirm, then wipes content but keeps settings/seed/token', async () => {
    const { removed, store } = mockChromeStorage({
      sessions_index_v1: { sessions: [{ id: 's1' }] },
      msgs_s1_v1: [{ id: 'm1' }],
      slides_decks_v1: [{ id: 'd1' }],
      news_cache_v1: { x: 1 },
      settings_v2: { openaiApiKey: 'enc' },
      _device_seed: 'THE-SEED',
      _feishu_utoken_v1: 'enc-utoken',
    })
    const { container, getByText } = renderSettings()
    const tabs = [...container.querySelectorAll('.settings-tab')]
    const backupTab = tabs.find((t) => t.textContent === '数据与备份')!
    fireEvent.click(backupTab)
    // step 1: the danger button opens the confirm dialog (no removal yet)
    fireEvent.click(getByText('清除全部数据'))
    expect(getByText('删除')).toBeTruthy()
    // step 2: confirm → actually clears
    fireEvent.click(getByText('删除'))
    await waitFor(() => expect(getByText(/已清除/)).toBeTruthy())
    const removedKeys = removed.flat()
    expect(removedKeys).toContain('sessions_index_v1')
    expect(removedKeys).toContain('msgs_s1_v1')
    expect(removedKeys).toContain('slides_decks_v1')
    expect(removedKeys).toContain('news_cache_v1')
    // config / crypto seed / Feishu OAuth must survive
    expect(removedKeys).not.toContain('settings_v2')
    expect(removedKeys).not.toContain('_device_seed')
    expect(removedKeys).not.toContain('_feishu_utoken_v1')
    expect(store._device_seed).toBe('THE-SEED')
    expect(store._feishu_utoken_v1).toBe('enc-utoken')
    expect(store.settings_v2).toEqual({ openaiApiKey: 'enc' })
  })
})
