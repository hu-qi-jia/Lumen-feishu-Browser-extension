// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ImagePicker } from './ImagePicker'
import type { SlideImage } from '../../shared/ai/slidesImages'

vi.mock('../../shared/attachments', () => ({
  compressImageToDataUrl: vi.fn(async () => 'data:image/png;base64,AA'),
}))

afterEach(cleanup)

const findXBtn = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === `移除 ${label}`,
  ) as HTMLButtonElement

describe('ImagePicker', () => {
  it('renders existing images with rename + remove', () => {
    const imgs: SlideImage[] = [{ id: 'upload-a', source: 'upload', label: '产品图', dataUrl: 'data:x' }]
    const onChange = vi.fn()
    const { container } = render(<ImagePicker images={imgs} onChange={onChange} />)
    expect((screen.getByDisplayValue('产品图') as HTMLInputElement).value).toBe('产品图')
    fireEvent.click(findXBtn(container, '产品图'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toEqual([])
  })

  it('rename calls onChange with updated label', () => {
    const imgs: SlideImage[] = [{ id: 'upload-a', source: 'upload', label: '产品图', dataUrl: 'data:x' }]
    const onChange = vi.fn()
    render(<ImagePicker images={imgs} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('产品图'), { target: { value: '主图' } })
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(last).toEqual([{ ...imgs[0], label: '主图' }])
  })

  it('shows page badge when pageOf returns a number', () => {
    const imgs: SlideImage[] = [{ id: 'doc-1', source: 'doc', label: '文档图1', dataUrl: 'data:x' }]
    const { container } = render(
      <ImagePicker images={imgs} pageOf={(id) => (id === 'doc-1' ? 3 : undefined)} onChange={() => {}} />,
    )
    expect(container.querySelector('.sl-imgchip-page')?.textContent).toBe('P3')
  })
})
