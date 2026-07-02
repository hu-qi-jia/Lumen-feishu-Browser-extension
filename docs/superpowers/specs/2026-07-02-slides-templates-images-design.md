# PPT 生成增强：多模板 + 装饰版式 + 图片

- 日期：2026-07-02
- 状态：设计待评审
- 参考项目：`E:\个人项目\open-slide`（仅作视觉/版式灵感，**不**采用其"每页任意 React"的架构）

## 1. 目标

1. **多模板、可见、可选**——把当前 3 个主题扩到 6 个；选择器从"色点"升级为高级预览图，用户一眼看出每种风格长什么样。
2. **HTML 遵循模板、提高美观**——在"一套共享版式 + N 套皮肤"的现有架构上，把版式词汇大幅丰富（眉题、页脚、卡片网格、图文分栏、编号列表、强调线、全幅封面、浅底数字块），让生成页接近 open-slide 的质感。
3. **图片**——支持①从源文档抽取图片、按"在文档中的位置 + 上下文"自动摆放；②用户上传图片并用自然语言指挥 agent 放到指定页/位置。
4. **自然语言改 PPT**——已有 `adjustDeck`，扩展为也理解图片摆放指令。
5. **工程严谨**——纯逻辑/Feishu API/UI/资产分层清晰；可复用组件抽离；纯函数补单测；不破坏现有安全边界。

## 2. 非目标

- 不做 AI 识图（vision）——图片摆放只靠文档位置 + 上下文 + 用户指令。
- 不做"每个模板自带独立版式集"——所有模板共享同一套版式词汇，模板只是皮肤（沿用代码库已选定的 "One layout code, N skins"）。
- 不引入每页任意 JSX/HTML 的生成模型（open-slide 那套是 agent 逐页写代码，不适合本扩展"从数据一次生成"的场景）。
- 不做图片的云图床/AI 生图/Unsplash 实时搜图——运行时图片只来自源文档或用户上传。

## 3. 现状（改动基线）

- `src/shared/ai/slides.ts`：`Slide` 布局枚举 `title/section/bullets/two-col/quote/stats/chart/embed`；`runMaterialsToSlides`（多链接→一套 deck）、`adjustDeck`（一句话改整套）、`sanitizeSlides`。
- `src/shared/ai/slidesThemes.ts`：3 个主题 `business/editorial/night`；`themeVars()` → CSS 变量；每个主题带 `decorations` CSS 片段与 `promptHint`。
- `src/shared/ai/slidesExport.ts`：`slideInnerHtml(s)`（switch 出每页 inner HTML）+ `SLIDES_CSS`（共用样式，token 驱动）；`buildSlidesHtml` 生成自包含 HTML（图表走 CDN）；被 `src/viewer/deckViewer.ts` 复用。
- `src/shared/ai/slidesSources.ts`：`fetchMaterial` 对 doc 走 `getDocumentContent`（`/raw_content`，纯文本，**丢图**）。
- `src/shared/ai/slidesStore.ts`：`SavedDeck` 存 `chrome.storage.local`（key `slides_decks_v1`），存盘后 `scheduleBackup('slides', …)` 镜像到可选云备份。
- `src/sidepanel/components/SlidesPanel.tsx`：主题选择器是色点按钮；已有"修改"框 → `adjustDeck`。
- `src/shared/attachments.ts`：`compressImage(file)`（内部）、`fileToAttachment`（含压缩：长边 1280、≤1MB、JPEG/PNG 智能选择）。
- `src/shared/feishu/http.ts`：`feishuFetch` 返回原始 `Response` 且已过出站守卫 `isFeishuOutboundAllowed`；`feishuReq` 假定 JSON 信封。
- `manifest.json`：`permissions: […, "storage", …]`，无 `unlimitedStorage`；CSP `img-src 'self' data: https:`。

## 4. 架构与数据模型

### 4.1 Slide schema（`slides.ts`，全部新增字段可选 → 老 deck 无损加载）

```ts
interface Slide {
  layout?: 'title'|'section'|'bullets'|'two-col'|'quote'|'stats'|'chart'|'embed'
         | 'cover' | 'cards' | 'image-split'        // 新增 3 个版式
  // 现有字段不变（title/subtitle/bullets/bullets2/quote/by/stats/chart/code/spec）
  eyebrow?: string                                   // 新：标题上方小标
  cards?: Array<{ title?: string; body?: string; num?: string; image?: string }>  // 新：cards 网格
  image?: string                                     // 新：图片池 id
  imageSide?: 'left' | 'right'                       // 新：image-split 图在哪侧（默认 right）
  imageCaption?: string                              // 新：图下说明（可选）
}
```

