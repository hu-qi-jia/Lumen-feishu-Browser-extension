import { describe, it, expect } from 'vitest'
import type { ChatMessage, SessionIndex, SessionMeta } from '@/shared/types'
import {
  emptyIndex, ensureSession, removeSession, removeSessionsByAppToken, capSessions, MAX_SESSIONS,
  previewFromMessages, groupSessions, stampKind, resolveSessionTitle, GENERAL_GROUP_KEY,
  messagesForRetry,
} from './logic'

// Deterministic id generator for assertions.
function ids() {
  let n = 0
  return () => `s${++n}`
}

describe('ensureSession', () => {
  it('creates a document session bound to appToken and indexes it', () => {
    const { idx, id, created } = ensureSession(emptyIndex(), 'appA', ids())
    expect(created).toBe(true)
    expect(id).toBe('s1')
    expect(idx.byAppToken).toEqual({ appA: 's1' })
    expect(idx.sessions[0]).toMatchObject({ appToken: 'appA', titleResolved: false })
  })

  it('reuses the existing session for the same appToken', () => {
    const first = ensureSession(emptyIndex(), 'appA', ids())
    const again = ensureSession(first.idx, 'appA', ids())
    expect(again.created).toBe(false)
    expect(again.id).toBe('s1')
    expect(again.idx).toBe(first.idx) // unchanged
  })

  it('creates and reuses a single general session for null appToken', () => {
    const gen = ids()
    const a = ensureSession(emptyIndex(), null, gen)
    expect(a.idx.generalId).toBe('s1')
    expect(a.idx.sessions[0]).toMatchObject({ appToken: null, title: '通用会话', titleResolved: true })
    const b = ensureSession(a.idx, null, gen)
    expect(b.created).toBe(false)
    expect(b.id).toBe('s1')
  })

  it('keeps document and general sessions separate', () => {
    const gen = ids()
    const doc = ensureSession(emptyIndex(), 'appA', gen)
    const both = ensureSession(doc.idx, null, gen)
    expect(both.idx.sessions).toHaveLength(2)
    expect(both.idx.byAppToken).toEqual({ appA: 's1' })
    expect(both.idx.generalId).toBe('s2')
  })

  it('stamps the Feishu kind onto a newly created session', () => {
    const { idx } = ensureSession(emptyIndex(), 'appA', ids(), 'sheet')
    expect(idx.sessions[0].kind).toBe('sheet')
  })

  it('does not overwrite an existing session when called again with a different kind', () => {
    const first = ensureSession(emptyIndex(), 'appA', ids(), 'sheet')
    const again = ensureSession(first.idx, 'appA', ids(), 'doc')
    expect(again.created).toBe(false)
    expect(again.idx).toBe(first.idx) // reused unchanged — kind NOT clobbered
  })

  it('backfills a missing kind on a legacy session when the kind becomes known', () => {
    // Simulate a session created before `kind` existed (no kind field).
    const legacy = ensureSession(emptyIndex(), 'appA', ids())
    expect(legacy.idx.sessions[0].kind).toBeUndefined()
    const out = ensureSession(legacy.idx, 'appA', ids(), 'base')
    expect(out.created).toBe(false)
    expect(out.idx.sessions.find((s) => s.appToken === 'appA')?.kind).toBe('base')
  })

  it('upgrades an unresolved wiki session to its real kind', () => {
    const wiki = ensureSession(emptyIndex(), 'wikiA', ids(), 'wiki')
    expect(wiki.idx.sessions[0].kind).toBe('wiki')
    const out = ensureSession(wiki.idx, 'wikiA', ids(), 'base')
    expect(out.idx.sessions.find((s) => s.appToken === 'wikiA')?.kind).toBe('base')
  })
})

