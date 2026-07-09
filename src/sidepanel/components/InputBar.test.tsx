// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import InputBar from './InputBar'
import { HAS_KNOWLEDGE_BASE } from '../../shared/config'

vi.mock('../../shared/ai/skills', () => ({ preloadSkills: () => Promise.resolve([]) }))

afterEach(cleanup)

describe('InputBar 知识库开关', () => {
  it('HAS_KNOWLEDGE_BASE 且无技能时仍可点开下拉，显示知识库开关', () => {
    if (!HAS_KNOWLEDGE_BASE) return
    render(
      <InputBar
        onSend={() => {}}
        disabled={false}
        kbEnabled={false}
        onToggleKb={() => {}}
        resourceKind="general"
      />,
    )
    fireEvent.click(screen.getByText('Tools'))
    expect(screen.getByText('知识库')).toBeTruthy()
  })

  it('点击知识库选项触发 onToggleKb(true)', () => {
    if (!HAS_KNOWLEDGE_BASE) return
    const toggle = vi.fn()
    render(
      <InputBar
        onSend={() => {}}
        disabled={false}
        kbEnabled={false}
        onToggleKb={toggle}
        resourceKind="general"
      />,
    )
    fireEvent.click(screen.getByText('Tools'))
    fireEvent.click(screen.getByText('知识库'))
    expect(toggle).toHaveBeenCalledWith(true)
  })
})