页脚**不交给模型填**：渲染器知道 deck 名 + 页码，自动渲染 `《deckName》· i+1 / n`。

### 4.2 图片池（挂在 deck 上，slides 里只存 id）

```ts
// slidesImages.ts
interface SlideImage {
  id: string                 // 'doc-1' | 'upload-<slug>'
  source: 'doc' | 'upload'
  label: string              // 文档图：'文档图1'；上传图：用户可改的名称（默认文件名）
  dataUrl: string            // 压缩后 base64（长边 ~1024px、JPEG ~0.8、约 256–384KB）
  context?: string           // doc 图：'位于"第三章 产品介绍"之后'（喂给模型的位置/上下文）
}

// slidesStore.ts
interface SavedDeck {
  /* 现有字段不变 */
  images?: SlideImage[]      // 可选 → 老 deck 无图也能加载；无需升 _v2
}
```

### 4.3 渲染上下文（自动页脚用）

```ts
// slideLayouts.ts
interface SlideCtx { deckName: string; index: number; total: number; images: SlideImage[] }
```

`slideInnerHtml` 签名：`(s: Slide, ctx?: SlideCtx) => string`。无 ctx（如老调用/单测）时不渲染页脚，向后兼容。

## 5. 模板系统

### 5.1 主题（`slidesThemes.ts`，6 个起步，结构允许后续加）

| id | 名 | mode | 调性 | decorations 要点 |
|---|---|---|---|---|
| business | 商务 | light | 浅底·蓝·冷静（保留）| 极简，强调克制 |
| editorial | 编辑 | light | 米底·衬线·大留白（保留）| 标题下强调线、斜体副标 |
| night | 暗夜 | dark | 深底·冷光（保留）| 右上角径向渐变高光 |
| minimal | 极简 | light | 纯白·黑·细线·瑞士网格（新）| 1px 细线分隔、无圆角、字距 |
| vibrant | 活力 | light | 浅底·渐变强调色·圆角·活泼（新）| 渐变色块、大圆角卡片、软阴影 |
| pitch | 路演 | dark | 深底·高对比·大数字（新）| 全幅强调色块、巨号数字 |

选择器按钮用 `ThemeThumb` 渲染一个**简单的风格图标**（见 5.2），无额外资产字段。

`promptHint` 现在还顺带引导**版式密度**（如 editorial 偏 image-split/quote；business 偏 cards/stats/chart；pitch 偏 stats/cover）。

### 5.2 选择器图标（`ThemeThumb`，纯 CSS/SVG）

按钮上是一个 **~48–64px 的风格化小图标**，传达该风格的视觉调性，用主题自己的调色板变量着色（换肤即换色）。每主题一个 motif：

| 主题 | 图标 motif |
|---|---|
| business | 三条中性横线 + 一段强调色短线（结构/克制）|
| editorial | 一个大号衬线字母 + 下划强调线（杂志感）|
| night | 深色圆角块 + 一颗强调色发光点（暗夜）|
| minimal | 2–3 根细发丝线 + 大留白（瑞士网格）|
| vibrant | 2–3 个圆角渐变色块（活泼）|
| pitch | 一个加粗大数字 `1`（路演大数字）|

纯 CSS/SVG、无图片资产、无联网、始终清晰、随调色板换色；按钮含名称 + 选中态 + tooltip（`promptHint`）。侧栏窄，按 2 列或 3 列网格排布。

### 5.3 版式注册表（新 `src/shared/ai/slideLayouts.ts`）

把 `slideInnerHtml` 的 switch 重构为纯函数注册表，每个版式一个独立函数，便于单测与扩展：

```ts
type LayoutFn = (s: Slide, ctx: SlideCtx) => string
const LAYOUTS: Record<string, LayoutFn> = {
  title, section, bullets, twocol, quote, stats, chart, embed,  // 从现 switch 迁出
  cover, cards, imagesplit,                                      // 新增
}
export const slideInnerHtml = (s: Slide, ctx?: SlideCtx) => (LAYOUTS[s.layout ?? 'bullets'] ?? bullets)(s, ctx ?? nullCtx)
```

`slidesExport.ts` 与 `deckViewer.ts` 都从 `slideLayouts.ts` 引入 `slideInnerHtml`（维持"导出 HTML"与"查看页"渲染一致）。

### 5.4 SLIDES_CSS 丰富（`slidesExport.ts`）

