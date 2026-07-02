# PPT 生成增强：多模板 + 装饰版式 + 图片 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 feishu 扩展的 PPT 生成从"3 个素主题 + 纯文字"升级为"6 个可见风格主题 + 丰富装饰版式 + 文档/上传图片"，并支持自然语言改图。

**Architecture:** 沿用代码库既定架构"一套共享版式 + N 套皮肤"（`One layout code, N skins`）。把 `slideInnerHtml` 的 switch 重构为版式注册表（每版式一个纯函数），大幅丰富 `SLIDES_CSS`；主题扩到 6 个并加按钮图标；图片走 `listBlocks` 遍历在正文原位插 `【图N】` 标记 + 并行下载，按位置/上下文由生成模型摆放（不走 vision）。所有新 Slide 字段可选 → 老 deck 无损加载。

**Tech Stack:** TypeScript, React 18, Vite, vitest（jsdom）, ECharts, Chrome MV3（`chrome.storage.local`）。

**Spec:** `feishu-doc-ai-assistant/docs/superpowers/specs/2026-07-02-slides-templates-images-design.md`

## Global Constraints

- **迭代循环（每个任务结束都跑）**：`npm run typecheck`（0 错）→ `npm test`（全绿）→ 受影响的任务再 `npm run build`（成功）。这是 CLAUDE.md 硬要求。
- **提交约定**：项目"仅在用户要求时才 commit/push；先开分支再改默认分支"。计划里的 commit 步骤在**用户未授权时跳过 git 提交**，改为完成代码+测试即可；用户授权后提交，提交信息结束语固定为 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **安全硬约束（不得破坏）**：出站只走 `feishuFetch`/`feishuReq`（已过 `isFeishuOutboundAllowed`）；图片以 `data:` 渲染（CSP `img-src 'self' data: https:` 已允许）；**dataUrl 永不进 LLM prompt**（模型只看 id + context/label）；写操作不自动重试（`robustFetch` 仅重试 GET）。
- **存储 key 约定**：现有 `slides_decks_v1` 不动；`SavedDeck` 新增字段全部可选 → 无需 `_v2` 迁移。
- **UI 约定**（见记忆）：UI 不用 emoji，用内联 SVG 描边图标（飞书风格）。
- **测试约定**：新纯函数必补单测；`npx vitest run <file>` 跑单文件。
- **路径根**：所有相对路径以 `feishu-doc-ai-assistant/` 为根。

## File Map

**新建：**
| 路径 | 职责 |
|---|---|
| `src/shared/ai/slideLayouts.ts` | 版式注册表：每版式一个纯函数 `(s, ctx?) => html` + `slideInnerHtml` 派发 + `SlideCtx` 类型 |
| `src/shared/ai/slidesImages.ts` | `SlideImage` 类型、`resolveImage`、`remapMarkers`、`stripMarkers`、`serializeDocBlocks`、`harvestDocImages` |
| `src/shared/feishu/media.ts` | `downloadMedia(fileToken, userToken): Promise<Blob>`（二进制，走 feishuFetch）|
| `src/sidepanel/components/ThemeThumb.tsx`(+`.css`) | 主题按钮：CSS/SVG 风格图标 + 名 + 选中态 |
| `src/sidepanel/components/ImagePicker.tsx`(+`.css`) | 上传 + chip 缩略图 + 改名/删除 |

**修改：**
| 路径 | 改动要点 |
|---|---|
| `src/shared/ai/slides.ts` | `Slide` 新字段/版式；`sanitizeSlides` 扩；`buildMaterialsPrompt`/`adjustDeck` 含图片池+空池守卫；`runMaterialsToSlides` 编排抽图、返回 `images` |
| `src/shared/ai/slidesExport.ts` | `slideInnerHtml` 改为从 `slideLayouts` 引入；`SLIDES_CSS` 丰富；`buildSlidesHtml` 传 ctx/页脚/alt/解析图片 id |
| `src/shared/ai/slidesThemes.ts` | 3→6 主题；`decorations` 丰富；`promptHint` 含版式密度 |
| `src/shared/ai/slidesSources.ts` | `fetchMaterial` doc 分支改 `listBlocks`+`serializeDocBlocks`（返回 imageTokens）；`resolveSource` 顺带 count 图片块作 chip 提示；`Material` doc 变体加 `imageTokens` |
| `src/shared/ai/slidesStore.ts` | `SavedDeck.images?` 可选 |
| `src/viewer/deckViewer.ts` | 构造 `SlideCtx`（name/index/total/images）传渲染器；页脚自动出；图片 `<img>` |
| `src/shared/attachments.ts` | 抽出导出 `compressImageToDataUrl(blob, opts?)` + 纯 helper `computeTargetSize`；`compressImage` 改为薄封装 |
| `src/sidepanel/components/SlidesPanel.tsx` | `ThemeThumb` 网格（生成前后都可选、生成后即时换肤）；`ImagePicker`（前后都可见、生成后显示所在页）；并行下载进度；池生命周期；placeholder 文案 |
| `manifest.json` | `permissions` 加 `"unlimitedStorage"` |

---

## Task 1: Slide schema 扩展 + sanitizeSlides

**Files:**
- Modify: `src/shared/ai/slides.ts:18-33`（`Slide` 接口）、`src/shared/ai/slides.ts:39-71`（`sanitizeSlides`）
- Test: `src/shared/ai/slides.test.ts`

**Interfaces:**
- Produces: `Slide` 新增可选字段 `eyebrow?: string`、`cards?: Array<{title?;body?;num?;image?}>`、`image?: string`、`imageSide?: 'left'|'right'`、`imageCaption?: string`；`layout` 联合新增 `'cover'|'cards'|'image-split'`。后续所有任务以此 schema 为准。

- [ ] **Step 1: 写失败测试**（在 `slides.test.ts` 末尾追加）

```ts
import { sanitizeSlides, type Slide } from './slides'

describe('sanitizeSlides — new layouts & fields', () => {
  it('accepts cover / cards / image-split layouts', () => {
    const raw = [
      { layout: 'cover', title: '封面', image: 'doc-1' },
      { layout: 'cards', title: '卡片页', eyebrow: '优势', cards: [
        { title: '快', body: '极速', num: '10x' },
        { title: '稳', body: '可靠', image: 'upload-a' },
      ] },
      { layout: 'image-split', title: '图文', image: 'doc-2', imageSide: 'left', imageCaption: '示意图' },
    ]
    const out = sanitizeSlides(raw)
    expect(out).toHaveLength(3)
    expect(out[0].layout).toBe('cover')
    expect(out[1].cards?.length).toBe(2)
    expect(out[2].imageSide).toBe('left')
    expect(out[2].imageCaption).toBe('示意图')
  })

  it('drops image references when image is not a non-empty string', () => {
    const out = sanitizeSlides([{ layout: 'image-split', title: 'x', image: '' }])
    expect(out[0].image).toBeUndefined()
  })

  it('caps cards at 6 and truncates long fields', () => {
    const cards = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, body: 'b'.repeat(300) }))
    const out = sanitizeSlides([{ layout: 'cards', cards }])[0]
    expect(out.cards?.length).toBe(6)
    expect(out.cards![0].body!.length).toBeLessThanOrEqual(160)
  })

  it('keeps new fields optional (old decks load unchanged)', () => {
    const out = sanitizeSlides([{ layout: 'bullets', title: '老页', bullets: ['a'] }])[0]
    expect(out.eyebrow).toBeUndefined()
    expect(out.image).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/slides.test.ts`
Expected: FAIL（`out[0].layout` 不是 `'cover'`——因 sanitize 白名单没含新 layout，回退到 `'bullets'`；`cards` 被丢）。

- [ ] **Step 3: 实现**——改 `Slide` 接口与 `sanitizeSlides`

`Slide` 接口（`slides.ts:18-33`）改为：

```ts
export interface Slide {
  layout?: 'title' | 'section' | 'bullets' | 'two-col' | 'quote' | 'stats' | 'chart' | 'embed'
    | 'cover' | 'cards' | 'image-split'
  title?: string
  subtitle?: string
  eyebrow?: string
  bullets?: string[]
  bullets2?: string[]
  quote?: string
  by?: string
  stats?: Array<{ num?: string; label?: string }>
  chart?: Record<string, unknown>
  code?: string
  spec?: import('../dataviz/spec').VizSpec
  cards?: Array<{ title?: string; body?: string; num?: string; image?: string }>
  image?: string
  imageSide?: 'left' | 'right'
  imageCaption?: string
}
```

`sanitizeSlides`（`slides.ts:39-71`）——在 layout 白名单加 3 项；新增字段清洗。把函数体替换为：

```ts
export function sanitizeSlides(raw: unknown): Slide[] {
  if (!Array.isArray(raw)) return []
  const out: Slide[] = []
  for (const r0 of raw) {
    if (!r0 || typeof r0 !== 'object') continue
    const r = r0 as Record<string, unknown>
    const layout = (['title', 'section', 'bullets', 'two-col', 'quote', 'stats', 'chart', 'embed', 'cover', 'cards', 'image-split'] as const)
      .find((l) => l === r.layout) ?? 'bullets'
    const s: Slide = { layout }
    if (typeof r.title === 'string') s.title = r.title.slice(0, 120)
    if (typeof r.subtitle === 'string') s.subtitle = r.subtitle.slice(0, 200)
    if (typeof r.quote === 'string') s.quote = r.quote.slice(0, 400)
    if (typeof r.by === 'string') s.by = r.by.slice(0, 80)
    if (typeof r.eyebrow === 'string') s.eyebrow = r.eyebrow.slice(0, 40)
    if (typeof r.imageCaption === 'string') s.imageCaption = r.imageCaption.slice(0, 80)
    if (r.imageSide === 'left' || r.imageSide === 'right') s.imageSide = r.imageSide
    if (typeof r.image === 'string' && r.image.trim()) s.image = r.image.slice(0, 60)
    if (r.bullets) s.bullets = arr(r.bullets)
    if (r.bullets2) s.bullets2 = arr(r.bullets2)
    if (Array.isArray(r.stats)) {
      s.stats = (r.stats as unknown[]).slice(0, 6).map((t) => {
        const o = (t ?? {}) as Record<string, unknown>
        return { num: String(o.num ?? '').slice(0, 24), label: String(o.label ?? '').slice(0, 60) }
      })
    }
    if (Array.isArray(r.cards)) {
      s.cards = (r.cards as unknown[]).slice(0, 6).map((c) => {
        const o = (c ?? {}) as Record<string, unknown>
        const card: NonNullable<Slide['cards']>[number] = {}
        if (typeof o.title === 'string') card.title = o.title.slice(0, 60)
        if (typeof o.body === 'string') card.body = o.body.slice(0, 160)
        if (typeof o.num === 'string') card.num = o.num.slice(0, 24)
        if (typeof o.image === 'string' && o.image.trim()) card.image = o.image.slice(0, 60)
        return card
      })
    }
    if (layout === 'chart' && r.chart && typeof r.chart === 'object') s.chart = r.chart as Record<string, unknown>
    if (layout === 'embed' && typeof r.code === 'string') s.code = r.code
    if (layout === 'embed' && r.spec && typeof r.spec === 'object') s.spec = r.spec as Slide['spec']
    if (s.title || s.subtitle || s.quote || s.bullets?.length || s.bullets2?.length || s.stats?.length || s.cards?.length || s.chart || s.code || s.spec || s.image) out.push(s)
  }
  return out.slice(0, 40)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/slides.test.ts`
Expected: PASS（新用例 + 现有用例全绿）。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: 0 错。

- [ ] **Step 6: commit（用户授权后）**

```bash
git add src/shared/ai/slides.ts src/shared/ai/slides.test.ts
git commit -m "feat(slides): extend Slide schema with cover/cards/image-split + image fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 图片池类型 + 纯 helper + 压缩导出

**Files:**
- Create: `src/shared/ai/slidesImages.ts`
- Modify: `src/shared/attachments.ts:40-73`（抽 `compressImageToDataUrl` + `computeTargetSize`）
- Test: `src/shared/ai/slidesImages.test.ts`、`src/shared/attachments.test.ts`（新建若不存在）

**Interfaces:**
- Produces:
  - `SlideImage`（`slidesImages.ts`）：`{ id: string; source: 'doc'|'upload'; label: string; dataUrl: string; context?: string }`
  - `resolveImage(images: SlideImage[], id?: string): SlideImage | undefined`
  - `remapMarkers(text: string, map: number[]): string`（`map[local-1]=global`，把 `【图{n}】`→`【图{map[n-1]}】`）
  - `stripMarkers(text: string, locals: number[]): string`（剔除指定 `【图{n}】`）
  - `compressImageToDataUrl(blob: Blob, opts?): Promise<string>`（来自 attachments）
  - `computeTargetSize(w, h, longEdge): {width, height}`（纯）
- Consumes: Task 1 的 `Slide`（仅类型引用，无循环）。

- [ ] **Step 1: 写失败测试**（`slidesImages.test.ts`）

```ts
import { resolveImage, remapMarkers, stripMarkers, type SlideImage } from './slidesImages'

