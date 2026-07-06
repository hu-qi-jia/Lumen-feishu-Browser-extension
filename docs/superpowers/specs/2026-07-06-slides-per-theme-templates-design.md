# PPT 每主题模板化 + 全图捕获 + 提速 — 设计稿

- 日期: 2026-07-06
- 分支: feishu-ok
- 状态: 已确认（用户：「按照你的方案执行吧」→ 范式①：LLM 出内容 + 每主题自带模板）

## 背景 / 问题

6 个主题共用**一套渲染器**：`slideLayouts.ts` 产出固定 HTML 契约（`.slide--<layout>` / `.s-*` 类），`SLIDES_CSS` 是唯一样式表；每个主题仅靠薄薄的 `decorations` 改几个强调色/字体 → **不同主题结构雷同**（相同网格、相同间距、相同对齐，只是换色）。模板风格按钮 `ThemeThumb` 对所有主题画**同一个线框**再换色，不像真正的 PPT 模板缩略图。文档图片上限 30 张，且 `placeDocImages` 会丢弃无文本匹配的图。生成速度受单次 LLM 调用主导。

## 目标（用户 4 点）

1. 不同主题 = 不同**结构 + 样式**（不只是颜色）。
2. 模板风格按钮 = 该主题的**真实视觉预览**（像 PPT 模板缩略图）。
3. 捕获并**插入文档全部图片**（不再丢弃）。
4. 提速。

## 方案：范式①（LLM 出内容 + 每主题自带模板）

保留「1 次 LLM 调用 → JSON 布局枚举」的内容模型（可靠、可编辑、一次调用、无幻觉风险），把**视觉 + 结构差异化全部下沉到「每主题完整样式表」**。HTML 契约不变 → 一份 `Slide[]` 通用于所有主题，`sanitizeSlides` / `adjustDeck` / 提示词不膨胀。

### 点 1：每主题完整样式表（结构差异化）

- `slidesThemes.ts`：`decorations?: string` → **`css?: string`**（每主题一份覆盖全布局的样式表）。保留 `SLIDES_CSS` 作为安全结构基线（不删，填空），主题 `css` 全面覆盖每个元素 + 背景 + 装饰伪元素 + **版式网格差异**（cards 列数、stats 对齐、分隔线/竖条/大编号等结构性元素），把"换色"升级为"换构图"。
- `slidesExport.ts` `buildSlidesHtml`：注入 `${SLIDES_CSS}\n:root{${themeVars}}\n${theme.css ?? ''}`，并在 `.slides-stage` 加 `data-theme="${theme.id}"`（便于主题按需作用域 + 未来切换）。
- `deckViewer.ts`：同步注入 `theme.css`（查看/导出 PDF 路径与导出 HTML 渲染一致）。
- `slideLayouts.ts`：**HTML 契约不变**（现有测试守住）；本点不动其结构。
- 6 主题设计语言（结构 + 视觉）：
  - **business 商务**：左侧 accent 竖条锚点 + 标题下 accent 短杠 + 3 列顶边 accent 卡片 + 柔阴影图框（结构化、克制）。
  - **editorial 编辑**：衬线大标题 + 首字下沉 + 大号章节编号 + 引文左竖线 + 仅底边线卡片 + 充裕留白（杂志专栏感）。
  - **night 暗夜**：径向光晕背景 + 毛玻璃半透明卡片（blur + 半透明边）+ 等宽标签 + 发光数字/圆点（科技）。
  - **minimal 极简**：顶部细线 + `01/02` 编号要点 + 超细字重 + 巨留白 + 仅细线边框（瑞士网格）。
  - **vibrant 活力**：渐变标题/数字 + **2 列 bento 卡（带顶图）** + 大圆角 + 渐变圆点（品牌）。
  - **pitch 路演**：暗底暖光晕 + **居中巨号数字** + 高对比 + accent 左边线卡片（融资路演）。
- 各主题 `promptHint` 同步收紧，驱动**不同版式配比**（business 数据混合 / editorial 文字叙事 / night 图表技术 / minimal 纯要点 / vibrant 卡片图文 / pitch 大数字），让"结构差异"既来自 CSS 也来自版式选择。

### 点 2：模板风格按钮 = 真实预览

- `ThemeThumb.tsx` / `ThemeThumb.css`：按 `theme.id`（`data-theme`）为每个主题画与其设计语言一致的 16:9 小幅构图——不再是同一个换色线框：
  - business=竖条 + 标题杠 + 三小块；editorial=衬线大标题 + 下沉首字；minimal=细线 + `01/02` 编号；vibrant=bento 渐变块；pitch=居中大数字；night=暗底 + 发光点。
- 按钮外框/名称仍用面板 token（暗色主题不污染周围）。

### 点 3：捕获并插入全部文档图片

- `slidesImages.ts`：`MAX_DOC_IMAGES` 30 → **60**（覆盖典型文档全部图片）。
- `slides.ts` `placeDocImages`：第一遍「文本匹配 → image-split」保留；**新增第二遍**——仍无引用的文档图，按 ≤6 张/页追加 `cards` 图廊页（`card.image = id`，`card.title` 取自 context），插在结尾（若末页是 quote/section 则插其前）。**保证每张文档图至少出现一次。**
- 同步更新 `slides.test.ts` 中「无匹配则不放置」用例为新语义（追加图廊页）。

### 点 4：提速

- `slidesImages.ts`：`DL_CONCURRENCY` 6 → **10**（图片并行；多图时收益明显）。
- `slides.ts` `buildMaterialsPrompt`：页数指引 8–16 → **8–12（宁少勿多，减少输出 token）**；精简 layout 参考（合并示例行）。
- 说明：单次 LLM 调用是长杆，已与图片下载并行；以上为安全杠杆。**流式增量渲染（半成品 JSON 提前出页）因可靠性风险本期不做**，留作未来选项。

## 不做（YAGNI）

- 不改输出格式（仍是独立 HTML 牌组；不引入 `pptxgenjs` / `reveal.js`）。
- 不让 LLM 直出 HTML/CSS（范式②，可靠性差，违背「AI 当润色不当引擎」）。
- 不动 `sanitizeSlides` / `adjustDeck` 的 JSON 契约。
- 不做流式增量渲染。

## 测试

- 更新 `slidesThemes.test.ts`：`decorations` → `css`（断言每主题 `css` 非空）。
- 更新 `slides.test.ts`：`placeDocImages`「无匹配」用例 → 断言追加图廊页；新增「保证全放置」「末页为 quote 时图廊插其前」用例。
- 新增 `slidesExport.test.ts`：`buildSlidesHtml` 注入 `theme.css` 且 stage 带 `data-theme`。
- 保持 `slideLayouts.test.ts` / `slidesImages.test.ts` 全绿（HTML 契约 + 下载/压缩参数不变）。

## 验证

`npm run typecheck` 0 错 → `npm test` 全绿 → `npm run build` 成功 → 真机（`dev:ui`）生成 PPT，核对：6 主题结构/视觉差异、文档图全落地、速度体感。
