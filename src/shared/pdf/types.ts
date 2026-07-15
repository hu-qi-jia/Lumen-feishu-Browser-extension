/**
 * PDF 提取的类型定义。
 * 纯本地、无 AI、无网络——基于 pdfjs-dist 的底层 API 自行实现文本+图片提取。
 */

/** pdfjs 文本项（getTextContent 返回的 item 的子集）。 */
export interface TextItem {
  str: string
  /** 变换矩阵 [a, b, c, d, e, f]；e/f 是 x/y 坐标（PDF 坐标系，原点左下）。 */
  transform: number[]
  width: number
  height: number
  /** 字体名（含 Bold/Italic 标记）。 */
  fontName?: string
  /** 是否有 EOL 标记（pdfjs 有时给出）。 */
  hasEOL?: boolean
}

/** 提取出的内嵌图片。 */
export interface ExtractedImage {
  /** dataURL（data:image/png;base64,...）。 */
  dataUrl: string
  /** 图片在 PDF 页面坐标系中的位置（左下原点）。 */
  x: number
  y: number
  width: number
  height: number
  /** 所属页码（从 1 开始）。 */
  page: number
}

/** 行内文本片段（对应 pdfjs 的一个 TextItem），用于基于 X 坐标的表格列检测。 */
export interface TextSegment {
  /** 片段文本（已压缩内部空白）。 */
  text: string
  /** 片段起始 X 坐标（PDF 坐标系）。 */
  x: number
  /** 片段渲染宽度。 */
  width: number
}

/** 一行文本（由同 Y 容差内的 TextItem 合并而成）。 */
export interface TextLine {
  text: string
  /** 行的 Y 坐标（取第一个 item 的 transform[5]）。 */
  y: number
  /** 行的起始 X 坐标。 */
  x: number
  /** 行内最大字号（近似 height）。 */
  fontSize: number
  /** 行内字体名集合（用于粗体/斜体推断）。 */
  fontName?: string
  /** 所属页码。 */
  page: number
  /** 行内文本片段（按 item 分割），用于基于 X 坐标的表格列检测。 */
  segments?: TextSegment[]
}

/** 段落 / 块级元素。 */
export interface Block {
  /** markdown 文本（已含标记）。 */
  text: string
  /** 块的 Y 坐标（取首行）。 */
  y: number
  /** 块的起始 X 坐标。 */
  x: number
  /** 块的类型。 */
  kind: 'heading' | 'paragraph' | 'list' | 'image' | 'empty' | 'table'
  /** 标题级别（1-6），仅 kind === 'heading' 时有效。 */
  level?: number
  /** 所属页码。 */
  page: number
}

/** 单页提取结果。 */
export interface PageContent {
  page: number
  lines: TextLine[]
  images: ExtractedImage[]
}
