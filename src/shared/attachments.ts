import type { Attachment, DocRefAttachmentData, DocSelectionPayload } from './types'
import { fileToClip } from './clip/file'
import { parseFeishuContext, buildFeishuUrl } from './feishu/pageUrl'
import { resolveToken } from './feishu/auth'
import { getDocumentMeta } from './feishu/docx'
import { getSpreadsheet, listSheets } from './feishu/sheets'
import { getApp, getWikiNode, listTables } from './feishu/api'
import type { AppSettings, SessionKind } from './types'

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_LONG_EDGE = 1280
const MAX_IMAGE_QUALITY = 0.85
const MAX_ATTACHMENTS_PER_MESSAGE = 4
const MAX_STORAGE_ESTIMATE_PER_IMAGE = 1024 * 1024

// ── Sub-table list cache ──
// 缓存 docToken → 子表列表，避免同一文档反复打开子表选择器时重复拉取。
const subTableCache = new Map<string, { id: string; name: string }[]>()

export function getCachedSubTables(docToken: string): { id: string; name: string }[] | undefined {
  return subTableCache.get(docToken)
}

export function setCachedSubTables(docToken: string, items: { id: string; name: string }[]) {
  subTableCache.set(docToken, items)
}

export interface AttachmentDraft extends Attachment {}

export function isImageFile(file: File): boolean {
  return (file.type || '').startsWith('image/')
}

export function isSupportedTextFile(file: File): boolean {
  const name = file.name.toLowerCase()
  const ext = name.split('.').pop() || ''
  return ext === 'csv' || ext === 'tsv' || ext === 'txt' || (file.type || '').startsWith('text/')
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.onerror = () => reject(new Error('读取文件失败'))
    fr.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/** Pure: clamp an image to fit within `longEdge` px, preserving aspect ratio. */
export function computeTargetSize(width: number, height: number, longEdge: number): { width: number; height: number } {
  const le = Math.max(width, height)
  if (le <= longEdge) return { width, height }
  const ratio = longEdge / le
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) }
}

type Drawable = ImageBitmap | HTMLImageElement

/** Decode an image Blob into something a canvas can draw, robustly. `createImageBitmap` is the
 *  preferred path: it sniffs the image format natively and decodes blobs whose Content-Type is
 *  empty or generic (Feishu's medias download often returns images with no precise MIME), where a
 *  data-URL + `new Image()` round-trip silently fails to decode. Falls back to `<img>` for the rare
 *  environment without `createImageBitmap`, inferring a real MIME from magic bytes so the data URL
 *  is decodable instead of `data:;base64,…` (which `<img>` frequently refuses). */
async function blobToDrawable(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob) } catch { /* fall through to <img> */ }
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const mime = blob.type && blob.type.startsWith('image/') ? blob.type : inferImageMimeFromBytes(bytes)
  return loadImage(`data:${mime};base64,${bytesToBase64(bytes)}`)
}

