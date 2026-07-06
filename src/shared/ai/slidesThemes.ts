/**
 * Slide themes — the visual skin of a generated deck. A theme is a small typed token object
 * (palette + type scale + padding + fonts) serialized to CSS custom properties that the shared
 * `SLIDES_CSS` consumes, plus a `css` block (a FULL per-theme stylesheet) and a `promptHint` that
 * steers the LLM's content/layout tone for that look.
 *
 * One layout code (slideLayouts.ts → fixed `.s-*` HTML contract), N *templates*: each theme's
 * `css` overrides the shared `SLIDES_CSS` baseline comprehensively — not just accent colors but
 * structure (grid columns, alignment, decorative rules/rails/numerals, card treatments) — so two
 * themes read as genuinely different decks, not the same deck recolored. The baseline stays as a
 * safe fallback so an incomplete theme still renders sanely.
 *
 * `themeVars()` → `--bg;--fg;...` string injected onto `:root` (viewer) or baked into a `<style>`
 * (exported HTML) AFTER `SLIDES_CSS` so it overrides the fallback `:root` block; `theme.css` is
 * appended after that so it wins over the baseline element rules.
 */

export interface SlideThemePalette {
  bg: string
  fg: string
  accent: string
  muted: string
  card: string
  border: string
}

export interface SlideTheme {
  id: string
  name: string
  mode: 'light' | 'dark'
  palette: SlideThemePalette
  /** Absolute px on the 1920×1080 design canvas. */
  typeScale: { hero: number; heading: number; body: number; caption: number }
  /** Canvas inner padding, px. */
  padding: number
  fontDisplay?: string
  fontBody?: string
  /** Full per-theme stylesheet, appended after `SLIDES_CSS` + themeVars so it overrides the
   *  baseline. Covers every layout's elements + backgrounds + structural decoration. */
  css?: string
  /** Appended to the generation prompt to steer content tone + layout mix for this look. */
  promptHint?: string
}

const SYS_SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const SERIF = 'Georgia, "Source Han Serif SC", "Songti SC", "Noto Serif CJK SC", serif'

