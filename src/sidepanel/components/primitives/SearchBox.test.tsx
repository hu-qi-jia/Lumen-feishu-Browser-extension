// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import SearchBox from './SearchBox'

afterEach(cleanup)

describe('SearchBox', () => {
  it('输入触发 onChange', () => {
    const onChange = vi.fn()
    render(<SearchBox value="" onChange={onChange} placeholder="搜" />)
    fireEvent.change(screen.getByPlaceholderText('搜'), { target: { value: 'abc' } })
    expect(onChange).toHaveBeenCalledWith('abc')
  })
  it('Enter 触发 onSearch', () => {
    const onSearch = vi.fn()
    render(<SearchBox value="x" onChange={() => {}} onSearch={onSearch} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSearch).toHaveBeenCalledTimes(1)
  })
  it('有值时显示清除叉，点击清空', () => {
    const onChange = vi.fn()
    render(<SearchBox value="x" onChange={onChange} />)
    const clear = screen.getByLabelText('清除')
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith('')
  })
  it('无值时不显示清除叉', () => {
    render(<SearchBox value="" onChange={() => {}} />)
    expect(screen.queryByLabelText('清除')).toBeNull()
  })
})
