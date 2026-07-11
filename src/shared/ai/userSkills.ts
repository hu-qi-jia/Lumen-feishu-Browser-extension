/**
 * 用户自定义技能（UserSkill）—— 让用户上传 Markdown 格式的技能文件，Agent 可作为工具调用。
 *
 * 形态：每个 skill 是一份「带 frontmatter 的 Markdown」，frontmatter 提供元信息（name/slug/
 * description/scope/parameters），body 是指令模板（含 {{param}} 占位符）。Agent 把每个启用的
 * skill 注册为一个 `ChatCompletionTool`（name = `skill__<slug>`）；调用时 executor 渲染模板
 * 并返回指令文本，Agent 据此用飞书工具完成任务。
 *
 * 命名约定：内部用 `UserSkill`（与社区 `Skill` 区分）；存储键 `_user_skills_v1`。
 * 安全：skill 内容只作为 tool result 文本回流给 LLM，不执行代码；受 truncateToolResult 截断。
 */
import type { ChatCompletionTool } from 'openai/resources'

// ─── 常量 ────────────────────────────────────────────────────────────────────

const KEY = '_user_skills_v1'
export const MAX_USER_SKILLS = 50
export const MAX_SKILL_BYTES = 16 * 1024 // 16KB / 个
export const USER_SKILL_PREFIX = 'skill__'

/** frontmatter 中 parameters 数组的元素类型。 */
export interface SkillParamDef {
  name: string
  type: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
  enum?: Array<string | number>
  default?: string | number | boolean
}

/** 从 frontmatter 解析出的元信息。 */
export interface SkillFrontmatter {
  name: string
  slug: string
  description: string
  scope: 'doc' | 'sheet' | 'any'
  icon?: string
  category?: string
  parameters?: SkillParamDef[]
}

/** 持久化的用户技能。 */
export interface UserSkill extends SkillFrontmatter {
  id: string
  rawMarkdown: string     // 完整 .md（含 frontmatter），编辑时直接编辑它
  bodyMarkdown: string    // 去掉 frontmatter 后的指令正文
  enabled: boolean
  builtIn: boolean
  createdAt: number
  updatedAt: number
}

/** 新建技能的输入（不含 id / 时间戳 / builtIn，由 save 时填充）。 */
export type UserSkillInput = {
  rawMarkdown: string
  enabled?: boolean
  category?: string
}

// ─── 轻量 YAML frontmatter 解析（只支持 skill 用到的子集）────────────────────

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/

/** 解析标量值：去引号、转 boolean/number。 */
function parseScalar(raw: string): unknown {
  const s = raw.trim()
  // 去掉首尾引号
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  // 行内数组 [a, b]
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((x) => parseScalar(x.trim()))
  }
  if (s === 'true') return true
  if (s === 'false') return false
  if (s !== '' && !isNaN(Number(s))) return Number(s)
  return s
}

/** 专门解析 parameters 段（块状数组，每项是多行键值对）。 */
function parseParamBlock(lines: string[], startIdx: number): { params: SkillParamDef[]; nextIdx: number } {
  const params: SkillParamDef[] = []
  let i = startIdx
  let cur: Partial<SkillParamDef> | null = null
  // 块内行：新项起点（"  - name: x"）或续行（"    type: string"）。缩进 ≥2 空格即视为块内。
  while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
    const line = lines[i]
    // 新项起点："  - name: xxx"
    const itemStart = line.match(/^\s*-\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
    if (itemStart) {
      if (cur && cur.name) params.push(cur as SkillParamDef)
      cur = {}
      assignParam(cur, itemStart[1], itemStart[2].trim())
    } else {
      // 续行："      type: string"
      const cont = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
      if (cont && cur) {
        assignParam(cur, cont[1], cont[2].trim())
      }
    }
    i++
  }
  if (cur && cur.name) params.push(cur as SkillParamDef)
  return { params, nextIdx: i }
}

