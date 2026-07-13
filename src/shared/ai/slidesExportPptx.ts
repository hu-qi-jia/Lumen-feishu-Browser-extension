/**
 * 导出 PPTX（PowerPoint .pptx）—— 把生成 PPT 的同一份 Slide[] 渲染成可在
 * PowerPoint / Keynote / WPS 中打开编辑的 .pptx 文件。
 *
 * 设计依据：
 *  - 源画布 1920×1080px，PptxGenJS LAYOUT_WIDE 为 13.33"×7.5"，换算系数 144（1920/13.33≈144，
 *    1080/7.5=144），所以 `inch = px / 144`。
 *  - 主题 palette 用十六进制（无 #），直接传入 PptxGenJS 的 color/fill。
 *  - 12 种 layout 各自映射到 PptxGenJS 的 addText / addImage / addShape。
 *  - 图片以 SlideImage.dataUrl（base64）嵌入，addImage({ data }) 原生支持。
 *  - chart layout（ECharts option）暂以占位文本降级，避免错误转换数据。
 *
 * pptxgenjs 通过动态 import 按需加载，不进主 bundle，避免增大首屏体积。
 */
import type { Slide } from './slides'
import type { SlideTheme } from './slidesThemes'
import { DEFAULT_THEME_ID, getTheme } from './slidesThemes'
import { resolveImage, type SlideImage } from './slidesImages'

// 动态 import 类型——只在调用导出时才加载 pptxgenjs，避免进主 bundle
type PptxGenJS = import('pptxgenjs').default
type PptxSlide = import('pptxgenjs').default.Slide

// 1920×1080 画布 → 13.33"×7.5" 的换算系数
const PX = 144
const inch = (px: number) => px / PX
// 画布尺寸（英寸）
const W = 13.33
const H = 7.5
// 安全边距（英寸）
const PAD = 0.7

