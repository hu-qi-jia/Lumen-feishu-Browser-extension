import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppSettings } from '../types'
import { encodeVaultPath } from './util'

// Mock ./http at the module level so the new CRUD tests can assert on obsidianFetch
// calls (signature = method, path, settings, opts). Hoisted so it applies before the
// dynamic import of ./api below. pingObsidian tests reuse the same mock (they previously
// stubbed global fetch directly — now obsidianFetch itself is the mock boundary).
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))
vi.mock('./http', () => ({ obsidianFetch: mockFetch }))

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

const { pingObsidian, recentNotes, searchVault, readNote, writeNote, deleteNote } = await import('./api')
const { saveObsidianToken } = await import('./auth')
const SETTINGS = { obsidianBaseUrl: 'http://127.0.0.1:27123' } as AppSettings

beforeEach(() => {
  for (const k of Object.keys(mem)) if (k !== '_device_seed') delete mem[k]
  mockFetch.mockReset()
})

describe('pingObsidian — reachability + auth probe', () => {
  it('reports ok + authenticated on 200 with a token', async () => {
    await saveObsidianToken('k')
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true, vault: 'My' }), { status: 200 }))
    const r = await pingObsidian(SETTINGS)
    expect(r).toMatchObject({ ok: true, status: 200, authenticated: true, vault: 'My' })
  })
  it('treats 401 as reachable (server up, token wrong)', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 401 }))
    const r = await pingObsidian(SETTINGS)
    expect(r.ok).toBe(true)
    expect(r.status).toBe(401)
  })
  it('reports not-ok on a network/CSP block (fetch throws)', async () => {
    mockFetch.mockRejectedValue(new Error('Failed to fetch'))
    const r = await pingObsidian(SETTINGS)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(0)
  })
})

const settings = { obsidianBaseUrl: 'http://127.0.0.1:27123' } as any
function jsonRes(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as any
}

describe('obsidian api — vault CRUD', () => {
  it('recentNotes: POST search/ JsonLogic {var:stat.mtime}, 客户端按 mtime 倒序 + 切片', async () => {
    mockFetch.mockResolvedValue(jsonRes([
      { filename: 'a.md', result: 100 },
      { filename: 'b.md', result: 300 },
      { filename: 'c.md', result: 200 },
    ]))
    const rows = await recentNotes(settings, 2)
    expect(mockFetch).toHaveBeenCalledWith('POST', 'search/', settings, expect.objectContaining({
      headers: { 'Content-Type': 'application/vnd.olrapi.jsonlogic+json' },
      body: JSON.stringify({ var: 'stat.mtime' }),
    }))
    expect(rows.map((r) => r.path)).toEqual(['b.md', 'c.md']) // 300, 200 → desc, sliced 2
    expect(rows[0].mtime).toBe(300)
  })

  it('searchVault: POST search/simple/?query=, 映射 filename+context', async () => {
    mockFetch.mockResolvedValue(jsonRes([
      { filename: 'notes/x.md', score: 5, matches: [{ context: 'hello world', match: { start: 0, end: 5 } }] },
    ]))
    const rows = await searchVault(settings, 'hello')
    expect(mockFetch).toHaveBeenCalledWith('POST', 'search/simple/', settings, expect.objectContaining({ params: { query: 'hello' } }))
    expect(rows[0]).toMatchObject({ path: 'notes/x.md', snippet: 'hello world', score: 5 })
  })

  it('searchVault: 空查询不发请求，返回 []', async () => {
    expect(await searchVault(settings, '   ')).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('readNote: GET vault/{path} 带 Accept text/markdown，返回正文', async () => {
    mockFetch.mockResolvedValue(jsonRes('# Title\nbody'))
    const md = await readNote(settings, 'Folder/My Note.md')
    expect(mockFetch).toHaveBeenCalledWith('GET', 'vault/' + encodeVaultPath('Folder/My Note.md'), settings, expect.objectContaining({ headers: { Accept: 'text/markdown' } }))
    expect(md).toBe('# Title\nbody')
  })

  it('writeNote: PUT vault/{path} text/markdown body', async () => {
    mockFetch.mockResolvedValue(jsonRes('', { status: 204, ok: true }))
    await writeNote(settings, 'new.md', '# Hi')
    expect(mockFetch).toHaveBeenCalledWith('PUT', 'vault/' + encodeVaultPath('new.md'), settings, expect.objectContaining({ headers: { 'Content-Type': 'text/markdown' }, body: '# Hi' }))
  })

  it('deleteNote: DELETE vault/{path}', async () => {
    mockFetch.mockResolvedValue(jsonRes('', { status: 204, ok: true }))
    await deleteNote(settings, 'old.md')
    expect(mockFetch).toHaveBeenCalledWith('DELETE', 'vault/' + encodeVaultPath('old.md'), settings, {})
  })

  it('401 → 友好的"重新接入"提示，而非裸状态码', async () => {
    mockFetch.mockResolvedValue(jsonRes({ message: 'unauthorized' }, { status: 401, ok: false }))
    await expect(readNote(settings, 'x.md')).rejects.toThrow(/API Key 无效或已失效/)
  })

  it('非 ok 非 401 → 抛状态码', async () => {
    mockFetch.mockResolvedValue(jsonRes({}, { status: 500, ok: false }))
    await expect(readNote(settings, 'x.md')).rejects.toThrow(/500/)
  })
})
