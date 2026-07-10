// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@/shared/types'

const mockPing = vi.fn()
vi.mock('@/shared/obsidian/api', () => ({ pingObsidian: mockPing }))

const KnowledgeBasePanel = (await import('./KnowledgeBasePanel')).default

beforeEach(() => mockPing.mockReset())
afterEach(cleanup)

describe('KnowledgeBasePanel', () => {
  it('已连接 → vault 视图（kb-vault-view）', async () => {
    mockPing.mockResolvedValue({ ok: true, status: 200, authenticated: true, vault: 'MyVault' })
    render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} onGoToSettings={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('kb-vault-view')).toBeTruthy())
  })
  it('未连接 → 门禁（kb-gate）+ 去设置按钮', async () => {
    mockPing.mockResolvedValue({ ok: false, status: 0, authenticated: false })
    const go = vi.fn()
    render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} onGoToSettings={go} />)
    await waitFor(() => expect(screen.getByTestId('kb-gate')).toBeTruthy())
    fireEvent.click(screen.getByText('去设置完成配置'))
    expect(go).toHaveBeenCalled()
  })
  it('ping 期间显示 loading', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockPing.mockReturnValue(new Promise((r) => { resolve = r as (v: unknown) => void }))
    render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} onGoToSettings={() => {}} />)
    expect(screen.getByTestId('kb-loading')).toBeTruthy()
    resolve({ ok: true, status: 200, authenticated: true })
    await waitFor(() => expect(screen.queryByTestId('kb-loading')).toBeNull())
  })
  it('settings 引用变但 baseUrl 不变 → 不重新 ping', async () => {
    mockPing.mockResolvedValue({ ok: true, status: 200, authenticated: true, vault: 'V' })
    const { rerender } = render(<KnowledgeBasePanel settings={DEFAULT_SETTINGS} onBack={() => {}} onGoToSettings={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('kb-vault-view')).toBeTruthy())
    expect(mockPing).toHaveBeenCalledTimes(1)
    rerender(<KnowledgeBasePanel settings={{ ...DEFAULT_SETTINGS, obsidianVaultName: 'Other' }} onBack={() => {}} onGoToSettings={() => {}} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(mockPing).toHaveBeenCalledTimes(1)
  })
})
