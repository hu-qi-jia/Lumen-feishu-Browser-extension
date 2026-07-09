// Pure unit tests for the docx block-view helpers added to kill the "4 confirm cards on a
// delete" failure: assertValidDeleteRange turns Feishu's opaque `invalid param` into a
// self-correctable message, and summarizeRootChildren hands the agent the root-children
// count + a numbered list so it stops miscounting the nested tree.
import { describe, it, expect } from 'vitest'
import { assertValidDeleteRange, summarizeRootChildren, summarizeDocument } from './docx'

describe('assertValidDeleteRange — pre-flight index validation', () => {
  it('accepts a valid half-open range (including the full range)', () => {
    expect(() => assertValidDeleteRange('doc1', 0, 3, 3)).not.toThrow()
    expect(() => assertValidDeleteRange('doc1', 2, 3, 73)).not.toThrow() // last block of a 73-child doc
    expect(() => assertValidDeleteRange('doc1', 0, 1, 1)).not.toThrow()
  })

  it('rejects end_index > childCount — the reported off-by-one (74 on a 73-child doc)', () => {
    expect(() => assertValidDeleteRange('doc1', 73, 74, 73)).toThrow(
      /共 73 个.*有效索引 0~72.*start_index=73.*end_index=74/s,
    )
  })

  it('rejects start < 0 and start >= end (empty / inverted range)', () => {
    expect(() => assertValidDeleteRange('doc1', -1, 2, 5)).toThrow(/删除范围无效/)
    expect(() => assertValidDeleteRange('doc1', 3, 3, 5)).toThrow(/删除范围无效/) // start == end → empty
    expect(() => assertValidDeleteRange('doc1', 4, 2, 5)).toThrow(/删除范围无效/) // start > end
  })

  it('rejects non-integer indices', () => {
    expect(() => assertValidDeleteRange('doc1', 1.5, 3, 5)).toThrow(/整数/)
    expect(() => assertValidDeleteRange('doc1', NaN, 3, 5)).toThrow(/整数/)
  })

  it('rejects a missing parent_block_id', () => {
    expect(() => assertValidDeleteRange(undefined, 0, 1, 5)).toThrow(/parent_block_id/)
  })

  it('the error message tells the model the real count and the exact bad params (self-heal)', () => {
    try {
      assertValidDeleteRange('blkX', 10, 12, 8)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('共 8 个')
      expect((e as Error).message).toContain('有效索引 0~7')
      expect((e as Error).message).toContain('start_index=10')
      expect((e as Error).message).toContain('end_index=12')
      expect((e as Error).message).toContain('不要原样重试')
    }
  })
})

describe('summarizeRootChildren — flat 0-indexed view of the doc root', () => {
  // Realistic shape: the page block's parent_id is '' (empty), content blocks' parent_id is
  // the doc id, and nested blocks carry their parent block's id.
  const txt = (id: string, parent: string, i: number, content: string) => ({
    block_id: id, parent_id: parent, index: i, block_type: 2,
    text: { elements: [{ text_run: { content } }] },
  })
  const h1 = (id: string, parent: string, i: number, content: string) => ({
    block_id: id, parent_id: parent, index: i, block_type: 3,
    heading1: { elements: [{ text_run: { content } }] },
  })
  const items = [
    { block_id: 'p', parent_id: '', index: 0, block_type: 1 },          // page root — NOT a content child
    txt('a', 'doc1', 0, '第一段'),
    txt('b', 'doc1', 1, '第二段'),
    h1('h', 'doc1', 2, '标题一'),
    txt('n', 'a', 0, '嵌套在 a 里的子块'),                                // nested — NOT a root child
  ]

  it('counts only root children, excluding the page block and nested blocks', () => {
    const r = summarizeRootChildren(items, 'doc1')
    expect(r.count).toBe(3)
    expect(r.truncated).toBe(false)
  })

  it('gives them stable 0-based indices with a type tag + text preview', () => {
    const r = summarizeRootChildren(items, 'doc1')
    expect(r.indexed).toEqual([
      { i: 0, t: 'text', s: '第一段' },
      { i: 1, t: 'text', s: '第二段' },
      { i: 2, t: 'h1', s: '标题一' },
    ])
  })

  it('keeps the real count even when the indexed list is capped (truncated=true)', () => {
    const many = Array.from({ length: 5 }, (_, i) => txt(`b${i}`, 'd', i, `段${i}`))
    const r = summarizeRootChildren(many, 'd', 3) // cap 3
    expect(r.count).toBe(5) // real total still 5
    expect(r.truncated).toBe(true)
    expect(r.indexed.length).toBe(3) // but only first 3 listed
    expect(r.indexed[0]).toEqual({ i: 0, t: 'text', s: '段0' })
  })

  it('sorts by the block index (not insertion order) so indices match delete semantics', () => {
    const shuffled = [txt('c', 'doc1', 2, '三'), txt('a', 'doc1', 0, '一'), txt('b', 'doc1', 1, '二')]
    const r = summarizeRootChildren(shuffled, 'doc1')
    expect(r.indexed.map((x) => x.s)).toEqual(['一', '二', '三'])
  })

  it('unknown block types fall back to type<N> (never crashes)', () => {
    const r = summarizeRootChildren([{ block_id: 'x', parent_id: 'doc1', index: 0, block_type: 999 }], 'doc1')
    expect(r.indexed[0].t).toBe('type999')
  })
})

