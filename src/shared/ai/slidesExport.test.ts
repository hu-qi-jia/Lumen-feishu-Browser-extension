import { describe, it, expect } from 'vitest'
import { buildSlidesHtml, slideInnerHtml } from './slidesExport'
import type { SlideImage } from './slidesImages'

const pool: SlideImage[] = [{ id: 'doc-1', source: 'doc', label: '图1', dataUrl: 'data:image/png;base64,AA' }]

describe('slidesExport', () => {
  it('slideInnerHtml is re-exported from slideLayouts', () => {
    expect(typeof slideInnerHtml).toBe('function')
  })
  it('buildSlidesHtml embeds image dataUrl and footer per page', () => {
    const html = buildSlidesHtml(
      [{ layout: 'image-split', title: 'A', image: 'doc-1' }, { layout: 'bullets', title: 'B' }],
      '演示',
      { id: 'business', name: '商务', mode: 'light', palette: { bg: '#fff', fg: '#111', accent: '#3370ff', muted: '#666', card: '#f5f6f8', border: '#eee' }, typeScale: { hero: 104, heading: 58, body: 34, caption: 24 }, padding: 120 } as never,
      pool,
    )
    expect(html).toContain('data:image/png;base64,AA')
    expect(html).toContain('s-footer')
    expect(html).toMatch(/1 \/ 2/)
  })
})
