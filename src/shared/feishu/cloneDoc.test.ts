import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./docx', () => ({
  createDocument: vi.fn(),
  listBlocks: vi.fn(),
  insertBlocks: vi.fn(),
  insertTable: vi.fn(),
}))

vi.mock('./media', () => ({ downloadMedia: vi.fn() }))
vi.mock('./upload', () => ({ uploadMedia: vi.fn() }))

import { cloneDocumentWithImages } from './cloneDoc'
import { createDocument, listBlocks, insertBlocks, insertTable } from './docx'
import { downloadMedia } from './media'
import { uploadMedia } from './upload'

function textBlock(id: string, parentId: string, idx: number, content: string) {
  return {
    block_id: id,
    block_type: 2,
    parent_id: parentId,
    children: [],
    index: idx,
    text: { elements: [{ text_run: { content } }], style: {} },
  }
}

function imageBlock(id: string, parentId: string, idx: number, token: string) {
  return {
    block_id: id,
    block_type: 27,
    parent_id: parentId,
    children: [],
    index: idx,
    image: { token },
  }
}

function sheetBlock(id: string, parentId: string, idx: number) {
  return {
    block_id: id,
    block_type: 30,
    parent_id: parentId,
    children: [],
    index: idx,
    sheet: { token: 'stok_sid' },
  }
}

function tableBlock(
  id: string,
  parentId: string,
  idx: number,
  rows: number,
  cols: number,
) {
  return {
    block_id: id,
    block_type: 31,
    parent_id: parentId,
    children: Array.from({ length: rows * cols }, (_, i) => `c_${i}`),
    index: idx,
    table: { property: { row_size: rows, column_size: cols, header_row: true } },
  }
}

function cellBlock(
  id: string,
  parentId: string,
  idx: number,
  textChildId: string,
) {
  return {
    block_id: id,
    block_type: 32,
    parent_id: parentId,
    children: [textChildId],
    index: idx,
  }
}

// Helper: a well-formed listBlocks return value.
function blocksResult<T>(items: T[]) {
  return { items, has_more: false, truncated: false }
}