新增样式类：`.s-eyebrow`、`.s-footer`、`.s-cards`（响应式网格）、`.s-split`/`.s-split-img`/`.s-split-text`（图文分栏）、`.s-cover`（全幅）、`.s-bullets--numbered`、`.s-stat--soft`（浅底数字块）、图片框（圆角 + `0 8px 32px rgba(0,0,0,.08)` 阴影，类 open-slide）。所有色值继续走 CSS 变量，主题换肤不变结构。

## 6. 图片管线

### 6.1 文档抽图（`slidesImages.ts` + `slidesSources.ts` + `media.ts`）

1. `fetchMaterial` 的 doc 分支从 `getDocumentContent`（raw_content）改走 `listBlocks`。
2. 遍历 block 树重建文本（纯函数 `serializeDocBlocks(items)`）：
   - 文本块 → `text_run.content`
   - 标题 → `# / ## / ### ` 前缀
   - 项目符号 → `- `
   - 图片块（`block_type === 27`，字段 `image.token`）→ **原位插 `【图N】`**，并收集 `{ token, n, context: '前一个标题/邻近句' }`
   - 表格/嵌入表（31/30）→ 跳过（数据走表格资料路径）
   - 其它块 → 尽量取文本，取不到跳过
3. 每张图（上限 **8 张/文档**，超出忽略并标记 truncated）调 `downloadMedia(token)` → `Blob` → `compressImageToDataUrl(blob)` → `SlideImage { id:'doc-N', label:'文档图N', dataUrl, context }`。
4. 权限错/下载失败/压缩失败 → **跳过该图**（不让整篇失败）。失败的图其 `【图N】` 标记**从正文中剔除**（避免池里不存在的悬空引用）；成功的图**保留遍历时分配的序号**（可能非连续，如 `【图1】【图3】`——无害，模型仍按上下文映射）。

### 6.2 二进制下载（新 `src/shared/feishu/media.ts`）

```ts
export async function downloadMedia(token: string, userToken: string): Promise<Blob> {
  const res = await feishuFetch('GET', `/drive/v1/medias/${token}/download`, userToken)  // 已过出站守卫
  if (!res.ok) throw new Error(`图片下载失败 (${res.status})`)
  return res.blob()
}
```

- 走现有 `feishuFetch`（host 在 `open.feishu.cn` 白名单内，无新出站）。
- 若飞书该接口需要 `extra` / 指向源 doc 的参数，实现时按 live API 确认补上（在 spec 此处记 TODO）。
- **不**走 `feishuReq`（它假定 JSON 信封）。

### 6.3 压缩复用（`attachments.ts` 重构）

把现有内部 `compressImage(file: File)` 抽成导出的 `compressImageToDataUrl(blob: Blob, opts?): Promise<string>`（File 即 Blob，签名放宽），聊天附件与 slides 图片共用；slides 侧用稍激进的默认（长边 1024、JPEG 0.8）以控制 deck 体积。

### 6.4 用户上传（`SlidesPanel.tsx` + 新 `ImagePicker.tsx`）

- "补充说明"下方加 `ImagePicker`：拖拽/点击上传 → `compressImageToDataUrl` → `SlideImage { source:'upload', label:文件名(可改名) }` → 进同一个池。
- 池以 chip/缩略图呈现，可删、可改名。上限（如 12 张/套）防失控。

### 6.5 摆放逻辑（位置 + 上下文，无 vision）

- **生成**：`buildMaterialsPrompt` 喂模型两样——①带着 `【图N】` 标记的正文（位置信号）；②图片池清单（id + label + context）。prompt 指示：适合配图的页用 `cover`/`image-split`/`cards`，把图片 id 填进 `image`（或卡片 `image`）；图片说明从上下文推断，不编造。
- **修改**：`adjustDeck` 入参加 `images: SlideImage[]`，prompt 附池清单。用户写"把 **产品图** 放第 3 页右侧"，模型把目标页 `image='upload-产品图'`、`imageSide='right'`（必要时改 layout 为 image-split）。
- 模型始终只看到 **id + context/label**，绝不看 dataUrl（既省 token，也避免把图当文本喂进去）。

## 7. 生成与导出

