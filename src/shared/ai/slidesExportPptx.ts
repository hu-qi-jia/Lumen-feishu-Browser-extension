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

interface RenderCtx {
  pptx: PptxGenJS
  slide: PptxSlide
  s: Slide
  theme: SlideTheme
  images: SlideImage[]
}

/** 添加 eyebrow（小标）—— 顶部一行大写小字 */
function addEyebrow({ slide, s, theme }: RenderCtx, y: number): number {
  if (!s.eyebrow) return y
  slide.addText(s.eyebrow, {
    x: inch(PAD * PX), y, w: W - 2 * PAD, h: 0.3,
    fontFace: theme.fontBody || undefined,
    fontSize: 11, color: hex(theme.palette.accent),
    bold: true, charSpacing: 1.5, align: 'left', valign: 'middle',
  })
  return y + 0.4
}

/** 添加标题（head）—— 主标题大字 */
function addHead({ slide, s, theme }: RenderCtx, y: number): number {
  if (!s.title) return y
  slide.addText(s.title, {
    x: inch(PAD * PX), y, w: W - 2 * PAD, h: 0.8,
    fontFace: theme.fontDisplay || undefined,
    fontSize: 28, color: hex(theme.palette.fg),
    bold: true, align: 'left', valign: 'top',
  })
  return y + 0.9
}

/** 添加副标题 —— 标题下方小字 */
function addSubtitle({ slide, s, theme }: RenderCtx, y: number): number {
  if (!s.subtitle) return y
  slide.addText(s.subtitle, {
    x: inch(PAD * PX), y, w: W - 2 * PAD, h: 0.5,
    fontFace: theme.fontBody || undefined,
    fontSize: 14, color: hex(theme.palette.muted),
    align: 'left', valign: 'top',
  })
  return y + 0.6
}

/** 添加 bullets 列表 —— 标准圆点 */
function addBullets({ slide, s, theme }: RenderCtx, bullets: string[] | undefined, x: number, y: number, w: number): number {
  if (!bullets?.length) return y
  const text = bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } }))
  slide.addText(text, {
    x, y, w, h: 4,
    fontFace: theme.fontBody || undefined,
    fontSize: 13, color: hex(theme.palette.fg),
    align: 'left', valign: 'top', lineSpacingMultiple: 1.3,
    paraSpaceAfter: 6,
  })
  return y + Math.min(3, bullets.length * 0.4)
}

/** 添加页脚（deck 名 · 页码） */
function addFooter({ slide, s: _s, theme }: RenderCtx, deckName: string, index: number, total: number): void {
  slide.addText(`${deckName} · ${index + 1} / ${total}`, {
    x: inch(PAD * PX), y: H - 0.5, w: W - 2 * PAD, h: 0.3,
    fontFace: theme.fontBody || undefined,
    fontSize: 9, color: hex(theme.palette.muted),
    align: 'left', valign: 'middle',
  })
}

/** 添加图片（如有），返回图片宽度占用 */
function tryAddImage({ slide, s, images }: RenderCtx, side: 'left' | 'right'): { imgW: number; imgAdded: boolean } {
  const im = resolveImage(images, s.image)
  if (!im || !im.dataUrl) return { imgW: 0, imgAdded: false }
  const imgW = (W - 2 * PAD) / 2 - 0.2
  const imgX = side === 'left' ? PAD : W - PAD - imgW
  slide.addImage({
    data: im.dataUrl,
    x: imgX, y: PAD + 0.3, w: imgW, h: H - 2 * PAD - 0.6,
    sizing: { type: 'contain', w: imgW, h: H - 2 * PAD - 0.6 },
  })
  return { imgW, imgAdded: true }
}

