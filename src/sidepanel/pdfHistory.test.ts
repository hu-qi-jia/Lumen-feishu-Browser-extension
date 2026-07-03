import { describe, it, expect, beforeEach } from 'vitest'
import { loadPdfs, savePdf, deletePdf, MAX_PDFS } from './pdfHistory'

const store: Record<string, unknown> = {}
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  ;(globalThis as any).chrome = {
    storage: { local: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
        const r: Record<string, unknown> = {}
        for (const k of keys) r[k] = store[k]
        cb(r)
      },
      set: (obj: Record<string, unknown>, cb: () => void) => { Object.assign(store, obj); cb() },
    } },
  }
})

describe('pdfHistory', () => {
  it('savePdf inserts newest-first and dedups by id', async () => {
    await savePdf({ id: 'a', fileName: 'a.pdf', markdown: '# A', createdAt: 1 })
    await savePdf({ id: 'b', fileName: 'b.pdf', markdown: '# B', createdAt: 2 })
    let list = await loadPdfs()
    expect(list.map((x) => x.id)).toEqual(['b', 'a'])
    await savePdf({ id: 'a', fileName: 'a.pdf', markdown: '# A2', createdAt: 3 })
    list = await loadPdfs()
    expect(list.map((x) => x.id)).toEqual(['a', 'b'])   // dedup + lifted to front
    expect(list.find((x) => x.id === 'a')?.markdown).toBe('# A2')
  })
  it('caps at MAX_PDFS', async () => {
    for (let i = 0; i < MAX_PDFS + 3; i++) await savePdf({ id: `id${i}`, fileName: `${i}.pdf`, markdown: '', createdAt: i })
    expect((await loadPdfs()).length).toBe(MAX_PDFS)
  })
  it('deletePdf removes by id', async () => {
    await savePdf({ id: 'a', fileName: 'a.pdf', markdown: '', createdAt: 1 })
    await savePdf({ id: 'b', fileName: 'b.pdf', markdown: '', createdAt: 2 })
    const list = await deletePdf('a')
    expect(list.map((x) => x.id)).toEqual(['b'])
  })
})
