/**
 * cloneDoc — block-level reconstruction pipeline for migrating a doc's content
 * into a fresh document while preserving images (download original bytes +
 * re-upload to the target doc). The LLM calls this tool ONCE; all iteration
 * happens here — the model never sees individual blocks.
 *
 * Pipeline:
 *   1. createDocument(newTitle) → target doc token
 *   2. listBlocks(sourceToken) → flat block list (paginated internally)
 *   3. Group blocks by parent_id → build a Map sorted by index
 *   4. Walk ROOT children in order, reconstructing:
 *      - Text family (2/3/4/5/12/13/14/15/17/22) → buffer, flush every 50
 *      - Table (31) → rebuild via insertTable (reads cell text from children)
 *      - Image (27) → downloadMedia → uploadMedia → insertBlocks(image)
 *      - Sheet-embed (30) → placeholder text
 *      - Other → skip, count in skippedBlocks
 *   5. Return CloneResult
 */
import { createDocument, listBlocks, insertBlocks, insertTable } from './docx'
import { downloadMedia } from './media'
import { uploadMedia } from './upload'

export interface CloneResult {
  docToken: string
  docTitle: string
  totalBlocks: number
  migratedImages: number
  skippedImages: number
  skippedBlocks: number
}

const TEXT_TYPES = new Set([2, 3, 4, 5, 12, 13, 14, 15, 17, 22])

interface Block {
  block_id: string
  block_type: number
  parent_id: string
  children: string[]
  index: number
  [k: string]: unknown
}

interface Stats {
  migratedImages: number
  skippedImages: number
  skippedBlocks: number
}