describe('summarizeDocument — compact full-text outline for the LLM', () => {
  // Same realistic shape as above: page block's parent_id is '', content blocks' is the doc id.
  const txt = (id: string, parent: string, i: number, content: string) => ({
    block_id: id, parent_id: parent, index: i, block_type: 2,
    text: { elements: [{ text_run: { content } }] },
  })

  it('carries the FULL text of each root block (not a 40-char snippet)', () => {
    const longBody = 'A'.repeat(200) // summarizeRootChildren would slice this to 40
    const items = [
      { block_id: 'p', parent_id: '', index: 0, block_type: 1 },
      txt('a', 'doc1', 0, longBody),
    ]
    const r = summarizeDocument(items, 'doc1')
    expect(r.outline[0].text).toBe(longBody)
    expect(r.outline[0].text.length).toBe(200)
    expect(r.root_children_count).toBe(1)
    expect(r.has_more).toBe(false)
    expect(r.start_index).toBe(0)
  })

  it('reads text from list / quote / code blocks too (the readBlockText generalization)', () => {
    // Old readBlockText only recognized text/heading keys → these came back as ''.
    const items = [
      { block_id: 'p', parent_id: '', index: 0, block_type: 1 },
      { block_id: 'li', parent_id: 'doc1', index: 0, block_type: 9, bullet: { elements: [{ text_run: { content: '列表项' } }] } },
      { block_id: 'q', parent_id: 'doc1', index: 1, block_type: 12, quote: { elements: [{ text_run: { content: '引用文' } }] } },
      { block_id: 'c', parent_id: 'doc1', index: 2, block_type: 11, code: { elements: [{ text_run: { content: 'const x=1' } }] } },
    ]
    const r = summarizeDocument(items, 'doc1')
    expect(r.outline.map((o) => o.text)).toEqual(['列表项', '引用文', 'const x=1'])
  })

  it('orders root children by block index and excludes the page block + nested blocks', () => {
    const items = [
      { block_id: 'p', parent_id: '', index: 0, block_type: 1 },
      txt('b', 'doc1', 1, '第二'),
      txt('a', 'doc1', 0, '第一'),
      txt('nest', 'a', 0, '嵌套在 a 里'), // parent is block 'a', not doc1 → not a root child
    ]
    const r = summarizeDocument(items, 'doc1')
    expect(r.root_children_count).toBe(2)
    expect(r.outline.map((o) => o.text)).toEqual(['第一', '第二'])
  })

  it('paginates: limit caps a page, reports has_more + next_start_index, keeps true count', () => {
    const many = Array.from({ length: 5 }, (_, i) => txt(`b${i}`, 'd', i, `段${i}`))
    const page1 = summarizeDocument(many, 'd', { limit: 3 })
    expect(page1.root_children_count).toBe(5) // real total still 5
    expect(page1.outline.length).toBe(3) // only first 3 on this page
    expect(page1.has_more).toBe(true)
    expect(page1.next_start_index).toBe(3)
    expect(page1.outline.map((o) => o.id)).toEqual(['b0', 'b1', 'b2'])

    // Page 2 picks up at next_start_index and reads to the end → no more.
    const page2 = summarizeDocument(many, 'd', { start: page1.next_start_index, limit: 3 })
    expect(page2.start_index).toBe(3)
    expect(page2.outline.map((o) => o.id)).toEqual(['b3', 'b4'])
    expect(page2.has_more).toBe(false)
    expect(page2.next_start_index).toBeUndefined()
  })

  it('a single block larger than charBudget is still returned (always keeps >= 1 entry)', () => {
    const huge = 'Z'.repeat(10_000)
    const r = summarizeDocument([txt('big', 'doc1', 0, huge)], 'doc1', { charBudget: 100 })
    expect(r.outline.length).toBe(1)
    expect(r.outline[0].text).toBe(huge)
    expect(r.has_more).toBe(false)
  })

  it('query locates blocks by text and reports absolute root indices + matched_count', () => {
    const items = [
      { block_id: 'p', parent_id: '', index: 0, block_type: 1 },
      txt('a', 'doc1', 0, '正文一'),
      txt('h', 'doc1', 1, '目录'), // absolute root index 1
      txt('b', 'doc1', 2, '正文二'),
      txt('h2', 'doc1', 3, '目录（续）'), // also matches "目录", absolute index 3
    ]
    const r = summarizeDocument(items, 'doc1', { query: '目录' })
    expect(r.matched_count).toBe(2)
    expect(r.root_children_count).toBe(4) // unfiltered total, not the match count
    expect(r.outline.map((o) => o.i)).toEqual([1, 3]) // ABSOLUTE root indices, not 0/1
    expect(r.outline.map((o) => o.text)).toEqual(['目录', '目录（续）'])
  })

  it('non-text blocks get empty text but still carry index/type/id', () => {
    const items = [
      { block_id: 'p', parent_id: '', index: 0, block_type: 1 },
      { block_id: 'img', parent_id: 'doc1', index: 0, block_type: 27, image: { token: 't' } },
      { block_id: 'tbl', parent_id: 'doc1', index: 1, block_type: 22, table: {} },
    ]
    const r = summarizeDocument(items, 'doc1')
    expect(r.outline[0]).toMatchObject({ i: 0, type: 'image', id: 'img', text: '' })
    expect(r.outline[1]).toMatchObject({ i: 1, type: 'table', id: 'tbl', text: '' })
  })

  it('every outline entry has exactly {i, type, id, text}', () => {
    const r = summarizeDocument([txt('a', 'doc1', 0, 'x')], 'doc1')
    expect(Object.keys(r.outline[0]).sort()).toEqual(['i', 'id', 'text', 'type'])
  })

  it('empty items → count 0, empty outline, no crash', () => {
    const r = summarizeDocument([], 'doc1')
    expect(r.root_children_count).toBe(0)
    expect(r.outline).toEqual([])
    expect(r.document_id).toBe('doc1')
  })
})
