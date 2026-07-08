import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppSettings } from '../types'

const mem: Record<string, unknown> = {}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test-ext-id-obsidian-http' },
  storage: { local: {
    get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
      const r: Record<string, unknown> = {}
      for (const k of keys) if (k in mem) r[k] = mem[k]
      cb(r)
    },
    set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, items); cb?.() },
  } },
}

const { obsidianFetch, buildObsidianUrl } = await import('./http')
const { saveObsidianToken } = await import('./auth')

const SETTINGS = { obsidianBaseUrl: 'http://127.0.0.1:27123' } as AppSettings

beforeEach(() => { for (const k of Object.keys(mem)) if (k !== '_device_seed') delete mem[k] })

describe('buildObsidianUrl', () => {
  it('joins base + path and trims slashes', () => {
    expect(buildObsidianUrl('http://127.0.0.1:27123/', 'vault/Note.md')).toBe('http://127.0.0.1:27123/vault/Note.md')
  })
  it('appends query params', () => {
    expect(buildObsidianUrl('http://127.0.0.1:27123', 'search/simple/', { query: 'a b' })).toBe('http://127.0.0.1:27123/search/simple/?query=a+b')
  })
})

describe('obsidianFetch — guard + auth + retry', () => {
  it('hits the built URL with a Bearer header when a token is stored', async () => {
    await saveObsidianToken('k-123')
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await obsidianFetch('GET', '', SETTINGS)
    expect(f).toHaveBeenCalledOnce()
    expect(f.mock.calls[0][0]).toBe('http://127.0.0.1:27123/')
    expect((f.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer k-123')
  })
  it('omits Authorization when no token stored (GET / is auth-optional)', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await obsidianFetch('GET', '', SETTINGS)
    expect((f.mock.calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined()
  })
  it('rejects BEFORE fetch when the URL is not loopback (guard)', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(obsidianFetch('GET', '', { obsidianBaseUrl: 'http://evil.com:27123' } as AppSettings)).rejects.toThrow(/出站被拦截/)
    expect(f).not.toHaveBeenCalled()
  })
  it('does NOT retry writes (POST fires once even on transient failure)', async () => {
    await saveObsidianToken('k')
    const f = vi.fn().mockRejectedValue(new Error('net'))
    vi.stubGlobal('fetch', f)
    await expect(obsidianFetch('POST', 'vault/x.md', SETTINGS, { body: 'x' })).rejects.toThrow()
    expect(f).toHaveBeenCalledOnce()
  })
})
