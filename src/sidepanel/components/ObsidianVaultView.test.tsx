// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'

const mockRecent = vi.fn(); const mockSearch = vi.fn()
vi.mock('../../shared/obsidian/api', () => ({ recentNotes: mockRecent, searchVault: mockSearch }))

const ObsidianVaultView = (await import('./ObsidianVaultView')).default
beforeEach(() => { mockRecent.mockReset(); mockSearch.mockReset() })
afterEach(cleanup)

describe('ObsidianVaultView', () => {
  it('挂载即载入最近笔记并渲染行', async () => {
    mockRecent.mockResolvedValue([{ path: 'a.md', mtime: 1000 }, { path: 'Folder/b.md', mtime: 2000 }])
    render(<ObsidianVaultView settings={DEFAULT_SETTINGS} />)
    await waitFor(() => expect(mockRecent).toHaveBeenCalled())
    expect(screen.getByText('a.md')).toBeTruthy()
    expect(screen.getByText('b.md')).toBeTruthy()
  })

  it('搜索提交 → searchVault → 显示带片段的结果', async () => {
    mockRecent.mockResolvedValue([])
    mockSearch.mockResolvedValue([{ path: 'n.md', snippet: 'hit here', score: 3 }])
    render(<ObsidianVaultView settings={DEFAULT_SETTINGS} />)
    await waitFor(() => expect(mockRecent).toHaveBeenCalled())
    const input = screen.getByPlaceholderText(/搜索笔记/)
    fireEvent.change(input, { target: { value: 'hit' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith(expect.anything(), 'hit'))
    expect(screen.getByText('n.md')).toBeTruthy()
    expect(screen.getByText(/hit here/)).toBeTruthy()
  })

  it('载入失败 → 显示错误，不崩', async () => {
    mockRecent.mockRejectedValue(new Error('读取最近笔记失败（500）'))
    render(<ObsidianVaultView settings={DEFAULT_SETTINGS} />)
    await waitFor(() => expect(screen.getByText(/读取最近笔记失败|500/)).toBeTruthy())
  })

  it('右上「新建笔记」图标 → 进入新建态（标题输入框出现）', async () => {
    mockRecent.mockResolvedValue([])
    render(<ObsidianVaultView settings={DEFAULT_SETTINGS} />)
    await waitFor(() => expect(screen.getByTestId('kb-vault-view')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('新建笔记'))
    expect(screen.getByPlaceholderText('笔记标题')).toBeTruthy()
  })

  it('SearchBox 输入 + Enter → searchVault', async () => {
    mockRecent.mockResolvedValue([])
    mockSearch.mockResolvedValue([{ path: 'a.md', score: 1, snippet: 's' }])
    render(<ObsidianVaultView settings={{ ...DEFAULT_SETTINGS }} />)
    await waitFor(() => expect(screen.getByTestId('kb-vault-view')).toBeTruthy())
    const input = screen.getByPlaceholderText(/搜索笔记/)
    fireEvent.change(input, { target: { value: 'kw' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith(expect.anything(), 'kw'))
  })
})
