/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import HistoryRow from './HistoryRow'

afterEach(cleanup)

describe('HistoryRow', () => {
  it('renders name and meta', () => {
    render(<HistoryRow name="报告.pdf" meta="3 分钟前" onOpen={() => {}} />)
    expect(screen.getByText('报告.pdf')).toBeTruthy()
    expect(screen.getByText('3 分钟前')).toBeTruthy()
  })
  it('clicking the main button triggers onOpen', () => {
    const onOpen = vi.fn()
    render(<HistoryRow name="x" onOpen={onOpen} />)
    fireEvent.click(screen.getByText('x').closest('button')!)
    expect(onOpen).toHaveBeenCalledOnce()
  })
  it('delete button triggers onDelete and is labeled 删除', () => {
    const onDelete = vi.fn()
    render(<HistoryRow name="x" onOpen={() => {}} onDelete={onDelete} />)
    const del = screen.getByLabelText('删除')
    expect(del).toBeTruthy()
    fireEvent.click(del)
    expect(onDelete).toHaveBeenCalledOnce()
  })
  it('omits the delete button when onDelete is not provided', () => {
    render(<HistoryRow name="x" onOpen={() => {}} />)
    expect(screen.queryByLabelText('删除')).toBeNull()
  })
  it('applies active class', () => {
    const { container } = render(<HistoryRow name="x" onOpen={() => {}} active />)
    expect(container.querySelector('.hr-row--active')).toBeTruthy()
  })
})
