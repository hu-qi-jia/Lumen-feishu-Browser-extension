// 缓存清理：定期 / 手动清除「可再生」的运行时缓存。
//
// chrome.storage.local 里有两类数据：
//   1) 缓存（可再生，可安全清除）：抓取结果、翻译、企业下发的模型/App ID、租户域名等——
//      清掉后下次用到会自动重新拉取/推导。
//   2) 用户数据 / 配置 / 密钥（绝不能动）：会话、已保存的小程序/PPT、本地经验、撤销记录、
//      最近文件、PDF 历史、settings_v2、news_settings_v1、token、App Secret、_device_seed（加密
//      种子——清掉它会让所有加密值永久无法解密）。
//
// 本模块只删除第 1 类。CACHE_KEYS 是一份**人工维护的白名单**——要清别的键必须显式加进来，
// 这样任何「误伤用户数据」都要走 code review，而不是靠通配规则悄悄发生。
import { TENANT_ORIGIN_KEY } from './feishu/tenant'

/** 可再生缓存键的白名单（仅这些会被清除）。 */
export const CACHE_KEYS = [
  'news_cache_v1',             // GitHub Trending + 微博热搜抓取缓存（由 alarm 重新抓取）
  'news_translation_cache_v1', // GitHub 描述翻译缓存（下次翻译时重新生成）
  '_llm_managed_v1',           // 企业托管 LLM 配置（从代理重新下发）
  '_managed_app_id_v1',        // 企业托管 App ID（从代理重新下发）
  TENANT_ORIGIN_KEY,           // 租户域名提示（下次进入租户页面时重新推导）
] as const

/** 自动清理间隔（天）。0 = 关闭，仅手动清理。 */
export type CacheCleanupDays = 0 | 3 | 7 | 30

const SETTINGS_KEY = 'cache_settings_v1'
export const CACHE_CLEANUP_ALARM = 'cache-cleanup-v1'

export interface CacheSettings {
  intervalDays: CacheCleanupDays
  /** 上次清理的时间戳（ms）。用于展示「上次清理」，非清理逻辑必需。 */
  lastCleanedAt: number | null
}

export const DEFAULT_CACHE_SETTINGS: CacheSettings = { intervalDays: 0, lastCleanedAt: null }

// ─── storage helpers（typeof-chrome 守卫，保证测试/sandbox 可导入）──────────────

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

function storageGetMany(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((res) => {
    try {
      if (!hasStorage()) { res({}); return }
      chrome.storage.local.get(keys, (r) => res(r ?? {}))
    } catch { res({}) }
  })
}

function storageRemove(keys: string[]): Promise<void> {
  return new Promise((res) => {
    try {
      if (!hasStorage()) { res(); return }
      chrome.storage.local.remove(keys, () => res())
    } catch { res() }
  })
}

function storageSet(obj: Record<string, unknown>): Promise<void> {
  return new Promise((res) => {
    try {
      if (!hasStorage()) { res(); return }
      chrome.storage.local.set(obj, () => res())
    } catch { res() }
  })
}

// ─── 体积估算 ──────────────────────────────────────────────────────────────────

/** JSON 编码后的 UTF-8 字节数（缓存体积估算用；不涉及解密，纯大小）。 */
function byteLen(v: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(v ?? '')).length } catch { return String(v ?? '').length }
}

export interface CacheSize {
  /** 缓存键合计占用字节数。 */
  bytes: number
  /** 实际存在的缓存键数量（空键不计）。 */
  count: number
}

/** 仅统计缓存键的体积（不含用户数据）。 */
export async function cacheBytes(): Promise<CacheSize> {
  const entries = await storageGetMany([...CACHE_KEYS])
  let bytes = 0
  let count = 0
  for (const v of Object.values(entries)) {
    if (v == null) continue
    count++
    bytes += byteLen(v)
  }
  return { bytes, count }
}

// ─── 清理 ──────────────────────────────────────────────────────────────────────

export interface ClearResult {
  /** 本次释放的字节数（清理前的缓存体积）。 */
  freedBytes: number
  /** 清掉的缓存键数量。 */
  cleared: number
}

/**
 * 清除可再生缓存（仅 CACHE_KEYS 白名单）。返回释放的字节数。
 * 不触碰任何用户数据 / 配置 / 密钥 / 加密种子。
 */
export async function clearCache(): Promise<ClearResult> {
  const before = await cacheBytes()
  await storageRemove([...CACHE_KEYS])
  return { freedBytes: before.bytes, cleared: before.count }
}

// ─── 设置 ──────────────────────────────────────────────────────────────────────

export async function loadCacheSettings(): Promise<CacheSettings> {
  const stored = await storageGetMany([SETTINGS_KEY])
  const s = stored[SETTINGS_KEY] as Partial<CacheSettings> | undefined
  if (!s) return { ...DEFAULT_CACHE_SETTINGS }
  const intervalDays = ([0, 3, 7, 30] as const).includes(s.intervalDays as CacheCleanupDays)
    ? (s.intervalDays as CacheCleanupDays)
    : DEFAULT_CACHE_SETTINGS.intervalDays
  return {
    intervalDays,
    lastCleanedAt: typeof s.lastCleanedAt === 'number' ? s.lastCleanedAt : null,
  }
}

export async function saveCacheSettings(s: CacheSettings): Promise<void> {
  await storageSet({ [SETTINGS_KEY]: s })
}

// ─── chrome.alarms 生命周期（参考 news/alarm.ts）──────────────────────────────
//
// chrome.alarms 在浏览器关闭时停摆，打开后会补 fire 已过期的周期；所以「每 N 天」≈「每 N 天
// 的浏览器在线时长」。SW 被回收不影响——alarm 唤醒时会重新拉起 SW。

function hasAlarms(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.alarms
}

/** 按天数创建周期清理 alarm（先清旧的同名 alarm）。days < 1 时为空操作。 */
export function setupCacheCleanupAlarm(days: CacheCleanupDays): void {
  if (!hasAlarms() || days < 1) return
  const periodMin = days * 24 * 60
  chrome.alarms.clear(CACHE_CLEANUP_ALARM, () => {
    chrome.alarms.create(CACHE_CLEANUP_ALARM, { delayInMinutes: periodMin, periodInMinutes: periodMin })
  })
}

/** 清除清理 alarm（用户选「关闭」时调用）。 */
export function clearCacheCleanupAlarm(): void {
  if (!hasAlarms()) return
  chrome.alarms.clear(CACHE_CLEANUP_ALARM)
}

/** 按设置重 arm：关闭→清 alarm；否则按周期创建。 */
export function syncCacheCleanupAlarm(days: CacheCleanupDays): void {
  if (days < 1) { clearCacheCleanupAlarm(); return }
  setupCacheCleanupAlarm(days)
}
