// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeThumb } from './ThemeThumb'
import { getTheme } from '@/shared/ai/slidesThemes'

afterEach(cleanup)

describe('ThemeThumb', () => {
  it('renders name and reflects selected state', () => {
    render(<ThemeThumb theme={getTheme('night')} selected={true} onSelect={() => {}} />)
    expect(screen.getByText('暗夜')).toBeTruthy()
    expect(screen.getByRole('button', { name: /暗夜/ }).classList.contains('sl-theme--active')).toBe(true)
  })
  it('calls onSelect on click', async () => {
    const user = userEvent.setup()
    const fn = vi.fn()
    render(<ThemeThumb theme={getTheme('minimal')} selected={false} onSelect={fn} />)
    await user.click(screen.getByRole('button'))
    expect(fn).toHaveBeenCalledOnce()
  })
  it('renders a preview swatch keyed by theme id', () => {
    const { container } = render(<ThemeThumb theme={getTheme('pitch')} selected={false} onSelect={() => {}} />)
    expect(container.querySelector('.sl-theme-preview[data-theme="pitch"]')).toBeTruthy()
  })
})