describe('cloneDocumentWithImages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates target doc and inserts text blocks from source', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    vi.mocked(listBlocks).mockResolvedValue(
      blocksResult([textBlock('b1', 'src-doc', 0, 'Hello world')]),
    )
    vi.mocked(insertBlocks).mockResolvedValue({
      children: [{ block_id: 'nb1' }],
      blocks_inserted: 1,
    })

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'Copy',
      token: 'u_tok',
    })

    expect(createDocument).toHaveBeenCalledWith('u_tok', 'Copy')
    expect(result.docToken).toBe('target-123')
    expect(result.totalBlocks).toBe(1)
    expect(insertBlocks).toHaveBeenCalled()
  })

  it('migrates images — downloads and uploads each one', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    vi.mocked(listBlocks).mockResolvedValue(
      blocksResult([
        imageBlock('img1', 'src-doc', 0, 'img-tok-1'),
        imageBlock('img2', 'src-doc', 1, 'img-tok-2'),
      ]),
    )
    vi.mocked(insertBlocks).mockResolvedValue({
      children: [{ block_id: 'nb' }],
      blocks_inserted: 1,
    })
    const fakeBlob = new Blob(['fake'], { type: 'image/png' })
    vi.mocked(downloadMedia).mockResolvedValue(fakeBlob)
    vi.mocked(uploadMedia).mockResolvedValueOnce('new-tok-1')
    vi.mocked(uploadMedia).mockResolvedValueOnce('new-tok-2')

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'With Pics',
      token: 'u_tok',
    })

    expect(downloadMedia).toHaveBeenCalledTimes(2)
    expect(downloadMedia).toHaveBeenCalledWith('img-tok-1', 'u_tok')
    expect(downloadMedia).toHaveBeenCalledWith('img-tok-2', 'u_tok')
    expect(uploadMedia).toHaveBeenCalledTimes(2)
    expect(result.migratedImages).toBe(2)
    expect(result.skippedImages).toBe(0)
  })

  it('skips images on upload failure', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    vi.mocked(listBlocks).mockResolvedValue(
      blocksResult([imageBlock('img1', 'src-doc', 0, 'img-tok-1')]),
    )
    vi.mocked(insertBlocks).mockResolvedValue({
      children: [{ block_id: 'nb' }],
      blocks_inserted: 1,
    })
    vi.mocked(downloadMedia).mockResolvedValue(
      new Blob(['fake'], { type: 'image/png' }),
    )
    vi.mocked(uploadMedia).mockRejectedValue(new Error('upload failed'))

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'X',
      token: 'u_tok',
    })

    expect(result.skippedImages).toBe(1)
    expect(result.migratedImages).toBe(0)
  })

  it('skips images with empty token', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    vi.mocked(listBlocks).mockResolvedValue(
      blocksResult([imageBlock('img1', 'src-doc', 0, '')]),
    )
    vi.mocked(insertBlocks).mockResolvedValue({
      children: [{ block_id: 'nb' }],
      blocks_inserted: 1,
    })

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'X',
      token: 'u_tok',
    })

    expect(result.skippedImages).toBe(1)
    expect(downloadMedia).not.toHaveBeenCalled()
  })

  it('skips oversized images (>20MB)', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    vi.mocked(listBlocks).mockResolvedValue(
      blocksResult([imageBlock('img1', 'src-doc', 0, 'big-tok')]),
    )
    vi.mocked(insertBlocks).mockResolvedValue({
      children: [{ block_id: 'nb' }],
      blocks_inserted: 1,
    })
    vi.mocked(downloadMedia).mockResolvedValue(
      new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'image/png' }),
    )

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'X',
      token: 'u_tok',
    })

    // uploadMedia should not be called — the >20MB guard in cloneDoc catches it
    expect(uploadMedia).not.toHaveBeenCalled()
    expect(result.skippedImages).toBe(1)
  })

  it('inserts placeholder for embedded sheets', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    vi.mocked(listBlocks).mockResolvedValue(
      blocksResult([sheetBlock('s1', 'src-doc', 0)]),
    )
    vi.mocked(insertBlocks).mockResolvedValue({
      children: [{ block_id: 'p' }],
      blocks_inserted: 1,
    })

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'x',
      token: 't',
    })

    expect(result.skippedBlocks).toBe(1)
    expect(insertBlocks).toHaveBeenCalledWith('t', 'target-123', [
      { text: '〔原嵌入式表格，未迁移〕' },
    ], 0)
  })

  it('reconstructs tables from flat blocks', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    // Table with 2 rows x 2 cols: cells c0..c3, each with a text child
    vi.mocked(listBlocks).mockResolvedValue(
      blocksResult([
        tableBlock('tbl', 'src-doc', 0, 2, 2),
        cellBlock('c0', 'tbl', 0, 't0'),
        textBlock('t0', 'c0', 0, 'A'),
        cellBlock('c1', 'tbl', 1, 't1'),
        textBlock('t1', 'c1', 0, 'B'),
        cellBlock('c2', 'tbl', 2, 't2'),
        textBlock('t2', 'c2', 0, 'C'),
        cellBlock('c3', 'tbl', 3, 't3'),
        textBlock('t3', 'c3', 0, 'D'),
      ]),
    )
    vi.mocked(insertTable).mockResolvedValue({
      table_block_id: 'ntbl',
      rows: 2,
      cols: 2,
    })

    await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'Table Doc',
      token: 'u_tok',
    })

    expect(insertTable).toHaveBeenCalledWith('u_tok', 'target-123', [
      ['A', 'B'],
      ['C', 'D'],
    ], 0)
  })

  it('handles empty source document gracefully', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    vi.mocked(listBlocks).mockResolvedValue(blocksResult([]))

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'Empty',
      token: 'u_tok',
    })

    expect(result.totalBlocks).toBe(0)
    expect(insertBlocks).not.toHaveBeenCalled()
  })

  it('buffers and flushes text blocks in chunks of 50', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    // 120 text blocks — should trigger at least 2 flushes (50 + 50 + 20)
    const blocks = Array.from({ length: 120 }, (_, i) =>
      textBlock(`b${i}`, 'src-doc', i, `Line ${i}`),
    )
    vi.mocked(listBlocks).mockResolvedValue(blocksResult(blocks))
    vi.mocked(insertBlocks).mockResolvedValue({
      children: [{ block_id: 'x' }],
      blocks_inserted: 50,
    })

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'Many Lines',
      token: 'u_tok',
    })

    // Should call insertBlocks multiple times due to 50-block flush
    expect(vi.mocked(insertBlocks).mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(result.totalBlocks).toBe(120)
  })

  it('combines text + image + sheet in a mixed document', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    vi.mocked(listBlocks).mockResolvedValue(
      blocksResult([
        textBlock('b1', 'src-doc', 0, 'Intro paragraph'),
        imageBlock('img', 'src-doc', 1, 'img-tok'),
        textBlock('b2', 'src-doc', 2, 'After image text'),
        sheetBlock('sh', 'src-doc', 3),
      ]),
    )
    const fakeBlob = new Blob(['fake'], { type: 'image/png' })
    vi.mocked(downloadMedia).mockResolvedValue(fakeBlob)
    vi.mocked(uploadMedia).mockResolvedValue('new-tok')
    vi.mocked(insertBlocks).mockResolvedValue({
      children: [{ block_id: 'x' }],
      blocks_inserted: 1,
    })

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'Mixed',
      token: 'u_tok',
    })

    expect(result.migratedImages).toBe(1)
    expect(result.skippedBlocks).toBe(1)
    expect(downloadMedia).toHaveBeenCalledWith('img-tok', 'u_tok')
  })

  it('skips unknown block types', async () => {
    vi.mocked(createDocument).mockResolvedValue({
      document: { document_id: 'target-123' },
    })
    vi.mocked(listBlocks).mockResolvedValue(
      blocksResult([
        {
          block_id: 'unk',
          block_type: 99,
          parent_id: 'src-doc',
          children: [],
          index: 0,
        },
        textBlock('b1', 'src-doc', 1, 'Known'),
      ]),
    )
    vi.mocked(insertBlocks).mockResolvedValue({
      children: [{ block_id: 'nb' }],
      blocks_inserted: 1,
    })

    const result = await cloneDocumentWithImages({
      sourceDocToken: 'src-doc',
      newDocTitle: 'X',
      token: 't',
    })

    expect(result.skippedBlocks).toBe(1)
  })
})