describe('removeSession', () => {
  it('removes a non-active session and clears its appToken index', () => {
    const gen = ids()
    let idx = ensureSession(emptyIndex(), 'appA', gen).idx   // s1 (doc appA)
    idx = ensureSession(idx, null, gen).idx                  // s2 (general)
    idx = { ...idx, activeId: idx.generalId }                // general active
    const out = removeSession(idx, idx.byAppToken['appA'], gen)
    expect(out.idx.sessions.some((s) => s.appToken === 'appA')).toBe(false)
    expect(out.idx.byAppToken['appA']).toBeUndefined()
    expect(out.activeId).toBe(idx.generalId) // active unchanged
  })

  it('deleting the ONLY session under a doc falls back to general (no recreate)', () => {
    // The bug this fixes: deleting the last session under the current doc used to recreate
    // an empty doc session, so it looked like it "couldn't be deleted". It's now truly gone.
    const gen = ids()
    let idx = ensureSession(emptyIndex(), 'appA', gen).idx   // s1 (doc appA, the only one)
    idx = ensureSession(idx, null, gen).idx                  // s2 (general)
    idx = { ...idx, activeId: idx.byAppToken['appA'] }       // the doc session is active
    const out = removeSession(idx, idx.byAppToken['appA'], gen)
    expect(out.idx.sessions.some((s) => s.appToken === 'appA')).toBe(false) // truly removed
    expect(out.idx.byAppToken['appA']).toBeUndefined()
    expect(out.activeId).toBe(idx.generalId) // landed on the general session, not a new appA
  })

  it('deleting the active doc session falls back to a sibling of the same doc', () => {
    // Two sessions under appA; the byAppToken shortcut moves to the survivor, which also
    // becomes active so the user stays on the same document.
    const gen = ids()
    let idx = ensureSession(emptyIndex(), 'appA', gen).idx   // s1
    const s2: SessionMeta = { id: 's2', title: 't', appToken: 'appA', createdAt: 0, updatedAt: 0, messageCount: 0, titleResolved: true }
    idx = { ...idx, sessions: [s2, ...idx.sessions], byAppToken: { ...idx.byAppToken } }
    idx = { ...idx, activeId: 's1' }
    const out = removeSession(idx, 's1', gen)
    expect(out.idx.sessions.some((s) => s.id === 's1')).toBe(false)
    expect(out.idx.byAppToken['appA']).toBe('s2')        // shortcut handed to the sibling
    expect(out.activeId).toBe('s2')                       // landed on the sibling
    expect(out.idx.sessions.some((s) => s.appToken === 'appA')).toBe(true) // doc still present
  })

  it('is a no-op for an unknown id', () => {
    const idx = ensureSession(emptyIndex(), 'appA', ids()).idx
    const out = removeSession(idx, 'nope', ids())
    expect(out.idx).toBe(idx)
  })
})

