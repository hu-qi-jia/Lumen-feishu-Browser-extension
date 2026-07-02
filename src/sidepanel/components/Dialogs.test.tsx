// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ConfirmDialog from './ConfirmDialog'

afterEach(cleanup)

describe('ConfirmDialog — dismissable + choices', () => {
  const req = { kind: 'create_base' as const, appName: '项目管理', currentApp: 'app1', currentBaseName: '当前库' }

  it('picking 新建独立 Base resolves "new"', () => {
    const onChoose = vi.fn()
    render(<ConfirmDialog req={req} onChoose={onChoose} />)
    fireEvent.click(screen.getByText('新建独立 Base'))
    expect(onChoose).toHaveBeenCalledWith('new')
  })

  it('clicking the overlay cancels', () => {
    const onChoose = vi.fn()
    const { container } = render(<ConfirmDialog req={req} onChoose={onChoose} />)
    fireEvent.click(container.querySelector('.confirm-overlay')!)
    expect(onChoose).toHaveBeenCalledWith('cancel')
  })

  it('Escape key cancels', () => {
    const onChoose = vi.fn()
    render(<ConfirmDialog req={req} onChoose={onChoose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onChoose).toHaveBeenCalledWith('cancel')
  })

  it('warns when open_id (owner) is not configured', () => {
    render(<ConfirmDialog req={{ ...req, ownerConfigured: false }} onChoose={vi.fn()} />)
    expect(screen.getByText(/只能查看、不能编辑/)).toBeTruthy()
  })
})

