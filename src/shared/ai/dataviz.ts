import type { AppSettings } from '../types'
import { NO_REMOTE_CODE } from '../config'
import type { VizField } from '../dataviz/types'
import type { VizSpec } from '../dataviz/spec'
import { validateSpec, referencedFields } from '../dataviz/spec'
import { chatCompleteStream } from './llm'
import { stripFences as fences } from './text'
import { sanitizeForLlm } from './redact'

/** Declarative-spec prompt (no-remote-code build): the model emits a VizSpec (DATA), which the
 *  bundled interpreter renders — no JS is generated or executed. */
function buildSpecPrompt(schema: VizField[], sampleRows: Record<string, string>[], request: string): string {
  return (
    `你是"数据看板生成器"。根据【字段】【样本数据】【需求】，输出一个 JSON：{"title":"简短标题","spec":<规格>}。\n` +
    `spec 是**声明式规格(不是代码)**，按需求选一种 kind：\n` +
    `· 单图：{"kind":"chart","title":"","chartType":"bar|line|pie|scatter","series":{"dimension":"分组字段","measure":{"op":"count|sum|avg|min|max|countDistinct","field":"数值字段(count 可省)"},"sort":"value-desc","limit":20},"axis":{"rotateLabels":true,"scale":true}}\n` +
    `· 看板(多指标/多图/可筛选)：{"kind":"dashboard","filters":["字段"…],"kpis":[{"label":"标签","value":{"op":"sum","field":"金额"}}…],"charts":[{"title":"","chartType":"pie","series":{"dimension":"字段","measure":{"op":"count"}}}…],"table":{"columns":[{"key":"真实字段","editable":false}],"pageSize":20}}\n` +
    `· 纯明细表：{"kind":"table","columns":[{"key":"真实字段","label":""}],"pageSize":20,"search":true,"actions":[{"label":"建任务","template":"跟进 {字段} 的 {字段}"}]}\n` +
    `【规则】dimension/field/filters/columns.key 只用【字段】里**真实存在**的字段名；聚合 op 只用 count/countDistinct/sum/avg/min/max；图表类型只用 bar/line/pie/scatter；不编造数据。可选 measure.where 过滤：[{"field":"","op":"eq|ne|gt|gte|lt|lte|contains|in","value":""}]。\n` +
    `只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n` +
    `\n【字段】${fieldList(schema)}\n\n【样本数据（前 ${sampleRows.length} 行）】\n${sanitizeForLlm(JSON.stringify(sampleRows))}\n\n【需求】${request}`
  )
}

/** Spec edit (minimal change): hand the model the current spec JSON + a change request. */
function buildSpecEditPrompt(previousSpec: VizSpec, request: string, schema: VizField[]): string {
  return (
    `下面是一个数据看板的**当前规格(JSON)**。请按【修改要求】做**最小改动**，其余原样保留。\n` +
    `只用【字段】里真实存在的字段名；保持 kind 与整体结构；只输出 {"title":"标题","spec":<修改后的完整规格>}，无解释/围栏。\n` +
    `【字段】${fieldList(schema)}\n【当前规格】${JSON.stringify(previousSpec)}\n【修改要求】${request}`
  )
}

/** Parse {title, spec} from model output → validated VizSpec. `warning` flags field names the
 *  model referenced that don't exist in the real table (their widgets will render empty). */
function parseSpec(out: string, schema: VizField[]): { name: string; spec: VizSpec; warning?: string } {
  let parsed: { title?: string; name?: string; spec?: unknown }
  try { parsed = JSON.parse(out) } catch { throw new Error('模型输出不是有效 JSON，无法解析可视化规格。请重试或换一个支持 JSON 输出的模型。') }
  const spec = validateSpec(parsed.spec, schema.map((f) => f.name))
  const known = new Set(schema.map((f) => f.name))
  const unknown = referencedFields(spec).filter((f) => !known.has(f))
  const warning = unknown.length
    ? `这些字段名没匹配到表里的列：${unknown.join('、')}（相关图表/指标可能显示为空）。可点重试或换种描述。`
    : undefined
  return { name: (parsed.title || parsed.name || '可视化').slice(0, 40), spec, warning }
}

