/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { RecentFile } from '../recentFiles'
import DocCombobox from './DocCombobox'

const RECENT: RecentFile[] = [
  { token: 'tokA', title: '需求文档', kind: 'doc', seen: 3 },
  { token: 'tokB', title: '周报', kind: 'sheet', seen: 2 },
]
afterEach(cleanup)

describe('DocCombobox', () => {
  it('lists recent docs on focus and picks one', () => {
    const onTargetChange = vi.fn()
    render(<DocCombobox recentFiles={RECENT} target={null} onTargetChange={onTargetChange} onConfirm={() => {}} />)
    fireEvent.focus(screen.getByTestId('dc-input'))
    fireEvent.click(screen.getByText('需求文档'))
    expect(onTargetChange).toHaveBeenCalledWith({ token: 'tokA', title: '需求文档' })
  })
  it('parses a pasted link into a token', () => {
    const onTargetChange = vi.fn()
    render(<DocCombobox recentFiles={[]} target={null} onTargetChange={onTargetChange} onConfirm={() => {}} />)
    fireEvent.change(screen.getByTestId('dc-input'), { target: { value: 'https://x.feishu.cn/docx/ABC123defgh' } })
    expect(onTargetChange).toHaveBeenCalledWith({ token: 'ABC123defgh', title: 'https://x.feishu.cn/docx/ABC123defgh' })
  })
  it('calls onTargetChange(null) for unparseable input', () => {
    const onTargetChange = vi.fn()
    render(<DocCombobox recentFiles={[]} target={null} onTargetChange={onTargetChange} onConfirm={() => {}} />)
    fireEvent.change(screen.getByTestId('dc-input'), { target: { value: '乱七八糟' } })
    expect(onTargetChange).toHaveBeenCalledWith(null)
  })
  it('fires onConfirm from the 添加到文档 button', () => {
    const onConfirm = vi.fn()
    render(<DocCombobox recentFiles={[]} target={{ token: 't', title: 'x' }} onTargetChange={() => {}} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByText('添加到文档'))
    expect(onConfirm).toHaveBeenCalled()
  })
})
