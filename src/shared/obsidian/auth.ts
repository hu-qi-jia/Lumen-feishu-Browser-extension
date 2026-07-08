/** Obsidian Local REST API token storage (encrypted, dedicated key).
 *  Mirrors feishu/auth.ts utoken: stored under its OWN storage key (NOT in the AppSettings
 *  blob) so it never appears in exported/backed-up settings. */
import { encryptField, decryptField } from '../crypto'

const OBSIDIAN_TOKEN_KEY = '_obsidian_token_v1'

function storageGet(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try { chrome.storage.local.get([key], (r) => resolve(r?.[key])) } catch { resolve(undefined) }
  })
}
function storageSet(key: string, val: unknown): Promise<void> {
  return new Promise((resolve) => {
    try { chrome.storage.local.set({ [key]: val }, () => resolve()) } catch { resolve() }
  })
}

/** Persist the Obsidian API key (encrypted). Empty/undefined clears it. */
export async function saveObsidianToken(token: string): Promise<void> {
  await storageSet(OBSIDIAN_TOKEN_KEY, await encryptField(token || ''))
}

/** Drop the stored Obsidian token (disconnect). */
export async function clearObsidianToken(): Promise<void> {
  await storageSet(OBSIDIAN_TOKEN_KEY, '')
}

/** Read the stored token without throwing ('' when absent or corrupt). */
export async function getObsidianToken(): Promise<string> {
  const raw = await storageGet(OBSIDIAN_TOKEN_KEY)
  if (!raw || typeof raw !== 'string') return ''
  try {
    return decryptField(raw)
  } catch {
    // Corrupt/tampered ciphertext → treat as no token (prompt reconnect), don't throw.
    // Mirrors feishu/auth.ts loadUserToken: a bad stored value must diagnose as
    // "no valid token → reconnect", not masquerade as a network/CSP/PNA block in pingObsidian.
    return ''
  }
}

/** Resolve the API key, throwing a clear setup message when absent. */
export async function resolveObsidianToken(): Promise<string> {
  const token = (await getObsidianToken()).trim()
  if (!token) throw new Error('未连接 Obsidian 知识库 — 请到「应用 → 知识库」填入 Local REST API 的 API Key。')
  return token
}
