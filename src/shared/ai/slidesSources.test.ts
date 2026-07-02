import { vi, describe, it, expect } from 'vitest'

vi.mock('../feishu/docx', () => ({
  getDocumentMeta: vi.fn(async () => ({ document: { title: 'D' } })),
  listBlocks: vi.fn(async () => ({
    items: [
      { block_type: 4, heading2: { elements: [{ text_run: { content: '标题X' } }] } },
      { block_type: 27, image: { token: 't1' } },
      { block_type: 27, image: { token: 't2' } },
    ],
    has_more: false,
    truncated: false,
  })),
}))
vi.mock('../feishu/auth', () => ({ resolveToken: vi.fn(async () => 'tok'), isPermissionError: () => false }))
vi.mock('./dataviz/data', () => ({ deriveVizSource: vi.fn(), fetchVizData: vi.fn() }))

import { fetchMaterial } from './slidesSources'

describe('fetchMaterial doc', () => {
  it('walks blocks → text with 【图n】 + imageTokens (not downloaded)', async () => {
    const m = await fetchMaterial({} as never, {
      kind: 'doc',
      label: 'D',
      url: 'https://a.feishu.cn/docx/DOC',
    }) as Extract<Awaited<ReturnType<typeof fetchMaterial>>, { kind: 'doc' }>

    expect(m.kind).toBe('doc')
    expect(m.text).toContain('【图1】')
    expect(m.text).toContain('标题X')
    expect(m.imageTokens).toEqual([
      { token: 't1', context: '标题X' },
      { token: 't2', context: '标题X' },
    ])
  })
})
