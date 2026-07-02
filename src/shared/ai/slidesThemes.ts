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
    decorations: '.s-head::after{content:"";display:block;width:72px;height:3px;background:var(--accent);margin-top:24px}',
    promptHint: '商务克制风：结论先行、要点精炼、数据优先（多用 chart 与 stats、cards），配色冷静、避免装饰。',
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
      '.s-head::after{content:"";display:block;width:96px;height:4px;background:var(--accent);margin-top:28px;border-radius:2px}' +
      '.slide--title .s-sub{font-style:italic}',
    promptHint: '编辑杂志风：大留白、左对齐叙事、强章节感；少图表，多用 quote 与 section 分隔；标题用衬线。',
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
      '.slide{background:radial-gradient(1200px 760px at 82% -12%, rgba(122,162,255,.18), transparent 60%), var(--bg)}',
    promptHint: '科技暗夜风：深色底、冷色高亮；多用 chart 与 stats 呈现数字；措辞精炼冷峻。',
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