const pool: SlideImage[] = [
  { id: 'doc-1', source: 'doc', label: '文档图1', dataUrl: 'data:x' },
  { id: 'upload-a', source: 'upload', label: '产品图', dataUrl: 'data:y' },
]

describe('resolveImage', () => {
  it('finds by id', () => { expect(resolveImage(pool, 'doc-1')?.label).toBe('文档图1') })
  it('returns undefined for missing/empty', () => {
    expect(resolveImage(pool, 'nope')).toBeUndefined()
    expect(resolveImage(pool, undefined)).toBeUndefined()
  })
})

describe('remapMarkers', () => {
  it('remaps 【图n】 local→global by 1-based map', () => {
    // local 1→global 5, local 2→global 6
    expect(remapMarkers('前【图1】中【图2】后', [5, 6])).toBe('前【图5】中【图6】后')
  })
  it('leaves unmapped locals untouched', () => {
    expect(remapMarkers('【图1】', [])).toBe('【图1】')
  })
})

describe('stripMarkers', () => {
  it('removes the given marker numbers', () => {
    expect(stripMarkers('a【图1】b【图2】c', [1])).toBe('abc')
  })
})
```

`attachments.test.ts`（纯 helper，避开 canvas）：

```ts
import { computeTargetSize } from './attachments'