describe('removeSessionsByAppToken — delete every session under a document', () => {
  const sess = (id: string, appToken: string | null): SessionMeta => ({
    id, title: id, appToken, createdAt: 0, updatedAt: 0, messageCount: 0, titleResolved: true,
  })
  const mk = (metas: SessionMeta[], activeId: string | null = null): SessionIndex => {
    const general = metas.find((m) => m.appToken === null)
    return {
      sessions: metas, activeId,
      generalId: general ? general.id : null, // the hook always maintains generalId
      byAppToken: Object.fromEntries(metas.filter((m) => m.appToken).map((m) => [m.appToken as string, m.id])),
    }
  }

  it('removes all sessions for the appToken and clears the shortcut', () => {
    const idx = mk([sess('a', 'doc1'), sess('b', 'doc1'), sess('c', 'doc2')])
    const out = removeSessionsByAppToken(idx, 'doc1', ids())
    expect(out.idx.sessions.map((s) => s.id)).toEqual(['c'])
    expect(out.idx.byAppToken['doc1']).toBeUndefined()
    expect(out.idx.byAppToken['doc2']).toBe('c')
    expect(out.removed.sort()).toEqual(['a', 'b'])
    expect(out.activeId).toBeNull() // nothing was active
  })

  it('falls back to the general session when the active one is among the removed', () => {
    const idx = mk([sess('a', 'doc1'), sess('g', null)], 'a')
    const out = removeSessionsByAppToken(idx, 'doc1', ids())
    expect(out.idx.sessions.some((s) => s.appToken === 'doc1')).toBe(false)
    expect(out.activeId).toBe('g') // landed on general
  })

  it('creates a general session to fall back to when none exists yet', () => {
    const idx = mk([sess('a', 'doc1')], 'a') // no general session yet
    const out = removeSessionsByAppToken(idx, 'doc1', ids())
    expect(out.idx.sessions.some((s) => s.appToken === 'doc1')).toBe(false)
    expect(out.activeId).toBeTruthy()
    expect(out.idx.sessions.find((s) => s.id === out.activeId)?.appToken).toBeNull() // general
  })

  it('is a no-op for an unknown appToken', () => {
    const idx = mk([sess('a', 'doc1')])
    const out = removeSessionsByAppToken(idx, 'nope', ids())
    expect(out.idx).toBe(idx)
    expect(out.removed).toEqual([])
  })

  it('clears the general group when appToken is null (re-ensures a fresh general)', () => {
    const idx = mk([sess('g1', null), sess('a', 'doc1')], 'g1')
    const out = removeSessionsByAppToken(idx, null, ids())
    expect(out.idx.sessions.some((s) => s.id === 'g1')).toBe(false)
    expect(out.idx.sessions.some((s) => s.appToken === 'doc1')).toBe(true) // doc untouched
    expect(out.activeId).toBeTruthy()
    expect(out.idx.sessions.find((s) => s.id === out.activeId)?.appToken).toBeNull()
  })
})

describe('capSessions — bound the number of conversation WINDOWS (not messages)', () => {
  const sess = (id: string, updatedAt: number, appToken: string | null = null): SessionMeta =>
    ({ id, title: id, appToken, createdAt: 0, updatedAt, messageCount: 0, titleResolved: true })
  const mk = (metas: SessionMeta[], activeId: string | null = null): SessionIndex => ({
    sessions: metas, activeId, generalId: null,
    byAppToken: Object.fromEntries(metas.filter((m) => m.appToken).map((m) => [m.appToken as string, m.id])),
  })

  it('no-op when within the cap', () => {
    const idx = mk([sess('a', 1), sess('b', 2)])
    expect(capSessions(idx, null, 20)).toEqual({ idx, removed: [] })
  })

  it('evicts the OLDEST windows beyond the cap', () => {
    const metas = Array.from({ length: 22 }, (_, i) => sess(`s${i}`, i))
    const { idx, removed } = capSessions(mk(metas), null, 20)
    expect(idx.sessions).toHaveLength(20)
    expect(removed).toEqual(['s0', 's1']) // two oldest dropped
  })

  it('never evicts the active or kept session even if oldest', () => {
    const metas = Array.from({ length: 22 }, (_, i) => sess(`s${i}`, i))
    const { idx, removed } = capSessions(mk(metas, 's0'), 's1', 20)
    expect(removed).not.toContain('s0') // active
    expect(removed).not.toContain('s1') // keepId
    expect(idx.sessions).toHaveLength(20)
  })

  it('drops evicted sessions from byAppToken too', () => {
    const metas = Array.from({ length: 21 }, (_, i) => sess(`s${i}`, i, `app${i}`))
    const { idx, removed } = capSessions(mk(metas), null, 20)
    expect(removed).toEqual(['s0'])
    expect(idx.byAppToken['app0']).toBeUndefined()
  })

  it('defaults to MAX_SESSIONS (20)', () => {
    expect(MAX_SESSIONS).toBe(20)
    expect(capSessions(mk(Array.from({ length: 25 }, (_, i) => sess(`s${i}`, i)))).idx.sessions).toHaveLength(20)
  })
})