function inferImageMimeFromBytes(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  return 'image/png' // best-effort default
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000 // avoid call-stack limits on large images
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

/** Compress any Blob (image) to a dataUrl, clamped to longEdge px. Reused by chat attachments
 *  AND slides images. Defaults: longEdge 1280 (chat). Slides passes 1024.
 *
 *  Output format is decided from the actual pixels (not the source MIME): PNG only if the image
 *  really has transparency, else JPEG — so a transparency-free PNG or a Feishu image with a missing
 *  Content-Type still compresses to a small JPEG instead of being kept as PNG by a wrong MIME hint. */
export async function compressImageToDataUrl(
  blob: Blob,
  opts: { longEdge?: number; quality?: number } = {},
): Promise<string> {
  const longEdge = opts.longEdge ?? MAX_IMAGE_LONG_EDGE
  const quality = opts.quality ?? MAX_IMAGE_QUALITY
  const drawable = await blobToDrawable(blob)
  const { width, height } = computeTargetSize(drawable.width, drawable.height, longEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.drawImage(drawable, 0, 0, width, height)
  if ('close' in drawable && typeof drawable.close === 'function') drawable.close() // free the ImageBitmap
  const transparent = hasTransparency(canvas, width, height)
  return canvas.toDataURL(transparent ? 'image/png' : 'image/jpeg', transparent ? undefined : quality)
}

/** Decode a base64 data: URL ("data:image/png;base64,...") straight to a Blob WITHOUT a
 *  network fetch. The naive `await (await fetch(dataUrl)).blob()` throws "Failed to fetch"
 *  in the extension side panel — fetching `data:` URLs is blocked by the MV3 page CSP. This
 *  decodes in-memory, so it works regardless of CSP and avoids a needless round-trip. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('无效的图片数据')
  const meta = dataUrl.slice(0, comma)
  const b64 = dataUrl.slice(comma + 1)
  const mime = /data:([^;,]+)/.exec(meta)?.[1] ?? 'application/octet-stream'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function compressImage(file: File): Promise<string> {
  // Chat-attachment wrapper: shared compression, plus a JPEG-quality step-down
  // loop if the result still exceeds the per-image storage budget.
  const result = await compressImageToDataUrl(file)
  if (estimateBase64Bytes(result) <= MAX_STORAGE_ESTIMATE_PER_IMAGE) return result

  // Re-encode at descending quality on a fresh canvas until it fits (mirrors original logic).
  const dataUrl = await readFileAsDataURL(file)
  const img = await loadImage(dataUrl)
  const { width, height } = computeTargetSize(img.width, img.height, MAX_IMAGE_LONG_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.drawImage(img, 0, 0, width, height)
  let stepped = canvas.toDataURL('image/jpeg', 0.7)
  for (let q = 0.7; q >= 0.45; q -= 0.1) {
    stepped = canvas.toDataURL('image/jpeg', q)
    if (estimateBase64Bytes(stepped) <= MAX_STORAGE_ESTIMATE_PER_IMAGE) break
  }
  return stepped
}

function hasTransparency(canvas: HTMLCanvasElement, width: number, height: number): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  const data = ctx.getImageData(0, 0, width, height).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}

function estimateBase64Bytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? ''
  return Math.round((base64.length * 3) / 4)
}

/** Convert a browser File into an Attachment suitable for a chat message. */
export async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`文件过大（${formatBytes(file.size)}）。请压缩或拆分后重试。`)
  }

  const id = crypto.randomUUID()

  if (isImageFile(file)) {
    const dataUrl = await compressImage(file)
    if (estimateBase64Bytes(dataUrl) > MAX_STORAGE_ESTIMATE_PER_IMAGE) {
      throw new Error('图片压缩后仍超过 1MB，请换一张更小的图片。')
    }
    return {
      id,
      type: 'image',
      name: file.name,
      mimeType: file.type || 'image/jpeg',
      dataUrl,
      size: estimateBase64Bytes(dataUrl),
    }
  }

  if (isSupportedTextFile(file)) {
    const clip = await fileToClip(file)
    return {
      id,
      type: 'file',
      name: file.name,
      mimeType: file.type || 'text/plain',
      content: clip.content,
      size: clip.content.length,
    }
  }

  throw new Error('暂不支持该文件类型。请上传图片、CSV、TSV 或 TXT 文件。')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function validateAttachmentCount(current: number, adding = 1): void {
  if (current + adding > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`单条消息最多附加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个文件。`)
  }
}

/** Build OpenAI-compatible content parts from a message's attachments. */
export function attachmentsToContentParts(attachments: Attachment[]): Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
> {
  const parts: ReturnType<typeof attachmentsToContentParts> = []
  for (const a of attachments) {
    if (a.type === 'image' && a.dataUrl) {
      parts.push({ type: 'image_url', image_url: { url: a.dataUrl, detail: 'auto' } })
    } else if (a.type === 'file' && a.content) {
      parts.push({ type: 'text', text: `\n\n【附件：${a.name}】\n${a.content}` })
    }
  }
  return parts
}

