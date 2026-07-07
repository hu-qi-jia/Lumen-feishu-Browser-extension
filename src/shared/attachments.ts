import type { Attachment } from './types'
import { fileToClip } from './clip/file'

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_LONG_EDGE = 1280
const MAX_IMAGE_QUALITY = 0.85
const MAX_ATTACHMENTS_PER_MESSAGE = 4
const MAX_STORAGE_ESTIMATE_PER_IMAGE = 1024 * 1024

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