/** 去掉颜色字符串的 # 前缀，PptxGenJS 要求 hex 无 # */
const hex = (c: string): string => (c || '').replace(/^#/, '')

/**
 * 把 CSS 字体栈清洗成单个 PPTX 字体名。
 * PptxGenJS 的 fontFace 参数直接写入 XML，不能含逗号/引号——
 * 否则 `<a:latin typeface="a, "b", c"/>` 会因引号未转义导致 XML 解析失败，
 * PowerPoint 拒绝打开。
 * 策略：优先取第一个被引号包围的字体名（通常是真正的字体名，如 "PingFang SC"），
 * 没有则取逗号分隔的第一项并去引号。
 */
const safeFont = (font: string | undefined): string | undefined => {
  if (!font) return undefined
  const quoted = font.match(/["']([^"']+)["']/)
  if (quoted) return quoted[1]
  const first = font.split(',')[0].trim().replace(/^["']|["']$/g, '')
  return first || undefined
}

/**
 * px → pt 换算：源画布 1920×1080px → PPTX 13.33"×7.5"，144px/inch，1inch=72pt。
 * 所以 pt = px / 144 * 72 = px / 2。
 */
const pt = (px: number) => Math.round(px / 2)

/** 从主题 typeScale 生成各 layout 用的字号（pt），与 HTML 预览的 CSS 字号对齐。 */
interface FontSizes {
  hero: number      // .s-title, .s-num  → 封面大标题 / 统计大数字
  heading: number   // .s-head, .s-quote → 内容页标题 / 引言
  body: number      // .s-sub, .s-bullets, .s-card-title → 正文
  caption: number   // .s-eyebrow, .s-label, .s-by → 小字
  cardNum: number   // .s-card-num (CSS 硬编码 38px)
  cardBody: number  // .s-card-body (CSS 硬编码 22px)
  stepTitle: number // .s-step-title (CSS 硬编码 30px)
  stepBody: number  // .s-step-body (CSS 硬编码 22px)
  footer: number    // .s-footer (CSS 硬编码 18px)
}
function fontSizes(theme: SlideTheme): FontSizes {
  const { hero, heading, body, caption } = theme.typeScale
  return {
    hero: pt(hero),
    heading: pt(heading),
    body: pt(body),
    caption: pt(caption),
    cardNum: pt(38),
    cardBody: pt(22),
    stepTitle: pt(30),
    stepBody: pt(22),
    footer: pt(18),
  }
}

/** 从 dataUrl 异步读取图片实际尺寸（用于按比例计算 PPTX 中的显示尺寸） */
function getImageDims(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

interface RenderCtx {
  pptx: PptxGenJS
  slide: PptxSlide
  s: Slide
  theme: SlideTheme
  images: SlideImage[]
  fs: FontSizes
}

/** 添加 eyebrow（小标）—— 顶部一行大写小字 */
function addEyebrow({ slide, s, theme, fs }: RenderCtx, y: number): number {
  if (!s.eyebrow) return y
  slide.addText(s.eyebrow, {
    x: inch(PAD * PX), y, w: W - 2 * PAD, h: 0.3,
    fontFace: safeFont(theme.fontBody),
    fontSize: fs.caption, color: hex(theme.palette.accent),
    bold: true, charSpacing: 1.5, align: 'left', valign: 'middle',
  })
  return y + 0.4
}

/** 添加标题（head）—— 主标题大字 */
function addHead({ slide, s, theme, fs }: RenderCtx, y: number): number {
  if (!s.title) return y
  slide.addText(s.title, {
    x: inch(PAD * PX), y, w: W - 2 * PAD, h: 0.8,
    fontFace: safeFont(theme.fontDisplay),
    fontSize: fs.heading, color: hex(theme.palette.fg),
    bold: true, align: 'left', valign: 'top',
  })
  return y + 0.9
}

/** 添加副标题 —— 标题下方小字 */
function addSubtitle({ slide, s, theme, fs }: RenderCtx, y: number): number {
  if (!s.subtitle) return y
  slide.addText(s.subtitle, {
    x: inch(PAD * PX), y, w: W - 2 * PAD, h: 0.5,
    fontFace: safeFont(theme.fontBody),
    fontSize: fs.body, color: hex(theme.palette.muted),
    align: 'left', valign: 'top',
  })
  return y + 0.6
}

/** 添加 bullets 列表 —— 标准圆点 */
function addBullets({ slide, s, theme, fs }: RenderCtx, bullets: string[] | undefined, x: number, y: number, w: number): number {
  if (!bullets?.length) return y
  const text = bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } }))
  slide.addText(text, {
    x, y, w, h: 4,
    fontFace: safeFont(theme.fontBody),
    fontSize: fs.body, color: hex(theme.palette.fg),
    align: 'left', valign: 'top', lineSpacingMultiple: 1.3,
    paraSpaceAfter: 6,
  })
  return y + Math.min(3, bullets.length * 0.4)
}

/** 添加页脚（deck 名 · 页码） */
function addFooter({ slide, s: _s, theme, fs }: RenderCtx, deckName: string, index: number, total: number): void {
  slide.addText(`${deckName} · ${index + 1} / ${total}`, {
    x: inch(PAD * PX), y: H - 0.5, w: W - 2 * PAD, h: 0.3,
    fontFace: safeFont(theme.fontBody),
    fontSize: fs.footer, color: hex(theme.palette.muted),
    align: 'left', valign: 'middle',
  })
}

/** 添加图片（如有），返回图片宽度占用。
 *  读取图片实际尺寸，在容器内按比例 contain 居中——避免 PptxGenJS 的 sizing:contain
 *  在某些版本下行为异常导致图片拉伸。 */