/** Extract plain text from a text-family block's elements. */
function getText(block: Block): string {
  const keyMap: Record<number, string> = {
    2: 'text', 3: 'heading1', 4: 'heading2', 5: 'heading3',
    12: 'bullet', 13: 'ordered', 15: 'quote', 14: 'code', 17: 'todo',
  }
  const key = keyMap[block.block_type]
  if (!key) return ''
  const el = (block as Record<string, unknown>)[key] as {
    elements?: Array<{ text_run?: { content?: string } }>
  }
  return (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('')
}

/** Map block_type to a BlockSpec style string. */
function blockStyle(bt: number): string {
  const map: Record<number, string> = {
    2: 'text', 3: 'h1', 4: 'h2', 5: 'h3',
    12: 'bullet', 13: 'ordered', 14: 'code',
    15: 'quote', 17: 'todo', 22: 'divider',
  }
  return map[bt] || 'text'
}

export async function cloneDocumentWithImages(opts: {
  sourceDocToken: string
  newDocTitle: string
  token: string // user_access_token
}): Promise<CloneResult> {
  const { sourceDocToken, newDocTitle, token } = opts

  // 1. Create target doc
  const created = (await createDocument(token, newDocTitle)) as {
    document?: { document_id?: string }
  }
  const targetDocId = created.document?.document_id
  if (!targetDocId) throw new Error('创建目标文档失败')
  const target = targetDocId // narrowed for closure safety

  // 2. Read all blocks from source (flat list, one paginated call internally)
  const { items } = (await listBlocks(token, sourceDocToken)) as { items?: Block[] }
  if (!items || !Array.isArray(items)) throw new Error('无法读取源文档结构')
  const allBlocks: Block[] = items

  // 3. Build parent→children map sorted by index
  const byParent = new Map<string, Block[]>()
  for (const b of allBlocks) {
    const list = byParent.get(b.parent_id) || []
    list.push(b)
    byParent.set(b.parent_id, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.index - b.index)

  // 4. Walk root children in order
  const rootChildren = byParent.get(sourceDocToken) ?? []
  const stats: Stats = { migratedImages: 0, skippedImages: 0, skippedBlocks: 0 }
  let textBuf: Array<{ text: string; style?: string; imageToken?: string }> = []
  let runningIndex = 0

  async function flushTextBuf() {
    if (!textBuf.length) return
    const specs = textBuf.map((t) => {
      if (t.imageToken) return { text: '', style: 'image' as const, imageToken: t.imageToken }
      return { text: t.text, style: (t.style || 'text') as 'text' }
    })
    await insertBlocks(token, target, specs, runningIndex)
    runningIndex += specs.length
    textBuf = []
  }

  async function processImage(block: Block) {
    const img = (block as { image?: { token?: string } }).image
    const imgToken = typeof img?.token === 'string' ? img.token : ''
    if (!imgToken) {
      stats.skippedImages++
      return
    }
    try {
      const blob = await downloadMedia(imgToken, token)
      if (blob.size > 20 * 1024 * 1024) {
        stats.skippedImages++
        return
      }
      const newToken = await uploadMedia({
        blob,
        fileName: 'image.png',
        mimeType: blob.type || 'image/png',
        parentNode: target,
        parentType: 'docx_image',
        token,
      })
      await flushTextBuf()
      await insertBlocks(
        token,
        target,
        [{ text: '', style: 'image', imageToken: newToken }],
        runningIndex,
      )
      runningIndex++
      stats.migratedImages++
    } catch {
      stats.skippedImages++
    }
  }

  async function processTable(block: Block) {
    await flushTextBuf()
    const cellBlocks = byParent.get(block.block_id) ?? []

    try {
      // Read table dimensions from the table block's property.
      const tableBlock = allBlocks.find((b) => b.block_id === block.block_id)
      const prop = (tableBlock as Record<string, unknown> | undefined)?.table as
        | { property?: { row_size?: number; column_size?: number } }
        | undefined
      const nRows = prop?.property?.row_size ?? 0
      const nCols = prop?.property?.column_size ?? 0

      // Filter and sort cells by index (row-major).
      const cells = cellBlocks
        .filter((c) => c.block_type === 32)
        .sort((a, b) => a.index - b.index)

      // If property is missing, infer from the cell count (single column).
      const rows = nRows > 0 ? nRows : cells.length
      const cols = nCols > 0 ? nCols : 1

      // Build grid
      const grid: string[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ''),
      )
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c
          const cell = cells.find((cc) => cc.index === idx)
          if (cell) {
            const textChild = byParent
              .get(cell.block_id)
              ?.find((tc) => tc.block_type === 2)
            grid[r][c] = textChild ? getText(textChild) : ''
          }
        }
      }
      await insertTable(token, target, grid, runningIndex)
      runningIndex++
    } catch {
      // Table reconstruction failed — insert a placeholder
      await insertBlocks(
        token,
        target,
        [{ text: '〔原表格重建失败，已跳过〕' }],
        runningIndex,
      )
      runningIndex++
      stats.skippedBlocks++
    }
  }

  // Walk root children in display order
  for (const block of rootChildren) {
    if (TEXT_TYPES.has(block.block_type)) {
      const style = blockStyle(block.block_type)
      if (block.block_type === 22) {
        textBuf.push({ text: '', style: 'divider' })
      } else {
        textBuf.push({ text: getText(block), style })
      }
      if (textBuf.length >= 50) await flushTextBuf()
    } else if (block.block_type === 27) {
      await processImage(block)
    } else if (block.block_type === 31) {
      await processTable(block)
    } else if (block.block_type === 30) {
      // Embedded sheet — placeholder
      await flushTextBuf()
      await insertBlocks(
        token,
        target,
        [{ text: '〔原嵌入式表格，未迁移〕' }],
        runningIndex,
      )
      runningIndex++
      stats.skippedBlocks++
    } else {
      stats.skippedBlocks++
    }
  }

  await flushTextBuf()

  return {
    docToken: target,
    docTitle: newDocTitle,
    totalBlocks: allBlocks.length,
    migratedImages: stats.migratedImages,
    skippedImages: stats.skippedImages,
    skippedBlocks: stats.skippedBlocks,
  }
}
