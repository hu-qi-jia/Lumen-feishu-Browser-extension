import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory chrome mock: storage.local (get(null)/get([key])/remove/set) + alarms (create/clear).
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
  clearAllUserData,
  cleanupImpact,
  isProtectedKey,
  loadCleanupSettings,
  saveCleanupSettings,
  syncCleanupAlarm,
  CLEANUP_ALARM,
} from './dataCleanup'

// A representative storage snapshot: every category the extension writes.
function fullStore(): Record<string, unknown> {
  return {
    // ── 保护：配置 / 凭证 / 种子 ──
    settings_v2: { openaiApiKey: 'enc', openaiModel: 'deepseek' },
    _device_seed: 'THE-SEED',
    _enterprise_policy_v1: 'enc-policy',
    _feishu_utoken_v1: 'enc-utoken',
    _user_app_creds_v1: { appId: 'cli_x' },
    _app_secret_dev_v1: 'enc-secret',
    news_settings_v1: { interval: 30, translationEngine: 'bing' },
    cleanup_settings_v1: { intervalDays: 7, lastCleanedAt: 1 },
    // ── 清除：用户内容 / 派生数据 / 缓存 ──
    sessions_index_v1: { sessions: [{ id: 's1' }], activeId: 's1' },
    msgs_s1_v1: [{ id: 'm1', attachments: [{ dataUrl: 'data:image/png;base64,AAA' }] }],
    slides_decks_v1: [{ id: 'd1', slides: [{ images: [{ dataUrl: 'data:image/png;base64,BBB' }] }] }],
    dataviz_v1: [{ id: 'v1', code: 'ui.site(...)' }],
    pdfHistory_v1: [{ id: 'p1' }],
    recentFiles_v1: [{ token: 'x' }],
    _learned_recipes_v1: [{ id: 'r1' }],
    _last_delete_undo_v1: { ops: [] },
    news_cache_v1: { github: { items: [] } },
    news_translation_cache_v1: { h: { zh: '译', ts: 1 } },
    _llm_managed_v1: 'enc-llm',
    _managed_app_id_v1: 'cli_y',
    _feishu_tenant_origin: 'https://x.feishu.cn',
    _skill_src_v1: 'abcdef0123456789',
    _artifact_autorestored_v1: 1,
    docBinding_v1: { mode: 'auto' },
  }
}

const PROTECTED = [
  'settings_v2', '_device_seed', '_enterprise_policy_v1', '_feishu_utoken_v1',
  '_user_app_creds_v1', '_app_secret_dev_v1', 'news_settings_v1', 'cleanup_settings_v1',
]

const CLEARED = [
  'sessions_index_v1', 'msgs_s1_v1', 'slides_decks_v1', 'dataviz_v1', 'pdfHistory_v1',
  'recentFiles_v1', '_learned_recipes_v1', '_last_delete_undo_v1', 'news_cache_v1',
  'news_translation_cache_v1', '_llm_managed_v1', '_managed_app_id_v1',
  '_feishu_tenant_origin', '_skill_src_v1', '_artifact_autorestored_v1', 'docBinding_v1',
]

describe('isProtectedKey', () => {
  beforeEach(() => mockChrome())
  it('flags exactly the config/credentials/seed keys', () => {
    for (const k of PROTECTED) expect(isProtectedKey(k)).toBe(true)
    for (const k of CLEARED) expect(isProtectedKey(k)).toBe(false)
  })
})

describe('clearAllUserData', () => {
  it('removes ALL content/cache keys and keeps ONLY config + seed + credentials', async () => {
    const { store } = mockChrome(fullStore())
    const res = await clearAllUserData()
    for (const k of PROTECTED) expect(store[k], `${k} must survive`).toBeDefined()
    for (const k of CLEARED) expect(store[k], `${k} must be cleared`).toBeUndefined()
    // the safety-critical ones, explicit:
    expect(store._device_seed).toBe('THE-SEED')
    expect(store._feishu_utoken_v1).toBe('enc-utoken')
    expect(store.settings_v2).toEqual({ openaiApiKey: 'enc', openaiModel: 'deepseek' })
    expect(res.removedCount).toBe(CLEARED.length)
    expect(res.keptCount).toBe(PROTECTED.length)
    expect(res.freedBytes).toBeGreaterThan(0)
  })

  it('wipes image-bearing keys (chat attachments + PPT images)', async () => {
    const { store } = mockChrome(fullStore())
    await clearAllUserData()
    expect(store.msgs_s1_v1).toBeUndefined() // chat image attachments
    expect(store.slides_decks_v1).toBeUndefined() // PPT slide images
  })

  it('is a no-op (0 removed) when only protected keys exist', async () => {
    const only: Record<string, unknown> = {}
    for (const k of PROTECTED) only[k] = 'x'
    mockChrome(only)
    const res = await clearAllUserData()
    expect(res.removedCount).toBe(0)
    expect(res.freedBytes).toBe(0)
  })
})

describe('cleanupImpact', () => {
  beforeEach(() => mockChrome())
  it('counts only non-protected keys', async () => {
    mockChrome(fullStore())
    const impact = await cleanupImpact()
    expect(impact.count).toBe(CLEARED.length)
    expect(impact.bytes).toBeGreaterThan(0)
  })
})

describe('cleanup settings round-trip', () => {
  beforeEach(() => mockChrome())
  it('returns defaults when unset', async () => {
    const s = await loadCleanupSettings()
    expect(s.intervalDays).toBe(0)
    expect(s.lastCleanedAt).toBeNull()
  })
  it('persists and reloads', async () => {
    await saveCleanupSettings({ intervalDays: 7, lastCleanedAt: 1234 })
    const s = await loadCleanupSettings()
    expect(s.intervalDays).toBe(7)
    expect(s.lastCleanedAt).toBe(1234)
  })
  it('coerces an unknown interval back to default (defensive)', async () => {
    await saveCleanupSettings({ intervalDays: 99 as unknown as 7, lastCleanedAt: null })
    const s = await loadCleanupSettings()
    expect(s.intervalDays).toBe(0)
  })
})

describe('syncCleanupAlarm', () => {
  beforeEach(() => mockChrome())
  it('creates a periodic alarm with period = days*24*60 for a real interval', () => {
    const { alarms } = mockChrome()
    syncCleanupAlarm(7)
    expect(alarms.clear).toHaveBeenCalledWith(CLEANUP_ALARM, expect.any(Function))
    expect(alarms.create).toHaveBeenCalledWith(
      CLEANUP_ALARM,
      { delayInMinutes: 7 * 24 * 60, periodInMinutes: 7 * 24 * 60 },
    )
  })
  it('clears the alarm and creates nothing when interval is 0 (off)', () => {
    const { alarms } = mockChrome()
    syncCleanupAlarm(0)
    expect(alarms.clear).toHaveBeenCalledWith(CLEANUP_ALARM)
    expect(alarms.create).not.toHaveBeenCalled()
  })
})