/** Max removable selection chips staged in the input box at once. */
export const MAX_SELECTION_CHIPS = 5

/** Below this length a selection is shown in full on its chip; longer ones are cut to this many
 *  characters with "...." appended (the full text is still sent to the agent + shown on hover). */
const SELECTION_PREVIEW_MAX = 50

/** Compact a long selection for chip DISPLAY only (the full text is still sent to the agent
 *  and shown on hover via `title`). Shows the first 50 characters + "....". */
export function previewSelectionText(text: string): string {
  const t = (text ?? '').trim()
  if (t.length <= SELECTION_PREVIEW_MAX) return t
  return `${t.slice(0, SELECTION_PREVIEW_MAX)}....`
}

/** Build a selection Attachment from a wire payload (+optional resolved context). */
export function selectionToAttachment(
  payload: DocSelectionPayload,
  ctx?: { blockId?: string; paragraphText?: string; headingText?: string },
): Attachment {
  return {
    id: crypto.randomUUID(),
    type: 'selection',
    name: payload.docTitle || '文档片段',
    mimeType: 'text/x-feishu-selection',
    size: 0,
    selection: {
      kind: payload.kind,
      docToken: payload.docToken,
      docTitle: payload.docTitle,
      url: payload.url,
      selectedText: payload.selectedText,
      ...(ctx?.blockId ? { blockId: ctx.blockId } : {}),
      ...(ctx?.paragraphText ? { paragraphText: ctx.paragraphText } : {}),
      ...(ctx?.headingText ? { headingText: ctx.headingText } : {}),
    },
  }
}

/** Pure: try to append a selection chip, enforcing the cap + exact-duplicate dedup.
 *  The cap is PER DOC (chips staged for other docs are hidden, not counted) — so you can hold
 *  up to MAX_SELECTION_CHIPS references for each doc independently. Returns the new attachment
 *  list + whether it was added (and why not). */
export function tryAddSelectionAttachment(
  current: Attachment[],
  payload: DocSelectionPayload,
): { attachments: Attachment[]; added: boolean; reason?: 'dup' | 'limit' } {
  const selCount = current.filter(
    (a) => a.type === 'selection' && a.selection?.docToken === payload.docToken,
  ).length
  if (selCount >= MAX_SELECTION_CHIPS) return { attachments: current, added: false, reason: 'limit' }
  const dup = current.some(
    (a) => a.type === 'selection' && a.selection?.docToken === payload.docToken && a.selection?.selectedText === payload.selectedText,
  )
  if (dup) return { attachments: current, added: false, reason: 'dup' }
  return { attachments: [...current, selectionToAttachment(payload)], added: true }
}

// ─── Document references (whole-doc context) ──────────────────────────────────

/** Max referenced-document chips staged in the input box at once. */
export const MAX_DOCREF_CHIPS = 5

/** Build a docref Attachment from resolved data. */
export function docRefToAttachment(data: DocRefAttachmentData): Attachment {
  return {
    id: crypto.randomUUID(),
    type: 'docref',
    name: data.docTitle || '文档',
    mimeType: 'text/x-feishu-docref',
    size: 0,
    docref: data,
  }
}

/** Pure: try to append a docref chip, enforcing the cap + duplicate-token dedup. */
export function tryAddDocRefAttachment(
  current: Attachment[],
  data: DocRefAttachmentData,
): { attachments: Attachment[]; added: boolean; reason?: 'dup' | 'limit' } {
  const count = current.filter((a) => a.type === 'docref').length
  if (count >= MAX_DOCREF_CHIPS) return { attachments: current, added: false, reason: 'limit' }
  const dup = current.some((a) => a.type === 'docref' && a.docref?.docToken === data.docToken)
  if (dup) return { attachments: current, added: false, reason: 'dup' }
  return { attachments: [...current, docRefToAttachment(data)], added: true }
}