async function tryAddImage({ slide, s, images }: RenderCtx, side: 'left' | 'right'): Promise<{ imgW: number; imgAdded: boolean }> {
  const im = resolveImage(images, s.image)
  if (!im || !im.dataUrl) return { imgW: 0, imgAdded: false }

  // 容器尺寸（图片可用区域）
  const containerW = (W - 2 * PAD) / 2 - 0.2
  const containerH = H - 2 * PAD - 0.6
  const containerX = side === 'left' ? PAD : W - PAD - containerW
  const containerY = PAD + 0.3

  // 读取图片实际尺寸，按比例计算显示尺寸并居中
  const dims = await getImageDims(im.dataUrl)
  if (dims && dims.w > 0 && dims.h > 0) {
    const imgRatio = dims.w / dims.h
    const containerRatio = containerW / containerH
    let finalW: number, finalH: number
    if (imgRatio > containerRatio) {
      // 图片更宽——以容器宽度为准
      finalW = containerW
      finalH = containerW / imgRatio
    } else {
      // 图片更高——以容器高度为准
      finalH = containerH
      finalW = containerH * imgRatio
    }
    // 在容器内居中
    const finalX = containerX + (containerW - finalW) / 2
    const finalY = containerY + (containerH - finalH) / 2
    slide.addImage({
      data: im.dataUrl,
      x: finalX, y: finalY, w: finalW, h: finalH,
    })
  } else {
    // 无法读取尺寸——退回到 sizing:contain
    slide.addImage({
      data: im.dataUrl,
      x: containerX, y: containerY, w: containerW, h: containerH,
      sizing: { type: 'contain', w: containerW, h: containerH },
    })
  }
  return { imgW: containerW, imgAdded: true }
}

