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

/** Compress any Blob (image) to a dataUrl, clamped to longEdge px. Reused by chat attachments
 *  AND slides images. Defaults: longEdge 1280 (chat). Slides passes 1024. */
export async function compressImageToDataUrl(
  blob: Blob,
  opts: { longEdge?: number; quality?: number } = {},
): Promise<string> {
  const longEdge = opts.longEdge ?? MAX_IMAGE_LONG_EDGE
  const quality = opts.quality ?? MAX_IMAGE_QUALITY
  const dataUrl = await readFileAsDataURL(blob as File)
  const img = await loadImage(dataUrl)
  const { width, height } = computeTargetSize(img.width, img.height, longEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.drawImage(img, 0, 0, width, height)
  const useJpeg = blob.type !== 'image/png' || !hasTransparency(canvas, width, height)
  const mime = useJpeg ? 'image/jpeg' : 'image/png'
  return canvas.toDataURL(mime, useJpeg ? quality : undefined)
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
