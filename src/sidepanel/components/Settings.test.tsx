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
  /** Click the "AI 模型" tab — these fields are gated behind tab navigation. */
  function switchToAiTab(container: HTMLElement) {
    const tabs = [...container.querySelectorAll('.settings-tab')]
    const aiTab = tabs.find((t) => t.textContent === '模型配置')!
    fireEvent.click(aiTab)
  }

  it('defaults Base URL to DeepSeek', () => {
    const { container } = renderSettings()
    switchToAiTab(container)
    const url = container.querySelector('input[type="url"]') as HTMLInputElement
    expect(url.value).toBe('https://api.deepseek.com')
  })

  it('picking 通义千问 fills its Base URL', () => {
    const { container } = renderSettings()
    switchToAiTab(container)
    const selects = [...container.querySelectorAll('select')]
    const provider = selects.find((s) => [...s.options].some((o) => o.value === 'qwen'))!
    fireEvent.change(provider, { target: { value: 'qwen' } })
    const url = container.querySelector('input[type="url"]') as HTMLInputElement
    expect(url.value).toContain('dashscope')
  })

  it('model field is free-text (input, not locked select)', () => {
    const { container } = renderSettings()
    switchToAiTab(container)
    // Model is an <input list=model-suggestions>, so any latest id can be typed
    expect(container.querySelector('input[list="model-suggestions"]')).toBeTruthy()
  })
})

describe('Settings — appearance accent', () => {
  it('clicking a swatch calls onAccentChange with a hex', () => {
    const onAccentChange = vi.fn()
    const { container } = renderSettings({ onAccentChange })
    const swatches = container.querySelectorAll('.accent-swatch')
    expect(swatches.length).toBeGreaterThan(1)
    fireEvent.click(swatches[1])
    expect(onAccentChange).toHaveBeenCalledOnce()
    expect(onAccentChange.mock.calls[0][0]).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('Settings — cache cleanup (general tab)', () => {
  // General tab reads/writes chrome.storage.local for the cache feature; mock it so the
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

  it('renders the cache section with a clear button on the general tab', () => {
    mockChromeStorage({ news_cache_v1: { x: 1 } })
    const { getByText } = renderSettings()
    expect(getByText('立即清理缓存')).toBeTruthy()
  })

  it('clicking 立即清理缓存 wipes ONLY cache keys — never settings / device seed', async () => {
    const { removed, store } = mockChromeStorage({
      news_cache_v1: { x: 1 },
      news_translation_cache_v1: { h: '译' },
      settings_v2: { openaiApiKey: 'enc' },
      _device_seed: 'THE-SEED',
      sessions_v1: [{ id: 'keep' }],
    })
    const { getByText } = renderSettings()
    fireEvent.click(getByText('立即清理缓存'))
    // clearCache is async; the success message is the reliable completion signal.
    await waitFor(() => expect(getByText(/已清理/)).toBeTruthy())
    const removedKeys = removed.flat()
    expect(removedKeys).toContain('news_cache_v1')
    expect(removedKeys).toContain('news_translation_cache_v1')
    // user data / config / crypto seed must survive
    expect(removedKeys).not.toContain('settings_v2')
    expect(removedKeys).not.toContain('_device_seed')
    expect(removedKeys).not.toContain('sessions_v1')
    expect(store._device_seed).toBe('THE-SEED')
    expect(store.settings_v2).toEqual({ openaiApiKey: 'enc' })
  })
})
