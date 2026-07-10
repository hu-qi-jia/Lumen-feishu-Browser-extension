// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { PageContext } from '@/shared/types'
import { DEFAULT_SETTINGS } from '@/shared/types'
import ScenarioPanel from './ScenarioPanel'

afterEach(cleanup)

const ctx: PageContext = { url: '', title: '', selectedText: '' }
const settings = { ...DEFAULT_SETTINGS, templateRegistryUrl: '' }

const realCard = (c: HTMLElement) => c.querySelector('.sc-card:not(.sc-card--skeleton)') as HTMLElement | null
const enterGallery = (c: HTMLElement) => {
  const card = Array.from(c.querySelectorAll('.hub-card--clickable'))
    .find((el) => el.textContent?.includes('场景模版')) as HTMLElement
  fireEvent.click(card)
}

describe('ScenarioPanel — feature hub + template gallery', () => {
  it('lands on the hub with a template-library entry', () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={false} recentFiles={[]} onGoToSettings={() => {}} />)
    expect(container.querySelector('.hub-card--clickable')).toBeTruthy()
  })

  it('renders builtin template cards in the gallery', async () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={false} recentFiles={[]} onGoToSettings={() => {}} />)
    enterGallery(container)
    await waitFor(() => expect(realCard(container)).toBeTruthy())
  })

  it('clicking anywhere on a card enters the detail/config view', async () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={false} recentFiles={[]} onGoToSettings={() => {}} />)
    enterGallery(container)
    await waitFor(() => expect(realCard(container)).toBeTruthy())
    fireEvent.click(realCard(container)!)
    expect(container.querySelector('.topbar-title')).toBeTruthy()
  })

  it('detail is reachable even when disabled (browsing not gated), but 创建 is blocked', async () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={true} recentFiles={[]} onGoToSettings={() => {}} />)
    enterGallery(container)
    await waitFor(() => expect(realCard(container)).toBeTruthy())
    fireEvent.click(realCard(container)!)
    expect(container.querySelector('.topbar-title')).toBeTruthy()
    const createBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => /开始创建|请先配置/.test(b.textContent || '')) as HTMLButtonElement
    expect(createBtn?.disabled).toBe(true)
  })

  // ── Context-aware hub: features that don't fit the current page are dimmed, not hidden ──
  const groupOf = (c: HTMLElement, title: string) =>
    Array.from(c.querySelectorAll('.sc-hub-group')).find((g) => g.textContent?.includes(title)) as HTMLElement

  it('on a Base page, table- and content-feature groups are all active (nothing dimmed)', () => {
    const baseCtx: PageContext = { url: '', title: '', selectedText: '', feishu: { isBase: true, kind: 'base', appToken: 'x' } }
    const { container } = render(<ScenarioPanel settings={settings} context={baseCtx} disabled={false} recentFiles={[]} onGoToSettings={() => {}} />)
    expect(container.querySelector('.sc-hub-title')?.textContent).toBe('应用')
    expect(groupOf(container, '数据可视化').className).not.toContain('sc-hub-group--dim')
    expect(groupOf(container, '数据分析').className).not.toContain('sc-hub-group--dim')
    expect(groupOf(container, '演示文稿').className).not.toContain('sc-hub-group--dim')
    expect(container.querySelector('.sc-hub-group--dim')).toBeFalsy()
  })

  it('on a Doc page, table-feature groups are dimmed but content/any groups stay active', () => {
    const docCtx: PageContext = { url: '', title: '', selectedText: '', feishu: { isBase: false, kind: 'doc', documentId: 'd' } }
    const { container } = render(<ScenarioPanel settings={settings} context={docCtx} disabled={false} recentFiles={[]} onGoToSettings={() => {}} />)
    expect(container.querySelector('.sc-hub-title')?.textContent).toBe('应用')
    expect(groupOf(container, '数据可视化').className).toContain('sc-hub-group--dim')
    expect(groupOf(container, '数据分析').className).toContain('sc-hub-group--dim')
    expect(groupOf(container, '演示文稿').className).not.toContain('sc-hub-group--dim')
  })

  it('off a Feishu resource, nothing is dimmed (we can\'t tell what the page is)', () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={false} recentFiles={[]} onGoToSettings={() => {}} />)
    expect(container.querySelector('.sc-hub-title')?.textContent).toBe('应用')
    expect(container.querySelector('.sc-hub-group--dim')).toBeFalsy()
  })

  it('知识库 card routes to the KnowledgeBasePanel', async () => {
    vi.resetModules()
    const pingMock = vi.fn().mockResolvedValue({ ok: false, status: 0, authenticated: false })
    vi.doMock('../../../shared/obsidian/api', () => ({ pingObsidian: pingMock }))
    const ScenarioPanelFresh = (await import('./ScenarioPanel')).default
    const { container } = render(<ScenarioPanelFresh settings={settings} context={ctx} disabled={false} recentFiles={[]} onGoToSettings={() => {}} />)
    const card = Array.from(container.querySelectorAll('.hub-card--clickable'))
      .find((el) => el.textContent?.includes('知识库')) as HTMLElement
    expect(card).toBeTruthy()
    fireEvent.click(card)
    await waitFor(() => expect(container.querySelector('.topbar-title')?.textContent).toBe('知识库'))
    vi.doUnmock('../../../shared/obsidian/api')
  })
})
