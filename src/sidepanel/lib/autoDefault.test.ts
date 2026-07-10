import { describe, it, expect } from 'vitest'
import { decideAutoDefault } from './autoDefault'
import type { AppTab } from '../hooks/useDocBinding'

const base = {
  ctxResolved: true,
  pageSupported: true,
  hasConversation: false,
  currentTab: 'chat' as AppTab,
  clip: false,
  chatStreaming: false,
  newSessionPin: false,
  alreadyDefaulted: false,
}

describe('decideAutoDefault', () => {
  it('waits while the page context is unresolved', () => {
    expect(decideAutoDefault({ ...base, ctxResolved: false })).toEqual({ tab: null, settled: false, consumePin: false })
  })

  it('defaults a supported Feishu page to chat, settling the one-shot latch', () => {
    const r = decideAutoDefault(base)
    expect(r.tab).toBe('chat')
    expect(r.settled).toBe(true)
  })

  it('defaults an unsupported page to scenes (应用 hub), settling the latch', () => {
    expect(decideAutoDefault({ ...base, pageSupported: false }).tab).toBe('scenes')
  })

  it('never re-yanks after settling — the doc-switch regression', () => {
    // First resolution settles on chat.
    expect(decideAutoDefault(base).settled).toBe(true)
    // Later the user switches docs; pageSupported may transiently flip. Already settled → no-op.
    const after = decideAutoDefault({ ...base, pageSupported: false, alreadyDefaulted: true })
    expect(after.tab).toBeNull()
    expect(after.settled).toBe(true)
  })

  it('does not yank the user out of an active conversation', () => {
    expect(decideAutoDefault({ ...base, hasConversation: true, pageSupported: false }).tab).toBeNull()
  })

  it('leaves the view untouched if the user is already on scenes or news', () => {
    expect(decideAutoDefault({ ...base, currentTab: 'scenes', pageSupported: false }).tab).toBeNull()
    expect(decideAutoDefault({ ...base, currentTab: 'news' }).tab).toBeNull()
  })

  it('waits (does not settle) while a clip is showing', () => {
    expect(decideAutoDefault({ ...base, clip: true, pageSupported: false }).settled).toBe(false)
  })

  it('waits while an answer is streaming', () => {
    expect(decideAutoDefault({ ...base, chatStreaming: true, pageSupported: false }).settled).toBe(false)
  })

  it('consumes the newSessionPin and settles without switching the view', () => {
    const r = decideAutoDefault({ ...base, newSessionPin: true, pageSupported: false })
    expect(r.tab).toBeNull()
    expect(r.settled).toBe(true)
    expect(r.consumePin).toBe(true)
  })
})