/** 12 种 layout 的渲染分派 */
function renderSlide(ctx: RenderCtx, deckName: string, index: number, total: number): void {
  const { s, theme } = ctx
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
          fontFace: theme.fontDisplay || undefined,
          fontSize: 40, color: hex(theme.palette.fg),
          bold: true, align: 'center', valign: 'middle',
        })
      }
      if (s.subtitle) {
        ctx.slide.addText(s.subtitle, {
          x: PAD, y: H / 2 + 0.5, w: W - 2 * PAD, h: 0.6,
          fontFace: theme.fontBody || undefined,
          fontSize: 16, color: hex(theme.palette.muted),
          align: 'center', valign: 'top',
        })
      }
      break
    }
    case 'section': {
      // SECTION 编号 + 标题
      ctx.slide.addText('SECTION', {
        x: PAD, y: H / 2 - 1.2, w: W - 2 * PAD, h: 0.4,
        fontFace: theme.fontBody || undefined,
        fontSize: 12, color: hex(theme.palette.accent),
        bold: true, charSpacing: 2, align: 'center',
      })
      if (s.title) {
        ctx.slide.addText(s.title, {
          x: PAD, y: H / 2 - 0.6, w: W - 2 * PAD, h: 1,
          fontFace: theme.fontDisplay || undefined,
          fontSize: 36, color: hex(theme.palette.fg),
          bold: true, align: 'center', valign: 'middle',
        })
      }
      if (s.subtitle) {
        ctx.slide.addText(s.subtitle, {
          x: PAD, y: H / 2 + 0.6, w: W - 2 * PAD, h: 0.5,
          fontFace: theme.fontBody || undefined,
          fontSize: 14, color: hex(theme.palette.muted),
          align: 'center',
        })
      }
      break
    }
    case 'quote': {
      const q = s.quote || s.title || ''
      ctx.slide.addText(`"${q}"`, {
        x: PAD + 0.5, y: H / 2 - 0.8, w: W - 2 * PAD - 1, h: 1.5,
        fontFace: theme.fontDisplay || undefined,
        fontSize: 24, color: hex(theme.palette.fg),
        italic: true, align: 'center', valign: 'middle',
        lineSpacingMultiple: 1.4,
      })
      if (s.by) {
        ctx.slide.addText(`— ${s.by}`, {
          x: PAD, y: H / 2 + 0.8, w: W - 2 * PAD, h: 0.4,
          fontFace: theme.fontBody || undefined,
          fontSize: 12, color: hex(theme.palette.muted),
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
            fontFace: theme.fontDisplay || undefined,
            fontSize: 32, color: hex(theme.palette.accent),
            bold: true, align: 'center', valign: 'middle',
          })
        }
        if (t.label) {
          ctx.slide.addText(t.label, {
            x, y: y + 0.85, w: cellW, h: 0.5,
            fontFace: theme.fontBody || undefined,
            fontSize: 11, color: hex(theme.palette.muted),
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
        fontFace: theme.fontBody || undefined,
        fontSize: 12, color: hex(theme.palette.muted),
        align: 'center', valign: 'middle', italic: true,
      })
      if (s.bullets?.length) addBullets(ctx, s.bullets, inch(PAD * PX), y + 2.2, W - 2 * PAD)
      break
    }
    case 'embed': {
      if (s.title) addHead(ctx, y)
      ctx.slide.addText('看板内容请在扩展浮窗中查看', {
        x: inch(PAD * PX), y: y + 1, w: W - 2 * PAD, h: 2,
        fontFace: theme.fontBody || undefined,
        fontSize: 14, color: hex(theme.palette.muted),
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
            fontFace: theme.fontDisplay || undefined,
            fontSize: 18, color: hex(theme.palette.accent),
            bold: true, align: 'left',
          })
          ty += 0.45
        }
        if (c.title) {
          ctx.slide.addText(c.title, {
            x: x + 0.1, y: ty, w: cardW - 0.2, h: 0.3,
            fontFace: theme.fontBody || undefined,
            fontSize: 12, color: hex(theme.palette.fg),
            bold: true, align: 'left',
          })
          ty += 0.35
        }
        if (c.body) {
          ctx.slide.addText(c.body, {
            x: x + 0.1, y: ty, w: cardW - 0.2, h: cardH - (ty - cy) - 0.15,
            fontFace: theme.fontBody || undefined,
            fontSize: 10, color: hex(theme.palette.muted),
            align: 'left', valign: 'top', lineSpacingMultiple: 1.2,
          })
        }
      })
      break
    }
    case 'image-split': {
      const side = s.imageSide ?? 'right'
      const { imgAdded } = tryAddImage(ctx, side)
      const textW = imgAdded ? (W - 2 * PAD) / 2 - 0.2 : W - 2 * PAD
      const textX = imgAdded ? (side === 'left' ? W - PAD - textW : PAD) : PAD
      let ty = PAD + 0.2
      if (s.eyebrow) {
        ctx.slide.addText(s.eyebrow, {
          x: textX, y: ty, w: textW, h: 0.3,
          fontFace: theme.fontBody || undefined,
          fontSize: 11, color: hex(theme.palette.accent),
          bold: true, charSpacing: 1.5, align: 'left',
        })
        ty += 0.4
      }
      if (s.title) {
        ctx.slide.addText(s.title, {
          x: textX, y: ty, w: textW, h: 0.7,
          fontFace: theme.fontDisplay || undefined,
          fontSize: 26, color: hex(theme.palette.fg),
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
          fontSize: 14, color: hex(theme.palette.bg),
          bold: true, align: 'center', valign: 'middle',
        })
        if (st.title) {
          ctx.slide.addText(st.title, {
            x, y: y + 0.6, w: stepW, h: 0.3,
            fontFace: theme.fontBody || undefined,
            fontSize: 12, color: hex(theme.palette.fg),
            bold: true, align: 'center',
          })
        }
        if (st.body) {
          ctx.slide.addText(st.body, {
            x, y: y + 0.95, w: stepW, h: 1,
            fontFace: theme.fontBody || undefined,
            fontSize: 10, color: hex(theme.palette.muted),
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

  // 动态加载 pptxgenjs（按需 chunk，不进主 bundle）
  const PptxGenJSClass: PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJSClass()
  pptx.layout = 'LAYOUT_WIDE' // 13.33" × 7.5"，16:9
  pptx.author = '飞书文档 AI 助手'
  pptx.company = ''
  pptx.subject = name || '演示文稿'
  pptx.title = name || '演示文稿'

  const total = data.length
  data.forEach((s, i) => {
    const slide = pptx.addSlide()
    renderSlide({ pptx, slide, s, theme, images }, name || '演示文稿', i, total)
  })

  await pptx.writeFile({ fileName: `${safeName(name)}.pptx` })
}