function assignParam(cur: Partial<SkillParamDef>, key: string, rawVal: string): void {
  const v = parseScalar(rawVal)
  if (key === 'name') cur.name = String(v ?? '')
  else if (key === 'type') cur.type = (String(v) === 'number' ? 'number' : String(v) === 'boolean' ? 'boolean' : 'string') as SkillParamDef['type']
  else if (key === 'description') cur.description = String(v ?? '')
  else if (key === 'required') cur.required = v === true
  else if (key === 'enum') cur.enum = Array.isArray(v) ? v : undefined
  else if (key === 'default') cur.default = v as string | number | boolean
}

/** 解析完整 skill markdown。不抛错——格式不对时返回带空 meta 的对象，由 validate 报具体问题。 */
export function parseSkillMarkdown(md: string): { meta: SkillFrontmatter; body: string } {
  // 去除 BOM（外部 .md 文件常见）和前导空白/空行，避免 frontmatter 正则失配
  const cleaned = md.replace(/^\uFEFF/, '').replace(/^\s+/, '')
  const m = cleaned.match(FRONTMATTER_RE)
  if (!m) {
    return { meta: { name: '', slug: '', description: '', scope: 'any' }, body: cleaned.trim() }
  }
  const yamlText = m[1]
  const body = m[2].trim()
  const meta = parseFrontmatter(yamlText)
  return { meta, body }
}

/** 解析 frontmatter 文本为 SkillFrontmatter（含 parameters 块状数组特殊处理）。 */
function parseFrontmatter(text: string): SkillFrontmatter {
  const lines = text.split(/\r?\n/)
  const raw: Record<string, unknown> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
    if (!m) { i++; continue }
    const key = m[1]
    const val = m[2].trim()
    // parameters 走块状解析
    if (key === 'parameters' && val === '' && i + 1 < lines.length && /^\s{2,}-\s+/.test(lines[i + 1])) {
      const { params, nextIdx } = parseParamBlock(lines, i + 1)
      raw[key] = params
      i = nextIdx
      continue
    }
    // 行内数组（enum 等）
    if (val === '' && i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
      const arr: Array<unknown> = []
      i++
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        arr.push(parseScalar(lines[i].replace(/^\s*-\s+/, '').trim()))
        i++
      }
      raw[key] = arr
      continue
    }
    raw[key] = parseScalar(val)
    i++
  }
  return normalizeFrontmatter(raw)
}

function normalizeFrontmatter(raw: Record<string, unknown>): SkillFrontmatter {
  const scopeRaw = String(raw.scope ?? 'any')
  const scope: SkillFrontmatter['scope'] = scopeRaw === 'doc' || scopeRaw === 'sheet' ? scopeRaw : 'any'
  const name = String(raw.name ?? '').trim()
  let slug = String(raw.slug ?? '').trim()
  // 外部 skill 文件常无 slug 字段——从 name 自动生成（小写、非字母数字转下划线）
  if (!slug && name) {
    slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  }
  return {
    name,
    slug,
    description: String(raw.description ?? '').trim(),
    scope,
    icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : undefined,
    category: typeof raw.category === 'string' && raw.category ? raw.category : undefined,
    parameters: Array.isArray(raw.parameters) ? (raw.parameters as SkillParamDef[]) : undefined,
  }
}

// ─── 校验 ────────────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9_]{2,40}$/

export interface SkillValidationResult {
  ok: boolean
  errors: string[]
  meta: SkillFrontmatter
  body: string
}

/** 校验 skill markdown，返回错误列表（空 = 通过）。 */
export function validateSkillMarkdown(md: string): SkillValidationResult {
  const errors: string[] = []
  const { meta, body } = parseSkillMarkdown(md)
  if (!meta.name.trim()) errors.push('name 不能为空')
  if (!meta.slug.trim()) errors.push('slug 不能为空')
  else if (!SLUG_RE.test(meta.slug)) errors.push(`slug 只能含小写字母/数字/下划线，2-40 字符（当前：${meta.slug}）`)
  if (!meta.description.trim()) errors.push('description 不能为空')
  if (!body.trim()) errors.push('指令正文（frontmatter 之后的 Markdown）不能为空')
  if (new Blob([md]).size > MAX_SKILL_BYTES) errors.push(`文件过大（>${MAX_SKILL_BYTES / 1024}KB）`)
  // 占位符引用检查（警告级，不阻断，但记入 errors 之外的 warnings）
  return { ok: errors.length === 0, errors, meta, body }
}

