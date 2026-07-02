/**
 * Slide themes — the visual skin of a generated deck. A theme is a small typed token object
 * (palette + type scale + padding + fonts) serialized to CSS custom properties that the shared
 * `SLIDES_CSS` consumes, plus an optional `decorations` CSS snippet and a `promptHint` that steers
 * the LLM's content/layout tone for that look.
 *
 * This is our equivalent of open-slide's per-slide `DesignSystem` + theme markdown, adapted to our
 * data-gen model (the LLM fills a JSON layout enum; rendering is one CSS). One layout code, N skins.
 *
 `themeVars()` → `--bg;--fg;...` string injected onto `:root` (viewer) or baked into a `<style>`
 * (exported HTML) AFTER `SLIDES_CSS` so it overrides the fallback `:root` block.
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
  /** Extra CSS appended after `SLIDES_CSS` (accent rules, background textures, …). */
  decorations?: string
  /** Appended to the generation prompt to steer content tone for this look. */
  promptHint?: string
}

const SYS_SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
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
    decorations:
      '.s-head::after{content:"";display:block;width:64px;height:3px;background:var(--accent);margin-top:20px}' +
      '.s-card{border-top:3px solid var(--accent);border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.04)}' +
      '.s-bullets li::before{border-radius:2px}' +
      '.s-photo,.s-split-img,.s-card-img{border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.06)}',
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
    decorations:
      '.s-head{font-weight:900;line-height:1.15}' +
      '.s-head::after{content:"";display:block;width:88px;height:4px;background:var(--accent);margin-top:28px;border-radius:2px}' +
      '.slide--quote .s-quote{font-size:1.1em;line-height:1.45;padding-left:52px;border-left:4px solid var(--accent)}' +
      '.slide--title .s-sub,.slide--section .s-sub{font-style:italic}' +
      '.s-eyebrow{font-style:italic;letter-spacing:.18em;font-family:Georgia,"Source Han Serif SC",serif}' +
      '.s-card{box-shadow:none;border-radius:2px;border-bottom:2px solid var(--accent);background:transparent}' +
      '.s-card-title{font-family:Georgia,"Source Han Serif SC",serif}' +
      '.s-photo,.s-split-img{border-radius:2px;box-shadow:none}' +
      '.s-card-img{border-radius:2px 2px 0 0;box-shadow:none}',
    promptHint:
      '编辑杂志风。版式规则：section 章节分隔≥2页，quote≥2页（引言+收尾），two-col≥1页，bullets 叙事≤3条/页。' +
      '不用 chart/stats/cards——以文字叙事为主，图片作插图点缀。' +
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
    decorations:
      '.slide{background:radial-gradient(1000px 600px at 80% -8%,rgba(122,162,255,.12),transparent 55%),var(--bg)}' +
      '.s-head::after{content:"";display:block;width:64px;height:2px;background:linear-gradient(90deg,var(--accent),transparent 80%);margin-top:20px}' +
      '.s-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px}' +
      '.s-bullets li::before{box-shadow:0 0 12px rgba(122,162,255,.3)}' +
      '.s-stat .s-num{text-shadow:0 0 40px rgba(122,162,255,.25)}' +
      '.s-photo,.s-split-img,.s-card-img{border-radius:10px;box-shadow:0 0 24px rgba(122,162,255,.08)}',
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
    decorations:
      '.s-head{font-weight:400;letter-spacing:-.01em;border-bottom:1px solid var(--fg);padding-bottom:18px}' +
      '.s-head::after{display:none}' +
      '.s-eyebrow{letter-spacing:.4em;font-weight:400}' +
      '.s-bullets li::before{border-radius:0;width:6px;height:6px;background:var(--fg);top:26px}' +
      '.s-card{border-radius:0;box-shadow:none;border:1px solid var(--border);background:transparent}' +
      '.s-photo,.s-split-img,.s-card-img{border-radius:0;box-shadow:none}' +
      '.s-stat .s-num{font-weight:300}',
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
    decorations:
      '.s-head,.s-title{background:linear-gradient(135deg,var(--accent),#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent}' +
      '.s-card{border:none;background:linear-gradient(135deg,var(--card),#fdf2f8);border-radius:16px;box-shadow:0 4px 24px rgba(124,58,237,.08)}' +
      '.s-stat .s-num,.s-card-num{background:linear-gradient(135deg,var(--accent),#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent}' +
      '.s-bullets li::before{background:var(--accent);border-radius:3px;box-shadow:0 0 6px rgba(124,58,237,.25)}' +
      '.s-photo,.s-split-img,.s-card-img{border-radius:14px;box-shadow:0 4px 20px rgba(124,58,237,.1)}',
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
    decorations:
      '.slide{background:radial-gradient(800px 500px at 60% 110%,rgba(251,191,36,.08),transparent 50%),var(--bg)}' +
      '.s-stat .s-num{font-size:1.35em;font-weight:900;color:var(--accent);text-shadow:0 0 32px rgba(251,191,36,.2)}' +
      '.s-head::after{content:"";display:block;width:96px;height:5px;background:var(--accent);margin-top:20px}' +
      '.s-card{border:1px solid var(--border);border-left:4px solid var(--accent);background:rgba(255,255,255,.02);border-radius:2px}' +
      '.s-card-num{color:var(--accent);font-weight:900}' +
      '.s-photo,.s-split-img,.s-card-img{border-radius:4px;box-shadow:0 2px 16px rgba(0,0,0,.4)}',
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