describe('stampKind', () => {
  it('upgrades an unresolved wiki session to its real kind', () => {
    const wiki = ensureSession(emptyIndex(), 'wikiA', ids(), 'wiki').idx
    const out = stampKind(wiki, 'wikiA', 'base')
    expect(out.sessions.find((s) => s.appToken === 'wikiA')?.kind).toBe('base')
  })

  it('is a no-op when the session already has that kind', () => {
    const base = ensureSession(emptyIndex(), 'appA', ids(), 'base').idx
    expect(stampKind(base, 'appA', 'base')).toBe(base) // returned unchanged
  })

  it('is a no-op for an unknown appToken', () => {
    const base = ensureSession(emptyIndex(), 'appA', ids(), 'base').idx
    expect(stampKind(base, 'unknown', 'sheet')).toBe(base)
  })

  it('overwrites a concrete kind with a new one (re-classification)', () => {
    const sheet = ensureSession(emptyIndex(), 'appA', ids(), 'sheet').idx
    const out = stampKind(sheet, 'appA', 'base')
    expect(out.sessions.find((s) => s.appToken === 'appA')?.kind).toBe('base')
  })
})

describe('resolveSessionTitle', () => {
  it('backfills a placeholder title with the real name', () => {
    const idx = ensureSession(emptyIndex(), 'appA', ids()).idx // placeholder title, unresolved
    const out = resolveSessionTitle(idx, 'appA', 'Q3 季度报告')
    expect(out.sessions.find((s) => s.appToken === 'appA')?.title).toBe('Q3 季度报告')
    expect(out.sessions.find((s) => s.appToken === 'appA')?.titleResolved).toBe(true)
  })

  it('refreshes an already-resolved title when the doc was renamed', () => {
    // The history-sync case: title was resolved once, then the doc got renamed in Feishu.
    let idx = ensureSession(emptyIndex(), 'appA', ids()).idx
    idx = resolveSessionTitle(idx, 'appA', '旧名称')
    expect(idx.sessions[0].title).toBe('旧名称')
    const out = resolveSessionTitle(idx, 'appA', '新名称')
    expect(out.sessions[0].title).toBe('新名称')
  })

  it('does NOT overwrite a manually renamed session (titleCustom)', () => {
    let idx = ensureSession(emptyIndex(), 'appA', ids()).idx
    // Simulate a hand rename: title + titleCustom flag set by renameSession.
    idx = {
      ...idx,
      sessions: idx.sessions.map((s) => ({ ...s, title: '我的笔记', titleResolved: true, titleCustom: true })),
    }
    const out = resolveSessionTitle(idx, 'appA', 'API 返回的名称')
    expect(out).toBe(idx) // unchanged — the user's custom name is preserved
    expect(out.sessions[0].title).toBe('我的笔记')
  })

  it('stamps the kind alongside the title', () => {
    const idx = ensureSession(emptyIndex(), 'appA', ids()).idx
    const out = resolveSessionTitle(idx, 'appA', '名称', 'sheet')
    expect(out.sessions[0].kind).toBe('sheet')
  })

  it('is a no-op when the title is unchanged and no kind is given', () => {
    const idx = resolveSessionTitle(ensureSession(emptyIndex(), 'appA', ids()).idx, 'appA', '名称')
    expect(resolveSessionTitle(idx, 'appA', '名称')).toBe(idx)
  })

  it('is a no-op for an unknown appToken', () => {
    const idx = ensureSession(emptyIndex(), 'appA', ids()).idx
    expect(resolveSessionTitle(idx, 'unknown', '名称')).toBe(idx)
  })
})