/** 检查 slug 是否与现有技能冲突（排除自己）。 */
export function slugConflict(slug: string, existing: UserSkill[], selfId?: string): boolean {
  return existing.some((s) => s.slug === slug && s.id !== selfId)
}

// ─── JSON Schema 生成 ────────────────────────────────────────────────────────

/** 把 SkillParamDef[] 转为 OpenAI function parameters 的 JSON Schema。 */
export function paramsToJsonSchema(params?: SkillParamDef[]): Record<string, unknown> {
  if (!params || !params.length) {
    return { type: 'object', properties: {}, required: [] }
  }
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const p of params) {
    const prop: Record<string, unknown> = { type: p.type, description: p.description ?? p.name }
    if (p.enum && p.enum.length) prop.enum = p.enum
    if (p.default !== undefined) prop.default = p.default
    properties[p.name] = prop
    if (p.required) required.push(p.name)
  }
  return { type: 'object', properties, required }
}

// ─── 模板渲染 ────────────────────────────────────────────────────────────────

/** 把 {{param}} 占位符替换为实际值。未提供的参数保留原占位符文本。 */
export function renderPromptTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in args ? String(args[key]) : `{{${key}}}`,
  )
}

// ─── ChatCompletionTool 生成 ─────────────────────────────────────────────────

/** 把一个 UserSkill 转为 ChatCompletionTool（name 带 skill__ 前缀）。 */
export function skillToTool(skill: UserSkill): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: `${USER_SKILL_PREFIX}${skill.slug}`,
      description: skill.description,
      parameters: paramsToJsonSchema(skill.parameters),
    },
  }
}

/** 批量转换。 */
export function skillsToTools(skills: UserSkill[]): ChatCompletionTool[] {
  return skills.map(skillToTool)
}

// ─── 上下文筛选 ──────────────────────────────────────────────────────────────

/** 按页面类型筛选启用的技能。kind: base/sheet/doc/undefined。
 *  同 slug 去重（保留第一个）——防止异常数据下两个技能生成同名工具导致 API 报错。 */
export function filterSkillsForContext(skills: UserSkill[], kind: string | undefined): UserSkill[] {
  const seen = new Set<string>()
  const out: UserSkill[] = []
  for (const s of skills) {
    if (!s.enabled) continue
    if (s.scope !== 'any' && s.scope !== kind) continue
    if (seen.has(s.slug)) continue
    seen.add(s.slug)
    out.push(s)
  }
  return out
}

/** 是否为用户技能工具名。 */
export function isUserSkillTool(name: string): boolean {
  return name.startsWith(USER_SKILL_PREFIX)
}

/** 从工具名提取 slug。 */
export function slugFromToolName(name: string): string {
  return name.startsWith(USER_SKILL_PREFIX) ? name.slice(USER_SKILL_PREFIX.length) : name
}

// ─── 执行（供 agent-executor 调用）────────────────────────────────────────────

/** 渲染并返回 skill 的指令文本。找不到时抛错。 */
export function runUserSkill(
  name: string,
  args: Record<string, unknown>,
  skills: UserSkill[],
): { status: 'ok'; skill: string; instruction: string } {
  const slug = slugFromToolName(name)
  const skill = skills.find((s) => s.slug === slug)
  if (!skill) throw new Error(`未找到技能：${slug}`)
  const instruction = renderPromptTemplate(skill.bodyMarkdown, args)
  return { status: 'ok', skill: skill.name, instruction }
}

// ─── system prompt 注入 ──────────────────────────────────────────────────────

/** 把启用技能列表渲染成 system prompt 说明块。空时返回空串。 */
export function formatUserSkillsBlock(skills: UserSkill[]): string {
  const active = skills.filter((s) => s.enabled)
  if (!active.length) return ''
  const lines = active.map((s) => {
    const scopeHint = s.scope === 'any' ? '' : `（仅${s.scope === 'doc' ? '文档' : '表格'}页）`
    return `- \`${USER_SKILL_PREFIX}${s.slug}\`：${s.description}${scopeHint}`
  })
  return '\n\n## 用户自定义技能\n你拥有以下用户自定义技能工具。当任务匹配某技能描述时，优先调用对应 `skill__` 工具获取详细指令，再据指令用飞书工具完成任务。\n' + lines.join('\n')
}

