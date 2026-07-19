// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@/shared/types'
import type { PageContext } from '@/shared/types'
import { useDocBinding, type AppTab } from './useDocBinding'

// crypto 走 identity（settings 字段非密钥）。
vi.mock('@/shared/crypto', () => ({ encryptField: async (s: string) => s, decryptField: async (s: string) => s }))

const storage = new Map<string, unknown>()

const ctxA: PageContext = { url: 'https://feishu.cn/docx/A', title: 'Doc A', selectedText: '', feishu: { isBase: false, kind: 'doc', documentId: 'A' } }
const ctxB: PageContext = { url: 'https://feishu.cn/docx/B', title: 'Doc B', selectedText: '', feishu: { isBase: false, kind: 'doc', documentId: 'B' } }

beforeEach(() => {
  vi.useFakeTimers()
  storage.clear()
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string[], cb?: (r: Record<string, unknown>) => void) => {
          const r: Record<string, unknown> = {}
          for (const k of keys) if (storage.has(k)) r[k] = storage.get(k)
          cb?.(r)
        },
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          for (const [k, v] of Object.entries(obj)) storage.set(k, v)
          cb?.()
        },
        remove: (keys: string | string[], cb?: () => void) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) storage.delete(k)
          cb?.()
        },
      },
    },
    runtime: { id: 'test', onMessage: { addListener() {}, removeListener() {} }, sendMessage: () => Promise.resolve(null) },
  }
})

afterEach(() => { vi.useRealTimers(); delete (globalThis as any).chrome; vi.restoreAllMocks() })

// Stable refs/args across rerenders — only `ctx` changes between renders.
function makeHook() {
  const wikiCacheRef = { current: new Map<string, NonNullable<PageContext['feishu']>>() }
  const newSessionPinRef = { current: false }
  const stable = {
    chatStreaming: false as boolean,
    settings: DEFAULT_SETTINGS,
    wikiCacheRef,
    newSessionPinRef,
    resolveWikiKind: async () => undefined,
    recordRecent: () => {},
    removeFromRecent: () => {},
    setTab: (_t: AppTab) => {},
  }
  return renderHook(({ ctx }: { ctx: PageContext }) => useDocBinding({ ...stable, ctx }), {
    initialProps: { ctx: ctxA },
  })
}

// Advance fake timers AND flush React's scheduler/microtasks so debounce + effects settle.
const flush = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('useDocBinding — follow mode tab-switch (regression: title flicker loop)', () => {
  it('holds the active session\'s doc on tab switch instead of oscillating the title', async () => {
    const { result, rerender } = makeHook()

    // Let the initial async session load + the 250ms liveResource debounce settle.
    await flush(400)
    expect(result.current.sessions.ready).toBe(true)
    expect(result.current.chatContext.title).toBe('Doc A')

    // Give doc A a conversation so the hold is meant to engage on switch.
    await act(async () => {
      result.current.sessions.setMessages((p) => [...p, { id: 'm1', role: 'user', content: 'hi', createdAt: 0 }])
    })

    // Switch the live tab to doc B and let the debounce + effects settle.
    await act(async () => { rerender({ ctx: ctxB }) })
    await flush(400)

    // The hold keeps the workspace on doc A (the conversation we're protecting) and asks the
    // user to confirm following doc B — the title must NOT have flipped to "Doc B".
    expect(result.current.chatContext.title).toBe('Doc A')
    expect(result.current.pendingSwitch?.to).toBe('B')

    // Re-sampling after more time still shows doc A (no A↔B oscillation).
    await flush(300)
    expect(result.current.chatContext.title).toBe('Doc A')
  })
})
