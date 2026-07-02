import { describe, it, expect } from 'vitest'
import { slideInnerHtml, type SlideCtx } from './slideLayouts'
import type { SlideImage } from './slidesImages'

const pool: SlideImage[] = [{ id: 'doc-1', source: 'doc', label: '文档图1', dataUrl: 'data:image/png;base64,AAAA' }]
const ctx: SlideCtx = { deckName: '《演示》', index: 2, total: 5, images: pool }

describe('slideInnerHtml', () => {
  it('renders eyebrow before head', () => {
    const html = slideInnerHtml({ layout: 'bullets', eyebrow: '概览', title: '标题', bullets: ['a'] })
    expect(html).toMatch(/s-eyebrow.*概览.*s-head.*标题/s)
  })
  it('renders auto footer when ctx present', () => {
    const html = slideInnerHtml({ layout: 'bullets', title: 'x' }, ctx)
    expect(html).toContain('s-footer')
    expect(html).toContain('《演示》')
    expect(html).toContain('3 / 5')
  })
  it('no footer without ctx', () => {
    expect(slideInnerHtml({ layout: 'bullets', title: 'x' })).not.toContain('s-footer')
  })
  it('image-split resolves image id → <img with dataUrl, default right side', () => {
    const html = slideInnerHtml({ layout: 'image-split', title: 't', image: 'doc-1' }, ctx)
    expect(html).toContain('s-split')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toMatch(/s-split-img/) // image present
  })
  it('image-split with missing image id renders text-only (no broken img)', () => {
    const html = slideInnerHtml({ layout: 'image-split', title: 't', image: 'nope' }, ctx)
    expect(html).not.toContain('<img')
  })
  it('image-side left puts image block first', () => {
    const a = slideInnerHtml({ layout: 'image-split', title: 't', image: 'doc-1', imageSide: 'left' }, ctx)
    const imgPos = a.indexOf('s-split-img')
    const txtPos = a.indexOf('s-split-text')
    expect(imgPos).toBeLessThan(txtPos)
  })
  it('cover renders centered title + optional bg image', () => {
    const html = slideInnerHtml({ layout: 'cover', title: '封面', subtitle: '副', image: 'doc-1' }, ctx)
    expect(html).toContain('s-cover')
    expect(html).toContain('封面')
    expect(html).toContain('data:image/png;base64,AAAA')
  })
  it('cards renders grid with num + body', () => {
    const html = slideInnerHtml({ layout: 'cards', title: '优点', cards: [
      { title: '快', body: 'b1', num: '10x' }, { title: '稳', body: 'b2' },
    ] }, ctx)
    expect(html).toContain('s-cards')
    expect(html).toContain('10x')
    expect(html).toContain('b1')
  })
  it('img has alt from imageCaption or label', () => {
    const withCap = slideInnerHtml({ layout: 'image-split', title: 't', image: 'doc-1', imageCaption: '示意图' }, ctx)
    expect(withCap).toContain('alt="示意图"')
    const noCap = slideInnerHtml({ layout: 'image-split', title: 't', image: 'doc-1' }, ctx)
    expect(noCap).toContain('alt="文档图1"')
  })
})
