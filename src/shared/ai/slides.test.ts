import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'
vi.mock('./llm', () => ({ chatCompleteStream: vi.fn(async (_s: unknown, content: string) => {
  // adjustDeck expects a bare JSON array; runMaterialsToSlides expects {title, slides}.
  // Distinguish by the adjustDeck-specific marker so the shared mock serves both call sites.
  if (/【修改要求】/.test(content)) {
    if (/可用图片/.test(content)) return JSON.stringify([{ layout: 'image-split', title: 'x', image: 'upload-产品图' }])
    return JSON.stringify([{ layout: 'bullets', title: '无图', bullets: ['a'] }])
  }
  // runMaterialsToSlides path: echo a pool-aware slide when the prompt lists available images.
  if (/可用图片/.test(content)) return JSON.stringify({ title: 'T', slides: [{ layout: 'image-split', title: 'x', image: 'doc-1' }] })
  return JSON.stringify({ title: 'T', slides: [{ layout: 'bullets', title: '无图', bullets: ['a'] }] })
}) }))
import { sanitizeSlides, runMaterialsToSlides, adjustDeck, placeDocImages, stripFirstPageImage, summarizeImageFailures } from './slides'

describe('sanitizeSlides — coerce model output into safe, well-formed slides', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeSlides(null)).toEqual([])
    expect(sanitizeSlides({})).toEqual([])
    expect(sanitizeSlides('x')).toEqual([])
  })

  it('keeps a valid layout and defaults an unknown/missing one to bullets', () => {
    const out = sanitizeSlides([
      { layout: 'title', title: '封面', subtitle: '副标题' },
      { layout: 'made-up', title: '内容', bullets: ['a', 'b'] },
      { title: '无 layout', bullets: ['x'] },
    ])
    expect(out.map((s) => s.layout)).toEqual(['title', 'bullets', 'bullets'])
  })

  it('drops slides with no content at all', () => {
    const out = sanitizeSlides([
      { layout: 'bullets' },                 // empty → dropped
      { layout: 'bullets', bullets: [] },    // empty bullets → dropped
      { layout: 'section', title: '第一章' },// has a title → kept
    ])
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('第一章')
  })

  it('coerces bullets to a trimmed array of strings and skips blanks', () => {
    const out = sanitizeSlides([{ layout: 'bullets', title: 't', bullets: ['a', '', '  ', 'b', 123] }])
    expect(out[0].bullets).toEqual(['a', 'b', '123'])
  })

  it('normalizes stats entries to {num,label} strings', () => {
    const out = sanitizeSlides([{ layout: 'stats', title: 'KPI', stats: [{ num: 42, label: '用户' }, { num: '3x' }] }])
    expect(out[0].stats).toEqual([{ num: '42', label: '用户' }, { num: '3x', label: '' }])
  })

  it('caps the deck length and per-slide arrays', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ layout: 'bullets', title: `s${i}`, bullets: ['x'] }))
    expect(sanitizeSlides(many)).toHaveLength(24)
    const bigBullets = sanitizeSlides([{ layout: 'bullets', title: 't', bullets: Array.from({ length: 20 }, () => 'b') }])
    expect(bigBullets[0].bullets!.length).toBeLessThanOrEqual(12)
  })

  it('preserves two-col second column', () => {
    const out = sanitizeSlides([{ layout: 'two-col', title: '对比', bullets: ['优点'], bullets2: ['缺点'] }])
    expect(out[0].bullets).toEqual(['优点'])
    expect(out[0].bullets2).toEqual(['缺点'])
  })

  it('keeps a chart slide with its ECharts option object', () => {
    const opt = { series: [{ type: 'pie', data: [{ name: 'A', value: 3 }] }] }
    const out = sanitizeSlides([{ layout: 'chart', title: '占比', chart: opt }])
    expect(out).toHaveLength(1)
    expect(out[0].layout).toBe('chart')
    expect(out[0].chart).toEqual(opt)
  })

  it('drops a chart slide whose chart is missing or not an object', () => {
    const out = sanitizeSlides([
      { layout: 'chart' },                 // no chart, no other content → dropped
      { layout: 'chart', chart: 'nope' },  // chart not an object, no other content → dropped
    ])
    expect(out).toHaveLength(0)
  })

  it('keeps an embed slide with its render code string', () => {
    const out = sanitizeSlides([{ layout: 'embed', title: '看板', code: 'ui.dashboard(container,{data})' }])
    expect(out).toHaveLength(1)
    expect(out[0].layout).toBe('embed')
    expect(out[0].code).toContain('ui.dashboard')
  })
})