export const BUILT_IN_THEMES: SlideTheme[] = [
  {
    id: 'business',
    name: '商务',
    mode: 'light',
    palette: { bg: '#ffffff', fg: '#1f2329', accent: '#3370ff', muted: '#646a73', card: '#f5f6f8', border: '#dee0e3' },
    typeScale: { hero: 104, heading: 58, body: 34, caption: 24 },
    padding: 120,
    fontBody: SYS_SANS,
    css:
      // 结构化商务：内容页左侧 accent 竖条锚点（居中页不加）+ 标题下短杠 + 顶边 accent 卡片 + 柔阴影图框
      '.slide:not(.slide--title):not(.slide--section):not(.slide--quote):not(.slide--cover){border-left:8px solid var(--accent);padding-left:calc(var(--pad) - 8px)}' +
      '.s-head{font-weight:800;letter-spacing:-.01em}' +
      '.s-head::after{content:"";display:block;width:72px;height:5px;background:var(--accent);margin-top:24px;border-radius:2px}' +
      '.s-title{font-weight:800;letter-spacing:-.02em}' +
      '.s-eyebrow{font-weight:700}' +
      '.s-section-num{color:var(--accent);font-weight:800}' +
      '.s-two{gap:80px;position:relative}' +
      '.s-two::before{content:"";position:absolute;left:50%;top:8%;bottom:8%;width:1px;background:var(--border);transform:translateX(-50%)}' +
      '.s-cards{grid-template-columns:repeat(3,1fr);gap:36px}' +
      '.s-card{border-top:5px solid var(--accent);border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.06);background:var(--card);padding:34px 30px}' +
      '.s-card-title{font-weight:800}' +
      '.s-card-num{font-weight:800}' +
      '.s-stats{gap:56px}' +
      '.s-stat .s-num{font-weight:800}' +
      '.s-bullets li{padding:16px 0 16px 44px}' +
      '.s-bullets li::before{border-radius:3px;width:12px;height:12px;top:24px}' +
      '.s-chart{border:1px solid var(--border);border-radius:10px;background:var(--card);padding:16px}' +
      '.s-photo,.s-split-img,.s-card-img{border-radius:8px;box-shadow:0 3px 14px rgba(0,0,0,.08)}' +
      '.s-footer{font-weight:600}',
    promptHint:
      '商务风格。版式规则：连续2页不得同一layout，整份≥5种不同版式。' +
      '数据页优先 chart+stats（约35%），对比用 two-col（约20%），cards 卡片展示维度（约15%），bullets 叙事，quote 收尾。' +
      '标题≤15字，要点≤5条·≤28字。封面 title+subtitle，最后一页给结论。',
  },
  {
    id: 'editorial',
    name: '编辑',
    mode: 'light',
    palette: { bg: '#f7f4ee', fg: '#20242b', accent: '#b6532c', muted: '#7c766c', card: '#efeae0', border: '#e2dccf' },
    typeScale: { hero: 132, heading: 64, body: 38, caption: 26 },
    padding: 140,
    fontDisplay: SERIF,
    fontBody: SYS_SANS,
    css:
      // 杂志专栏：衬线大标题 + 首字下沉 + 巨号章节编号 + 引文左竖线 + 仅底边线卡片 + 充裕留白 + 双栏细分隔
      '.s-title,.s-head{font-family:var(--font-display);font-weight:900;line-height:1.1;letter-spacing:-.01em}' +
      '.s-head::after{content:"";display:block;width:96px;height:4px;background:var(--accent);margin-top:30px}' +
      '.s-eyebrow{font-style:italic;letter-spacing:.22em;font-family:var(--font-display);color:var(--accent)}' +
      '.s-section-num{font-family:var(--font-display);font-size:1.6em;letter-spacing:.12em;color:var(--accent);font-weight:900}' +
      '.s-bullets li{padding:18px 0 18px 0;border-bottom:1px solid var(--border);line-height:1.5}' +
      '.s-bullets li:last-child{border-bottom:none}' +
      '.s-bullets li:first-child::first-letter{font-family:var(--font-display);font-size:1.9em;font-weight:900;float:left;line-height:.86;margin:8px 14px 0 0;color:var(--accent)}' +
      '.s-bullets li::before{display:none}' +
      '.s-two{gap:96px;position:relative}' +
      '.s-two>div:not(:last-child){position:relative}' +
      '.s-two>div:not(:last-child)::after{content:"";position:absolute;right:-48px;top:6%;bottom:6%;width:1px;background:var(--border)}' +
      '.slide--quote .s-quote{font-family:var(--font-display);font-size:1.18em;line-height:1.45;padding-left:56px;border-left:5px solid var(--accent);font-style:italic}' +
      '.slide--title .s-sub,.slide--section .s-sub{font-style:italic;font-family:var(--font-display)}' +
      '.s-cards{grid-template-columns:repeat(2,1fr);gap:48px 64px}' +
      '.s-card{box-shadow:none;border-radius:0;border-bottom:3px solid var(--accent);background:transparent;padding:0 0 28px}' +
      '.s-card-title{font-family:var(--font-display);font-weight:900;font-size:34px}' +
      '.s-card-num{font-family:var(--font-display);font-style:italic;font-size:38px}' +
      '.s-stats{gap:72px}' +
      '.s-stat .s-num{font-family:var(--font-display);font-weight:900}' +
      '.s-photo,.s-split-img{border-radius:0;box-shadow:0 1px 0 var(--border)}' +
      '.s-card-img{border-radius:0;box-shadow:none;margin-bottom:20px;height:200px}' +
      '.s-chart{border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:24px 0}',
    promptHint:
      '编辑杂志风。版式规则：section 章节分隔≥2页，quote≥2页（引言+收尾），two-col≥1页，bullets 叙事≤3条/页。' +
      '不用 chart/stats——以文字叙事为主，图片作插图点缀。' +
      '标题衬线体、正文无衬线，留白充裕。第一段引言，最后收束观点。',
  },
  {
    id: 'night',
    name: '暗夜',
    mode: 'dark',
    palette: { bg: '#0f1322', fg: '#e8ecf8', accent: '#7aa2ff', muted: '#8a93ad', card: '#161b2e', border: '#262d45' },
    typeScale: { hero: 112, heading: 60, body: 36, caption: 24 },
    padding: 120,
    fontBody: SYS_SANS,
    css:
      // 科技暗夜：径向光晕背景 + 毛玻璃半透明卡片 + 等宽标签 + 发光数字/圆点 + 半透明分隔
      '.slide{background:radial-gradient(1100px 640px at 82% -10%,rgba(122,162,255,.16),transparent 55%),radial-gradient(900px 520px at -5% 110%,rgba(122,162,255,.08),transparent 50%),var(--bg)}' +
      '.slide--title,.slide--section,.slide--quote{background:radial-gradient(900px 560px at 50% 50%,rgba(122,162,255,.12),transparent 60%),var(--bg)}' +
      '.s-title{font-weight:800;letter-spacing:-.02em}' +
      '.s-head{font-weight:700}' +
      '.s-head::after{content:"";display:block;width:80px;height:2px;background:linear-gradient(90deg,var(--accent),transparent 85%);margin-top:22px}' +
      '.s-eyebrow{font-family:' + MONO + ';letter-spacing:.24em}' +
      '.s-section-num{font-family:' + MONO + ';color:var(--accent);letter-spacing:.24em}' +
      '.s-two{gap:80px;position:relative}' +
      '.s-two::before{content:"";position:absolute;left:50%;top:6%;bottom:6%;width:1px;background:linear-gradient(180deg,transparent,rgba(122,162,255,.25),transparent);transform:translateX(-50%)}' +
      '.s-cards{grid-template-columns:repeat(3,1fr);gap:32px}' +
      '.s-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:16px;backdrop-filter:blur(6px);padding:34px 30px}' +
      '.s-card-num{font-family:' + MONO + ';color:var(--accent)}' +
      '.s-card-title{font-weight:700}' +
      '.s-stats{gap:56px}' +
      '.s-stat .s-num{font-family:' + MONO + ';text-shadow:0 0 48px rgba(122,162,255,.35)}' +
      '.s-stat .s-label{font-family:' + MONO + ';letter-spacing:.12em}' +
      '.s-bullets li::before{box-shadow:0 0 16px rgba(122,162,255,.5);border-radius:50%;width:12px;height:12px;top:24px}' +
      '.s-chart{border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.02);padding:16px}' +
      '.s-photo,.s-split-img,.s-card-img{border-radius:12px;box-shadow:0 0 32px rgba(122,162,255,.12);border:1px solid rgba(255,255,255,.07)}' +
      '.s-footer{border-top-color:rgba(255,255,255,.08);font-family:' + MONO + '}',
    promptHint:
      '科技暗夜风。版式规则：chart+stats 占40%——数据可视化为主体，用深色系图表配色。' +
      'image-split 用于架构图/流程图。bullets≤4条/页只作简注。quote 用于技术洞察收尾。不用 cards。' +
      '每页聚焦一个技术亮点，措辞精炼冷峻。',
  },
  {
    id: 'minimal',
    name: '极简',
    mode: 'light',
    palette: { bg: '#ffffff', fg: '#111111', accent: '#111111', muted: '#888888', card: '#fafafa', border: '#e8e8e8' },
    typeScale: { hero: 120, heading: 60, body: 32, caption: 22 },
    padding: 128,
    fontBody: SYS_SANS,
    css:
      // 瑞士极简：顶部细线 + 01/02 编号要点 + 超细字重 + 巨留白 + 仅细线边框 + 双栏细线分隔
      '.slide{border-top:1px solid var(--fg)}' +
      '.slide--title,.slide--section,.slide--quote,.slide--cover{border-top:none}' +
      '.s-title{font-weight:200;letter-spacing:-.03em}' +
      '.s-head{font-weight:300;letter-spacing:-.01em;border-bottom:1px solid var(--border);padding-bottom:22px}' +
      '.s-head::after{display:none}' +
      '.s-eyebrow{letter-spacing:.5em;font-weight:400;color:var(--muted);text-transform:uppercase}' +
      '.s-section-num{font-weight:200;letter-spacing:.4em;color:var(--muted)}' +
      '.s-bullets{counter-reset:minbul}' +
      '.s-bullets li{counter-increment:minbul;padding:20px 0 20px 80px;border-bottom:1px solid var(--border)}' +
      '.s-bullets li:last-child{border-bottom:none}' +
      '.s-bullets li::before{content:counter(minbul,decimal-leading-zero);position:absolute;left:0;top:22px;width:auto;height:auto;border-radius:0;background:none;color:var(--muted);font-size:var(--caption-size);font-weight:300;letter-spacing:.1em}' +
      '.s-two{gap:0;position:relative}' +
      '.s-two>div{padding:0 48px}' +
      '.s-two>div:first-child{padding-left:0}' +
      '.s-two>div:last-child{padding-right:0}' +
      '.s-two>div:not(:last-child)::after{content:"";position:absolute;right:0;top:6%;bottom:6%;width:1px;background:var(--border)}' +
      '.s-cards{grid-template-columns:repeat(2,1fr);gap:48px;border:none}' +
      '.s-card{border-radius:0;box-shadow:none;border:1px solid var(--border);background:transparent;padding:36px 32px}' +
      '.s-card-title{font-weight:400}' +
      '.s-card-num{font-weight:200}' +
      '.s-stats{gap:64px}' +
      '.s-stat .s-num{font-weight:200;letter-spacing:-.03em}' +
      '.s-stat .s-label{letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}' +
      '.s-quote{font-weight:200;letter-spacing:-.02em}' +
      '.s-chart{border:none;padding:0}' +
      '.s-photo,.s-split-img,.s-card-img{border-radius:0;box-shadow:none}' +
      '.s-footer{border-top:none;padding-top:0;font-weight:300;letter-spacing:.3em;text-transform:uppercase}',
    promptHint:
      '瑞士极简风。版式规则：bullets 为主（单列要点≤5条/页），two-col 用于对比（各≤3条），quote 用于点睛。' +
      '不用 chart/stats/cards/image-split——纯粹文字排版。封面标题≤10字无副标题。' +
      '每页只承载一个核心观点，让留白说话。',
  },
  {
    id: 'vibrant',
    name: '活力',
    mode: 'light',
    palette: { bg: '#ffffff', fg: '#1a1a2e', accent: '#7c3aed', muted: '#6b7280', card: '#f5f3ff', border: '#ede9fe' },
    typeScale: { hero: 116, heading: 60, body: 34, caption: 24 },
    padding: 120,
    fontBody: SYS_SANS,
    css:
      // 活力品牌：渐变标题/数字 + 2 列 bento 卡（带顶图）+ 渐变圆点 + 大圆角 + 渐变分隔
      '.s-head,.s-title{background:linear-gradient(135deg,var(--accent),#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800;letter-spacing:-.02em}' +
      '.s-head::after{content:"";display:block;width:80px;height:5px;background:linear-gradient(90deg,var(--accent),#ec4899);margin-top:22px;border-radius:3px}' +
      '.s-eyebrow{background:linear-gradient(135deg,var(--accent),#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700}' +
      '.s-section-num{background:linear-gradient(135deg,var(--accent),#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:900}' +
      '.s-two{gap:56px;position:relative}' +
      '.s-two::before{content:"";position:absolute;left:50%;top:10%;bottom:10%;width:2px;background:linear-gradient(180deg,transparent,var(--accent),transparent);transform:translateX(-50%);border-radius:2px}' +
      '.s-cards{grid-template-columns:repeat(2,1fr);gap:32px}' +
      '.s-card{border:none;background:linear-gradient(135deg,var(--card),#fdf2f8);border-radius:20px;box-shadow:0 8px 30px rgba(124,58,237,.12);padding:36px 32px;overflow:hidden}' +
      '.s-card-img{margin:-36px -32px 24px;height:200px;border-radius:0}' +
      '.s-card-num{background:linear-gradient(135deg,var(--accent),#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:900;margin-top:0}' +
      '.s-card-title{font-weight:800}' +
      '.s-stats{gap:48px}' +
      '.s-stat .s-num{background:linear-gradient(135deg,var(--accent),#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:900}' +
      '.s-bullets li::before{background:linear-gradient(135deg,var(--accent),#ec4899);border-radius:5px;box-shadow:0 0 10px rgba(124,58,237,.28);width:13px;height:13px;top:24px}' +
      '.s-chart{border-radius:18px;background:linear-gradient(135deg,var(--card),#fdf2f8);padding:18px}' +
      '.s-photo,.s-split-img{border-radius:18px;box-shadow:0 8px 28px rgba(124,58,237,.14)}' +
      '.s-footer{border-top:none;font-weight:600}',
    promptHint:
      '活力品牌风。版式规则：cards 占30%（产品/特性卡片尽量带 image），image-split 占20%+，stats 占15%，cover 开场+bullets 叙事。' +
      '多用 image 字段配图（cards 和 image-split 都填 image）。标题可用惊叹句式有感染力。收尾用 quote 喊口号。',
  },
  {
    id: 'pitch',
    name: '路演',
    mode: 'dark',
    palette: { bg: '#0a0a0a', fg: '#f5f5f5', accent: '#fbbf24', muted: '#9ca3af', card: '#171717', border: '#262626' },
    typeScale: { hero: 140, heading: 64, body: 34, caption: 24 },
    padding: 120,
    fontBody: SYS_SANS,
    css:
      // 融资路演：暗底暖光晕 + 居中巨号数字 + 高对比 + accent 左边线卡片 + 极简文字
      '.slide{background:radial-gradient(1000px 620px at 60% 112%,rgba(251,191,36,.12),transparent 50%),var(--bg)}' +
      '.slide--title,.slide--section,.slide--quote{background:radial-gradient(900px 560px at 50% 50%,rgba(251,191,36,.08),transparent 60%),var(--bg)}' +
      '.s-title{font-weight:900;letter-spacing:-.03em}' +
      '.s-head{font-weight:900;letter-spacing:-.02em}' +
      '.s-head::after{content:"";display:block;width:96px;height:5px;background:var(--accent);margin-top:24px}' +
      '.s-section-num{color:var(--accent);font-weight:900;letter-spacing:.28em}' +
      '.s-stats{flex-direction:column;align-items:center;justify-content:center;gap:72px}' +
      '.s-stat{flex-direction:column;align-items:center;justify-content:center;text-align:center}' +
      '.s-stat .s-num{font-size:calc(var(--hero-size)*1.6);font-weight:900;color:var(--accent);text-shadow:0 0 44px rgba(251,191,36,.32);line-height:1}' +
      '.s-stat .s-label{font-size:var(--body-size);color:var(--fg);margin-top:26px;letter-spacing:.04em}' +
      '.s-cards{grid-template-columns:repeat(2,1fr);gap:36px}' +
      '.s-card{border:1px solid var(--border);border-left:5px solid var(--accent);background:rgba(255,255,255,.025);border-radius:4px;padding:32px 30px}' +
      '.s-card-num{color:var(--accent);font-weight:900}' +
      '.s-card-title{font-weight:800}' +
      '.s-bullets li::before{background:var(--accent);border-radius:0;width:9px;height:9px;top:26px}' +
      '.s-two{gap:80px}' +
      '.s-chart{border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,.02);padding:16px}' +
      '.s-photo,.s-split-img,.s-card-img{border-radius:4px;box-shadow:0 4px 22px rgba(0,0,0,.5)}' +
      '.s-footer{border-top-color:var(--border);font-weight:600}',
    promptHint:
      '融资路演风。版式规则：stats 占30%（每页一个巨号数字+一行说明），cover 开场冲击力强，bullets≤3条/页，cards 用于团队/优势。' +
      '不用 chart——数据用 stats 大数字呈现。标题≤12字极具冲击力。最后 quote 收尾给行动号召。',
  },
]

export const DEFAULT_THEME_ID = 'business'

export function getTheme(id?: string): SlideTheme {
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? BUILT_IN_THEMES[0]
}

/**
 * CSS custom-property declarations for a theme (`--bg:#…;--accent:#…;…`).
 * Inject as `:root{ <this> }` AFTER `SLIDES_CSS` so theme tokens win over the fallback `:root`.
 */
export function themeVars(t: SlideTheme): string {
  const p = t.palette
  return [
    `--bg:${p.bg}`,
    `--fg:${p.fg}`,
    `--accent:${p.accent}`,
    `--muted:${p.muted}`,
    `--card:${p.card}`,
    `--border:${p.border}`,
    `--pad:${t.padding}px`,
    `--hero-size:${t.typeScale.hero}px`,
    `--heading-size:${t.typeScale.heading}px`,
    `--body-size:${t.typeScale.body}px`,
    `--caption-size:${t.typeScale.caption}px`,
    `--font-display:${t.fontDisplay ?? SYS_SANS}`,
    `--font-body:${t.fontBody ?? SYS_SANS}`,
  ].join(';')
}
