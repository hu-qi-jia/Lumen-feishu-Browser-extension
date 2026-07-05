// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageExportCard from './ImageExportCard'

describe('ImageExportCard', () => {
  const sample = [
    { name: 'img1.png', context: '标题A', dataUrl: 'data:image/png;base64,abc' },
    { name: 'img2.jpg', context: '', dataUrl: 'data:image/jpeg;base64,xyz' },
  ]

  it('renders image count and download button', () => {
    render(<ImageExportCard images={sample} docTitle="测试文档" onClose={vi.fn()} />)
    expect(screen.getByText('2 张图片（测试文档）')).toBeTruthy()
    expect(screen.getByText('下载全部 ZIP')).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(2)
  })

  it('shows empty state when no valid images', () => {
    render(<ImageExportCard images={[{ name: 'x', context: '', dataUrl: '' }]} docTitle="x" onClose={vi.fn()} />)
    expect(screen.getByText('没有可导出的图片')).toBeTruthy()
  })

  it('calls onClose when × clicked', async () => {
    const onClose = vi.fn()
    render(<ImageExportCard images={sample} docTitle="x" onClose={onClose} />)
    const closeBtns = screen.getAllByLabelText('关闭')
    await userEvent.click(closeBtns[closeBtns.length - 1])
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
