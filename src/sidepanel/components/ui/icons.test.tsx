// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { IconSearch, IconSettings, IconChevronLeft } from './icons'

afterEach(cleanup)

describe('新增图标', () => {
  it('IconSearch 渲染圆 + 把手线', () => {
    const { container } = render(<IconSearch />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelector('circle')?.getAttribute('cx')).toBe('11')
    expect(svg.querySelector('line')).toBeTruthy()
  })
  it('IconSettings 渲染齿轮（含中心圆 + 主路径）', () => {
    const { container } = render(<IconSettings />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelector('circle')?.getAttribute('r')).toBe('3')
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(1)
  })
  it('IconChevronLeft 渲染左折线', () => {
    const { container } = render(<IconChevronLeft />)
    expect(container.querySelector('svg polyline')?.getAttribute('points')).toBe('15 18 9 12 15 6')
  })
})