describe('computeTargetSize', () => {
  it('keeps size when under long edge', () => {
    expect(computeTargetSize(800, 600, 1024)).toEqual({ width: 800, height: 600 })
  })
  it('scales down by long edge, preserving aspect', () => {
    expect(computeTargetSize(2048, 1024, 1024)).toEqual({ width: 1024, height: 512 })
    expect(computeTargetSize(1000, 2000, 500)).toEqual({ width: 250, height: 500 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/slidesImages.test.ts src/shared/attachments.test.ts`
Expected: FAIL（模块/导出不存在）。

- [ ] **Step 3: 实现 `slidesImages.ts`**（类型 + 三个纯 helper；`serializeDocBlocks`/`harvestDocImages` 留给 Task 6/8）

```ts
import type { Slide } from './slides'

export interface SlideImage {
  id: string
  source: 'doc' | 'upload'
  label: string
  dataUrl: string
  context?: string
}

export function resolveImage(images: SlideImage[], id?: string): SlideImage | undefined {
  if (!id) return undefined
  return images.find((i) => i.id === id)
}

/** Remap 【图{n}】 markers: local n → map[n-1] (global). Unmapped n left as-is. */
export function remapMarkers(text: string, map: number[]): string {
  return text.replace(/【图(\d+)】/g, (_m, d) => {
    const n = Number(d)
    return map[n - 1] != null ? `【图${map[n - 1]}】` : `【图${n}】`
  })
}

/** Remove 【图{n}】 markers for the given (local) numbers from text. */
export function stripMarkers(text: string, locals: number[]): string {
  const set = new Set(locals)
  return text.replace(/【图(\d+)】/g, (m, d) => (set.has(Number(d)) ? '' : m))
}

// (serializeDocBlocks / harvestDocImages added in later tasks)
```

- [ ] **Step 4: 实现 attachments 改动**——抽 `computeTargetSize` + `compressImageToDataUrl`

在 `attachments.ts` 顶部常量区下方加纯 helper 与导出函数；`compressImage` 改为调 `compressImageToDataUrl`。

加（常量之后）：

```ts
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
```

把原 `compressImage`（`attachments.ts:40-73`）替换为薄封装：

```ts
function compressImage(file: File): Promise<string> {
  return compressImageToDataUrl(file)
}
```

（`readFileAsDataURL`/`loadImage`/`hasTransparency`/`MAX_IMAGE_LONG_EDGE`/`MAX_IMAGE_QUALITY` 保持不变。）

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/slidesImages.test.ts src/shared/attachments.test.ts`
Expected: PASS。

- [ ] **Step 6: typecheck + commit**

Run: `npm run typecheck` → 0 错。
Commit: `feat(slides): SlideImage type + marker helpers + shared compressImageToDataUrl`

---

## Task 3: 版式注册表 slideLayouts.ts

**Files:**
- Create: `src/shared/ai/slideLayouts.ts`
- Test: `src/shared/ai/slideLayouts.test.ts`

**Interfaces:**
- Produces:
  - `SlideCtx = { deckName: string; index: number; total: number; images: SlideImage[] }`
  - `slideInnerHtml(s: Slide, ctx?: SlideCtx): string`（导出；`slidesExport.ts` 将改为从这里引入）
- Consumes: Task 1 `Slide`、Task 2 `SlideImage`/`resolveImage`。

- [ ] **Step 1: 写失败测试**

```ts
import { slideInnerHtml, type SlideCtx } from './slideLayouts'
import type { SlideImage } from './slidesImages'

const pool: SlideImage[] = [{ id: 'doc-1', source: 'doc', label: '文档图1', dataUrl: 'data:image/png;base64,AAAA' }]
const ctx: SlideCtx = { deckName: '《演示》', index: 2, total: 5, images: pool }

describe('slideInnerHtml', () => {
  it('renders eyebrow before head', () => {
    const html = slideInnerHtml({ layout: 'bullets', eyebrow: '概览', title: '标题', bullets: ['a'] })
    expect(html).toMatch(/s-eyebrow.*概览.*s-head.*标题/s)
  })
  it('renders auto footer when ctx present', () => {
    const html = slideInnerHtml({ layout: 'bullets', title: 'x' }, ctx)
    expect(html).toContain('s-footer')
    expect(html).toContain('《演示》')
    expect(html).toContain('3 / 5')
  })
  it('no footer without ctx', () => {
    expect(slideInnerHtml({ layout: 'bullets', title: 'x' })).not.toContain('s-footer')
  })
  it('image-split resolves image id → <img with dataUrl, default right side', () => {
    const html = slideInnerHtml({ layout: 'image-split', title: 't', image: 'doc-1' }, ctx)
    expect(html).toContain('s-split')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toMatch(/s-split-img/) // image present
  })
  it('image-split with missing image id renders text-only (no broken img)', () => {
    const html = slideInnerHtml({ layout: 'image-split', title: 't', image: 'nope' }, ctx)
    expect(html).not.toContain('<img')
  })
  it('image-side left puts image block first', () => {
    const a = slideInnerHtml({ layout: 'image-split', title: 't', image: 'doc-1', imageSide: 'left' }, ctx)
    const imgPos = a.indexOf('s-split-img')
    const txtPos = a.indexOf('s-split-text')
    expect(imgPos).toBeLessThan(txtPos)
  })
  it('cover renders centered title + optional bg image', () => {
    const html = slideInnerHtml({ layout: 'cover', title: '封面', subtitle: '副', image: 'doc-1' }, ctx)
    expect(html).toContain('s-cover')
    expect(html).toContain('封面')
    expect(html).toContain('data:image/png;base64,AAAA')
  })
  it('cards renders grid with num + body', () => {
    const html = slideInnerHtml({ layout: 'cards', title: '优点', cards: [
      { title: '快', body: 'b1', num: '10x' }, { title: '稳', body: 'b2' },
    ] }, ctx)
    expect(html).toContain('s-cards')
    expect(html).toContain('10x')
    expect(html).toContain('b1')
  })
  it('img has alt from imageCaption or label', () => {
    const withCap = slideInnerHtml({ layout: 'image-split', title: 't', image: 'doc-1', imageCaption: '示意图' }, ctx)
    expect(withCap).toContain('alt="示意图"')
    const noCap = slideInnerHtml({ layout: 'image-split', title: 't', image: 'doc-1' }, ctx)
    expect(noCap).toContain('alt="文档图1"')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/slideLayouts.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `slideLayouts.ts`**

```ts
import type { Slide } from './slides'
import { resolveImage, type SlideImage } from './slidesImages'

export interface SlideCtx {
  deckName: string
  index: number
  total: number
  images: SlideImage[]
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const bl = (arr?: string[]): string =>
  `<ul class="s-bullets">${(arr ?? []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`

/** Resolve an image id to an <img> tag (rounded frame + shadow + alt). Empty if not found. */
function imgTag(images: SlideImage[], id?: string, caption?: string, cls = 's-photo'): string {
  const im = resolveImage(images, id)
  if (!im) return ''
  const alt = esc(caption || im.label)
  return `<div class="${cls}"><img src="${im.dataUrl}" alt="${alt}" /></div>`
}

function eyebrow(s: Slide): string {
  return s.eyebrow ? `<div class="s-eyebrow">${esc(s.eyebrow)}</div>` : ''
}
function head(s: Slide): string {
  return s.title ? `<div class="s-head">${esc(s.title)}</div>` : ''
}
function footer(ctx?: SlideCtx): string {
  if (!ctx) return ''
  return `<div class="s-footer">${esc(ctx.deckName)} · ${ctx.index + 1} / ${ctx.total}</div>`
}

type Fn = (s: Slide, ctx: SlideCtx | undefined) => string

const title: Fn = (s) => `<div class="s-title">${esc(s.title ?? '')}</div>` + (s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : '')
const section: Fn = (s) => `<div class="s-section-num">SECTION</div><div class="s-title">${esc(s.title ?? '')}</div>` + (s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : '')
const quote: Fn = (s) => `<div class="s-quote">&ldquo;${esc(s.quote ?? s.title ?? '')}&rdquo;</div>` + (s.by ? `<div class="s-by">&mdash; ${esc(s.by)}</div>` : '')
const bullets: Fn = (s) => `${eyebrow(s)}${head(s)}${bl(s.bullets)}` + (s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : '')
const twoCol: Fn = (s) => `${eyebrow(s)}${head(s)}<div class="s-two"><div>${bl(s.bullets)}</div><div>${bl(s.bullets2)}</div></div>`
const stats: Fn = (s) => `${eyebrow(s)}${head(s)}<div class="s-stats">${(s.stats ?? []).map((t) => `<div class="s-stat"><div class="s-num">${esc(t.num)}</div><div class="s-label">${esc(t.label)}</div></div>`).join('')}</div>`
const chart: Fn = (s) => `${eyebrow(s)}${head(s)}<div class="s-chart" data-chart="${esc(JSON.stringify(s.chart ?? {}))}"></div>${s.bullets?.length ? bl(s.bullets) : ''}`
const embed: Fn = (s) => `${head(s)}<div class="s-embed"><div class="muted center">看板内容请在扩展浮窗中查看</div></div>`

const cover: Fn = (s, ctx) => {
  const bg = imgTag(ctx?.images ?? [], s.image, s.imageCaption, 's-cover-bg')
  return `<div class="s-cover${bg ? ' s-cover--hasimg' : ''}">${bg}<div class="s-cover-inner"><div class="s-title">${esc(s.title ?? '')}</div>${s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : ''}</div></div>`
}

const cards: Fn = (s, ctx) => {
  const imgs = ctx?.images ?? []
  const items = (s.cards ?? []).map((c) =>
    `<div class="s-card">${c.image ? imgTag(imgs, c.image, undefined, 's-card-img') : ''}${c.num ? `<div class="s-card-num">${esc(c.num)}</div>` : ''}<div class="s-card-title">${esc(c.title ?? '')}</div>${c.body ? `<div class="s-card-body">${esc(c.body)}</div>` : ''}</div>`,
  ).join('')
  return `${eyebrow(s)}${head(s)}<div class="s-cards">${items}</div>`
}

const imageSplit: Fn = (s, ctx) => {
  const img = imgTag(ctx?.images ?? [], s.image, s.imageCaption, 's-split-img')
  const text = `<div class="s-split-text">${eyebrow(s)}${head(s)}${bl(s.bullets)}${s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : ''}</div>`
  return `<div class="s-split s-split--${s.imageSide ?? 'right'}">${s.imageSide === 'left' ? img + text : text + img}</div>`
}

const LAYOUTS: Record<string, Fn> = {
  title, section, quote, twocol: twoCol, bullets, stats, chart, embed, cover, cards,
  'image-split': imageSplit, 'two-col': twoCol,
}

export function slideInnerHtml(s: Slide, ctx?: SlideCtx): string {
  const fn = LAYOUTS[s.layout ?? 'bullets'] ?? bullets
  return fn(s, ctx) + footer(ctx)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/slideLayouts.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck` → 0 错。
Commit: `feat(slides): layout registry (slideLayouts) with cover/cards/image-split + ctx/footer`

---

## Task 4: slidesExport 接入版式注册表 + SLIDES_CSS 丰富 + buildSlidesHtml

**Files:**
- Modify: `src/shared/ai/slidesExport.ts:14-39`（去本地 `slideInnerHtml`，改引入）、`105-162`（`SLIDES_CSS`）、`45-84`（`buildSlidesHtml`）
- Test: `src/shared/ai/slidesExport.test.ts`（新建）

**Interfaces:**
- Produces: `slideInnerHtml` 仍由 `slidesExport.ts` 再导出（保持 deckViewer 现有 import 不破）。`buildSlidesHtml` 内部构造 `SlideCtx` 传给每页。
- Consumes: Task 3 `slideInnerHtml`/`SlideCtx`、Task 2 `SlideImage`。

- [ ] **Step 1: 写失败测试**

```ts
import { buildSlidesHtml, slideInnerHtml } from './slidesExport'
import type { SlideImage } from './slidesImages'

const pool: SlideImage[] = [{ id: 'doc-1', source: 'doc', label: '图1', dataUrl: 'data:image/png;base64,AA' }]

describe('slidesExport', () => {
  it('slideInnerHtml is re-exported from slideLayouts', () => {
    expect(typeof slideInnerHtml).toBe('function')
  })
  it('buildSlidesHtml embeds image dataUrl and footer per page', () => {
    const html = buildSlidesHtml(
      [{ layout: 'image-split', title: 'A', image: 'doc-1' }, { layout: 'bullets', title: 'B' }],
      '演示',
      { id: 'business', name: '商务', mode: 'light', palette: { bg: '#fff', fg: '#111', accent: '#3370ff', muted: '#666', card: '#f5f6f8', border: '#eee' }, typeScale: { hero: 104, heading: 58, body: 34, caption: 24 }, padding: 120 } as never,
      pool,
    )
    expect(html).toContain('data:image/png;base64,AA')
    expect(html).toContain('s-footer')
    expect(html).toMatch(/1 \/ 2/)
  })
})
```

> 注：`buildSlidesHtml` 签名要加 `images` 形参（见 Step 3）。`SlideTheme` 用 `as never` 绕过完整字段只为测试简洁；实现里用真实 `SlideTheme`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/slidesExport.test.ts`
Expected: FAIL（`buildSlidesHtml` 还没 images 形参 / 还没接 ctx）。

- [ ] **Step 3: 改 `slidesExport.ts`**

3a. 顶部 import 改为从 `slideLayouts` 引入（删除本地的 `slideInnerHtml` 函数定义 `25-39`）：

```ts
import type { Slide } from './slides'
import type { SlideTheme } from './slidesThemes'
import { themeVars, DEFAULT_THEME_ID, getTheme } from './slidesThemes'
import { slideInnerHtml, type SlideCtx } from './slideLayouts'
import type { SlideImage } from './slidesImages'

// re-export so existing deckViewer import keeps working
export { slideInnerHtml }
```

删除原 `slideInnerHtml`（`25-39`）与本地 `esc`/`bl`（`18-22`）——它们已迁入 slideLayouts。

3b. `slideHtml`（`41-42`）改为接收 ctx：

```ts
const slideHtml = (s: Slide, ctx: SlideCtx): string =>
  `<div class="slide slide--${s.layout || 'bullets'}">${slideInnerHtml(s, ctx)}</div>`
```

3c. `buildSlidesHtml`（`45-84`）加 `images` 形参并构造 ctx：

```ts
export function buildSlidesHtml(slides: Slide[], name: string, theme: SlideTheme = getTheme(DEFAULT_THEME_ID), images: SlideImage[] = []): string {
  const data = (Array.isArray(slides) ? slides : []).filter(Boolean)
  const total = data.length
  const ctx = (i: number): SlideCtx => ({ deckName: name || '演示文稿', index: i, total, images })
  const pages = data.map((s, i) => slideHtml(s, ctx(i))).join('')
  const title = (name || '演示文稿').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const hasChart = data.some((s) => s.layout === 'chart')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${SLIDES_CSS}
:root{${themeVars(theme)}}
${theme.decorations ?? ''}</style>
${hasChart ? '<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>' : ''}
</head>
<body>
<div class="slides-stage" tabindex="0">
  <div class="slide-frame-wrap"><div class="slide-frame-outer"><div class="slide-frame"></div></div></div>
  <div class="slides-bar-zone">
    <div class="slides-bar">
      <div class="slides-nav"><button class="page slides-prev" type="button">&#8249;</button><span class="slides-count"></span></div>
      <div class="slides-dots"></div>
      <div class="slides-nav"><button class="page slides-play" type="button" title="全屏播放"></button><button class="page slides-next" type="button">&#8250;</button></div>
    </div>
  </div>
</div>
<div class="slides-print"></div>
<script>window.__SLIDES__ = ${JSON.stringify(pages)}; window.__COUNT__ = ${total};</script>
<script>${SLIDES_JS}</script>
</body>
</html>`
}
```

3d. `downloadSlidesHtml`（`87-100`）签名加 `images` 并透传：

```ts
export function downloadSlidesHtml(slides: Slide[], name: string, theme: SlideTheme = getTheme(DEFAULT_THEME_ID), images: SlideImage[] = []): void {
  const html = buildSlidesHtml(slides, name, theme, images)
  // …（其余 Blob 下载逻辑不变）
}
```

3e. `SLIDES_CSS`（`105-162`）在 `.s-chart` 规则之后、`.slides-bar` 之前插入新样式：

```css
.s-eyebrow{font-size:var(--caption-size);letter-spacing:.28em;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:20px}
.s-footer{position:absolute;left:var(--pad);right:var(--pad);bottom:48px;display:flex;align-items:baseline;font-size:18px;letter-spacing:.2em;color:var(--muted);border-top:1px solid var(--border);padding-top:14px}
.slide{position:relative} /* footer 绝对定位锚点 */
/* photo frame（圆角+阴影，open-slide 风）*/
.s-photo,.s-split-img,.s-card-img,.s-cover-bg{border-radius:var(--osd-radius,12px);overflow:hidden}
.s-photo img,.s-split-img img,.s-card-img img,.s-cover-bg img{width:100%;height:100%;object-fit:cover;display:block}
.s-photo,.s-split-img,.s-card-img{box-shadow:0 8px 32px rgba(0,0,0,.08)}
/* image-split */
.s-split{display:flex;gap:64px;align-items:center;flex:1}
.s-split--left{flex-direction:row-reverse}
.s-split-text{flex:1.2;display:flex;flex-direction:column;justify-content:center}
.s-split-img{flex:0.8;align-self:stretch;min-height:360px}
/* cards grid */
.s-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;flex:1;align-content:center}
.s-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:32px 28px}
.s-card-img{margin:-32px -28px 24px;height:180px;border-radius:12px 12px 0 0}
.s-card-num{font-family:var(--font-display);font-size:32px;color:var(--accent);margin-bottom:12px}
.s-card-title{font-family:var(--font-display);font-size:30px;font-weight:700;color:var(--fg);margin-bottom:12px}
.s-card-body{font-size:18px;color:var(--muted);line-height:1.6}
/* cover */
.s-cover{align-items:center;justify-content:center;position:relative}
.s-cover--hasimg .s-cover-bg{position:absolute;inset:0;border-radius:0;box-shadow:none}
.s-cover--hasimg .s-cover-bg img{opacity:.45}
.s-cover-inner{position:relative;z-index:1;text-align:center;max-width:1500px}
.s-cover--hasimg~.s-footer,.s-cover .s-footer{color:var(--fg)}
@media (max-width:900px){.s-cards{grid-template-columns:repeat(2,1fr)}}
@media print{
  .s-cards{grid-template-columns:repeat(3,1fr)}
  .s-split-img,.s-photo,.s-card-img{height:auto}
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/slidesExport.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量 typecheck + test（确保 deckViewer 临时引用不破）**

Run: `npm run typecheck && npm test`
Expected: 0 错、全绿（deckViewer 的 `slideInnerHtml(s)` 无 ctx 调用仍兼容——Task 5 会补 ctx）。

- [ ] **Step 6: commit**

`feat(slides): route slidesExport through slideLayouts + enrich SLIDES_CSS + images in export`

---

## Task 5: deckViewer 传 ctx + 页脚 + 图片

**Files:**
- Modify: `src/viewer/deckViewer.ts:53-59`（`hydrateCharts` 旁）、`71-80`（`show`）、`122-132`（`printAll`）、`134-158`（入口读 images）
- Test: 无单测（viewer 是 DOM 集成页，靠 Task 13 真机验证）；本任务以 typecheck + build 为准。

**Interfaces:**
- Consumes: Task 4 `slideInnerHtml` 带 ctx；`chrome.storage.session.deckView` 新增 `images?: SlideImage[]`。

- [ ] **Step 1: 改 `deckViewer.ts`**

1a. `DeckView`（`19-26`）加 `images?`：

```ts
import type { SlideImage } from '../shared/ai/slidesImages'
interface DeckView {
  slides: Slide[]
  name: string
  themeId?: string
  print?: boolean
  images?: SlideImage[]
}
```

1b. 顶部加一个模块级 `let images: SlideImage[] = []`，并在 `show`（`71-80`）与 `printAll`（`122-132`）里构造 ctx：

```ts
let slides: Slide[] = []
let images: SlideImage[] = []
let deckName = '演示文稿'
let cur = -1

function pageHtml(s: Slide, i: number): string {
  const ctx = { deckName, index: i, total: slides.length, images }
  return `<div class="slide slide--${s.layout || 'bullets'}">${slideInnerHtml(s, ctx)}</div>`
}

function show(i: number): void {
  const nx = Math.max(0, Math.min(slides.length - 1, i))
  if (nx === cur) return
  cur = nx
  frame.innerHTML = pageHtml(slides[nx], nx)
  countEl.textContent = `${cur + 1} / ${slides.length}`
  Array.from(dotsEl.children).forEach((d, j) => d.classList.toggle('active', j === cur))
  hydrateCharts(frame)
}
```

`printAll` 里 `frame.innerHTML = slides.map(...)` 改为 `slides.map((s, i) => pageHtml(s, i)).join('')`。

1c. 入口（`134-158`）读取 images：

```ts
void chrome.storage.session.get('deckView').then((res) => {
  const dv = res?.deckView as DeckView | undefined
  const theme = getTheme(dv?.themeId)
  const themeStyle = document.createElement('style')
  themeStyle.textContent = `:root{${themeVars(theme)}}${theme.decorations ?? ''}`
  document.head.appendChild(themeStyle)
  if (!dv?.slides?.length) {
    frame.innerHTML = '<div class="muted center" style="font-size:24px">没有可显示的演示。请在「PPT 生成」里生成或从历史记录打开一份。</div>'
    fit(); return
  }
  slides = dv.slides
  images = dv.images ?? []
  deckName = dv.name || '演示文稿'
  document.title = deckName
  // …dots, ResizeObserver, show(0), fit, focus, print 不变
})
```

- [ ] **Step 2: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 0 错、构建成功。

- [ ] **Step 3: commit**

`feat(slides): deck viewer passes ctx (auto footer) + renders images`

---

## Task 6: serializeDocBlocks（block 遍历 → 文本 + 图片标记）

**Files:**
- Modify: `src/shared/ai/slidesImages.ts`（追加）、`src/shared/feishu/docx.ts`（如已导出 block_type 常量则复用，否则本地）
- Test: `src/shared/ai/slidesImages.test.ts`（追加）

**Interfaces:**
- Produces: `serializeDocBlocks(items): { text: string; images: Array<{ token: string; context: string }> }`（本地编号 `【图1】【图2】`；`context` 取最近的标题文本）。

- [ ] **Step 1: 写失败测试**（追加到 `slidesImages.test.ts`）

```ts
import { serializeDocBlocks } from './slidesImages'

describe('serializeDocBlocks', () => {
  it('turns text/heading blocks into markdown-ish text', () => {
    const items = [
      { block_type: 4, heading2: { elements: [{ text_run: { content: '产品介绍' } }] } }, // h2
      { block_type: 2, text: { elements: [{ text_run: { content: '正文内容' } }] } },
    ]
    expect(serializeDocBlocks(items).text).toContain('产品介绍')
    expect(serializeDocBlocks(items).text).toContain('正文内容')
  })
  it('inserts 【图n】 at image-block position and collects token + nearest-heading context', () => {
    const items = [
      { block_type: 4, heading2: { elements: [{ text_run: { content: '第三章 产品' } }] } },
      { block_type: 27, image: { token: 'tokA', width: 100, height: 80 } },
      { block_type: 27, image: { token: 'tokB' } },
    ]
    const r = serializeDocBlocks(items)
    expect(r.text).toContain('【图1】')
    expect(r.text).toContain('【图2】')
    expect(r.images).toEqual([
      { token: 'tokA', context: '第三章 产品' },
      { token: 'tokB', context: '第三章 产品' },
    ])
  })
  it('ignores non-image blocks with no text content', () => {
    expect(serializeDocBlocks([{ block_type: 99, weird: {} }]).text.trim()).toBe('')
    expect(serializeDocBlocks([{ block_type: 99 }]).images).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/slidesImages.test.ts`
Expected: FAIL（`serializeDocBlocks` 未导出）。

- [ ] **Step 3: 实现**（追加到 `slidesImages.ts`）

```ts
const textOf = (el: unknown): string => {
  // 提取 text_run.content / headingN.elements 等
  const e = (el as { elements?: Array<{ text_run?: { content?: string } }> })?.elements
  if (!Array.isArray(e)) return ''
  return e.map((x) => String(x?.text_run?.content ?? '')).join('')
}

/** Walk a docx block list → readable text with 【图n】 markers at image-block positions,
 *  plus per-image {token, context=nearest preceding heading}. Pure. */
export function serializeDocBlocks(items: unknown[]): { text: string; images: Array<{ token: string; context: string }> } {
  const lines: string[] = []
  const images: Array<{ token: string; context: string }> = []
  let lastHeading = ''
  let imgIdx = 0
  for (const raw of items) {
    const b = raw as { block_type?: number; [k: string]: unknown }
    if (!b || typeof b.block_type !== 'number') continue
    switch (b.block_type) {
      case 2: { // text
        const t = textOf(b.text); if (t) lines.push(t); break
      }
      case 3: case 4: case 5: { // heading1-3
        const t = textOf((b as { heading1?: unknown; heading2?: unknown; heading3?: unknown })[`heading${b.block_type - 2}`])
        if (t) { lastHeading = t; lines.push(`${'#'.repeat(b.block_type - 2)} ${t}`) }
        break
      }
      case 12: case 13: { // bullet / ordered
        const t = textOf((b as { bullet?: unknown; ordered?: unknown })[b.block_type === 12 ? 'bullet' : 'ordered'])
        if (t) lines.push(`- ${t}`); break
      }
      case 27: { // image
        const img = (b as { image?: { token?: string } }).image
        const token = typeof img?.token === 'string' ? img.token : ''
        if (token) { imgIdx++; lines.push(`【图${imgIdx}】`); images.push({ token, context: lastHeading }) }
        break
      }
      default: break // tables(31)/sheet(30)/etc skipped
    }
  }
  return { text: lines.join('\n'), images }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/slidesImages.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck`
Commit: `feat(slides): serializeDocBlocks → text with 【图n】 markers + image tokens`

---

## Task 7: downloadMedia + harvestDocImages（并行下载/压缩/跳过/剔标记）

**Files:**
- Create: `src/shared/feishu/media.ts`
- Modify: `src/shared/ai/slidesImages.ts`（追加 `harvestDocImages`）
- Test: `src/shared/feishu/media.test.ts`、`src/shared/ai/slidesImages.test.ts`（追加 harvest 用例，mock download/compress）

**Interfaces:**
- Produces:
  - `downloadMedia(fileToken, userToken): Promise<Blob>`（media.ts）
  - `harvestDocImages(args: { userToken; docImages: Array<{token;context}>; onProgress?(k,n); signal? }): Promise<{ images: SlideImage[]; failedTokens: string[] }>`（并行上限 4，每图压缩 `compressImageToDataUrl(blob,{longEdge:1024,quality:.8})`，失败跳过）。
- Consumes: Task 2 `compressImageToDataUrl`/`SlideImage`、Task 6 输出结构。

- [ ] **Step 1: 写失败测试**

`media.test.ts`（mock `feishuFetch`）：

```ts
import { vi, describe, it, expect } from 'vitest'
import { downloadMedia } from './media'

vi.mock('./http', () => ({
  feishuFetch: vi.fn(async () => new Response(new Blob([new Uint8Array([1,2,3])]), { status: 200 })),
}))
import { feishuFetch } from './http'

describe('downloadMedia', () => {
  it('GETs the drive media download path and returns a Blob', async () => {
    const blob = await downloadMedia('tok123', 'user-tok')
    expect(feishuFetch).toHaveBeenCalledWith('GET', '/drive/v1/medias/tok123/download', 'user-tok')
    expect(blob).toBeInstanceOf(Blob)
  })
})
```

`slidesImages.test.ts` 追加（mock `downloadMedia` + `compressImageToDataUrl`）：

```ts
vi.mock('../feishu/media', () => ({ downloadMedia: vi.fn(async (t: string) => new Blob([new Uint8Array([1])])) }))
vi.mock('./attachments', () => ({ compressImageToDataUrl: vi.fn(async (b: Blob, o?: {longEdge?:number}) => `data:${(b as {size?:number}).size}-${o?.longEdge}`) }))
import { downloadMedia } from '../feishu/media'
import { compressImageToDataUrl } from './attachments'
import { harvestDocImages } from './slidesImages'

describe('harvestDocImages', () => {
  it('downloads in parallel, compresses at longEdge=1024, builds pool with doc-N ids', async () => {
    const r = await harvestDocImages({
      userToken: 'u', docImages: [{ token: 'a', context: '标题A' }, { token: 'b', context: '' }],
    })
    expect(downloadMedia).toHaveBeenCalledTimes(2)
    expect(compressImageToDataUrl).toHaveBeenCalledWith(expect.any(Blob), { longEdge: 1024, quality: 0.8 })
    expect(r.images.map((i) => i.id)).toEqual(['doc-1', 'doc-2'])
    expect(r.images[0].context).toBe('标题A')
    expect(r.failedTokens).toEqual([])
  })
  it('skips a failed download, returns it in failedTokens', async () => {
    ;(downloadMedia as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(async (t: string) => { if (t === 'a') throw new Error('403'); return new Blob([]) })
    const r = await harvestDocImages({ userToken: 'u', docImages: [{ token: 'a', context: '' }, { token: 'b', context: '' }] })
    expect(r.images.map((i) => i.id)).toEqual(['doc-1'])
    expect(r.failedTokens).toEqual(['a'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/feishu/media.test.ts src/shared/ai/slidesImages.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `media.ts`**

```ts
import { feishuFetch } from './http'

/** Download a Feishu drive media (e.g. docx image-block token) as a Blob.
 *  Uses feishuFetch so the outbound guard + feishu host allowlist still apply. */
export async function downloadMedia(fileToken: string, userToken: string): Promise<Blob> {
  const res = await feishuFetch('GET', `/drive/v1/medias/${fileToken}/download`, userToken)
  if (!res.ok) throw new Error(`图片下载失败 (${res.status})`)
  return res.blob()
}
```

> 若 live API 需 `extra` 参数（指向源 doc），实现期在此 URL 追加 `?extra={...}` 并更新测试断言；spec §6.2/§11 已记此 TODO。

- [ ] **Step 4: 实现 `harvestDocImages`**（追加到 `slidesImages.ts`）

```ts
import { downloadMedia } from '../feishu/media'
import { compressImageToDataUrl } from './attachments'

/** Cap parallel image downloads to avoid hammering the API. */
const DL_CONCURRENCY = 4
/** Hard cap images per deck (spec §6.1). */
export const MAX_DOC_IMAGES = 8

/** Download + compress all doc images in parallel (capped). Failed images are skipped
 *  (returned in failedTokens) — the caller strips their 【图n】 markers from text. */
export async function harvestDocImages(args: {
  userToken: string
  docImages: Array<{ token: string; context: string }>
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}): Promise<{ images: SlideImage[]; failedTokens: string[] }> {
  const list = args.docImages.slice(0, MAX_DOC_IMAGES)
  const total = list.length
  const results: Array<{ ok: true; img: SlideImage } | { ok: false; token: string }> = []
  let cursor = 0, done = 0

  async function worker(): Promise<void> {
    while (cursor < list.length) {
      const my = cursor++
      const { token, context } = list[my]
      try {
        if (args.signal?.aborted) return
        const blob = await downloadMedia(token, args.userToken)
        const dataUrl = await compressImageToDataUrl(blob, { longEdge: 1024, quality: 0.8 })
        results[my] = { ok: true, img: { id: `doc-${my + 1}`, source: 'doc', label: `文档图${my + 1}`, dataUrl, context } }
      } catch {
        results[my] = { ok: false, token }
      }
      done++
      args.onProgress?.(done, total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(DL_CONCURRENCY, total) }, () => worker()))

  const images: SlideImage[] = []
  const failedTokens: string[] = []
  // Renumber survivors contiguous (doc-1..doc-K) so ids have no gaps.
  let k = 0
  for (const r of results) {
    if (r?.ok) { k++; images.push({ ...r.img, id: `doc-${k}`, label: `文档图${k}` }) }
    else if (r) failedTokens.push(r.token)
  }
  return { images, failedTokens }
}
```

> 注：survivors 被**重新连续编号**（doc-1..doc-K，无空洞）。因此调用方需先按"本地编号→全局编号"重映射正文里的 `【图n】`（Task 10），再按失败的**本地号**剔除标记。见 Task 10 的编排。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/shared/feishu/media.test.ts src/shared/ai/slidesImages.test.ts`
Expected: PASS（harvest 用例里 survivors 重编号后 `doc-1`——第二项成功即 doc-1）。

- [ ] **Step 6: typecheck + commit**

Run: `npm run typecheck`
Commit: `feat(slides): downloadMedia + harvestDocImages (parallel, capped, skip-failed)`

---

## Task 8: 6 主题 + decorations + promptHint 密度

**Files:**
- Modify: `src/shared/ai/slidesThemes.ts:43-80`（`BUILT_IN_THEMES`）
- Test: `src/shared/ai/slidesThemes.test.ts`（新建）

**Interfaces:**
- Produces: `BUILT_IN_THEMES` 6 项（business/editorial/night/minimal/vibrant/pitch），每项 `decorations` 与 `promptHint`（含版式密度）齐备。

- [ ] **Step 1: 写失败测试**

```ts
import { BUILT_IN_THEMES, getTheme, themeVars } from './slidesThemes'

describe('themes', () => {
  it('has 6 themes with stable ids', () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual(['business', 'editorial', 'night', 'minimal', 'vibrant', 'pitch'])
  })
  it('every theme has palette, decorations, promptHint mentioning layouts', () => {
    for (const t of BUILT_IN_THEMES) {
      expect(t.palette.bg).toBeTruthy()
      expect(t.decorations?.length).toBeGreaterThan(0)
      expect(t.promptHint?.length).toBeGreaterThan(0)
    }
  })
  it('getTheme falls back to business for unknown', () => {
    expect(getTheme('nope').id).toBe('business')
  })
  it('themeVars emits all tokens', () => {
    const v = themeVars(getTheme('vibrant'))
    expect(v).toContain('--accent')
    expect(v).toContain('--hero-size')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/slidesThemes.test.ts`
Expected: FAIL（只有 3 个主题）。

- [ ] **Step 3: 实现**——在 `BUILT_IN_THEMES`（`slidesThemes.ts:43-80`）数组末尾、`night` 之后追加 3 个主题，并给前 3 个的 `promptHint` 补版式密度（编辑/夜已合格，商务补一句）。

把 `business` 的 `promptHint`（`52`）改为：
```ts
    promptHint: '商务克制风：结论先行、要点精炼、数据优先（多用 chart 与 stats、cards），配色冷静、避免装饰。',
```

在 `night` 之后（`80` 之前，即数组闭合 `]` 之前）追加：

```ts
  {
    id: 'minimal',
    name: '极简',
    mode: 'light',
    palette: { bg: '#ffffff', fg: '#111111', accent: '#111111', muted: '#888888', card: '#fafafa', border: '#e8e8e8' },
    typeScale: { hero: 120, heading: 60, body: 32, caption: 22 },
    padding: 128,
    fontBody: SYS_SANS,
    decorations:
      '.s-eyebrow{letter-spacing:.4em}' +
      '.s-head{border-bottom:1px solid var(--fg);padding-bottom:20px}' +
      '.s-card,.s-photo,.s-split-img{border-radius:0;box-shadow:none;border:1px solid var(--border)}' +
      '.s-bullets li::before{border-radius:0;width:10px;height:2px;top:30px}',
    promptHint: '瑞士极简风：大量留白、细发丝线、无圆角无阴影；多用 bullets/two-col/quote，少卡片，黑白克制。',
  },
  {
    id: 'vibrant',
    name: '活力',
    mode: 'light',
    palette: { bg: '#ffffff', fg: '#1a1a2e', accent: '#7c3aed', muted: '#6b7280', card: '#f5f3ff', border: '#ede9fe' },
    typeScale: { hero: 116, heading: 60, body: 34, caption: 24 },
    padding: 120,
    fontBody: SYS_SANS,
    decorations:
      '.s-head,.s-title{background:linear-gradient(90deg,var(--accent),#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent}' +
      '.s-card{border:none;background:linear-gradient(135deg,var(--card),#fdf2f8)}' +
      '.s-stat .s-num,.s-card-num{background:linear-gradient(90deg,var(--accent),#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent}' +
      '.s-bullets li::before{background:linear-gradient(90deg,var(--accent),#ec4899)}',
    promptHint: '活力品牌风：渐变强调色、圆角卡片、视觉跳跃；多用 cards/stats/image-split，适合产品/品牌发布。',
  },
  {
    id: 'pitch',
    name: '路演',
    mode: 'dark',
    palette: { bg: '#0a0a0a', fg: '#f5f5f5', accent: '#fbbf24', muted: '#9ca3af', card: '#171717', border: '#262626' },
    typeScale: { hero: 140, heading: 64, body: 34, caption: 24 },
    padding: 120,
    fontBody: SYS_SANS,
    decorations:
      '.slide{background:radial-gradient(1000px 600px at 10% 110%, rgba(251,191,36,.12), transparent 60%), var(--bg)}' +
      '.s-stat .s-num,.s-card-num{font-size:1.15em}' +
      '.s-head::after{content:"";display:block;width:120px;height:6px;background:var(--accent);margin-top:24px}',
    promptHint: '融资路演风：深色底、高对比、巨号数字；多用 stats/cover/cards，一页一个关键数字，适合汇报/路演。',
  },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/slidesThemes.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck`
Commit: `feat(slides): 6 themes (add minimal/vibrant/pitch) + richer decorations + layout-density hints`

---

## Task 9: slidesSources — doc 走 listBlocks + 序列化；resolveSource 预告图片数

**Files:**
- Modify: `src/shared/ai/slidesSources.ts:21-24`（`Material` doc 变体）、`79-98`（`fetchMaterial`）、`31-76`（`resolveSource` chip 加 imageCount）
- Test: `src/shared/ai/slidesSources.test.ts`（新建，mock docx API）

**Interfaces:**
- Produces: doc `Material` 变体为 `{ kind:'doc'; label; url; text; imageTokens: Array<{token;context}> }`（`text` 含本地 `【图n】` 标记，未下载）；`ResolvedSource` 加可选 `imageCount?: number`（chip 提示用）。
- Consumes: Task 6 `serializeDocBlocks`、`docx.listBlocks`。

- [ ] **Step 1: 写失败测试**

```ts
import { vi, describe, it, expect } from 'vitest'
vi.mock('../feishu/docx', () => ({
  getDocumentMeta: vi.fn(async () => ({ document: { title: 'D' } })),
  listBlocks: vi.fn(async () => ({ items: [
    { block_type: 4, heading2: { elements: [{ text_run: { content: '标题X' } }] } },
    { block_type: 27, image: { token: 't1' } },
    { block_type: 27, image: { token: 't2' } },
  ], has_more: false, truncated: false })),
}))
vi.mock('../feishu/auth', () => ({ resolveToken: vi.fn(async () => 'tok'), isPermissionError: () => false }))
vi.mock('./dataviz/data', () => ({ deriveVizSource: vi.fn(), fetchVizData: vi.fn() }))
import { fetchMaterial, resolveSource } from './slidesSources'

describe('fetchMaterial doc', () => {
  it('walks blocks → text with 【图n】 + imageTokens (not downloaded)', async () => {
    const m = await fetchMaterial({} as never, { kind: 'doc', label: 'D', url: 'https://a.feishu.cn/docx/DOC' }) as Extract<Awaited<ReturnType<typeof fetchMaterial>>, { kind: 'doc' }>
    expect(m.kind).toBe('doc')
    expect(m.text).toContain('【图1】')
    expect(m.text).toContain('标题X')
    expect(m.imageTokens).toEqual([{ token: 't1', context: '标题X' }, { token: 't2', context: '标题X' }])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/slidesSources.test.ts`
Expected: FAIL（doc 仍走 raw_content，无 imageTokens）。

- [ ] **Step 3: 实现**

3a. `Material` doc 变体（`21-24`）改为：

```ts
export type Material =
  | { kind: 'doc'; label: string; url: string; text: string; imageTokens: Array<{ token: string; context: string }> }
  | { kind: 'sheet'; label: string; url: string; schema: VizField[]; sampleRows: Record<string, string>[] }
  | { kind: 'base'; label: string; url: string; schema: VizField[]; sampleRows: Record<string, string>[] }
```

3b. import 加 `listBlocks`、`serializeDocBlocks`：

```ts
import { getDocumentMeta, listBlocks } from '../feishu/docx'
import { serializeDocBlocks } from './slidesImages'
```

3c. `fetchMaterial` doc 分支（`80-88`）改为：

```ts
  if (src.kind === 'doc') {
    const token = await resolveToken(settings)
    const ctx = parseFeishuContext(src.url)
    const docId = ctx?.kind === 'doc' ? ctx.documentId : undefined
    if (!docId) throw new Error(`《${src.label}》链接无法解析`)
    const { items } = await listBlocks(token, docId)
    const { text, images: imageTokens } = serializeDocBlocks(items)
    if (!text.trim()) throw new Error(`《${src.label}》没有可读取的内容`)
    return { kind: 'doc', label: src.label, url: src.url, text, imageTokens }
  }
```

3d. `ResolvedSource` 加可选 `imageCount?`（在 `resolveSource` 里对 doc 顺带 count——可选轻量预扫；实现期如太重则省略，chip 不显示该数即可）：

> 决策：`resolveSource` 当前只为命名与 chip label；为避免多一次 listBlocks 调用，`imageCount` 仅在 `fetchMaterial` 之后由 SlidesPanel 从 `imageTokens.length` 得出并显示（见 Task 13）。`resolveSource` 本身**不改**，避免把"解析阶段"变重。本步骤只保留 `Material` 与 `fetchMaterial` 改动。测试里相应只验 fetchMaterial。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/slidesSources.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + 全量 test（slides.ts 用到 Material 处需同步，见 Task 10；此处可能 typecheck 暂报错——把 buildMaterialsPrompt 对 doc 的 `m.text` 用法保留即可，imageTokens 暂未消费）**

Run: `npm run typecheck`
Expected: 若 `slides.ts` 因 Material shape 变化报错，仅可能是解构 doc 字段处；当前 `buildMaterialsPrompt` 只用 `m.text`/`m.label`/`m.kind`/`m.schema`/`m.sampleRows`——不会报错。应 0 错。

- [ ] **Step 6: commit**

`feat(slides): fetchMaterial walks listBlocks → text+markers+imageTokens`

---

## Task 10: slides.ts — prompt 扩展 + runMaterialsToSlides 编排抽图 + adjustDeck(images) + 数据贯通

**Files:**
- Modify: `src/shared/ai/slides.ts:98-117`（`adjustDeck`）、`169-233`（`buildMaterialsPrompt`/`runMaterialsToSlides`/`MaterialsSlidesResult`）
- Modify: `src/shared/ai/slidesStore.ts:10-26`（`SavedDeck.images?`）
- Test: `src/shared/ai/slides.test.ts`（追加）

**Interfaces:**
- Produces:
  - `MaterialsSlidesResult` 加 `images: SlideImage[]`
  - `runMaterialsToSlides(settings, materials, request?, opts?)`——opts 新增 `onImageProgress?(done,total)`；内部：聚合 doc imageTokens → 全局编号 → remap 正文 → `harvestDocImages` → strip 失败标记 → buildMaterialsPrompt(texts+pool) → 生成。
  - `buildMaterialsPrompt(materials, request?, themeHint?, pool?)`——pool 非空时附"可用图片"段；pool 空时禁止需图版式。
  - `adjustDeck(settings, { slides, images, instruction, signal })`
  - `SavedDeck.images?: SlideImage[]`
- Consumes: Task 2/6/7（`SlideImage`/`remapMarkers`/`stripMarkers`/`harvestDocImages`/`MAX_DOC_IMAGES`）、Task 9 `Material`。

- [ ] **Step 1: 写失败测试**（追加到 `slides.test.ts`；mock `chatCompleteStream`）

```ts
import { vi } from 'vitest'
vi.mock('./llm', () => ({ chatCompleteStream: vi.fn(async (_s: unknown, content: string) => {
  // 回显 prompt 里出现的图片池信息，便于断言
  if (/可用图片/.test(content)) return JSON.stringify({ title: 'T', slides: [{ layout: 'image-split', title: 'x', image: 'doc-1' }] })
  return JSON.stringify({ title: 'T', slides: [{ layout: 'bullets', title: '无图', bullets: ['a'] }] })
}) }))
import { runMaterialsToSlides, adjustDeck } from './slides'

describe('runMaterialsToSlides image orchestration', () => {
  it(' harvests doc images, passes pool to prompt, returns images', async () => {
    const materials = [{ kind: 'doc', label: 'D', url: 'u', text: '标题\n【图1】正文', imageTokens: [{ token: 't1', context: '标题' }] }] as const
    const r = await runMaterialsToSlides({} as never, materials as never)
    // 注：harvestDocImages 会真调网络；此处仅断言返回结构字段存在。完整集成在 Task 13 真机验。
    expect(Array.isArray(r.images)).toBe(true)
    expect(r.sources.length).toBe(1)
  })
})

describe('adjustDeck prompt includes pool', () => {
  it('lists available images when pool non-empty', async () => {
    await adjustDeck({} as never, {
      slides: [{ layout: 'bullets', title: 'a' }],
      images: [{ id: 'upload-产品图', source: 'upload', label: '产品图', dataUrl: 'data:x' }],
      instruction: '把 产品图 放第1页',
    })
    const { chatCompleteStream } = await import('./llm')
    const content = (chatCompleteStream as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)?.[1] as string
    expect(content).toContain('可用图片')
    expect(content).toContain('upload-产品图')
  })
})
```

> 注：`runMaterialsToSlides` 测试里 `harvestDocImages` 会触发真实 `downloadMedia`——测试环境会失败。为可测，给 `runMaterialsToSlides` 注入可选 `imageFetcher?`（默认 `harvestDocImages`），测试里传入桩：

把上面 runMaterials 用例改为：

```ts
  it('orchestrates: remap global numbering, harvest via injected fetcher, strip failed markers, pass pool to prompt', async () => {
    const fetcher = vi.fn(async () => ({
      // 输入 imageTokens=[t1]，成功→doc-1
      images: [{ id: 'doc-1', source: 'doc', label: '文档图1', dataUrl: 'data:ok', context: '标题' }],
      failedTokens: [],
    }))
    const materials = [{ kind: 'doc', label: 'D', url: 'u', text: '# 标题\n【图1】正文', imageTokens: [{ token: 't1', context: '标题' }] }]
    const r = await runMaterialsToSlides({} as never, materials as never, undefined, { imageFetcher: fetcher as never })
    expect(fetcher).toHaveBeenCalled()
    const { chatCompleteStream } = await import('./llm')
    const content = (chatCompleteStream as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)?.[1] as string
    expect(content).toContain('【图1】')          // marker survived in prompt text
    expect(content).toContain('可用图片')
    expect(content).toContain('doc-1')
    expect(r.images.map((i: { id: string }) => i.id)).toEqual(['doc-1'])
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/ai/slides.test.ts`
Expected: FAIL（`imageFetcher`/pool/images 未实现）。

- [ ] **Step 3: 实现**

3a. `slides.ts` 顶部 import 加：

```ts
import type { SlideImage } from './slidesImages'
import { remapMarkers, stripMarkers, harvestDocImages, MAX_DOC_IMAGES } from './slidesImages'
```

3b. `MaterialsSlidesResult`（`202-207`）加 `images`：

```ts
export interface MaterialsSlidesResult {
  name: string
  slides: Slide[]
  images: SlideImage[]
  truncated: boolean
  sources: SourceRef[]
}
```

3c. `buildMaterialsPrompt` 签名加 `pool`，并在末尾加图片段 + 空池守卫（替换 `169-200`）：

```ts
function buildMaterialsPrompt(
  materials: Material[],
  request?: string,
  themeHint?: string,
  pool: SlideImage[] = [],
): string {
  const docs = materials.filter((m): m is Extract<Material, { kind: 'doc' }> => m.kind === 'doc')
  const perDoc = docBudgetEach(docs.length)
  const blocks = materials.map((m, i) => {
    if (m.kind === 'doc') {
      const over = m.text.length > perDoc
      return `【资料${i + 1}｜文档《${m.label}》】\n${m.text.slice(0, perDoc)}${over ? `\n…（已截取前 ${perDoc} 字）` : ''}`
    }
    const flds = m.schema.map((f) => `${f.name}（${f.type}）${f.samples?.length ? `｜样本: ${f.samples.join(', ')}` : ''}`).join('\n')
    const sample = m.sampleRows.slice(0, MATERIAL_TABLE_SAMPLE)
    const kindLabel = m.kind === 'base' ? '多维表格' : '表格'
    return `【资料${i + 1}｜${kindLabel}《${m.label}》】\n字段：\n${flds}\n样本数据（前 ${sample.length} 行，可能非全部）:\n${sanitizeForLlm(JSON.stringify(sample))}`
  })
  const layoutLine =
    pool.length
      ? `可选 layout：title / section / bullets / two-col / quote / stats / chart / **cover / cards / image-split**（cover/image-split 需配图）`
      : `可选 layout：title / section / bullets / two-col / quote / stats / chart（本次没有可用图片，**禁止使用 cover 背景图 / image-split 等需要图片的版式**）`
  const fieldsLine = pool.length
    ? `字段：title、subtitle、eyebrow、bullets[]、bullets2[]、quote、by、stats[{num,label}]、chart、cards[{title,body,num,image}]、image(图片id)、imageSide(left|right)、imageCaption。`
    : `字段：title、subtitle、eyebrow、bullets[]、bullets2[]、quote、by、stats[{num,label}]、chart。`
  const imageLine = pool.length
    ? `\n【可用图片（image 字段填这些 id 之一）】\n${pool.map((im) => `- ${im.id}（${im.source === 'doc' ? '文档图' : '用户上传'}·${im.label}${im.context ? `·${im.context}` : ''}）`).join('\n')}\n适合配图的页用 cover / image-split / cards，把图片 id 填进 image（或卡片 image）；图片说明从上下文推断，不要编造。正文里的【图n】是原文配图位置，按其上下文放到对应页。\n`
    : ``
  return (
    `你是顶尖的演示设计师 + 数据分析师。下面有 ${materials.length} 份资料（文档 / 表格），请综合它们做成一套【可翻页的幻灯片 PPT】。\n` +
    `输出一个 JSON 对象：{"title":"演示标题","slides":[ 每张幻灯片一个对象 ]}。${layoutLine}\n` +
    `  · {"layout":"title","title":"主标题","subtitle":"一句话主旨"} —— 仅第 1 张封面\n` +
    `  · {"layout":"section","title":"章节名","subtitle":"可选"} —— 章节分隔\n` +
    `  · {"layout":"bullets","eyebrow":"可选小标","title":"小标题","bullets":["要点",...]} —— 每页 3–6 条\n` +
    `  · {"layout":"two-col","title":"小标题","bullets":[...],"bullets2":[...]} —— 对比 / 分组\n` +
    `  · {"layout":"stats","title":"小标题","stats":[{"num":"123","label":"说明"},...]} —— 关键数字\n` +
    `  · {"layout":"cards","title":"小标题","cards":[{"title":"","body":"","num":"","image":""},...]} —— 卡片网格\n` +
    `  · {"layout":"image-split","title":"","image":"图片id","imageSide":"left|right","bullets":[...]} —— 图文左右\n` +
    `  · {"layout":"chart","title":"小标题","chart":{完整 ECharts 配置对象}} —— 数据优先图表\n` +
    `  · {"layout":"quote","quote":"结论","by":"可选"} —— 结论 / 收尾\n` +
    `${fieldsLine}\n` +
    `【诚实硬规则】只用上面资料里能直接读到 / 数出来的数字；绝不编造精确总数或比例；只用真实字段名。\n` +
    `【要求】8–16 张；第 1 张必须是 title 或 cover 封面；文字精炼（标题≤20 字、要点≤30 字）；中文。\n` +
    `【视觉风格】${themeHint || '商务克制：结论先行、要点精炼、避免装饰。'}\n` +
    `【内容预算】画布固定 1920×1080 且不滚动：每页只承载一个主题。\n` +
    (request?.trim() ? `【用户额外要求】${request.trim()}\n` : '') +
    imageLine +
    `只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n\n${blocks.join('\n\n')}`
  )
}
```

3d. `runMaterialsToSlides`（`211-233`）改为编排抽图：

```ts
export async function runMaterialsToSlides(
  settings: AppSettings,
  materials: Material[],
  request?: string,
  opts?: {
    signal?: AbortSignal
    onProgress?: (chars: number) => void
    themeHint?: string
    onImageProgress?: (done: number, total: number) => void
    /** Test seam + future alt sources. Default: harvestDocImages. */
    imageFetcher?: typeof harvestDocImages
  },
): Promise<MaterialsSlidesResult> {
  // 1) 聚合 doc imageTokens，分配全局编号并 remap 正文里的【图n】
  const fetch = opts?.imageFetcher ?? harvestDocImages
  const docs = materials.filter((m): m is Extract<Material, { kind: 'doc' }> => m.kind === 'doc')
  const perDoc = docBudgetEach(docs.length)

  type Local = { token: string; context: string }
  const globalDocImages: Array<{ token: string; context: string }> = []
  const remappedTexts = new Map<Material, string>()
  for (const m of docs) {
    const local = (m as Extract<Material, { kind: 'doc' }>).imageTokens ?? []
    if (!local.length) { remappedTexts.set(m, m.text); continue }
    const base = globalDocImages.length
    const map = local.map((_, i) => base + i + 1) // local i (1-based) → global
    globalDocImages.push(...local)
    ;(m as Extract<Material, { kind: 'doc' }>).text = remapMarkers(m.text, map)
    remappedTexts.set(m, (m as Extract<Material, { kind: 'doc' }>).text)
  }
  const capped = globalDocImages.slice(0, MAX_DOC_IMAGES)
  const localToGlobalForCapped: number[] = []
  // 收集被 cap 的失败本地号（超出上限的）以剔除其标记：用其在原文里的全局号
  const overflowGlobals = globalDocImages.slice(MAX_DOC_IMAGES).map((_, i) => MAX_DOC_IMAGES + i + 1)

  // 2) 下载 + 压缩（并行），失败返回 failedTokens
  const token = await resolveToken(settings)
  const harvested = capped.length
    ? await fetch({ userToken: token, docImages: capped, signal: opts?.signal, onProgress: opts?.onImageProgress })
    : { images: [], failedTokens: [] }

  // 3) survivors 被 harvestDocImages 重新连续编号为 doc-1..doc-K。
  //    需把正文里的【图{oldGlobal}】映射到 survivor 的新编号，并剔除失败/溢出的标记。
  //    建立 oldGlobal → new 的映射：
  const survivorOldGlobals: number[] = [] // 与 harvested.images 顺序对齐的 oldGlobal
  let gi = 0
  for (let i = 0; i < capped.length; i++) {
    gi++
    const ok = !harvested.failedTokens.includes(capped[i].token)
    if (ok) survivorOldGlobals.push(gi)
  }
  // oldGlobal → new doc-K
  const oldToNew = new Map<number, number>()
  survivorOldGlobals.forEach((og, k) => oldToNew.set(og, k + 1))
  // 重写正文：把【图{og}】→【图{new}】，再把无 new（失败/溢出）的标记剔除
  const failedGlobals = capped
    .map((c, i) => (harvested.failedTokens.includes(c.token) ? i + 1 : -1))
    .filter((n) => n > 0)
  const allDropGlobals = new Set([...failedGlobals, ...overflowGlobals])
  for (const m of docs) {
    let t = (m as Extract<Material, { kind: 'doc' }>).text
    t = t.replace(/【图(\d+)】/g, (mm, d) => {
      const n = Number(d)
      return oldToNew.has(n) ? `【图${oldToNew.get(n)}】` : (allDropGlobals.has(n) ? '' : mm)
    })
    ;(m as Extract<Material, { kind: 'doc' }>).text = t
  }
  // 把 pool 里的 id 从 doc-K 改为 "doc-K"（已是），label 也已是
  const pool: SlideImage[] = harvested.images

  // 4) 生成
  const out = fences(await chatCompleteStream(settings, buildMaterialsPrompt(materials, request, opts?.themeHint, pool), {
    signal: opts?.signal, onChunk: (f) => opts?.onProgress?.(f.length),
  }))
  if (!out) throw new Error('模型未返回内容。')
  let parsed: { title?: string; slides?: unknown }
  try { parsed = JSON.parse(out) } catch { throw new Error('幻灯片解析失败，请重试或换一个支持 JSON 输出的模型。') }
  const slides = sanitizeSlides(parsed.slides)
  if (!slides.length) throw new Error('没有生成可用的幻灯片内容。')
  return {
    name: String(parsed.title || '综合演示').slice(0, 40),
    slides,
    images: pool,
    truncated: docs.some((d) => (remappedTexts.get(d) ?? d.text).length > perDoc) || globalDocImages.length > MAX_DOC_IMAGES,
    sources: materials.map((m) => ({ kind: m.kind, label: m.label, url: m.url })),
  }
}
```

> `resolveToken` 已在文件用？若未 import，加 `import { resolveToken } from '../feishu/auth'`。

3e. `adjustDeck`（`98-117`）入参加 `images`，prompt 附池：

```ts
export async function adjustDeck(
  settings: AppSettings,
  input: { slides: Slide[]; images?: SlideImage[]; instruction: string; signal?: AbortSignal },
): Promise<Slide[]> {
  const pool = input.images ?? []
  const numbered = input.slides.map((s, i) => `${i + 1}. ${JSON.stringify(s)}`).join('\n')
  const layoutLine = pool.length
    ? `可选 layout：title / section / bullets / two-col / quote / stats / chart / cover / cards / image-split`
    : `可选 layout：title / section / bullets / two-col / quote / stats / chart（无可用图片，禁止 cover 背景图 / image-split）`
  const imageLine = pool.length
    ? `\n【可用图片】\n${pool.map((im) => `- ${im.id}（${im.label}）`).join('\n')}\n把图片放到指定页时：把该页 image 改为此 id，layout 改为 image-split（或 cover/cards），可用 imageSide 控制左右。\n`
    : ``
  const content =
    `下面是一套完整的演示幻灯片（JSON 数组，共 ${input.slides.length} 页，已标注页码）。请按【修改要求】修改其中需要改的页，**没有明确提到的页必须原样保留**。\n` +
    `修改要求里可能用自然语言指代页码或范围（如"第3页"、"封面"、"第5-7页"、"每页"、"全部"），由你判断该改哪些页；也可能指代某张图片（按其 label）。\n` +
    `${layoutLine}；字段：title、subtitle、eyebrow、bullets[]、bullets2[]、quote、by、stats、chart、cards[]、image、imageSide、imageCaption。\n` +
    `可以改 layout、文字、要点，或把某页改成 chart / image-split。文字精炼（标题≤20 字、要点≤30 字）。\n` +
    `只输出修改后的【完整 slides JSON 数组】（必须包含所有页、顺序不变，包括没改的），不要解释、不要代码围栏。\n` +
    `【当前幻灯片】\n${numbered}\n${imageLine}【修改要求】${input.instruction}`
  const out = fences(await chatCompleteStream(settings, content, { signal: input.signal }))
  if (!out) throw new Error('模型未返回内容。')
  let parsed: unknown
  try { parsed = JSON.parse(out) } catch { throw new Error('修改结果解析失败，请重试或换种说法。') }
  const slides = sanitizeSlides(parsed)
  if (!slides.length) throw new Error('修改后没有可用内容，请换种说法重试。')
  return slides
}
```

3f. `slidesStore.ts` `SavedDeck`（`10-26`）加：

```ts
import type { SlideImage } from './slidesImages'
export interface SavedDeck {
  /* …现有字段… */
  images?: SlideImage[]
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/ai/slides.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + 全量 test**

Run: `npm run typecheck && npm test`
Expected: 0 错、全绿。

- [ ] **Step 6: commit**

`feat(slides): orchestrate doc-image harvest + pool-aware prompts + adjustDeck(images) + SavedDeck.images`

---

## Task 11: ThemeThumb 组件

**Files:**
- Create: `src/sidepanel/components/ThemeThumb.tsx`、`src/sidepanel/components/ThemeThumb.css`
- Test: `src/sidepanel/components/ThemeThumb.test.tsx`

**Interfaces:**
- Props: `{ theme: SlideTheme; selected: boolean; disabled?: boolean; onSelect: () => void }`
- 渲染：一个 button，含按 `theme.id` switch 的 CSS/SVG 风格图标 + `theme.name` + 选中态。

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeThumb } from './ThemeThumb'
import { getTheme } from '../../shared/ai/slidesThemes'

describe('ThemeThumb', () => {
  it('renders name and reflects selected state', () => {
    render(<ThemeThumb theme={getTheme('night')} selected={true} onSelect={() => {}} />)
    expect(screen.getByText('暗夜')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /暗夜/ })).toHaveClass('sl-theme--active')
  })
  it('calls onSelect on click', async () => {
    const user = userEvent.setup()
    const fn = vi.fn()
    render(<ThemeThumb theme={getTheme('minimal')} selected={false} onSelect={fn} />)
    await user.click(screen.getByRole('button'))
    expect(fn).toHaveBeenCalledOnce()
  })
  it('renders an icon element keyed by theme id', () => {
    const { container } = render(<ThemeThumb theme={getTheme('pitch')} selected={false} onSelect={() => {}} />)
    expect(container.querySelector('.sl-theme-icon[data-theme="pitch"]')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/sidepanel/components/ThemeThumb.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 `ThemeThumb.tsx`**

```tsx
import type { SlideTheme } from '../../shared/ai/slidesThemes'
import './ThemeThumb.css'

interface Props {
  theme: SlideTheme
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}

/** A pure-CSS/SVG motif per theme id, tinted by the theme's own palette via CSS vars. */
function Icon({ id, accent }: { id: string; accent: string }) {
  const common = { style: { color: accent }, 'data-theme': id }
  switch (id) {
    case 'editorial':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"><text x="6" y="30" fontFamily="Georgia,serif" fontSize="26" fill="currentColor" stroke="none">A</text><line x1="8" y1="36" x2="40" y2="36" /></svg></span>)
    case 'night':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none"><rect x="6" y="6" width="36" height="36" rx="6" fill="#0f1322" stroke="currentColor" strokeWidth="1.5" /><circle cx="34" cy="14" r="3" fill="currentColor" /></svg></span>)
    case 'minimal':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1"><line x1="8" y1="16" x2="40" y2="16" /><line x1="8" y1="24" x2="32" y2="24" /><line x1="8" y1="32" x2="36" y2="32" /></svg></span>)
    case 'vibrant':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none"><rect x="6" y="14" width="12" height="20" rx="3" fill="currentColor" opacity=".8" /><rect x="20" y="8" width="12" height="26" rx="3" fill="currentColor" opacity=".55" /><rect x="34" y="18" width="8" height="16" rx="3" fill="currentColor" /></svg></span>)
    case 'pitch':
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none"><text x="11" y="34" fontFamily="system-ui,sans-serif" fontWeight="800" fontSize="28" fill="currentColor" stroke="none">1</text></svg></span>)
    case 'business':
    default:
      return (<span className="sl-theme-icon" {...common}><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="8" y1="16" x2="34" y2="16" /><line x1="8" y1="24" x2="28" y2="24" /><line x1="8" y1="32" x2="22" y2="32" /><line x1="36" y1="32" x2="42" y2="32" /></svg></span>)
  }
}

export function ThemeThumb({ theme, selected, disabled, onSelect }: Props) {
  return (
    <button
      type="button"
      className={`sl-theme${selected ? ' sl-theme--active' : ''}`}
      onClick={onSelect}
      disabled={disabled}
      title={theme.promptHint}
      aria-pressed={selected}
    >
      <Icon id={theme.id} accent={theme.palette.accent} />
      <span className="sl-theme-name">{theme.name}</span>
    </button>
  )
}
```

`ThemeThumb.css`（与现有 `.sl-theme` 类名协调，覆盖旧色点样式——旧样式在 SlidesPanel.css 里，Task 13 会清理；这里先给图标版样式，`.sl-theme--active` 复用现有）：

```css
.sl-theme{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;border:1px solid var(--border,#dee0e3);border-radius:10px;background:var(--bg,#fff);cursor:pointer;transition:border-color .15s,box-shadow .15s}
.sl-theme:hover{border-color:var(--accent)}
.sl-theme--active{border-color:var(--accent);box-shadow:0 0 0 2px rgba(51,112,255,.18)}
.sl-theme:disabled{opacity:.5;cursor:not-allowed}
.sl-theme-icon{display:flex;width:44px;height:44px;align-items:center;justify-content:center}
.sl-theme-icon svg{width:100%;height:100%}
.sl-theme-name{font-size:12px;color:var(--fg,#1f2329)}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/components/ThemeThumb.test.tsx`
Expected: PASS。

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck`
Commit: `feat(slides): ThemeThumb component (per-theme CSS/SVG motif)`

---

## Task 12: ImagePicker 组件

**Files:**
- Create: `src/sidepanel/components/ImagePicker.tsx`、`src/sidepanel/components/ImagePicker.css`
- Test: `src/sidepanel/components/ImagePicker.test.tsx`

**Interfaces:**
- Props:
  ```ts
  interface ImagePickerProps {
    images: SlideImage[]
    pageOf?: (id: string) => number | undefined   // 生成后用来显示"所在页"；生成前不传
    onChange: (next: SlideImage[]) => void
    disabled?: boolean
    max?: number                                  // 默认 12
  }
  ```
- 行为：上传（`compressImageToDataUrl`）→ 追加 `upload-<slug>`；chip 显示缩略图 + 可编辑 label + 删除 + （生成后）"p{n}"角标。

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImagePicker } from './ImagePicker'
import type { SlideImage } from '../../shared/ai/slidesImages'

vi.mock('../../shared/attachments', () => ({ compressImageToDataUrl: vi.fn(async () => 'data:image/png;base64,AA') }))

describe('ImagePicker', () => {
  it('renders existing images with rename + remove', () => {
    const imgs: SlideImage[] = [{ id: 'upload-a', source: 'upload', label: '产品图', dataUrl: 'data:x' }]
    const onChange = vi.fn()
    render(<ImagePicker images={imgs} onChange={onChange} />)
    expect(screen.getByDisplayValue('产品图')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('移除 产品图'))
    expect(onChange).toHaveBeenCalledWith([])
  })
  it('rename calls onChange with updated label', () => {
    const imgs: SlideImage[] = [{ id: 'upload-a', source: 'upload', label: '产品图', dataUrl: 'data:x' }]
    const onChange = vi.fn()
    render(<ImagePicker images={imgs} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('产品图'), { target: { value: '主图' } })
    expect(onChange).toHaveBeenLastCalledWith([{ ...imgs[0], label: '主图' }])
  })
  it('shows page badge when pageOf returns a number', () => {
    const imgs: SlideImage[] = [{ id: 'doc-1', source: 'doc', label: '文档图1', dataUrl: 'data:x' }]
    render(<ImagePicker images={imgs} pageOf={(id) => (id === 'doc-1' ? 3 : undefined)} onChange={() => {}} />)
    expect(screen.getByText('p3')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/sidepanel/components/ImagePicker.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 `ImagePicker.tsx`**

```tsx
import { useRef, useState } from 'react'
import type { SlideImage } from '../../shared/ai/slidesImages'
import { compressImageToDataUrl } from '../../shared/attachments'
import './ImagePicker.css'

interface Props {
  images: SlideImage[]
  pageOf?: (id: string) => number | undefined
  onChange: (next: SlideImage[]) => void
  disabled?: boolean
  max?: number
}

const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'img'

export function ImagePicker({ images, pageOf, onChange, disabled, max = 12 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return
    setBusy(true)
    try {
      const next = [...images]
      for (const f of Array.from(files)) {
        if (next.length >= max) break
        const dataUrl = await compressImageToDataUrl(f, { longEdge: 1024, quality: 0.8 })
        const base = slug(f.name.replace(/\.[^.]+$/, ''))
        let id = `upload-${base}`, k = 1
        while (next.some((i) => i.id === id)) id = `upload-${base}-${k++}`
        next.push({ id, source: 'upload', label: base, dataUrl })
      }
      onChange(next)
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }

  function rename(id: string, label: string) {
    onChange(images.map((i) => (i.id === id ? { ...i, label } : i)))
  }
  function remove(id: string) {
    onChange(images.filter((i) => i.id !== id))
  }

  return (
    <div className="sl-imgpicker">
      <div className="sl-imgpicker-grid">
        {images.map((i) => (
          <div className="sl-imgchip" key={i.id}>
            <img className="sl-imgchip-thumb" src={i.dataUrl} alt={i.label} />
            <input className="sl-imgchip-name" value={i.label} aria-label={`名称 ${i.label}`}
              onChange={(e) => rename(i.id, e.target.value)} disabled={disabled} />
            {pageOf ? (pageOf(i.id) != null && <span className="sl-imgchip-page">p{pageOf(i.id)}</span>) : null}
            <button type="button" className="sl-imgchip-x" aria-label={`移除 ${i.label}`} onClick={() => remove(i.id)} disabled={disabled}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        ))}
      </div>
      {images.length < max && (
        <button type="button" className="sl-imgpicker-add" onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
          {busy ? '处理…' : '+ 添加图片'}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
    </div>
  )
}
```

`ImagePicker.css`：

```css
.sl-imgpicker{display:flex;flex-direction:column;gap:8px}
.sl-imgpicker-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.sl-imgchip{position:relative;border:1px solid var(--border,#dee0e3);border-radius:8px;overflow:hidden;background:var(--card,#f5f6f8)}
.sl-imgchip-thumb{width:100%;height:60px;object-fit:cover;display:block}
.sl-imgchip-name{width:100%;border:none;border-top:1px solid var(--border,#dee0e3);background:transparent;font-size:11px;padding:4px 22px 4px 6px;outline:none}
.sl-imgchip-page{position:absolute;top:4px;left:4px;background:var(--accent,#3370ff);color:#fff;font-size:10px;padding:1px 5px;border-radius:4px}
.sl-imgchip-x{position:absolute;top:2px;right:2px;width:20px;height:20px;border:none;background:rgba(255,255,255,.85);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.sl-imgchip-x svg{width:12px;height:12px}
.sl-imgpicker-add{align-self:flex-start;border:1px dashed var(--border,#dee0e3);background:transparent;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px}
.sl-imgpicker-add:hover{border-color:var(--accent,#3370ff);color:var(--accent,#3370ff)}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/sidepanel/components/ImagePicker.test.tsx`
Expected: PASS。

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck`
Commit: `feat(slides): ImagePicker component (upload/rename/remove + page badge)`

---

## Task 13: SlidesPanel 全量接线 + manifest

**Files:**
- Modify: `src/sidepanel/components/SlidesPanel.tsx`（全文件接线）、`src/sidepanel/components/SlidesPanel.css`（清理旧 `.sl-theme-dot` 色点样式，沿用 ThemeThumb.css）、`manifest.json:10-18`（加 `unlimitedStorage`）
- 验证：typecheck + build + 真机（dev:ui）。

**Interfaces（接线点）：**
- `themeId` state 生成前后都用；`hasGen` 后渲染主题网格，换肤走 `openDeck(last.current, newThemeId)` + `saveDeck({...existing, themeId})`，**不调 LLM**。
- `images: SlideImage[]` state；贯穿 `generate`（传 `runMaterialsToSlides` 的 `onImageProgress`、结果 `r.images` 入 deck）、`regenerate`（传 `adjustDeck` 的 `images`）、`openDeck`（写 session 含 images）、`newDraft`（清空）。
- 生成后 `ImagePicker` 的 `pageOf` 反查 slides。
- 占位文案加多图示例；状态栏 `下载文档图片 k/N`。

- [ ] **Step 1: 接线 `SlidesPanel.tsx`**（下列为关键 diff；保持既有结构）

1a. import：

```ts
import { runMaterialsToSlides, adjustDeck, type Slide } from '../../shared/ai/slides'
import type { SlideImage } from '../../shared/ai/slidesImages'
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, getTheme } from '../../shared/ai/slidesThemes'
import { ThemeThumb } from './ThemeThumb'
import { ImagePicker } from './ImagePicker'
```

1b. state（在 `themeId` 附近）：

```ts
const [images, setImages] = useState<SlideImage[]>([])
const [imgProg, setImgProg] = useState<{ done: number; total: number } | null>(null)
```

`newDraft` 内追加：`setImages([]); setImgProg(null)`

1c. 主题选择器（生成前，替换 `219-226` 色点版）：

```tsx
<div className="sl-themes">
  {BUILT_IN_THEMES.map((t) => (
    <ThemeThumb key={t.id} theme={t} selected={themeId === t.id} disabled={busy} onSelect={() => setThemeId(t.id)} />
  ))}
</div>
```

1d. 图片上传区（生成前，放在"补充说明"下方 `274-275` 之后）：

```tsx
<div className="sl-field">
  <label className="sl-label">图片 <span className="sl-label-hint">（可选，上传后可在"修改"里指派到页）</span></label>
  <ImagePicker images={images} onChange={setImages} disabled={busy} />
</div>
```

1e. `generate()`（替换 `90-119`）——传 onImageProgress、保存 images、开 deck：

```tsx
async function generate() {
  if (busy || sources.length === 0) return
  const ac = new AbortController(); abortRef.current = ac
  setBusy(true); setErrMsg(''); setStatus(''); setGenChars(0); setImgProg(null)
  try {
    setStatus(`读取 ${sources.length} 份资料…`)
    const materials = []
    for (const src of sources) materials.push(await fetchMaterial(settings, src))
    const docImgTotal = materials.filter((m) => m.kind === 'doc').reduce((n, m) => n + (m.kind === 'doc' ? m.imageTokens.length : 0), 0)
    if (docImgTotal > 0) setStatus(`下载文档图片…（共 ${Math.min(docImgTotal, 8)} 张）`)
    else setStatus('综合资料生成幻灯片…（约需几十秒，请耐心等待）')
    const r = await runMaterialsToSlides(settings, materials, request.trim() || undefined, {
      signal: ac.signal, onProgress: setGenChars, themeHint: getTheme(themeId).promptHint,
      onImageProgress: (done, total) => { setImgProg({ done, total }); setStatus(`下载文档图片 ${done}/${total}…`) },
    })
    const pool = [...images, ...r.images]
    const deck: Deck = { name: r.name, slides: r.slides }
    last.current = deck
    setImages(pool)
    setHasGen(true)
    const srcKey = primarySrcKey(sources) ?? 'multi'
    const saved: SavedDeck = { id: crypto.randomUUID(), name: r.name, srcKey, slides: r.slides, sources: r.sources, themeId, images: pool, createdAt: Date.now() }
    setDecks(await saveDeck(saved))
    setActiveDeckId(saved.id)
    await openDeck(deck, themeId, false, pool)
    setStatus(`已生成「${r.name}」· 共 ${r.slides.length} 页${r.truncated ? '（部分文档较长/图片较多，已截取）' : ''}`)
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') setStatus('已取消')
    else { setErrMsg(errText(e)); setStatus('') }
  } finally { setBusy(false); abortRef.current = null; setImgProg(null) }
}
```

1f. `openDeck` 改签名加 images（替换 `34-39`）：

```tsx
async function openDeck(deck: Deck, themeId: string, print = false, images: SlideImage[] = []): Promise<void> {
  await chrome.storage.session.set({ deckView: { slides: deck.slides, name: deck.name, themeId, print, images } })
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/viewer/deckViewer.html') })
}
```

> 所有 `openDeck(...)` 调用点（查看/导出/重开历史）都要传 images：`openDeck(last.current, themeId, false, images)`；导出 PDF 同理；`openSaved` 用 `d.images ?? []`。

1g. `regenerate()`（替换 `133-158`）——把 images 传 adjustDeck、留空则 generate（已含上传图）：

```tsx
async function regenerate() {
  if (busy) return
  const deck = last.current
  const mod = adjReq.trim()
  if (!deck || !mod) { if (!sources.length) { setErrMsg('请填写修改内容，或先添加资料后重新生成。'); return } void generate(); return }
  const ac = new AbortController(); abortRef.current = ac
  setBusy(true); setErrMsg(''); setStatus('按修改重新生成…'); setGenChars(0)
  try {
    const slides = await adjustDeck(settings, { slides: deck.slides, images, instruction: mod, signal: ac.signal })
    const nd: Deck = { name: deck.name, slides }
    last.current = nd
    const existing = decks.find((d) => d.id === activeDeckId)
    if (existing) setDecks(await saveDeck({ ...existing, slides }))
    await openDeck(nd, themeId, false, images)
    setStatus(`已按修改重新生成 · 共 ${slides.length} 页`)
    setAdjReq('')
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') setStatus('已取消')
    else { setErrMsg(errText(e)); setStatus('') }
  } finally { setBusy(false); abortRef.current = null }
}
```

1h. `exportHtml` 传 images：

```tsx
function exportHtml() {
  if (!last.current || busy) return
  try { downloadSlidesHtml(last.current.slides, last.current.name, getTheme(themeId), images); setStatus('已导出 HTML 文件') }
  catch (e) { setErrMsg(errText(e)) }
}
```

（`import { downloadSlidesHtml }` 已存在。）

1i. 生成后区块：加①主题即时换肤、②图片池可见（带 pageOf）、③"修改" placeholder 多图示例。

把 `hasGen` 分支（`280-324` 之间）在"查看 PPT"按钮上方插入主题网格；在"修改"框上方插 ImagePicker；"修改"placeholder 改：

```tsx
{hasGen && (
  <>
    <div className="sl-result"> {/* 保持现有 */} </div>

    <div className="sl-field">
      <label className="sl-label">主题 <span className="sl-label-hint">（换肤即时生效，无需重新生成）</span></label>
      <div className="sl-themes">
        {BUILT_IN_THEMES.map((t) => (
          <ThemeThumb key={t.id} theme={t} selected={themeId === t.id} disabled={busy}
            onSelect={async () => {
              setThemeId(t.id)
              const existing = decks.find((d) => d.id === activeDeckId)
              if (existing) setDecks(await saveDeck({ ...existing, themeId: t.id }))
              if (last.current) { try { await openDeck(last.current, t.id, false, images) } catch (e) { setErrMsg(errText(e)) } }
            }} />
        ))}
      </div>
    </div>

    <Button variant="primary" block icon={<IconEye />} onClick={() => last.current && openDeck(last.current, themeId, false, images)}>查看 PPT</Button>
    <div className="sl-export-row">
      <Button icon={<IconCode />} onClick={exportHtml}>导出 HTML</Button>
      <Button icon={<IconFileText />} onClick={exportPdf}>导出 PDF</Button>
    </div>

    <div className="sl-field">
      <label className="sl-label">图片</label>
      <ImagePicker images={images} onChange={setImages} disabled={busy}
        pageOf={(id) => {
          const slides = last.current?.slides ?? []
          for (let i = 0; i < slides.length; i++) {
            const s = slides[i]
            if (s.image === id) return i + 1
            if (s.cards?.some((c) => c.image === id)) return i + 1
          }
          return undefined
        }} />
    </div>

    <div className="sl-field">
      <label className="sl-label">修改</label>
      <textarea className="sl-req" rows={3} value={adjReq}
        onChange={(e) => setAdjReq(e.target.value)}
        placeholder={'用自然语言描述要改的地方，留空则从资料重新生成\n如：第3页改成饼图；第2页放 产品图、第5页换 团队照'} disabled={busy} />
    </div>
    <Button block icon={<IconRefresh />} onClick={regenerate} disabled={disabled}>重新生成</Button>
  </>
)}
```

> 删掉旧 `hasGen` 区块里重复的"查看/导出/修改/重新生成"（被上面替换）。

1j. 状态栏（`327-331`）加图片进度：

```tsx
{busy && (
  <p className="sl-hint sl-status">
    {status || '处理中…'}（已 {elapsed}s{genChars > 0 ? `，已生成 ${genChars} 字` : ''}{imgProg && imgProg.total ? `，图片 ${imgProg.done}/${imgProg.total}` : ''}）
  </p>
)}
```

1k. `openSaved`（`175-184`）载入 images 与 themeId：

```tsx
async function openSaved(d: SavedDeck) {
  if (busy) return
  setDrawerOpen(false)
  const deck: Deck = { name: d.name, slides: d.slides }
  const tid = d.themeId ?? DEFAULT_THEME_ID
  const imgs = d.images ?? []
  last.current = deck; setHasGen(true); setActiveDeckId(d.id); setAdjReq(''); setThemeId(tid); setImages(imgs)
  setStatus(''); setErrMsg('')
  try { await openDeck(deck, tid, false, imgs) } catch (e) { setErrMsg(errText(e)) }
}
```

1l. `SlidesPanel.css`：删除旧 `.sl-theme`/`.sl-theme-dot` 色点相关样式（ThemeThumb.css 已接管 `.sl-theme`），保留 `.sl-themes` 网格布局：

```css
.sl-themes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
```

- [ ] **Step 2: manifest 加 `unlimitedStorage`**

`manifest.json` `permissions` 数组（`10-18`）加一项：

```json
  "permissions": ["sidePanel", "storage", "activeTab", "identity", "scripting", "contextMenus", "commands", "unlimitedStorage"],
```

- [ ] **Step 3: typecheck + 全量 test + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: 0 错、全绿、构建成功（偶发 TLS 报错→重试）。

- [ ] **Step 4: 真机验证（按记忆 dev:ui 流程，在真实扩展里跑）**

- `npm run dev:ext`（或项目约定）装扩展 → 打开 PPT 面板。
- ① 文档含图 → 生成 → 图按上下文落到对应页（image-split/cover/cards）。
- ② 上传一张图 → "修改"写"把 <label> 放第3页右侧" → 重新生成 → 生效。
- ③ 6 主题缩略图正确显示、选中态正确；生成后点另一主题 → 即时换肤、不重跑。
- ④ 导出 HTML：图片可见、`<img alt>` 有值；导出 PDF：图片可见。
- ⑤ 老 deck（无 images/新字段）从历史打开仍正常。
- ⑥ 状态栏生成期显示"图片 k/N"。

- [ ] **Step 5: commit**

`feat(slides): wire templates/images into panel + manifest unlimitedStorage`

---

## Self-Review（写完后自检，已修正）

**Spec 覆盖**：①6 主题(T8) ②丰富版式+CSS(T3/T4) ③文档抽图(T6/T7/T9/T10) ④上传(T12/T13) ⑤NL 改图(T10 adjustDeck) ⑥可见图标(T11) ⑦即时换肤(T13) ⑧池后置可见(T13 pageOf) ⑨空池守卫(T10 prompt) ⑩并行下载+进度(T7/T13) ⑪池生命周期(T13) ⑫alt(T3 imgTag) ⑬预告图数(T13 status) ⑭撤销上次修改—spec 标"后续"，本计划不含任务（已与用户确认后续） ⑮placeholder 多图示例(T13)。✅ 全覆盖。

**占位符**：无 TBD/TODO（media.ts 的 `extra` 参数是 live-API 确认点，spec 已记，非计划占位）。

**类型一致**：`SlideImage`/`SlideCtx`/`resolveImage`/`remapMarkers`/`stripMarkers`/`serializeDocBlocks`/`harvestDocImages`/`downloadMedia`/`compressImageToDataUrl`/`computeTargetSize` 在定义任务与消费任务中签名一致；`buildSlidesHtml`/`downloadSlidesHtml`/`openDeck`/`adjustDeck`/`runMaterialsToSlides` 的新参数在各任务对齐。✅

**已知简化**：harvest 的 survivor 重编号映射在 Task 10 用 `oldToNew` Map 处理（测试覆盖单图成功场景；多图失败顺序边界由 Task 13 真机验证补强）。

---

## Execution Handoff

Plan complete and saved to `feishu-doc-ai-assistant/docs/superpowers/plans/2026-07-02-slides-templates-images.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