describe('previewFromMessages', () => {
  const msg = (id: string, role: ChatMessage['role'], content: string | null): ChatMessage =>
    ({ id, role, content, createdAt: 0 })

  it('returns the first user message, truncated to 60 chars', () => {
    const long = 'x'.repeat(80)
    expect(previewFromMessages([msg('1', 'assistant', 'hi'), msg('2', 'user', long)])).toBe('x'.repeat(60))
  })

  it('skips assistant / tool / empty user messages', () => {
    expect(
      previewFromMessages([msg('1', 'assistant', 'a'), msg('2', 'user', '   '), msg('3', 'user', 'hello world')]),
    ).toBe('hello world')
  })

  it('returns undefined when there is no user text', () => {
    expect(previewFromMessages([msg('1', 'assistant', 'a')])).toBeUndefined()
    expect(previewFromMessages([])).toBeUndefined()
  })
})

describe('messagesForRetry', () => {
  const msg = (id: string, role: ChatMessage['role'], content: string | null): ChatMessage =>
    ({ id, role, content, createdAt: 0 })

  it('drops the assistant reply after the most recent user message', () => {
    const msgs = [
      msg('1', 'user', 'q1'),
      msg('2', 'assistant', 'a1'),
      msg('3', 'user', 'q2'),
      msg('4', 'assistant', 'a2'),
    ]
    // Keep everything up to and including the last user message (q2); a2 is dropped.
    expect(messagesForRetry(msgs)).toEqual([msgs[0], msgs[1], msgs[2]])
  })

  it('keeps the earlier conversation intact (full history for context)', () => {
    const msgs = [
      msg('1', 'user', 'q1'),
      msg('2', 'assistant', 'a1'),
      msg('3', 'user', 'q2'),
    ]
    expect(messagesForRetry(msgs)).toEqual([msgs[0], msgs[1], msgs[2]])
  })

  it('returns the input by reference when there is no user message to retry from', () => {
    const msgs = [msg('1', 'assistant', 'a'), msg('2', 'assistant', 'b')]
    expect(messagesForRetry(msgs)).toBe(msgs)
    expect(messagesForRetry([])).toEqual([])
  })
})

describe('groupSessions — bucket the history by document', () => {
  const s = (id: string, appToken: string | null, opts: Partial<SessionMeta> = {}): SessionMeta => ({
    id, title: id, appToken, createdAt: 0, updatedAt: 0, messageCount: 0, titleResolved: false, ...opts,
  })

  it('buckets by appToken, newest group first, newest session first within a group', () => {
    const groups = groupSessions([
      s('a', 'doc1', { updatedAt: 1 }),
      s('b', 'doc1', { updatedAt: 5 }),
      s('c', 'doc2', { updatedAt: 10 }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['doc2', 'doc1'])
    expect(groups.find((g) => g.key === 'doc1')!.sessions.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('puts unbound sessions in the general bucket', () => {
    const groups = groupSessions([s('g', null, { updatedAt: 1 })])
    expect(groups[0].key).toBe(GENERAL_GROUP_KEY)
    expect(groups[0].label).toBe('通用会话')
  })

  it('uses a resolved real title as the group label over placeholders', () => {
    const groups = groupSessions([
      s('a', 'doc1', { title: '会话 Abcdefgh…', updatedAt: 10 }),
      s('b', 'doc1', { title: 'Q3 季度报告', titleResolved: true, updatedAt: 1 }),
    ])
    expect(groups[0].label).toBe('Q3 季度报告')
  })

  it('falls back to the first-message preview when no resolved title exists', () => {
    const groups = groupSessions([s('a', 'doc1', { title: '会话 Abcdefgh…', preview: '帮我建个表', updatedAt: 1 })])
    expect(groups[0].label).toBe('帮我建个表')
  })

  it('picks up the kind from any session in the group', () => {
    const groups = groupSessions([s('a', 'doc1', { updatedAt: 1 }), s('b', 'doc1', { kind: 'sheet', updatedAt: 2 })])
    expect(groups[0].kind).toBe('sheet')
  })
})
