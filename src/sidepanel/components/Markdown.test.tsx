/* @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Markdown from './Markdown'

afterEach(cleanup)

describe('Markdown', () => {
  it('renders headings, paragraphs, lists', () => {
    render(<Markdown>{'# 标题\n正文\n- 项 A\n- 项 B'}</Markdown>)
    expect(screen.getByText('标题').tagName).toBe('H2')
    expect(screen.getByText('正文').tagName).toBe('P')
    expect(screen.getByText('项 A').tagName).toBe('LI')
  })
  it('renders a fenced code block', () => {
    const { container } = render(<Markdown>{'```js\nconsole.log(1)\n```'}</Markdown>)
    expect(container.querySelector('.md-code-block')).toBeTruthy()
    expect(container.querySelector('.md-code-lang')?.textContent).toBe('js')
  })
  it('renders a github-style table', () => {
    const { container } = render(<Markdown>{'| A | B |\n|---|---|\n| 1 | 2 |'}</Markdown>)
    expect(container.querySelector('.md-table')).toBeTruthy()
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
  })
  it('renders an https link as an anchor', () => {
    render(<Markdown>{'见 https://example.com 页'}</Markdown>)
    const a = document.querySelector('.md-link') as HTMLAnchorElement | null
    expect(a).toBeTruthy()
    expect(a?.href).toBe('https://example.com/')
  })
})