/**
 * One-shot codegen: given a table schema + a small sample of rows + a natural-language
 * request, ask the LLM for a render-function body that builds an ECharts chart. The code is
 * the SAVED artifact; data is injected live at render time. Same client/guard as vision.ts —
 * no new egress. The code runs only inside the locked sandbox (connect-src 'none').
 */

/** Defense-in-depth on top of the sandbox CSP: reject obvious network/import calls. */
export function hasForbiddenCalls(code: string): boolean {
  return /\b(fetch|XMLHttpRequest|importScripts|WebSocket|EventSource|sendBeacon|localStorage|indexedDB)\b/.test(code)
    || /\bimport\s|\brequire\s*\(/.test(code)
}

/** Model-facing field list: 名（类型）｜样本: a, b, c — the real sample values let the model
 *  see actual formats (date layout, currency style with ¥/$, option labels) instead of guessing. */
function fieldList(schema: VizField[]): string {
  return schema.map((f) => `${f.name}（${f.type}）${f.samples?.length ? `｜样本: ${f.samples.join(', ')}` : ''}`).join('\n')
}

function buildPrompt(schema: VizField[], sampleRows: Record<string, string>[], request: string): string {
  const schemaText = fieldList(schema)
  return (
    `你是一个"AI 小程序生成器"。根据【字段】【样本数据】和【需求】，生成一个嵌在飞书页面浮窗里的自包含小程序。\n` +
    `输出一个 JSON 对象：{"title": "简短标题", "code": "..."}。code 是构建界面的 JS（可以是直接写语句的"函数体"，` +
    `也可以是完整的 function render(data, echarts, container, theme){...} 或箭头函数，都行），运行时可用：\n` +
    `  - data：完整数据数组（每项一行对象，键=字段名，值是字符串，数字用 Number() 转）。\n` +
    `  - echarts：ECharts 模块。  - container：根 DOM 容器（已撑满浮窗，宽高 100%，可随意 appendChild/设样式）。\n` +
    `  - theme：'light' 或 'dark'。\n` +
    `【先按需求判断要做哪一类，然后实现】：\n` +
    `  • 图表看板 → 用 echarts（见下方"图表规则"）。\n` +
    `  • 交互工具/计算器/模拟器 → 在 container 里建输入控件，读 data 实时计算并展示（可用 echarts 出图）。\n` +
    `  • 报表/打印视图 → 排一份适合打印的 DOM（标题/小计/表格）；放一个"打印/导出PDF"按钮，onclick=()=>window.print()。\n` +
    `  • 自定义视图 → 卡片墙 / 看板 / 时间线 / 甘特 等纯 DOM+SVG 视图。\n` +
    `（注：演示幻灯片 PPT 有专门的「AI 幻灯片」功能，这里不做 PPT。）\n` +
    `【图表规则（做图表时遵守）】：默认只画一个最能回答需求的图；要多图(看板)时**绝不一个实例叠多坐标系**，` +
    `照骨架：container.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px;height:100%;overflow:auto';` +
    `function cell(){var d=document.createElement('div');d.style.minHeight='240px';container.appendChild(d);return echarts.init(d,theme);}` +
    `var c=cell();c.setOption({...})；类目轴标签多时 axisLabel:{interval:0,rotate:35~45} 防重叠、grid.bottom 留足；` +
    `数值都远大于0时数值轴 {scale:true} 避免从0留空白；图表类型只用 bar/line/pie/scatter；不在图里再放大标题（浮窗已有标题栏）。\n` +
    `【数据绑定（最重要）】：图表的 series 数据、KPI 数值、表格行**必须在运行时用代码对 data 数组实时计算**` +
    `（分组/求和/计数/过滤都写成对 data 的运算），**绝对禁止把算好的数值/类目写死进 setOption 或 DOM**——` +
    `样本数据只是给你看结构，真实数据在运行时通过 data 注入；一旦写死，用户改了飞书表格、重新打开小程序就不会更新（变成死数据）。` +
    `例：对 data 按某字段分组求和得到 {类目, 值} 数组，再 setOption；不要直接写 data:[42000,5000,…]。\n` +
    `【通用硬规则】：不要设 backgroundColor（透明）；只用真实存在的字段名、不编造数据；` +
    `**禁止 fetch / XMLHttpRequest / WebSocket / import / require / localStorage 等任何网络与 IO**；` +
    `只输出那个 JSON 对象本身，不要任何解释、前言或代码围栏。\n` +
    `\n【字段】${schemaText}\n\n【样本数据（前 ${sampleRows.length} 行）】\n${sanitizeForLlm(JSON.stringify(sampleRows))}\n\n【需求】${request}`
  )
}

/**
 * Edit prompt: hand the model the CURRENT code and one change request, and require a
 * minimal diff. This is what makes "调整" safe for multi-chart dashboards — regenerating
 * from scratch would restyle/reshuffle the charts the user didn't mention; editing the
 * existing code keeps them byte-identical.
 */
function buildEditPrompt(previousCode: string, request: string, schema: VizField[]): string {
  const schemaText = fieldList(schema)
  return (
    `下面是一个嵌在飞书页面浮窗里的"AI 小程序"的**当前完整代码**。请按【修改要求】对它做**最小改动**。\n` +
    `【最重要的规则】只改用户明确提到的那一处（某一个图表 / 某个控件 / 某段文案）；\n` +
    `其它图表、布局、配色、变量名**必须逐字保留、原样不动**——不要顺手重排、不要重命名、不要"优化"没被提到的部分。\n` +
    `运行时仍可用：data（完整数据数组）、echarts、container、theme、feishu（含义与原代码一致）。\n` +
    `若是多图看板：每个图各自 echarts.init 一个容器，改其中一个时绝不能动其它图的代码。\n` +
    `【字段】${schemaText}\n` +
    `【当前代码】\n${previousCode}\n` +
    `【修改要求】${request}\n` +
    `【输出】严格只输出一个 JSON 对象：{"title":"标题","code":"修改后的完整代码"}；保持原有取数方式与真实字段名；` +
    `**禁止 fetch / XMLHttpRequest / WebSocket / import / require / localStorage** 等任何网络与 IO；不要任何解释、前言或代码围栏。`
  )
}

export async function generateViz(
  settings: AppSettings,
  input: {
    schema: VizField[]; sampleRows: Record<string, string>[]; request: string
    previousCode?: string; previousSpec?: VizSpec
    signal?: AbortSignal; onProgress?: (chars: number) => void
  },
): Promise<{ name: string; code?: string; spec?: VizSpec; warning?: string }> {
  const content = NO_REMOTE_CODE
    ? (input.previousSpec ? buildSpecEditPrompt(input.previousSpec, input.request, input.schema) : buildSpecPrompt(input.schema, input.sampleRows, input.request))
    : (input.previousCode ? buildEditPrompt(input.previousCode, input.request, input.schema) : buildPrompt(input.schema, input.sampleRows, input.request))
  // Stream so the panel shows live progress ("已生成 N 字") + a working cancel — a 小程序 codegen
  // can take many seconds and a frozen spinner reads as "hung".
  const out = fences(await chatCompleteStream(settings, content, { signal: input.signal, onChunk: (f) => input.onProgress?.(f.length) }))
  if (!out) throw new Error('模型未返回内容。')
  if (NO_REMOTE_CODE) return parseSpec(out, input.schema)
  let parsed: { title?: string; name?: string; code?: string }
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error('模型输出不是有效 JSON，无法解析可视化代码。请重试或换一个支持 JSON 输出的模型。')
  }
  const code = (parsed.code ?? '').trim()
  if (!code) throw new Error('模型没有生成可视化代码。')
  if (hasForbiddenCalls(code)) throw new Error('生成的代码包含被禁止的网络 / 导入调用，已拒绝。')
  return { name: (parsed.title || parsed.name || '可视化').slice(0, 40), code }
}