describe('sanitizeSlides — new layouts & fields', () => {
  it('accepts cover / cards / image-split layouts', () => {
    const raw = [
      { layout: 'cover', title: '封面', image: 'doc-1' },
      { layout: 'cards', title: '卡片页', eyebrow: '优势', cards: [
        { title: '快', body: '极速', num: '10x' },
        { title: '稳', body: '可靠', image: 'upload-a' },
      ] },
      { layout: 'image-split', title: '图文', image: 'doc-2', imageSide: 'left', imageCaption: '示意图' },
    ]
    const out = sanitizeSlides(raw)
    expect(out).toHaveLength(3)
    expect(out[0].layout).toBe('cover')
    expect(out[1].cards?.length).toBe(2)
    expect(out[2].imageSide).toBe('left')
    expect(out[2].imageCaption).toBe('示意图')
  })

  it('drops image references when image is not a non-empty string', () => {
    const out = sanitizeSlides([{ layout: 'image-split', title: 'x', image: '' }])
    expect(out[0].image).toBeUndefined()
  })

  it('trims surrounding whitespace from image ids so they match the pool exactly', () => {
    const out = sanitizeSlides([
      { layout: 'image-split', title: 'x', image: ' doc-1 ' },
      { layout: 'cards', title: 'y', cards: [{ title: 'a', image: '\tupload-b\n' }] },
    ])
    expect(out[0].image).toBe('doc-1')
    expect(out[1].cards![0].image).toBe('upload-b')
  })

  it('caps cards at 6 and truncates long fields', () => {
    const cards = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, body: 'b'.repeat(300) }))
    const out = sanitizeSlides([{ layout: 'cards', cards }])[0]
    expect(out.cards?.length).toBe(6)
    expect(out.cards![0].body!.length).toBeLessThanOrEqual(160)
  })

  it('accepts timeline layout with steps (capped at 6, body truncated, blanks dropped)', () => {
    const steps = Array.from({ length: 9 }, (_, i) => ({ title: `s${i}`, body: 'b'.repeat(200) }))
    const out = sanitizeSlides([{ layout: 'timeline', title: '路线', steps }])[0]
    expect(out.layout).toBe('timeline')
    expect(out.steps?.length).toBe(6)
    expect(out.steps![0].body!.length).toBeLessThanOrEqual(140)
    // blank steps are filtered out
    const out2 = sanitizeSlides([{ layout: 'timeline', steps: [{ title: 'a' }, { body: '' }, {}] }])[0]
    expect(out2.steps?.length).toBe(1)
  })

  it('keeps new fields optional (old decks load unchanged)', () => {
    const out = sanitizeSlides([{ layout: 'bullets', title: '老页', bullets: ['a'] }])[0]
    expect(out.eyebrow).toBeUndefined()
    expect(out.image).toBeUndefined()
  })
})

describe('runMaterialsToSlides image orchestration', () => {
  it('orchestrates: remap global numbering, harvest via injected fetcher, strip failed markers, pass pool to prompt', async () => {
    const fetcher = vi.fn(async () => ({
      // 输入 imageTokens=[t1]，成功→doc-1
      images: [{ id: 'doc-1', source: 'doc', label: '文档图1', dataUrl: 'data:ok', context: '标题' }],
      failedTokens: [],
    }))
    const materials = [{ kind: 'doc', label: 'D', url: 'u', text: '# 标题\n【图1】正文', imageTokens: [{ token: 't1', context: '标题' }] }]
    const r = await runMaterialsToSlides({} as never, materials as never, undefined, { imageFetcher: fetcher as never })
    expect(fetcher).toHaveBeenCalled()
    const { chatCompleteStream } = await import('./llm')
    const content = (chatCompleteStream as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)?.[1] as string
    expect(content).toContain('【图1】')          // marker survived in prompt text
    expect(content).toContain('可用图片')
    expect(content).toContain('doc-1')
    expect(r.images.map((i: { id: string }) => i.id)).toEqual(['doc-1'])
  })
})

