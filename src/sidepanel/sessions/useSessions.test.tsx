// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ChatMessage } from '@/shared/types'
import { useSessions } from './useSessions'

// In-memory chrome.storage.local mock.
let mem: Record<string, unknown>
beforeEach(() => {
  mem = {}
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
          const r: Record<string, unknown> = {}
          for (const k of keys) if (k in mem) r[k] = mem[k]
          cb(r)
        },
        set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(mem, items); cb?.() },
        remove: (keys: string | string[], cb?: () => void) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete mem[k]); cb?.()
        },
      },
    },
  }
})

const msg = (content: string): ChatMessage =>
  ({ id: Math.random().toString(), role: 'user', content, createdAt: 0 })

function renderSessions(initialToken: string | null) {
  return renderHook(({ t }) => useSessions(t, false), { initialProps: { t: initialToken } })
}

describe('useSessions', () => {
  it('binds a session to the current Base appToken', async () => {
    const { result } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.activeSession?.appToken).toBe('appA')
  })

  it('keeps per-document sessions isolated and restores on return', async () => {
    const { result, rerender } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    const idA = result.current.activeSession!.id

    act(() => result.current.setMessages([msg('hello A')]))
    expect(result.current.messages).toHaveLength(1)

    // Switch to another document → fresh, empty session
    rerender({ t: 'appB' })
    await waitFor(() => expect(result.current.activeSession?.appToken).toBe('appB'))
    expect(result.current.messages).toHaveLength(0)

    // Switch back → original session + messages restored
    rerender({ t: 'appA' })
    await waitFor(() => expect(result.current.activeSession?.id).toBe(idA))
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].content).toBe('hello A')
  })

  it('uses a single general session for non-Base (null) context', async () => {
    const { result } = renderSessions(null)
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.activeSession?.appToken).toBeNull()
    expect(result.current.activeSession?.title).toBe('通用会话')
  })

  it('resolveTitle backfills the document session title (Base name)', async () => {
    const { result } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.resolveTitle('appA', '人员管理系统'))
    await waitFor(() =>
      expect(result.current.index.sessions.find((s) => s.appToken === 'appA')?.title).toBe('人员管理系统')
    )
  })

  it('setMessagesFor writes to a specific session even when another is active', async () => {
    const { result, rerender } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    const idA = result.current.activeSession!.id

    // Switch active session to appB (simulating navigation mid-stream)
    rerender({ t: 'appB' })
    await waitFor(() => expect(result.current.activeSession?.appToken).toBe('appB'))

    // A streaming reply that began in A writes to idA, NOT the now-active B
    act(() => result.current.setMessagesFor(idA, [msg('reply in A')]))
    expect(result.current.messages).toHaveLength(0) // active (B) display untouched

    // Back to A → the reply landed there (no cross-contamination)
    rerender({ t: 'appA' })
    await waitFor(() => expect(result.current.activeSession?.id).toBe(idA))
    expect(result.current.messages.map((m) => m.content)).toContain('reply in A')
  })

  it('createSession adds a new active session', async () => {
    const { result } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    const before = result.current.index.sessions.length
    act(() => result.current.createSession())
    await waitFor(() => expect(result.current.index.sessions.length).toBe(before + 1))
    expect(result.current.messages).toHaveLength(0)
  })

  it('createSession on a resource page survives a streaming cycle (no jump back to the old session)', async () => {
    const { result, rerender } = renderHook(({ t, s }) => useSessions(t, s), {
      initialProps: { t: 'appA', s: false },
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    const idA = result.current.activeSession!.id

    // User starts a new session while still on appA.
    act(() => result.current.createSession())
    const newId = result.current.activeSession!.id
    expect(newId).not.toBe(idA)

    // Send a message (streaming on) then the reply completes (streaming off). The
    // auto-switch effect re-runs when streaming flips to false — it must NOT resolve
    // the old appA session and jump the view back to it.
    act(() => rerender({ t: 'appA', s: true }))
    await act(async () => { rerender({ t: 'appA', s: false }) })

    expect(result.current.activeSession?.id).toBe(newId)
  })

  it('does NOT yank the view off the active session when a reply finishes (no post-reply switch)', async () => {
    // The bug: the auto-switch effect had `streaming` in its deps, so it re-ran at every
    // stream-end. When the active session wasn't the live tab's — here the general session
    // while sitting on a doc page — ensureSession(activeAppToken) switched away the instant
    // the reply finished, abandoning the session the reply just landed in.
    const { result, rerender } = renderHook(
      ({ t, s }: { t: string | null; s: boolean }) => useSessions(t, s),
      { initialProps: { t: null as string | null, s: false } }, // non-doc page → general session
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    const generalId = result.current.activeSession!.id
    expect(result.current.activeSession?.appToken).toBeNull()

    // Navigate to appA (idle) → a doc session is created and activated...
    rerender({ t: 'appA', s: false })
    await waitFor(() => expect(result.current.activeSession?.appToken).toBe('appA'))
    // ...then the user picks the general session back (e.g. from the history drawer).
    act(() => result.current.switchTo(generalId))
    expect(result.current.activeSession?.id).toBe(generalId)

    // A reply streams into the general session, then finishes.
    act(() => rerender({ t: 'appA', s: true }))
    await act(async () => { rerender({ t: 'appA', s: false }) })

    // The view must STAY on the general session — the reply landed there.
    expect(result.current.activeSession?.id).toBe(generalId)
  })

  it('createSession({ appToken }) binds the new session to a SPECIFIC resource', async () => {
    const { result } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.createSession({ appToken: 'appB', title: 'B 会话' }))
    expect(result.current.activeSession?.appToken).toBe('appB')
    expect(result.current.activeSession?.title).toBe('B 会话')
    // appB now resolves to the new session.
    expect(result.current.index.byAppToken.appB).toBe(result.current.activeSession!.id)
  })

  it('rebindSession moves a session to a new resource, keeping its messages + byAppToken map', async () => {
    const { result } = renderSessions('appA')
    await waitFor(() => expect(result.current.ready).toBe(true))
    const idA = result.current.activeSession!.id
    act(() => result.current.setMessages([msg('thread on A')]))

    // "在当前会话中继续" on a switch to appB → rebind A's session to appB.
    act(() => result.current.rebindSession(idA, 'appB', 'B 文档'))
    const rebound = result.current.index.sessions.find((s) => s.id === idA)!
    expect(rebound.appToken).toBe('appB')
    expect(result.current.index.byAppToken.appB).toBe(idA)
    // appA's old shortcut no longer points here.
    expect(result.current.index.byAppToken.appA).toBeUndefined()
    // Messages survive the rebind.
    expect(result.current.messages.map((m) => m.content)).toContain('thread on A')
  })

  it('setKbEnabled toggles kbEnabled on the active session and persists it in meta', async () => {
    const { result } = renderSessions(null)
    await waitFor(() => expect(result.current.ready).toBe(true))
    const id = result.current.activeSession!.id
    expect(id).toBeTruthy()

    // Default: no kbEnabled key (undefined → falsy).
    expect(result.current.activeSession?.kbEnabled).toBeUndefined()

    act(() => result.current.setKbEnabled(id, true))
    expect(result.current.activeSession?.kbEnabled).toBe(true)
    // Reflected in the index meta too.
    expect(result.current.index.sessions.find((s) => s.id === id)?.kbEnabled).toBe(true)

    act(() => result.current.setKbEnabled(id, false))
    expect(result.current.activeSession?.kbEnabled).toBe(false)
  })
})