- `buildMaterialsPrompt`（`slides.ts`）：版式枚举新增 `cover/cards/image-split` 与字段说明（eyebrow、cards[]、image、imageSide、imageCaption）；非空图片池时加"可用图片"段；带 `【图N】` 标记的正文原样进 prompt；**图片池为空时显式禁止需要图的版式（cover 背景图 / image-split），避免空白图槽**。
- `sanitizeSlides`：接受新 layout 与新字段；`cards` 截断 ≤6、每字段长度截断；`image` 必须是池里存在的 id（否则丢弃该 `image` 引用，不崩）。
- `adjustDeck`：入参 `{ slides, images, instruction, signal }`；prompt 含池清单。
- `buildSlidesHtml`（`slidesExport.ts`）：给每页构造 `ctx`（deckName + index + total + images）→ 自动页脚；`image` id 在渲染时由 `slideLayouts` 经 `ctx.images` 解析为 dataUrl 内嵌 → **导出 HTML 依然自包含**（延续现有承诺，仅图表仍走 CDN）；`<img>` 带 `alt`（取 `imageCaption` 或 label，无障碍 + PDF 可读）。
- `deckViewer.ts`：`show(i)` 时构造 `ctx` 传给 `slideInnerHtml`；图片即 `<img>`，无 hydrate。

## 8. 组件与文件结构

### 8.1 新增文件

| 路径 | 职责 | 复用性 |
|---|---|---|
| `src/shared/ai/slideLayouts.ts` | 版式注册表，每版式一个纯函数 + `slideInnerHtml` 派发 | 导出/查看页共用 |
| `src/shared/ai/slidesImages.ts` | `SlideImage` 类型、`serializeDocBlocks`、抽图编排、`resolveImage`、上传→SlideImage | 纯逻辑，可单测 |
| `src/shared/feishu/media.ts` | `downloadMedia(token)` 二进制下载 | 通用飞书能力 |
| `src/sidepanel/components/ThemeThumb.tsx`(+css) | 主题按钮：简单 CSS/SVG 风格图标 + 名 + 选中态 | 选择器用，可复用 |
| `src/sidepanel/components/ImagePicker.tsx`(+css) | 上传 + chip 缩略图 + 改名/删除 | 通用图片拾取 |

### 8.2 修改文件

| 路径 | 改动 |
|---|---|
| `src/shared/ai/slides.ts` | Slide schema 新字段/版式；`buildMaterialsPrompt` 扩；`adjustDeck` 入参加 images；`sanitizeSlides` 扩 |
| `src/shared/ai/slidesExport.ts` | `slideInnerHtml` 改为引 `slideLayouts`；`SLIDES_CSS` 丰富；`buildSlidesHtml` 传 ctx + 解析图片 id |
| `src/shared/ai/slidesThemes.ts` | 6 主题 + 更丰富 decorations；`promptHint` 含版式密度 |
| `src/shared/ai/slidesSources.ts` | doc 分支改 `listBlocks` 遍历；`Material` 增 `images?: SlideImage[]`；返回 marked text |
| `src/shared/ai/slidesStore.ts` | `SavedDeck.images?`（可选，无 _v2） |
| `src/viewer/deckViewer.ts` | 构造 ctx；渲染页脚；图片 `<img>` |
| `src/sidepanel/components/SlidesPanel.tsx` | `ThemeThumb` 网格替换色点；`ImagePicker`；把 images 池贯穿 generate/adjust/openDeck/export |
| `src/shared/attachments.ts` | 抽出导出 `compressImageToDataUrl(blob, opts?)`，`compressImage` 改为薄封装 |
| `manifest.json` | `permissions` 加 `"unlimitedStorage"` |

### 8.3 分层约定（严谨性）

- 纯逻辑/可单测 → `src/shared/ai/`、`src/shared/feishu/`、`src/shared/`。
- 通用压缩等跨域工具 → `src/shared/`（如 `attachments.ts`）。
- React UI → `src/sidepanel/components/`，组件保持 presentational（props in、回调 out）。
- 资产 → `assets/`。
- 不在 UI 组件里直写 Feishu/LLM 调用；调 `shared/ai`、`shared/feishu` 的纯函数。

## 9. 安全与边界（不破坏硬约束）

- **出站**：图片下载走 `feishuFetch`（已过 `isFeishuOutboundAllowed`，host `open.feishu.cn` 在白名单），无新出站、无新权限。
- **CSP**：图片以 `data:` 渲染，CSP `img-src 'self' data: https:` 已允许；viewer 是扩展页（`script-src 'self'`），`<img>` 无需脚本。
- **LLM 不收图**：模型只看 id + context/label，dataUrl 永不进 prompt（省 token、避误用）。
- **存储**：`unlimitedStorage` 是纯本地权限（解 10MB 上限，不发数据外出）。图片随 deck 走既有 `chrome.storage.local` + 可选 `scheduleBackup` 云备份路径，与文字 deck 一致；默认云备份关闭（`HAS_ARTIFACT_SYNC` 门控）。
- **导出 HTML 自包含**：dataUrl 内嵌，离线可开；仅图表 CDN（现状不变）。
- **写操作不重试**：`robustFetch` 只重试 GET（下载是 GET，安全）。

