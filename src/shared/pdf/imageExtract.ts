/**
 * 图片提取：遍历 pdfjs 操作符列表，提取内嵌图片为 dataURL。
 *
 * pdf2md 完全无图像能力——图片位置退化为空段落。
 * 这里用 page.getOperatorList() 遍历 OPS.paintImageXObject / paintJpegXObject，
 * 通过 page.objs.get() 获取图片对象，转为 canvas → dataURL。
 *
 * 纯本地、无 AI、无网络。
 */
import { OPS } from 'pdfjs-dist'
import type { ExtractedImage } from './types'

/** 图片对象 → dataURL（通过 OffscreenCanvas 渲染）。 */
async function imageObjToDataUrl(imgObj: unknown): Promise<string | null> {
  try {
    // pdfjs 图片对象结构：{ width, height, data: Uint8ClampedArray (RGBA), kind }
    const obj = imgObj as { width?: number; height?: number; data?: Uint8ClampedArray | Uint8Array; kind?: number }
    if (!obj.width || !obj.height || !obj.data) return null

    const canvas = new OffscreenCanvas(obj.width, obj.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // pdfjs 的 data 是 RGBA 数组（大多数情况）
    const imageData = new ImageData(
      obj.data instanceof Uint8ClampedArray ? obj.data : new Uint8ClampedArray(obj.data),
      obj.width,
      obj.height,
    )
    ctx.putImageData(imageData, 0, 0)

    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * 从一页提取所有内嵌图片。
 *
 * 需要在页面渲染后调用（page.objs 在渲染时填充）。
 * 返回图片列表，含位置/尺寸/页码。
 */
export async function extractPageImages(
  page: import('pdfjs-dist/types/src/display/api').PDFPageProxy,
  pageNum: number,
): Promise<ExtractedImage[]> {
  const ops = await page.getOperatorList()
  const images: ExtractedImage[] = []

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    // paintImageXObject / paintInlineImageXObject / paintJpegXObject
    const isImage =
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintJpegXObject

    if (!isImage) continue

    const args = ops.argsArray[i]
    if (!args || !args[0]) continue

    const imgName = args[0] as string
    const transform = args[3] as number[] // [a, b, c, d, e, f]

    // 从变换矩阵提取位置/尺寸
    const x = transform?.[4] ?? 0
    const y = transform?.[5] ?? 0
    const width = Math.abs(transform?.[0] ?? 0)
    const height = Math.abs(transform?.[3] ?? 0)

    // 获取图片对象
    // paintInlineImageXObject 的数据直接在 args[0] 里（对象），其他需要 page.objs.get
    let dataUrl: string | null = null
    if (typeof imgName === 'object') {
      // 内联图片
      dataUrl = await imageObjToDataUrl(imgName)
    } else {
      // 命名图片对象（需要从 page.objs 异步获取）
      try {
        const imgObj = await new Promise<unknown>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('img obj timeout')), 5000)
          try {
            page.objs.get(imgName, (val: unknown) => {
              clearTimeout(timeout)
              resolve(val)
            })
          } catch (e) {
            clearTimeout(timeout)
            reject(e)
          }
        })
        dataUrl = await imageObjToDataUrl(imgObj)
      } catch {
        // 某些图片对象可能不可用（如 SMask），跳过
      }
    }

    if (dataUrl) {
      images.push({ dataUrl, x, y, width, height, page: pageNum })
    }
  }

  return images
}
