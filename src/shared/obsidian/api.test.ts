import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppSettings } from '../types'

const mem: Record<string, unknown> = {}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test-ext-id-obsidian-api' },
  storage: { local: {
    get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
      const r: Record<string, unknown> = {}
      for (const k of keys) if (k in mem) r[k] = mem[k]
      cb(r)
    },
    set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, items); cb?.() },
  } },
}

const { pingObsidian } = await import('./api')
const { saveObsidianToken } = await import('./auth')
const SETTINGS = { obsidianBaseUrl: 'http://127.0.0.1:27123' } as AppSettings

beforeEach(() => { for (const k of Object.keys(mem)) if (k !== '_device_seed') delete mem[k] })

describe('pingObsidian — reachability + auth probe', () => {
  it('reports ok + authenticated on 200 with a token', async () => {
    await saveObsidianToken('k')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true, vault: 'My' }), { status: 200 })))
    const r = await pingObsidian(SETTINGS)
    expect(r).toMatchObject({ ok: true, status: 200, authenticated: true, vault: 'My' })
  })
  it('treats 401 as reachable (server up, token wrong)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    const r = await pingObsidian(SETTINGS)
    expect(r.ok).toBe(true)
    expect(r.status).toBe(401)
  })
  it('reports not-ok on a network/CSP block (fetch throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')))
    const r = await pingObsidian(SETTINGS)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(0)
  })
})
