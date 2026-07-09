// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import type { AppSettings } from '../../../shared/types'

const mockPing = vi.fn()
const mockSaveToken = vi.fn()
const mockGetToken = vi.fn()
vi.mock('../../../shared/obsidian/api', () => ({ pingObsidian: (...a: unknown[]) => mockPing(...a) }))
vi.mock('../../../shared/obsidian/auth', () => ({ saveObsidianToken: (...a: unknown[]) => mockSaveToken(...a), getObsidianToken: () => mockGetToken() }))

const KnowledgeBaseTab = (await import('./KnowledgeBaseTab')).default

beforeEach(() => { mockPing.mockReset(); mockSaveToken.mockReset(); mockGetToken.mockReset(); mockGetToken.mockResolvedValue('') })
afterEach(cleanup)

describe('KnowledgeBaseTab', () => {
  it('渲染四步引导 + 端点/API Key 字段', () => {
    render(<KnowledgeBaseTab form={{ ...DEFAULT_SETTINGS } as AppSettings} patch={() => {}} set={() => () => {}} />)
    expect(screen.getByText('安装社区插件')).toBeTruthy()
    expect(screen.getByText('测试连接')).toBeTruthy()
    expect(screen.getByPlaceholderText('http://127.0.0.1:27123')).toBeTruthy()
  })
  it('填 key + 测试连接成功 → 存 token + patch vault', async () => {
    mockPing.mockResolvedValue({ ok: true, status: 200, authenticated: true, vault: 'MyVault' })
    const patch = vi.fn()
    render(<KnowledgeBaseTab form={{ ...DEFAULT_SETTINGS } as AppSettings} patch={patch} set={() => () => {}} />)
    fireEvent.change(screen.getByPlaceholderText('粘贴 API Key'), { target: { value: 'k1' } })
    fireEvent.click(screen.getByText('测试 Obsidian 连接'))
    await waitFor(() => expect(mockPing).toHaveBeenCalled())
    await waitFor(() => expect(mockSaveToken).toHaveBeenCalledWith('k1'))
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ obsidianVaultName: 'MyVault' }))
    expect(screen.getByText(/已连接 · MyVault/)).toBeTruthy()
  })
  it('连接失败 → 错误态，不存 token', async () => {
    mockPing.mockResolvedValue({ ok: false, status: 0, authenticated: false })
    const patch = vi.fn()
    render(<KnowledgeBaseTab form={{ ...DEFAULT_SETTINGS } as AppSettings} patch={patch} set={() => () => {}} />)
    fireEvent.change(screen.getByPlaceholderText('粘贴 API Key'), { target: { value: 'k1' } })
    fireEvent.click(screen.getByText('测试 Obsidian 连接'))
    await waitFor(() => expect(screen.getByText(/无法连接/)).toBeTruthy())
    expect(mockSaveToken).not.toHaveBeenCalled()
  })
})
