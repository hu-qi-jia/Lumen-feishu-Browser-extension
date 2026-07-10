// 数据清理：清除全部用户数据（会话记录、保存的 PPT / 建站 / PDF、图片附件、本地经验、
// 资讯缓存、企业下发缓存等），只保留「配置 / 凭证」。供「清除数据」按钮和定期自动清理使用。
//
// 实现是「保留白名单、其余全删」：读出 chrome.storage.local 的全部键，删掉不在 PROTECTED_KEYS
// 里的。这样将来新增任何用户数据键都会自动纳入清理，不会因名单遗漏而残留。
//
// 安全：_device_seed 必须保留——它是加密种子，删了会让所有加密值（API Key / Token）永久无法
// 解密；_feishu_utoken_v1（飞书 OAuth 授权）也保留，避免清理后被强制重新授权。

/** 自动清理间隔（天）。0 = 关闭，仅手动清理。 */
export type CleanupIntervalDays = 0 | 3 | 7 | 30

const SETTINGS_KEY = 'cleanup_settings_v1'
export const CLEANUP_ALARM = 'data-cleanup-v1'

export interface CleanupSettings {
  intervalDays: CleanupIntervalDays
  /** 上次清理的时间戳（ms）。仅用于展示「上次清理」。 */
  lastCleanedAt: number | null
}

export const DEFAULT_CLEANUP_SETTINGS: CleanupSettings = { intervalDays: 0, lastCleanedAt: null }

/**
 * 保护名单：清除时保留的键 = 配置 + 凭证 + 加密种子 + 本清理自身的设置。
 * 主题色 / 外观模式存在 localStorage（不在 chrome.storage），天然不受影响，无需列入。
 */
const PROTECTED_KEYS = new Set<string>([
  'settings_v2',            // AppSettings：API Key / 模型 / 飞书 Token / 偏好
  '_device_seed',           // 加密种子（删了所有加密值失效）
  '_enterprise_policy_v1',  // 企业策略
  '_feishu_utoken_v1',      // 飞书 OAuth 授权（user_access_token bundle）
  '_user_app_creds_v1',     // 飞书自带 App 凭证
  '_app_secret_dev_v1',     // 记住的 App Secret
  'news_settings_v1',       // 资讯设置（刷新间隔 / 翻译引擎）
  '_user_skills_v1',        // 用户自定义技能（用户创建的配置，清理时保留）
  SETTINGS_KEY,             // 本清理设置自身
])

export function isProtectedKey(key: string): boolean {
  return PROTECTED_KEYS.has(key)
}

// ─── storage helpers（typeof-chrome 守卫，保证测试/sandbox 可导入）──────────────

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

function storageGetAll(): Promise<Record<string, unknown>> {
  return new Promise((res) => {
    try {
      if (!hasStorage()) { res({}); return }
      chrome.storage.local.get(null, (r) => res(r ?? {}))
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

/** JSON 编码后的 UTF-8 字节数（体积估算用；不涉及解密，纯大小）。 */
function byteLen(v: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(v ?? '')).length } catch { return String(v ?? '').length }
}

export interface CleanupImpact {
  /** 将被清除的字节数（非保护键合计）。 */
  bytes: number
  /** 将被清除的键数量。 */
  count: number
}

/** 「清除全部数据」会释放多少：仅统计非保护键。 */
export async function cleanupImpact(): Promise<CleanupImpact> {
  const all = await storageGetAll()
  let bytes = 0
  let count = 0
  for (const [k, v] of Object.entries(all)) {
    if (PROTECTED_KEYS.has(k) || v == null) continue
    count++
    bytes += byteLen(v)
  }
  return { bytes, count }
}

// ─── 清理 ──────────────────────────────────────────────────────────────────────

export interface CleanupResult {
  /** 删掉的键数。 */
  removedCount: number
  /** 保留的键数（保护键中实际存在的）。 */
  keptCount: number
  /** 释放的字节数。 */
  freedBytes: number
}

/**
 * 清除全部用户数据，只保留 PROTECTED_KEYS（配置 / 凭证 / 加密种子）。
 * 读出所有键 → 删掉非保护键。不可逆。
 */
export async function clearAllUserData(): Promise<CleanupResult> {
  const all = await storageGetAll()
  const toRemove = Object.keys(all).filter((k) => !PROTECTED_KEYS.has(k))
  let freedBytes = 0
  for (const k of toRemove) freedBytes += byteLen(all[k])
  if (toRemove.length) await storageRemove(toRemove)
  return { removedCount: toRemove.length, keptCount: Object.keys(all).length - toRemove.length, freedBytes }
}

// ─── 设置 ──────────────────────────────────────────────────────────────────────

export async function loadCleanupSettings(): Promise<CleanupSettings> {
  const stored = (await storageGetOne(SETTINGS_KEY)) as Partial<CleanupSettings> | undefined
  if (!stored) return { ...DEFAULT_CLEANUP_SETTINGS }
  const intervalDays = ([0, 3, 7, 30] as const).includes(stored.intervalDays as CleanupIntervalDays)
    ? (stored.intervalDays as CleanupIntervalDays)
    : DEFAULT_CLEANUP_SETTINGS.intervalDays
  return {
    intervalDays,
    lastCleanedAt: typeof stored.lastCleanedAt === 'number' ? stored.lastCleanedAt : null,
  }
}

async function storageGetOne(key: string): Promise<unknown> {
  return new Promise((res) => {
    try {
      if (!hasStorage()) { res(undefined); return }
      chrome.storage.local.get([key], (r) => res(r?.[key]))
    } catch { res(undefined) }
  })
}

export async function saveCleanupSettings(s: CleanupSettings): Promise<void> {
  await storageSet({ [SETTINGS_KEY]: s })
}

// ─── chrome.alarms 生命周期（参考 news/alarm.ts）──────────────────────────────

function hasAlarms(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.alarms
}

/** 按天数创建周期清理 alarm（先清旧的同名 alarm）。days < 1 时为空操作。 */
export function setupCleanupAlarm(days: CleanupIntervalDays): void {
  if (!hasAlarms() || days < 1) return
  const periodMin = days * 24 * 60
  chrome.alarms.clear(CLEANUP_ALARM, () => {
    chrome.alarms.create(CLEANUP_ALARM, { delayInMinutes: periodMin, periodInMinutes: periodMin })
  })
}

/** 清除清理 alarm（用户选「关闭」时调用）。 */
export function clearCleanupAlarm(): void {
  if (!hasAlarms()) return
  chrome.alarms.clear(CLEANUP_ALARM)
}

/** 按设置重 arm：关闭→清 alarm；否则按周期创建。 */
export function syncCleanupAlarm(days: CleanupIntervalDays): void {
  if (days < 1) { clearCleanupAlarm(); return }
  setupCleanupAlarm(days)
}