/** 12 种 layout 的渲染分派 */
async function renderSlide(ctx: RenderCtx, deckName: string, index: number, total: number): Promise<void> {
  const { s, theme, fs } = ctx
  // 设置背景色
  ctx.slide.background = { color: hex(theme.palette.bg) }
  let y = PAD + 0.2

  switch (s.layout) {
    case 'title':
    case 'cover': {
      // 居中大标题 + 副标题
      if (s.title) {
        ctx.slide.addText(s.title, {
          x: PAD, y: H / 2 - 0.8, w: W - 2 * PAD, h: 1.2,
          fontFace: safeFont(theme.fontDisplay),
          fontSize: fs.hero, color: hex(theme.palette.fg),
          bold: true, align: 'center', valign: 'middle',
        })
      }
      if (s.subtitle) {
        ctx.slide.addText(s.subtitle, {
          x: PAD, y: H / 2 + 0.5, w: W - 2 * PAD, h: 0.6,
          fontFace: safeFont(theme.fontBody),
          fontSize: fs.body, color: hex(theme.palette.muted),
          align: 'center', valign: 'top',
        })
      }
      break
    }
    case 'section': {
      // SECTION 编号 + 标题
      ctx.slide.addText('SECTION', {
        x: PAD, y: H / 2 - 1.2, w: W - 2 * PAD, h: 0.4,
        fontFace: safeFont(theme.fontBody),
        fontSize: fs.caption, color: hex(theme.palette.accent),
        bold: true, charSpacing: 2, align: 'center',
      })
      if (s.title) {
        ctx.slide.addText(s.title, {
          x: PAD, y: H / 2 - 0.6, w: W - 2 * PAD, h: 1,
          fontFace: safeFont(theme.fontDisplay),
          fontSize: fs.hero, color: hex(theme.palette.fg),
          bold: true, align: 'center', valign: 'middle',
        })
      }
      if (s.subtitle) {
        ctx.slide.addText(s.subtitle, {
          x: PAD, y: H / 2 + 0.6, w: W - 2 * PAD, h: 0.5,
          fontFace: safeFont(theme.fontBody),
          fontSize: fs.body, color: hex(theme.palette.muted),
          align: 'center',
        })
      }
      break
    }
    case 'quote': {
      const q = s.quote || s.title || ''
      ctx.slide.addText(`"${q}"`, {
        x: PAD + 0.5, y: H / 2 - 0.8, w: W - 2 * PAD - 1, h: 1.5,
        fontFace: safeFont(theme.fontDisplay),
        fontSize: fs.heading, color: hex(theme.palette.fg),
        italic: true, align: 'center', valign: 'middle',
        lineSpacingMultiple: 1.4,
      })
      if (s.by) {
        ctx.slide.addText(`— ${s.by}`, {
          x: PAD, y: H / 2 + 0.8, w: W - 2 * PAD, h: 0.4,
          fontFace: safeFont(theme.fontBody),
          fontSize: fs.caption, color: hex(theme.palette.muted),
          align: 'center',
        })
      }
      break
    }
    case 'bullets': {
      y = addEyebrow(ctx, y)
      y = addHead(ctx, y)
      addBullets(ctx, s.bullets, inch(PAD * PX), y, W - 2 * PAD)
      addSubtitle(ctx, y + 3)
      break
    }
    case 'two-col': {
      y = addEyebrow(ctx, y)
      y = addHead(ctx, y)
      const colW = (W - 2 * PAD - 0.3) / 2
      addBullets(ctx, s.bullets, PAD, y, colW)
      addBullets(ctx, s.bullets2, PAD + colW + 0.3, y, colW)
      break
    }
    case 'stats': {
      y = addEyebrow(ctx, y)
      y = addHead(ctx, y)
      const stats = s.stats ?? []
      const gap = 0.2
      const cellW = (W - 2 * PAD - gap * (stats.length - 1)) / Math.max(stats.length, 1)
      stats.forEach((t, i) => {
        const x = PAD + i * (cellW + gap)
        if (t.num) {
          ctx.slide.addText(t.num, {
            x, y, w: cellW, h: 0.8,
            fontFace: safeFont(theme.fontDisplay),
            fontSize: fs.hero, color: hex(theme.palette.accent),
            bold: true, align: 'center', valign: 'middle',
          })
        }
        if (t.label) {
          ctx.slide.addText(t.label, {
            x, y: y + 0.85, w: cellW, h: 0.5,
            fontFace: safeFont(theme.fontBody),
            fontSize: fs.caption, color: hex(theme.palette.muted),
            align: 'center', valign: 'top',
          })
        }
      })
      break
    }
    case 'chart': {
      y = addEyebrow(ctx, y)
      y = addHead(ctx, y)
      // ECharts option 转原生 PPT 图表暂不实现，以提示文本占位（用户可手动插图）
      ctx.slide.addText('图表内容请在扩展浮窗中查看，或使用「导出 HTML」获取可交互图表', {
        x: inch(PAD * PX), y, w: W - 2 * PAD, h: 2,
        fontFace: safeFont(theme.fontBody),
        fontSize: fs.body, color: hex(theme.palette.muted),
        align: 'center', valign: 'middle', italic: true,
      })
      if (s.bullets?.length) addBullets(ctx, s.bullets, inch(PAD * PX), y + 2.2, W - 2 * PAD)
      break
    }
    case 'embed': {
      if (s.title) addHead(ctx, y)
      ctx.slide.addText('看板内容请在扩展浮窗中查看', {
        x: inch(PAD * PX), y: y + 1, w: W - 2 * PAD, h: 2,
        fontFace: safeFont(theme.fontBody),
        fontSize: fs.body, color: hex(theme.palette.muted),
        align: 'center', valign: 'middle',
      })
      break
    }
    case 'cards': {
      y = addEyebrow(ctx, y)
      y = addHead(ctx, y)
      const cards = s.cards ?? []
      const cols = cards.length <= 3 ? cards.length : 3
      const rows = Math.ceil(cards.length / cols)
      const gap = 0.2
      const cardW = (W - 2 * PAD - gap * (cols - 1)) / cols
      const cardH = Math.min(2.2, (H - y - PAD - 0.4) / rows - gap)
      cards.forEach((c, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = PAD + col * (cardW + gap)
        const cy = y + row * (cardH + gap)
        // 卡片背景
        ctx.slide.addShape('roundRect', {
          x, y: cy, w: cardW, h: cardH,
          fill: { color: hex(theme.palette.card) },
          line: { color: hex(theme.palette.border), width: 0.5 },
          rectRadius: 0.05,
        })
        let ty = cy + 0.15
        if (c.num) {
          ctx.slide.addText(c.num, {
            x: x + 0.1, y: ty, w: cardW - 0.2, h: 0.4,
            fontFace: safeFont(theme.fontDisplay),
            fontSize: fs.cardNum, color: hex(theme.palette.accent),
            bold: true, align: 'left',
          })
          ty += 0.45
        }
        if (c.title) {
          ctx.slide.addText(c.title, {
            x: x + 0.1, y: ty, w: cardW - 0.2, h: 0.3,
            fontFace: safeFont(theme.fontBody),
            fontSize: fs.body, color: hex(theme.palette.fg),
            bold: true, align: 'left',
          })
          ty += 0.35
        }
        if (c.body) {
          ctx.slide.addText(c.body, {
            x: x + 0.1, y: ty, w: cardW - 0.2, h: cardH - (ty - cy) - 0.15,
            fontFace: safeFont(theme.fontBody),
            fontSize: fs.cardBody, color: hex(theme.palette.muted),
            align: 'left', valign: 'top', lineSpacingMultiple: 1.2,
          })
        }
      })
      break
    }
    case 'image-split': {
      const side = s.imageSide ?? 'right'
      const { imgAdded } = await tryAddImage(ctx, side)
      const textW = imgAdded ? (W - 2 * PAD) / 2 - 0.2 : W - 2 * PAD
      const textX = imgAdded ? (side === 'left' ? W - PAD - textW : PAD) : PAD
      let ty = PAD + 0.2
      if (s.eyebrow) {
        ctx.slide.addText(s.eyebrow, {
          x: textX, y: ty, w: textW, h: 0.3,
          fontFace: safeFont(theme.fontBody),
          fontSize: fs.caption, color: hex(theme.palette.accent),
          bold: true, charSpacing: 1.5, align: 'left',
        })
        ty += 0.4
      }
      if (s.title) {
        ctx.slide.addText(s.title, {
          x: textX, y: ty, w: textW, h: 0.7,
          fontFace: safeFont(theme.fontDisplay),
          fontSize: fs.heading, color: hex(theme.palette.fg),
          bold: true, align: 'left', valign: 'top',
        })
        ty += 0.8
      }
      addBullets(ctx, s.bullets, textX, ty, textW)
      break
    }
    case 'timeline': {
      y = addEyebrow(ctx, y)
      y = addHead(ctx, y)
      const steps = s.steps ?? []
      const gap = 0.2
      const stepW = (W - 2 * PAD - gap * (steps.length - 1)) / Math.max(steps.length, 1)
      steps.forEach((st, i) => {
        const x = PAD + i * (stepW + gap)
        // 序号圆
        ctx.slide.addShape('ellipse', {
          x: x + stepW / 2 - 0.25, y, w: 0.5, h: 0.5,
          fill: { color: hex(theme.palette.accent) },
          line: { color: hex(theme.palette.accent), width: 1 },
        })
        ctx.slide.addText(String(i + 1), {
          x: x + stepW / 2 - 0.25, y, w: 0.5, h: 0.5,
          fontSize: fs.caption, color: hex(theme.palette.bg),
          bold: true, align: 'center', valign: 'middle',
        })
        if (st.title) {
          ctx.slide.addText(st.title, {
            x, y: y + 0.6, w: stepW, h: 0.3,
            fontFace: safeFont(theme.fontBody),
            fontSize: fs.stepTitle, color: hex(theme.palette.fg),
            bold: true, align: 'center',
          })
        }
        if (st.body) {
          ctx.slide.addText(st.body, {
            x, y: y + 0.95, w: stepW, h: 1,
            fontFace: safeFont(theme.fontBody),
            fontSize: fs.stepBody, color: hex(theme.palette.muted),
            align: 'center', valign: 'top', lineSpacingMultiple: 1.2,
          })
        }
      })
      break
    }
    default: {
      // 兜底为 bullets 渲染
      y = addEyebrow(ctx, y)
      y = addHead(ctx, y)
      addBullets(ctx, s.bullets, inch(PAD * PX), y, W - 2 * PAD)
      break
    }
  }

  addFooter(ctx, deckName, index, total)
}

