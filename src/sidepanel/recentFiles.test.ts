import { describe, it, expect } from 'vitest'
import { upsertRecent, removeRecent, MAX_RECENT, cleanRecentTitle, displayName } from './recentFiles'
import type { RecentFile } from './recentFiles'

const f = (token: string, title: string, kind: RecentFile['kind'], seen: number): RecentFile =>
  ({ token, title, kind, seen })

describe('upsertRecent', () => {
  it('prepends a new file', () => {
    expect(upsertRecent([], { token: 'a', title: 'A', kind: 'doc' }, 100)).toEqual([
      f('a', 'A', 'doc', 100),
    ])
  })

  it('moves an existing file to the front and refreshes its title + seen', () => {
    const files = [f('a', 'A', 'doc', 1), f('b', 'B', 'sheet', 2)]
    const out = upsertRecent(files, { token: 'a', title: 'A2', kind: 'doc' }, 99)
    expect(out).toEqual([f('a', 'A2', 'doc', 99), f('b', 'B', 'sheet', 2)])
  })

  it('is a no-op (same ref) when the entry is already top with the same title', () => {
    const files = [f('a', 'A', 'doc', 1)]
    expect(upsertRecent(files, { token: 'a', title: 'A', kind: 'doc' }, 99)).toBe(files)
  })

  it('caps at MAX_RECENT, dropping the oldest (tail)', () => {
    const files = Array.from({ length: MAX_RECENT }, (_, i) => f(`t${i}`, `T${i}`, 'doc', i))
    const out = upsertRecent(files, { token: 'new', title: 'N', kind: 'sheet' }, 999)
    expect(out).toHaveLength(MAX_RECENT)
    expect(out[0].token).toBe('new')
    expect(out.find((x) => x.token === `t${MAX_RECENT - 1}`)).toBeUndefined()
  })

  it('keeps each entry kind independent (wiki stays wiki for pin correctness)', () => {
    const out = upsertRecent([f('a', 'A', 'doc', 1)], { token: 'w', title: 'W', kind: 'wiki' }, 2)
    expect(out[0].kind).toBe('wiki')
    expect(out[1].kind).toBe('doc')
  })

  it('dedupes by token even across different kinds', () => {
    const files = [f('a', 'A', 'doc', 1), f('b', 'B', 'sheet', 2)]
    const out = upsertRecent(files, { token: 'b', title: 'B2', kind: 'sheet' }, 3)
    expect(out.filter((x) => x.token === 'b')).toHaveLength(1)
    expect(out[0].token).toBe('b')
  })
})

describe('removeRecent', () => {
  it('drops the matching token and keeps order', () => {
    const files = [f('a', 'A', 'doc', 3), f('b', 'B', 'sheet', 2), f('c', 'C', 'base', 1)]
    expect(removeRecent(files, 'b').map((x) => x.token)).toEqual(['a', 'c'])
  })

  it('is a no-op (same ref) when the token is absent', () => {
    const files = [f('a', 'A', 'doc', 1)]
    expect(removeRecent(files, 'zzz')).toBe(files)
  })
})

describe('cleanRecentTitle / displayName', () => {
  it('strips the Feishu brand suffix from a real title', () => {
    expect(cleanRecentTitle('季度复盘 - 飞书云文档', 'doc')).toBe('季度复盘')
  })

  it('never returns the raw placeholder "飞书云文档" — falls back per kind', () => {
    // The bug: a loading Feishu page is titled "飞书云文档"; the dropdown must not show that.
    expect(cleanRecentTitle('飞书云文档', 'doc')).toBe('未命名文档')
    expect(cleanRecentTitle('飞书云文档', 'sheet')).toBe('未命名表格')
    expect(cleanRecentTitle('飞书云文档', 'base')).toBe('未命名多维表格')
    expect(cleanRecentTitle('', 'doc')).toBe('未命名文档')
  })

  it('displayName reads the row title + kind', () => {
    expect(displayName(f('a', '飞书云文档', 'base', 1))).toBe('未命名多维表格')
    expect(displayName(f('a', '销售表 — 飞书表格', 'sheet', 1))).toBe('销售表')
  })
})
