import { vi, describe, it, expect } from 'vitest'
import { resolveImage, remapMarkers, stripMarkers, serializeDocBlocks, type SlideImage } from './slidesImages'

const pool: SlideImage[] = [
  { id: 'doc-1', source: 'doc', label: '文档图1', dataUrl: 'data:x' },
  { id: 'upload-a', source: 'upload', label: '产品图', dataUrl: 'data:y' },
]

describe('resolveImage', () => {
  it('finds by id', () => { expect(resolveImage(pool, 'doc-1')?.label).toBe('文档图1') })
  it('returns undefined for missing/empty', () => {
    expect(resolveImage(pool, 'nope')).toBeUndefined()
    expect(resolveImage(pool, undefined)).toBeUndefined()
  })
})

describe('remapMarkers', () => {
  it('remaps 【图n】 local→global by 1-based map', () => {
    // local 1→global 5, local 2→global 6
    expect(remapMarkers('前【图1】中【图2】后', [5, 6])).toBe('前【图5】中【图6】后')
  })
  it('leaves unmapped locals untouched', () => {
    expect(remapMarkers('【图1】', [])).toBe('【图1】')
  })
})

describe('stripMarkers', () => {
  it('removes the given marker numbers', () => {
    expect(stripMarkers('a【图1】b【图2】c', [1])).toBe('ab【图2】c')
  })
})

describe('serializeDocBlocks', () => {
  it('turns text/heading blocks into markdown-ish text', () => {
    const items = [
      { block_type: 4, heading2: { elements: [{ text_run: { content: '产品介绍' } }] } }, // h2
      { block_type: 2, text: { elements: [{ text_run: { content: '正文内容' } }] } },
    ]
    expect(serializeDocBlocks(items).text).toContain('产品介绍')
    expect(serializeDocBlocks(items).text).toContain('正文内容')
  })
  it('inserts 【图n】 at image-block position and collects token + nearest-heading context', () => {
    const items = [
      { block_type: 4, heading2: { elements: [{ text_run: { content: '第三章 产品' } }] } },
      { block_type: 27, image: { token: 'tokA', width: 100, height: 80 } },
      { block_type: 27, image: { token: 'tokB' } },
    ]
    const r = serializeDocBlocks(items)
    expect(r.text).toContain('【图1】')
    expect(r.text).toContain('【图2】')
    expect(r.images).toEqual([
      { token: 'tokA', context: '第三章 产品' },
      { token: 'tokB', context: '第三章 产品' },
    ])
  })
  it('context includes the preceding text line, not just the heading', () => {
    const items = [
      { block_type: 4, heading2: { elements: [{ text_run: { content: '架构' } }] } },
      { block_type: 2, text: { elements: [{ text_run: { content: '系统由三个模块组成' } }] } },
      { block_type: 27, image: { token: 'tok' } },
    ]
    const r = serializeDocBlocks(items)
    expect(r.images[0].context).toBe('架构｜系统由三个模块组成')
  })
  it('a new heading clears the stale preceding text so the image context stays in-section', () => {
    const items = [
      { block_type: 2, text: { elements: [{ text_run: { content: '上一节的旧内容' } }] } },
      { block_type: 4, heading2: { elements: [{ text_run: { content: '新一节' } }] } },
      { block_type: 27, image: { token: 'tok' } },
    ]
    const r = serializeDocBlocks(items)
    expect(r.images[0].context).toBe('新一节') // not '新一节｜上一节的旧内容'
  })
  it('ignores non-image blocks with no text content', () => {
    expect(serializeDocBlocks([{ block_type: 99, weird: {} }]).text.trim()).toBe('')
    expect(serializeDocBlocks([{ block_type: 99 }]).images).toEqual([])
  })
})

// --- harvestDocImages (Task 7) ---
// NOTE: brief wrote mock path './attachments', but the real compressImageToDataUrl
// module is src/shared/attachments.ts → from src/shared/ai/ that's '../attachments'.
// The mock + implementation both use '../attachments' so the mock intercepts the
// real import. Added `vi` to the vitest import (project disables globals).
vi.mock('../feishu/media', () => ({ downloadMedia: vi.fn(async (_t: string) => new Blob([new Uint8Array([1])])) }))
vi.mock('../attachments', () => ({ compressImageToDataUrl: vi.fn(async (b: Blob, o?: { longEdge?: number }) => `data:${(b as { size?: number }).size}-${o?.longEdge}`) }))
import { downloadMedia } from '../feishu/media'
import { compressImageToDataUrl } from '../attachments'
import { harvestDocImages } from './slidesImages'

describe('harvestDocImages', () => {
  it('downloads in parallel, compresses at longEdge=1024, builds pool with doc-N ids', async () => {
    const r = await harvestDocImages({
      userToken: 'u', docImages: [{ token: 'a', context: '标题A' }, { token: 'b', context: '' }],
    })
    expect(downloadMedia).toHaveBeenCalledTimes(2)
    expect(compressImageToDataUrl).toHaveBeenCalledWith(expect.any(Blob), { longEdge: 1024, quality: 0.8 })
    expect(r.images.map((i) => i.id)).toEqual(['doc-1', 'doc-2'])
    expect(r.images[0].context).toBe('标题A')
    expect(r.failedTokens).toEqual([])
  })
  it('skips a failed download, returns it in failedTokens (provisional id keeps the gap)', async () => {
    ;(downloadMedia as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(async (t: string) => { if (t === 'a') throw new Error('403'); return new Blob([]) })
    const r = await harvestDocImages({ userToken: 'u', docImages: [{ token: 'a', context: '' }, { token: 'b', context: '' }] })
    // doc-1 (a) failed → only doc-2 (b) survives; ids are provisional, NOT renumbered.
    expect(r.images.map((i) => i.id)).toEqual(['doc-2'])
    expect(r.failedTokens).toEqual(['a'])
  })

  it('classifies an HTTP download error as reason "http"', async () => {
    ;(downloadMedia as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(async () => { throw new Error('图片下载失败 (429)') })
    const r = await harvestDocImages({ userToken: 'u', docImages: [{ token: 'a', context: '' }] })
    expect(r.failures).toEqual([{ reason: 'http', detail: '图片下载失败 (429)' }])
  })

  it('classifies a decode/compress error as reason "decode"', async () => {
    ;(downloadMedia as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(async () => new Blob([new Uint8Array([1])]))
    ;(compressImageToDataUrl as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(async () => { throw new Error('图片加载失败') })
    const r = await harvestDocImages({ userToken: 'u', docImages: [{ token: 'a', context: '' }] })
    expect(r.failures).toEqual([{ reason: 'decode', detail: '图片加载失败' }])
  })
})
