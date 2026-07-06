import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory chrome mock: storage.local (get/remove/set) + alarms (create/clear).
// Mirrors the configBackup.test.ts mockStorage pattern.
function mockChrome(seed: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...seed }
  const alarms = {
    create: vi.fn(),
    clear: vi.fn((_name: string, cb?: () => void) => cb?.()),
  }
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
        remove: (keys: string | string[], cb?: () => void) => {
          const ks = Array.isArray(keys) ? keys : [keys]
          for (const k of ks) delete store[k as string]
          cb?.()
        },
        set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(store, items); cb?.() },
      },
    },
    alarms,
  })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  return { store, alarms }
}

import {
  CACHE_KEYS,
  clearCache,
  cacheBytes,
  loadCacheSettings,
  saveCacheSettings,
  syncCacheCleanupAlarm,
  CACHE_CLEANUP_ALARM,
} from './cacheCleanup'

describe('cacheBytes', () => {
  beforeEach(() => mockChrome())
  it('counts only cache keys, not user data', async () => {
    mockChrome({
      news_cache_v1: { items: [1, 2, 3] }, // cache
      news_translation_cache_v1: { a: 'x' }, // cache
      settings_v2: { openaiApiKey: 'enc-secret' }, // NOT cache
      _device_seed: 'seed-that-must-not-be-touched', // NOT cache
      sessions_v1: [{ id: 'big' }], // NOT cache
    })
    const size = await cacheBytes()
    expect(size.count).toBe(2)
    expect(size.bytes).toBeGreaterThan(0)
    // sanity: a value that size matches one of the cache payloads
    const expected = new TextEncoder().encode(JSON.stringify({ items: [1, 2, 3] })).length
    expect(size.bytes).toBeGreaterThan(expected - 1)
  })
  it('returns zero when no cache present', async () => {
    mockChrome({ settings_v2: {}, sessions_v1: [] })
    const size = await cacheBytes()
    expect(size.bytes).toBe(0)
    expect(size.count).toBe(0)
  })
})

describe('clearCache', () => {
  it('removes ONLY the cache keys and preserves user data / config / seed', async () => {
    const { store } = mockChrome({
      news_cache_v1: { x: 1 },
      news_translation_cache_v1: { h: '译' },
      _llm_managed_v1: 'enc-cfg',
      _managed_app_id_v1: 'cli_x',
      _feishu_tenant_origin: 'https://example.feishu.cn',
      settings_v2: { openaiApiKey: 'enc' },
      _device_seed: 'THE-SEED',
      news_settings_v1: { interval: 30 },
      sessions_v1: [{ id: 'keep-me' }],
    })
    const res = await clearCache()
    // every cache key gone
    for (const k of CACHE_KEYS) expect(store[k]).toBeUndefined()
    // everything else intact — especially the crypto seed
    expect(store._device_seed).toBe('THE-SEED')
    expect(store.settings_v2).toEqual({ openaiApiKey: 'enc' })
    expect(store.news_settings_v1).toEqual({ interval: 30 })
    expect(store.sessions_v1).toEqual([{ id: 'keep-me' }])
    expect(res.cleared).toBe(5)
    expect(res.freedBytes).toBeGreaterThan(0)
  })
  it('reports 0 when nothing to clear', async () => {
    mockChrome({ settings_v2: {} })
    const res = await clearCache()
    expect(res.cleared).toBe(0)
    expect(res.freedBytes).toBe(0)
  })
})

describe('cache settings round-trip', () => {
  beforeEach(() => mockChrome())
  it('returns defaults when unset', async () => {
    const s = await loadCacheSettings()
    expect(s.intervalDays).toBe(0)
    expect(s.lastCleanedAt).toBeNull()
  })
  it('persists and reloads', async () => {
    await saveCacheSettings({ intervalDays: 7, lastCleanedAt: 1234 })
    const s = await loadCacheSettings()
    expect(s.intervalDays).toBe(7)
    expect(s.lastCleanedAt).toBe(1234)
  })
  it('coerces an unknown interval back to default (defensive)', async () => {
    await saveCacheSettings({ intervalDays: 99 as unknown as 7, lastCleanedAt: null })
    const s = await loadCacheSettings()
    expect(s.intervalDays).toBe(0)
  })
})

describe('syncCacheCleanupAlarm', () => {
  beforeEach(() => mockChrome())
  it('creates a periodic alarm with period = days*24*60 for a real interval', () => {
    const { alarms } = mockChrome()
    syncCacheCleanupAlarm(7)
    expect(alarms.clear).toHaveBeenCalledWith(CACHE_CLEANUP_ALARM, expect.any(Function))
    expect(alarms.create).toHaveBeenCalledWith(
      CACHE_CLEANUP_ALARM,
      { delayInMinutes: 7 * 24 * 60, periodInMinutes: 7 * 24 * 60 },
    )
  })
  it('clears the alarm and creates nothing when interval is 0 (off)', () => {
    const { alarms } = mockChrome()
    syncCacheCleanupAlarm(0)
    expect(alarms.clear).toHaveBeenCalledWith(CACHE_CLEANUP_ALARM)
    expect(alarms.create).not.toHaveBeenCalled()
  })
})