// ─── 存储 ────────────────────────────────────────────────────────────────────

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

function storageGet(): Promise<UserSkill[]> {
  return new Promise((resolve) => {
    try {
      if (!hasStorage()) { resolve([]); return }
      chrome.storage.local.get([KEY], (r) => resolve(Array.isArray(r?.[KEY]) ? (r[KEY] as UserSkill[]) : []))
    } catch { resolve([]) }
  })
}

function storageSet(list: UserSkill[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!hasStorage()) { resolve(); return }
      chrome.storage.local.set({ [KEY]: list }, () => resolve())
    } catch { resolve() }
  })
}

export const loadUserSkills = storageGet

/** 批量覆写整个技能列表（用于首次初始化写入内置技能）。 */
export async function saveAllUserSkills(list: UserSkill[]): Promise<void> {
  await storageSet(list)
}

/** 保存（新增或更新）。rawMarkdown 会被重新解析。返回保存后的列表。 */
export async function saveUserSkill(input: UserSkillInput, existing: UserSkill[], id?: string): Promise<UserSkill[]> {
  const { meta, body } = parseSkillMarkdown(input.rawMarkdown)
  const now = Date.now()
  if (id) {
    // 更新
    const list = existing.map((s) =>
      s.id === id
        ? {
            ...s,
            ...meta,
            rawMarkdown: input.rawMarkdown,
            bodyMarkdown: body,
            enabled: input.enabled ?? s.enabled,
            category: input.category ?? s.category,
            updatedAt: now,
          }
        : s,
    )
    await storageSet(list)
    return list
  }
  // 新增
  if (existing.length >= MAX_USER_SKILLS) {
    throw new Error(`技能数量已达上限（${MAX_USER_SKILLS} 个）`)
  }
  const newSkill: UserSkill = {
    id: crypto.randomUUID(),
    ...meta,
    rawMarkdown: input.rawMarkdown,
    bodyMarkdown: body,
    enabled: input.enabled ?? true,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  }
  const list = [...existing, newSkill]
  await storageSet(list)
  return list
}

/** 删除。 */
export async function deleteUserSkill(id: string, existing: UserSkill[]): Promise<UserSkill[]> {
  const target = existing.find((s) => s.id === id)
  if (!target) return existing
  const list = existing.filter((s) => s.id !== id)
  await storageSet(list)
  return list
}

/** 切换启用状态。 */
export async function toggleUserSkill(id: string, existing: UserSkill[]): Promise<UserSkill[]> {
  const list = existing.map((s) => (s.id === id ? { ...s, enabled: !s.enabled, updatedAt: Date.now() } : s))
  await storageSet(list)
  return list
}

/** 导入多个 skill（从 JSON 或 .md 文件）。冲突的 slug 自动追加后缀。返回新增数量与列表。 */
export async function importUserSkills(
  raws: Array<{ rawMarkdown: string; enabled?: boolean }>,
  existing: UserSkill[],
): Promise<{ added: number; list: UserSkill[] }> {
  let list = [...existing]
  let added = 0
  for (const raw of raws) {
    if (list.length >= MAX_USER_SKILLS) break
    const { meta, body } = parseSkillMarkdown(raw.rawMarkdown)
    if (!meta.slug || !meta.name) continue
    // slug 去重
    let slug = meta.slug
    let n = 2
    while (list.some((s) => s.slug === slug)) {
      slug = `${meta.slug}_${n++}`
      if (slug.length > 40) break
    }
    const now = Date.now()
    list.push({
      id: crypto.randomUUID(),
      ...meta,
      slug,
      rawMarkdown: raw.rawMarkdown,
      bodyMarkdown: body,
      enabled: raw.enabled ?? true,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    })
    added++
  }
  await storageSet(list)
  return { added, list }
}

/** 导出全部技能为 JSON 字符串（用于下载备份）。 */
export function exportUserSkills(skills: UserSkill[]): string {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    skills: skills.map((s) => ({ rawMarkdown: s.rawMarkdown, enabled: s.enabled })),
  }, null, 2)
}
