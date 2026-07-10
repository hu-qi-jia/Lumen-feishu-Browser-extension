// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SegmentedTabs from './SegmentedTabs'

describe('SegmentedTabs', () => {
  it('renders options and highlights active', () => {
    render(
      <SegmentedTabs
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]}
        value="a"
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('A')
  })

  it('calls onChange with clicked value', () => {
    const onChange = vi.fn()
    render(
      <SegmentedTabs
        options={[{ value: 'recent', label: '最近' }, { value: 'search', label: '搜索' }]}
        value="recent"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText('搜索'))
    expect(onChange).toHaveBeenCalledWith('search')
  })
})
