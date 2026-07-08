// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { SessionIndex } from '../../shared/types'
import SessionDrawer from './SessionDrawer'
import type { SessionsApi } from '../sessions/useSessions'

afterEach(cleanup)

// One doc group ('doc1') with a single active session. The active session's group is
// expanded by default, so its row — and the group-header delete button — are both in the DOM.
const index: SessionIndex = {
  sessions: [
    { id: 's1', title: '会话一', appToken: 'doc1', createdAt: 0, updatedAt: 0, messageCount: 2, titleResolved: true, preview: '帮我建表' },
  ],
  activeId: 's1',
  byAppToken: { doc1: 's1' },
  generalId: null,
}

function mkApi(overrides: Partial<SessionsApi> = {}): SessionsApi {
  return {
    ready: true,
    index,
    activeSession: index.sessions[0],
    messages: [],
    setMessages: vi.fn(),
    setMessagesFor: vi.fn(),
    switchTo: vi.fn(),
    createSession: vi.fn(),
    removeSession: vi.fn(),
    removeSessionsByAppToken: vi.fn(),
    renameSession: vi.fn(),
    rebindSession: vi.fn(),
    resolveTitle: vi.fn(),
    stampKind: vi.fn(),
    ...overrides,
  } as unknown as SessionsApi
}

function renderDrawer(api: SessionsApi) {
  return render(
    <SessionDrawer
      sessions={api}
      busy={false}
      onClose={vi.fn()}
      onPickSession={vi.fn()}
    />,
  )
}

describe('SessionDrawer — delete confirm flow', () => {
  it('a session-row delete asks for confirm, then deletes on 删除', () => {
    const api = mkApi()
    renderDrawer(api)
    // Only the row trash is named exactly "删除" before the dialog opens.
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByText(/删除该会话/)).toBeTruthy()
    fireEvent.click(document.querySelector('.confirm-btn--danger')!)
    expect(api.removeSession).toHaveBeenCalledWith('s1')
    expect(api.removeSessionsByAppToken).not.toHaveBeenCalled()
  })

  it('cancel (or overlay) does not delete', () => {
    const api = mkApi()
    renderDrawer(api)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(document.querySelector('.confirm-btn--ghost')!) // 取消
    expect(api.removeSession).not.toHaveBeenCalled()
    expect(screen.queryByText(/删除该会话/)).toBeNull()
  })

  it('the group-header delete confirms with the doc name + count, then deletes by appToken', () => {
    const api = mkApi()
    renderDrawer(api)
    fireEvent.click(screen.getByRole('button', { name: '删除该文档全部会话' }))
    expect(screen.getByText(/删除「会话一」下的全部会话（1 个）/)).toBeTruthy()
    fireEvent.click(document.querySelector('.confirm-btn--danger')!)
    expect(api.removeSessionsByAppToken).toHaveBeenCalledWith('doc1')
    expect(api.removeSession).not.toHaveBeenCalled()
  })
})
