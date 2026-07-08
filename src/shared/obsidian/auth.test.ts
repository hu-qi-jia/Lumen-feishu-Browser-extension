import { describe, it, expect, beforeEach } from 'vitest'

// In-memory chrome.storage + runtime.id for crypto key derivation.
const mem: Record<string, unknown> = {}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test-ext-id-obsidian-auth' },
  storage: { local: {
    get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
      const r: Record<string, unknown> = {}
      for (const k of keys) if (k in mem) r[k] = mem[k]
      cb(r)
    },
    set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, items); cb?.() },
  } },
}

const { saveObsidianToken, clearObsidianToken, resolveObsidianToken, getObsidianToken } = await import('./auth')

beforeEach(() => {
  for (const k of Object.keys(mem)) if (k !== '_device_seed') delete mem[k]
})

describe('resolveObsidianToken — encrypted Obsidian API key', () => {
  it('round-trips a saved token; plaintext never sits in storage', async () => {
    await saveObsidianToken('obs-key-abc-123')
    expect(mem['_obsidian_token_v1']).not.toBe('obs-key-abc-123') // encrypted at rest
    expect(await resolveObsidianToken()).toBe('obs-key-abc-123')
  })
  it('throws a clear setup message when no token is stored', async () => {
    await clearObsidianToken()
    await expect(resolveObsidianToken()).rejects.toThrow(/未连接|API Key/)
  })
  it('clear removes the token', async () => {
    await saveObsidianToken('k')
    await clearObsidianToken()
    await expect(resolveObsidianToken()).rejects.toThrow()
  })
  it('treats corrupt ciphertext as no-token instead of throwing', async () => {
    // Directly poison the store with bytes that aren't valid AES-GCM ciphertext
    // (nor valid base64) under the derived key — simulating tampering/corruption.
    mem['_obsidian_token_v1'] = 'not-valid-ciphertext-zzz'
    expect(await getObsidianToken()).toBe('') // must NOT throw — degrade to no-token
    await expect(resolveObsidianToken()).rejects.toThrow(/未连接|API Key/) // surfaces setup message
  })
})