/** 更新某个 docref chip 的子表选择（用户在内联下拉里切换子表时调用）。
 *  sheet → patch { sheetId, sheetName }；base → patch { tableId, tableName }。 */
export function updateDocRefAttachment(
  current: Attachment[],
  id: string,
  patch: Partial<Pick<DocRefAttachmentData, 'sheetId' | 'sheetName' | 'tableId' | 'tableName'>>,
): Attachment[] {
  return current.map((a) =>
    a.id === id && a.docref ? { ...a, docref: { ...a.docref, ...patch } } : a,
  )
}

/** Map a wiki node's obj_type to a SessionKind. */
function wikiObjTypeToKind(objType: string): SessionKind | undefined {
  if (objType === 'bitable') return 'base'
  if (objType === 'sheet') return 'sheet'
  if (objType === 'docx' || objType === 'doc') return 'doc'
  return undefined
}

/** Fetch the real title of a resource by token + kind (read-only GETs). Returns '' on failure. */
async function fetchResourceTitle(kind: SessionKind, token: string, userToken: string): Promise<string> {
  try {
    if (kind === 'doc') {
      const m = await getDocumentMeta(userToken, token) as { document?: { title?: string } }
      return m?.document?.title?.trim() ?? ''
    }
    if (kind === 'sheet') {
      const m = await getSpreadsheet(userToken, token) as { spreadsheet?: { title?: string } }
      return m?.spreadsheet?.title?.trim() ?? ''
    }
    if (kind === 'base') {
      const m = await getApp(userToken, token) as { app?: { name?: string } }
      return m?.app?.name?.trim() ?? ''
    }
    if (kind === 'wiki') {
      const r = await getWikiNode(userToken, token) as { node?: { title?: string } }
      return r?.node?.title?.trim() ?? ''
    }
  } catch { /* not authorized / network / not found */ }
  return ''
}

/**
 * Resolve a pasted Feishu link (or bare token) into a DocRefAttachmentData: parses the kind +
 * token from the URL, resolves wiki nodes to their real kind + obj_token, and fetches the real
 * title via the Feishu API. Returns null when the URL isn't a recognized Feishu resource.
 */