describe('runMaterialsToSlides parallel download + LLM', () => {
  it('builds the LLM prompt with provisional ids before download resolves', async () => {
    // Fetcher deliberately slow-ish: the prompt must still promise doc-1 (provisional pool).
    const fetcher = vi.fn(async () => ({
      images: [{ id: 'doc-1', source: 'doc', label: '文档图1', dataUrl: 'data:ok', context: '标题' }],
      failedTokens: [],
    }))
    const materials = [{ kind: 'doc', label: 'D', url: 'u', text: '# 标题\n【图1】正文', imageTokens: [{ token: 't1', context: '标题' }] }]
    await runMaterialsToSlides({} as never, materials as never, undefined, { imageFetcher: fetcher as never })
    const { chatCompleteStream } = await import('./llm')
    const content = (chatCompleteStream as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)?.[1] as string
    expect(content).toContain('doc-1')
    expect(content).toContain('可用图片')
  })

  it('strips image refs that failed to download (image-split → bullets, cover → title)', async () => {
    // All downloads failed → no survivors. The model (mocked) still referenced doc-1 because the
    // provisional pool promised it. stripFailedImageRefs must degrade the slide to text-only.
    const fetcher = vi.fn(async () => ({ images: [], failedTokens: ['t1'] }))
    const materials = [{ kind: 'doc', label: 'D', url: 'u', text: '# 标题\n【图1】正文', imageTokens: [{ token: 't1', context: '标题' }] }]
    const r = await runMaterialsToSlides({} as never, materials as never, undefined, { imageFetcher: fetcher as never })
    expect(r.images).toEqual([])
    expect(r.slides[0].layout).toBe('bullets')
    expect(r.slides[0].image).toBeUndefined()
  })
})

describe('adjustDeck prompt includes pool', () => {
  it('lists available images when pool non-empty', async () => {
    await adjustDeck({} as never, {
      slides: [{ layout: 'bullets', title: 'a' }],
      images: [{ id: 'upload-产品图', source: 'upload', label: '产品图', dataUrl: 'data:x' }],
      instruction: '把 产品图 放第1页',
    } as never)
    const { chatCompleteStream } = await import('./llm')
    const content = (chatCompleteStream as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)?.[1] as string
    expect(content).toContain('可用图片')
    expect(content).toContain('upload-产品图')
  })
})