## 10. 测试与验收（遵 CLAUDE.md 硬循环）

- `npm run typecheck` 0 错；`npm test` 全绿（现有 ~460 + 新增）；`npm run build` 成功。
- 新增单测：
  - `slideLayouts.test.ts`：每个新版式产出含期望类名的 HTML；`image` id 经 ctx 解析为 dataUrl；无 ctx 时不渲染页脚。
  - `slidesImages.test.ts`：`serializeDocBlocks` 把图片块转为 `【图N】` 且 context 取邻近标题；`resolveImage` 命中/未命中；超 8 张截断。
  - `slides.test.ts`（更新）：`sanitizeSlides` 接受 cover/cards/image-split 与新字段、`image` 引用不存在时剔除；`adjustDeck`/`runMaterialsToSlides` 的 prompt 含图片池与 markers（快照或包含断言）。
  - `attachments.test.ts`（更新）：`compressImageToDataUrl(blob)` 输出 dataUrl 且长边 ≤1024。
- 真机验证（按记忆 dev:ui 流程，在真实扩展里验）：①文档含图→生成→图按上下文落在对应页；②上传图→"修改"里指派页/侧→生效；③6 主题预览图正确显示、缺图降级；④导出 HTML 图片可见、PDF 导出图片可见；⑤老 deck（无 images/新字段）仍能打开。

## 11. 风险与回退

- **飞书 download 接口契约**：`/drive/v1/medias/{token}/download` 对 docx 图片块 token 的确切参数（是否需 `extra`/doc 指向）需 live 确认；若失败率 high → 文档抽图降级为"仅保留 `【图N】` 文本标记、不放图"，上传路径不受影响。
- **block→文本质量**：`raw_content` 是飞书优化过的纯文本；自写 `serializeDocBlocks` 质量可能略差。对策：只做"足够好"的序列（文本/标题/列表/图标记），复杂块取文本兜底；必要时对单个 doc 同时取 raw_content 做文本、listBlocks 只为定位图——但优先单次 listBlocks。
- **deck 体积**：8 张图 × ~350KB ≈ 2.8MB/套；`unlimitedStorage` 解配额，云备份（若开）会变大——可接受（用户自有代理）。

## 12. 体验优化（已采纳的 PM/UX 点）

1. **生成后一键换主题（不重跑模型）**：主题是渲染时应用的纯皮肤。生成后结果卡显示当前主题（`ThemeThumb` 图标 + 名），点选即换 → 用新 themeId 重开查看页、同步更新 saved deck。`SlidesPanel.tsx`：把主题选择器在 `hasGen` 后也显示（绑当前 deck），换肤只走 `openDeck(deck, newThemeId)` + `saveDeck({...existing, themeId})`，不调 LLM。
2. **图片池生成后可见**：生成后把 `images` 以缩略图列出（label + 当前所在页），可删、可用人话 label 写"修改"。`ImagePicker` 组件生成前后复用；"在哪页"由遍历 slides 的 `image`/`cards[].image` 反查得出。
3. **池为空时禁止需要图的版式**：见 §7 prompt 守卫。
4. **文档图片并行下载 + 进度**：`slidesImages.ts` 用并发上限 4 的 `Promise.all` 下载；`SlidesPanel` 状态栏显示"下载文档图片 k/N…"（复用现有 status/onProgress 机制）。
5. **池生命周期正确性**：上传图在"重新生成（无修改）"时作为输入再次使用（不丢）；`newDraft` 清空 deck 与池。`SlidesPanel.tsx` 状态管理把 `images` 与 `slides` 同等对待。
6. **导出 `<img>` 带 alt**：见 §7（取 imageCaption 或 label）。
7. **解析链接后预告图片数**：`resolveSource`/`fetchMaterial` 顺带 count 文档图片块，chip 上显示"含 N 张图"（轻量预扫；失败静默，不阻塞）。
8. **（后续）撤销上次"修改"**：`adjustDeck` 前把旧 slides 存一份到 saved deck 的 `prevSlides?`，给"撤销上次修改"入口。本期标记为后续增强，不阻塞主流程。
9. **"修改"框 placeholder 示例**：含多图多页示例，如"第2页放 产品图、第5页换 团队照"。纯文案。
