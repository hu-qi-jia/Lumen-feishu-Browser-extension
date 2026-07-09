// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../shared/types'

const mockRead = vi.fn(); const mockWrite = vi.fn(); const mockDelete = vi.fn()
vi.mock('../../shared/obsidian/api', () => ({ readNote: mockRead, writeNote: mockWrite, deleteNote: mockDelete }))

const ObsidianNoteDetail = (await import('./ObsidianNoteDetail')).default
beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset(); mockDelete.mockReset() })
afterEach(cleanup)

describe('ObsidianNoteDetail', () => {
  it('顶栏返回键（TopBar/BackButton）→ 调用 onClose', async () => {
    mockRead.mockResolvedValue('x')
    const onClose = vi.fn()
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path="a.md" onClose={onClose} onDeleted={() => {}} />)
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('返回'))
    expect(onClose).toHaveBeenCalled()
  })

  it('读现有笔记 → 显示正文 + 编辑切换', async () => {
    mockRead.mockResolvedValue('# Hello\nworld')
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path="a.md" onClose={() => {}} onDeleted={() => {}} />)
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy()) // Markdown 渲染 # Hello
    fireEvent.click(screen.getByLabelText('编辑')) // 编辑是 SVG 图标按钮，靠 aria-label 匹配
    const ta = screen.getByTestId('kb-editor') as HTMLTextAreaElement
    expect(ta.value).toContain('# Hello')
  })

  it('编辑后保存 → writeNote(path, draft)', async () => {
    mockRead.mockResolvedValue('orig'); mockWrite.mockResolvedValue(undefined)
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path="a.md" onClose={() => {}} onDeleted={() => {}} />)
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('编辑'))
    fireEvent.change(screen.getByTestId('kb-editor'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(mockWrite).toHaveBeenCalledWith(expect.anything(), 'a.md', 'changed'))
  })

  it('删除 → 确认 → deleteNote → onDeleted', async () => {
    mockRead.mockResolvedValue('x'); mockDelete.mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path="a.md" onClose={() => {}} onDeleted={onDeleted} />)
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('删除'))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(expect.anything(), 'a.md'))
    expect(onDeleted).toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('取消确认 → 不删除', async () => {
    mockRead.mockResolvedValue('x')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path="a.md" onClose={() => {}} onDeleted={() => {}} />)
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('删除'))
    expect(mockDelete).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('新建态（path=null）→ 输入标题 + 正文 → writeNote(newPath, body)', async () => {
    mockWrite.mockResolvedValue(undefined)
    render(<ObsidianNoteDetail settings={DEFAULT_SETTINGS} path={null} onClose={() => {}} onDeleted={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('笔记标题'), { target: { value: 'Idea' } })
    fireEvent.change(screen.getByTestId('kb-editor'), { target: { value: 'first' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(mockWrite).toHaveBeenCalledWith(expect.anything(), 'Idea.md', 'first'))
  })
})