/** 清洗文件名（与 HTML 导出一致） */
const safeName = (name: string): string =>
  (name || '演示文稿').replace(/[\\/:*?"<>|]/g, '_')

/**
 * 导出 PPTX 文件。pptxgenjs 动态加载，调用时才进 bundle。
 *
 * 关键设计：
 *  1. 不传 outputType，走 PptxGenJS 浏览器默认分支（zip.generateAsync({type:'blob'})）。
 *     之前传 outputType:'blob'/'arraybuffer' 会走分支 B，该分支不传 compression 参数，
 *     可能导致某些 JSZip 版本在浏览器中行为异常。
 *  2. 临时清除 process.versions.node / process.release.name，防止 Vite 注入的 process
 *     polyfill 让 pptxgenjs 误判为 Node 环境（fs 已被 alias 到空模块）。
 *  3. 检查输出 magic bytes（PK = 0x50 0x4B），确保是有效 ZIP。
 *
 * @param slides Slide[]（与 HTML 导出同一份数据）
 * @param name 文件名（不含扩展名）
 * @param theme 主题（默认 business）
 * @param images 图片池
 */
export async function downloadSlidesPptx(
  slides: Slide[],
  name: string,
  theme: SlideTheme = getTheme(DEFAULT_THEME_ID),
  images: SlideImage[] = [],
): Promise<void> {
  const data = (Array.isArray(slides) ? slides : []).filter(Boolean)
  if (data.length === 0) return

  // 调试：检测 process 是否被 polyfill 注入（Vite/依赖可能注入 process polyfill）
  const g = globalThis as any
  const procWasDefined = typeof g.process !== 'undefined'
  console.info('[pptx] process defined:', procWasDefined,
    'versions.node:', g.process?.versions?.node, 'release.name:', g.process?.release?.name)

  // 临时移除 process.versions.node 和 process.release.name，强制 isNode=false
  const savedVersionsNode = g.process?.versions?.node
  const savedReleaseName = g.process?.release?.name
  if (g.process?.versions) g.process.versions.node = undefined
  if (g.process?.release) g.process.release.name = undefined

  try {
    // 动态加载 pptxgenjs（按需 chunk，不进主 bundle）
    const PptxGenJSClass: PptxGenJS = (await import('pptxgenjs')).default
    const pptx = new PptxGenJSClass()
    pptx.layout = 'LAYOUT_WIDE' // 13.33" × 7.5"，16:9
    pptx.author = '飞书文档 AI 助手'
    pptx.company = ''
    pptx.subject = name || '演示文稿'
    pptx.title = name || '演示文稿'

    const total = data.length
    const fs = fontSizes(theme)
    console.info('[pptx] slides:', total, 'images:', images.length)
    // 检查图片 dataUrl 格式（必须是 data:image/xxx;base64,... 格式）
    if (images.length > 0) {
      images.slice(0, 3).forEach((img, i) => {
        const prefix = img.dataUrl?.slice(0, 40)
        const valid = img.dataUrl?.toLowerCase().includes('base64,')
        console.info(`[pptx] image[${i}] id=${img.id} valid=${valid} prefix=${prefix}`)
      })
    }

    // renderSlide 是异步的（tryAddImage 需要读取图片尺寸），用 for...of 顺序执行
    for (let i = 0; i < data.length; i++) {
      const slide = pptx.addSlide()
      await renderSlide({ pptx, slide, s: data[i], theme, images, fs }, name || '演示文稿', i, total)
    }

    // 必须显式传 outputType：PptxGenJS 的 write() 逻辑陷阱——
    // 若 props 是对象但无 outputType 字段，整个 props 对象会被当成 outputType 传给
    // JSZip 的 `type` 参数，导致 `type.toLowerCase is not a function`。
    // 用 'arraybuffer' 比 'blob' 更可控：不依赖 JSZip 在浏览器中的 Blob 构造，
    // 自己用正确 MIME 类型构造 Blob。
    const result = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer
    console.info('[pptx] write result: ArrayBuffer byteLength=' + result?.byteLength)

    if (!result || result.byteLength < 1000) {
      console.warn('[pptx] output too small, falling back to writeFile')
      await pptx.writeFile({ fileName: `${safeName(name)}.pptx` })
      return
    }

    // 检查 magic bytes（ZIP 文件必须以 PK 开头: 0x50 0x4B 0x03 0x04）
    const bytes = new Uint8Array(result)
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B
    console.info('[pptx] magic bytes:', bytes[0], bytes[1], bytes[2], bytes[3],
      'isZip=' + isZip, 'size=' + result.byteLength)

    if (!isZip) {
      console.warn('[pptx] output not a valid ZIP, falling back to writeFile')
      await pptx.writeFile({ fileName: `${safeName(name)}.pptx` })
      return
    }

    // 修复 PptxGenJS 的 bug：它在 slides.forEach 循环里为每个 slide 都生成了一个
    // slideMaster${idx+1}.xml 的 Override，但 ZIP 里实际只有一个 slideMaster1.xml。
    // PowerPoint 打开时找不到 slideMaster2..N.xml，直接拒绝识别。
    // 修复方式：用 JSZip 解压，移除 [Content_Types].xml 中多余的 slideMaster Override，
    // 只保留 slideMaster1.xml，然后重新打包。
    let fixedResult: ArrayBuffer = result
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(result)

      // 列出实际存在的 slideMasters 文件
      const existingMasters = Object.keys(zip.files)
        .filter((f) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f))
      console.info('[pptx] existing slideMasters:', existingMasters.length, existingMasters.join(', '))

      // 修正 [Content_Types].xml：移除不存在的 slideMaster Override
      const ctFile = zip.file('[Content_Types].xml')
      if (ctFile) {
        const ct = await ctFile.async('string')
        // 匹配所有 slideMaster Override
        const masterOverrideRegex = /<Override PartName="\/ppt\/slideMasters\/slideMaster(\d+)\.xml"[^>]*\/>/g
        const matched: string[] = []
        const cleanedCt = ct.replace(masterOverrideRegex, (_m, num) => {
          const path = `ppt/slideMasters/slideMaster${num}.xml`
          if (zip.files[path]) {
            matched.push(path)
            return _m // 保留实际存在的
          }
          return '' // 移除不存在的
        })
        const removedCount = (ct.match(masterOverrideRegex) || []).length - matched.length
        if (removedCount > 0) {
          console.info('[pptx] removed ' + removedCount + ' invalid slideMaster Override(s) from [Content_Types].xml')
          zip.file('[Content_Types].xml', cleanedCt)
          fixedResult = await zip.generateAsync({
            type: 'arraybuffer',
            compression: 'STORE',
          })
          console.info('[pptx] fixed PPTX size:', fixedResult.byteLength, '(was', result.byteLength, ')')
        }
      }
    } catch (fixErr) {
      console.error('[pptx] fix [Content_Types].xml failed:', fixErr)
      // 修复失败则用原始结果
    }

    // 自己构造 Blob 并触发下载，确保 MIME 类型正确
    const blob = new Blob([fixedResult], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    console.info('[pptx] blob size:', blob.size)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName(name)}.pptx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    console.error('[pptx] export failed:', e)
    throw e
  } finally {
    if (g.process?.versions && savedVersionsNode !== undefined)
      g.process.versions.node = savedVersionsNode
    if (g.process?.release && savedReleaseName !== undefined)
      g.process.release.name = savedReleaseName
  }
}