describe('placeDocImages — guarantee every doc image appears', () => {
  const docImg = (id: string, ctx: string) => ({ id, source: 'doc' as const, label: id, dataUrl: 'data:x', context: ctx })

  it('does nothing when every doc image is already referenced', () => {
    const slides = [{ layout: 'image-split', title: 'A', image: 'doc-1' }]
    expect(placeDocImages(slides as never, [docImg('doc-1', 'x')])).toEqual(slides)
  })

  it('injects an unreferenced doc image onto the best-matching text slide as image-split (never the cover)', () => {
    const slides = [
      { layout: 'title', title: '封面' },
      { layout: 'bullets', title: '产品架构', bullets: ['模块一', '模块二'] },
      { layout: 'bullets', title: '团队介绍', bullets: ['成员'] },
    ]
    // doc-2 was never referenced; its context '架构' overlaps slide 1 (NOT the cover at slide 0).
    const out = placeDocImages(slides as never, [docImg('doc-2', '产品架构｜系统组成')])
    expect(out[0].layout).toBe('title')            // cover untouched — page 1 stays image-free
    expect(out[0].image).toBeUndefined()
    expect(out[1].layout).toBe('image-split')
    expect(out[1].image).toBe('doc-2')
    expect(out[1].bullets).toEqual(['模块一', '模块二']) // original bullets preserved on the text side
    expect(out[2].layout).toBe('bullets') // untouched
  })

  it('appends an orphan with no text match to a cards gallery page (still guarantees placement)', () => {
    const slides = [{ layout: 'bullets', title: '团队', bullets: ['成员'] }]
    const out = placeDocImages(slides as never, [docImg('doc-9', '完全不相关的XYZABC')])
    expect(out[0].layout).toBe('bullets') // original slide untouched — no token overlap
    expect(out[0].image).toBeUndefined()
    expect(out[1].layout).toBe('cards') // gallery appended so the image still appears
    expect(out[1].cards?.[0].image).toBe('doc-9')
  })

  it('preserves a non-text slide (stats) and routes its orphan to a gallery page', () => {
    const slides = [{ layout: 'stats', title: '数据', stats: [{ num: '99', label: 'x' }] }]
    const out = placeDocImages(slides as never, [docImg('doc-1', '数据')])
    // stats is not placeable → the stat slide is NOT clobbered...
    expect(out[0].layout).toBe('stats')
    expect(out[0].image).toBeUndefined()
    // ...but the image still lands in an appended gallery rather than being dropped.
    expect(out[1].layout).toBe('cards')
    expect(out[1].cards?.[0].image).toBe('doc-1')
  })

  it('inserts the gallery before a closing quote/section slide, not after it', () => {
    const slides = [
      { layout: 'bullets', title: '团队', bullets: ['成员'] },
      { layout: 'quote', quote: '结论' },
    ]
    const out = placeDocImages(slides as never, [docImg('doc-1', '无关ZZZ')])
    expect(out.map((s) => s.layout)).toEqual(['bullets', 'cards', 'quote'])
  })

  it('splits >6 orphan images across multiple gallery pages (6 per page)', () => {
    const slides = [{ layout: 'bullets', title: '团队', bullets: ['成员'] }]
    const imgs = Array.from({ length: 7 }, (_, i) => docImg(`doc-${i + 1}`, '无关XYZ'))
    const out = placeDocImages(slides as never, imgs)
    const galleryPages = out.filter((s) => s.layout === 'cards')
    expect(galleryPages).toHaveLength(2)
    expect(galleryPages[0].cards?.length).toBe(6)
    expect(galleryPages[1].cards?.length).toBe(1)
  })

  it('guarantees every doc image id is referenced somewhere in the deck', () => {
    const slides = [
      { layout: 'bullets', title: '产品架构', bullets: ['模块'] },
      { layout: 'chart', title: '图表', chart: { series: [] } },
      { layout: 'stats', title: '数据', stats: [{ num: '1', label: 'x' }] },
    ]
    const imgs = [docImg('doc-1', '产品架构'), docImg('doc-2', '图表'), docImg('doc-3', '无关QWERTY')]
    const out = placeDocImages(slides as never, imgs)
    const referenced = new Set<string>()
    for (const s of out) {
      if (s.image) referenced.add(s.image)
      s.cards?.forEach((c) => { if (c.image) referenced.add(c.image) })
    }
    expect(referenced).toEqual(new Set(['doc-1', 'doc-2', 'doc-3']))
  })
})

describe('stripFirstPageImage — page 1 never carries an image', () => {
  it('drops a cover background image (cover → title)', () => {
    const out = stripFirstPageImage([{ layout: 'cover', title: '封面', image: 'doc-1' }, { layout: 'bullets', title: 'a', bullets: ['x'] }])
    expect(out[0].layout).toBe('title')
    expect(out[0].image).toBeUndefined()
    expect(out[1].layout).toBe('bullets') // other slides untouched
  })

  it('degrades an image-split cover to bullets, preserving the text side', () => {
    const out = stripFirstPageImage([{ layout: 'image-split', title: '封面', image: 'doc-1', imageSide: 'right', bullets: ['a'] }])
    expect(out[0].layout).toBe('bullets')
    expect(out[0].image).toBeUndefined()
    expect(out[0].imageSide).toBeUndefined()
    expect(out[0].bullets).toEqual(['a'])
  })

  it('strips images from cards on the cover', () => {
    const out = stripFirstPageImage([{ layout: 'cards', title: '封面', cards: [{ image: 'doc-1', title: 'x' }, { image: 'doc-2' }] }])
    expect(out[0].cards?.[0].image).toBeUndefined()
    expect(out[0].cards?.[1].image).toBeUndefined()
  })

  it('leaves a clean title cover and an empty deck unchanged', () => {
    expect(stripFirstPageImage([{ layout: 'title', title: '封面' }])).toEqual([{ layout: 'title', title: '封面' }])
    expect(stripFirstPageImage([])).toEqual([])
  })
})

describe('summarizeImageFailures', () => {
  it('returns empty string for no failures', () => {
    expect(summarizeImageFailures([])).toBe('')
  })
  it('groups by reason in Chinese', () => {
    const failures = [{ reason: 'http' }, { reason: 'http' }, { reason: 'decode' }, { reason: 'other' }]
    const s = summarizeImageFailures(failures)
    expect(s).toContain('2 网络/接口')
    expect(s).toContain('1 解码')
    expect(s).toContain('1 其他')
  })
})