export async function resolveDocRefFromUrl(
  url: string,
  settings: AppSettings,
): Promise<DocRefAttachmentData | null> {
  const s = (url ?? '').trim()
  if (!s) return null

  // Try parsing as a full Feishu URL first.
  const feishu = parseFeishuContext(s)
  let token: string | undefined
  let kind: SessionKind | undefined

  if (feishu?.kind === 'wiki' && feishu.wikiToken) {
    // Wiki node → resolve to real kind + obj_token via the API.
    const userToken = await resolveToken(settings).catch(() => undefined)
    if (!userToken) return null
    try {
      const res = await getWikiNode(userToken, feishu.wikiToken) as {
        node?: { obj_type: string; obj_token: string; title?: string }
      }
      const n = res.node
      if (!n) return null
      let realKind = wikiObjTypeToKind(n.obj_type)
      if (!realKind || !n.obj_token) return null
      // 偶发情况下 wiki get_node 会错误返回 doc，但实际节点是 sheet/base。
      // 当解析为文档时，用返回的 obj_token 尝试读 sheet/base 列表，成功则纠正类型。
      if (realKind === 'doc' && userToken) {
        const baseRes = await listTables(userToken, n.obj_token).catch(() => null) as {
          items?: Array<{ table_id: string; name: string }>
        } | null
        if (baseRes && Array.isArray(baseRes.items)) {
          realKind = 'base'
          setCachedSubTables(n.obj_token, baseRes.items.map((t) => ({ id: t.table_id, name: t.name })))
        } else {
          const sheetRes = await listSheets(userToken, n.obj_token).catch(() => null) as {
            sheets?: Array<{ sheet_id: string; title: string; index?: number }>
          } | null
          if (sheetRes && Array.isArray(sheetRes.sheets)) {
            realKind = 'sheet'
            setCachedSubTables(n.obj_token, sheetRes.sheets.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((s) => ({ id: s.sheet_id, name: s.title })))
          }
        }
      }
      kind = realKind
      token = n.obj_token
      const title = (n.title ?? '').trim()
      // Pre-fetch sub-tables for the resolved sheet/base so the picker opens instantly.
      if ((kind === 'sheet' || kind === 'base') && userToken) {
        void (async () => {
          try {
            if (kind === 'sheet') {
              const res = await listSheets(userToken, token) as {
                sheets?: Array<{ sheet_id: string; title: string; index?: number }>
              }
              setCachedSubTables(token, (res.sheets ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((s) => ({ id: s.sheet_id, name: s.title })))
            } else {
              const res = await listTables(userToken, token) as {
                items?: Array<{ table_id: string; name: string }>
              }
              setCachedSubTables(token, (res.items ?? []).map((t) => ({ id: t.table_id, name: t.name })))
            }
          } catch { /* 缓存预热失败不致命 */ }
        })()
      }
      return {
        kind,
        docToken: token,
        docTitle: title || '',
        url: s,
      }
    } catch { return null }
  }

  // 多维表格 URL 可能带 ?table=xxx —— 捕获下来作为默认选中的子表。
  let baseTableId: string | undefined
  if (feishu?.kind === 'doc' && feishu.documentId) { kind = 'doc'; token = feishu.documentId }
  else if (feishu?.kind === 'sheet' && feishu.spreadsheetToken) { kind = 'sheet'; token = feishu.spreadsheetToken }
  else if (feishu?.kind === 'base' && feishu.appToken) {
    kind = 'base'; token = feishu.appToken
    if (feishu.tableId) baseTableId = feishu.tableId
  }

  // Fallback: a bare token (no / ? #) — assume doc, the most common paste.
  if (!kind || !token) {
    if (!/[/?#]/.test(s) && /^[\w-]{10,}$/.test(s)) { kind = 'doc'; token = s }
    else return null
  }

  const userToken = await resolveToken(settings).catch(() => undefined)
  let title = ''
  let baseTableName: string | undefined
  if (userToken) {
    // 拉取标题和子表列表并行执行，子表缓存后下游选择器可直接命中。
    const titlePromise = fetchResourceTitle(kind, token, userToken)
    const subPromise: Promise<{ id: string; name: string }[] | undefined> = (async () => {
      if (kind === 'sheet') {
        try {
          const res = await listSheets(userToken, token) as {
            sheets?: Array<{ sheet_id: string; title: string; index?: number }>
          }
          const items = (res.sheets ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((s) => ({ id: s.sheet_id, name: s.title }))
          setCachedSubTables(token, items)
          return items
        } catch { return undefined }
      }
      if (kind === 'base') {
        try {
          const res = await listTables(userToken, token) as {
            items?: Array<{ table_id: string; name: string }>
          }
          const items = (res.items ?? []).map((t) => ({ id: t.table_id, name: t.name }))
          setCachedSubTables(token, items)
          return items
        } catch { return undefined }
      }
      return undefined
    })()
    const [t, subItems] = await Promise.all([titlePromise, subPromise])
    title = t
    if (kind === 'base' && baseTableId && subItems) {
      baseTableName = subItems.find((it) => it.id === baseTableId)?.name
    }
  }

  return {
    kind,
    docToken: token,
    docTitle: title,
    url: feishu ? s : buildFeishuUrl(kind, token) || s,
    ...(baseTableId ? { tableId: baseTableId, ...(baseTableName ? { tableName: baseTableName } : {}) } : {}),
  }
}
