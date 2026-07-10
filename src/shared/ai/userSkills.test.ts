import { describe, it, expect } from 'vitest'
import {
  parseSkillMarkdown,
  validateSkillMarkdown,
  paramsToJsonSchema,
  renderPromptTemplate,
  skillToTool,
  skillsToTools,
  filterSkillsForContext,
  isUserSkillTool,
  slugFromToolName,
  runUserSkill,
  formatUserSkillsBlock,
  slugConflict,
  exportUserSkills,
  USER_SKILL_PREFIX,
  type UserSkill,
} from './userSkills'
import { buildBuiltinSkills, BUILTIN_SKILL_MARKDOWNS } from './builtinSkills'

// ─── 测试夹具 ─────────────────────────────────────────────────────────────────

const SAMPLE_MD = `---
name: 文案润色
slug: polish_text
description: 以指定风格润色文案
scope: any
icon: sparkle
category: 文案
parameters:
  - name: text
    type: string
    description: 待润色的原文
    required: true
  - name: style
    type: string
    description: 润色风格
    enum: ["正式", "简洁"]
    default: 正式
---

# 文案润色

风格：{{style}}
原文：{{text}}`

function makeSkill(overrides: Partial<UserSkill> = {}): UserSkill {
  const { meta, body } = parseSkillMarkdown(SAMPLE_MD)
  return {
    id: 'test-1',
    ...meta,
    rawMarkdown: SAMPLE_MD,
    bodyMarkdown: body,
    enabled: true,
    builtIn: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

// ─── frontmatter 解析 ────────────────────────────────────────────────────────

describe('parseSkillMarkdown', () => {
  it('解析带 frontmatter 的完整 markdown', () => {
    const { meta, body } = parseSkillMarkdown(SAMPLE_MD)
    expect(meta.name).toBe('文案润色')
    expect(meta.slug).toBe('polish_text')
    expect(meta.description).toBe('以指定风格润色文案')
    expect(meta.scope).toBe('any')
    expect(meta.icon).toBe('sparkle')
    expect(meta.category).toBe('文案')
    expect(meta.parameters).toHaveLength(2)
    expect(meta.parameters![0]).toEqual({
      name: 'text', type: 'string', description: '待润色的原文', required: true,
    })
    expect(meta.parameters![1]).toEqual({
      name: 'style', type: 'string', description: '润色风格',
      enum: ['正式', '简洁'], default: '正式',
    })
    expect(body).toContain('# 文案润色')
    expect(body).toContain('{{text}}')
  })

  it('无 frontmatter 时返回空 meta + 原文为 body', () => {
    const md = '# 只有正文\n\n没有 frontmatter'
    const { meta, body } = parseSkillMarkdown(md)
    expect(meta.name).toBe('')
    expect(meta.slug).toBe('')
    expect(body).toBe(md)
  })

  it('scope 非法值回退为 any', () => {
    const md = `---
name: 测试
slug: test
description: 测试
scope: invalid
---
正文`
    const { meta } = parseSkillMarkdown(md)
    expect(meta.scope).toBe('any')
  })

  it('scope 合法值 doc/sheet 保留', () => {
    for (const scope of ['doc', 'sheet'] as const) {
      const md = `---
name: 测试
slug: test_${scope}
description: 测试
scope: ${scope}
---
正文`
      expect(parseSkillMarkdown(md).meta.scope).toBe(scope)
    }
  })

  it('引用字符串的引号被去除', () => {
    const md = `---
name: "带引号"
slug: quoted
description: '单引号描述'
---
正文`
    const { meta } = parseSkillMarkdown(md)
    expect(meta.name).toBe('带引号')
    expect(meta.description).toBe('单引号描述')
  })
})

// ─── 校验 ────────────────────────────────────────────────────────────────────

describe('validateSkillMarkdown', () => {
  it('合法 skill 通过校验', () => {
    const r = validateSkillMarkdown(SAMPLE_MD)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('name 为空时报错', () => {
    const md = `---
name: ""
slug: test
description: 描述
---
正文`
    expect(validateSkillMarkdown(md).errors).toContain('name 不能为空')
  })

  it('slug 非法字符报错', () => {
    const md = `---
name: 测试
slug: "大写Slug"
description: 描述
---
正文`
    const r = validateSkillMarkdown(md)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('slug'))).toBe(true)
  })

  it('slug 太短报错', () => {
    const md = `---
name: 测试
slug: a
description: 描述
---
正文`
    expect(validateSkillMarkdown(md).ok).toBe(false)
  })

  it('body 为空报错', () => {
    const md = `---
name: 测试
slug: test
description: 描述
---
`
    expect(validateSkillMarkdown(md).errors).toContain('指令正文（frontmatter 之后的 Markdown）不能为空')
  })

  it('description 为空报错', () => {
    const md = `---
name: 测试
slug: test
description: ""
---
正文`
    expect(validateSkillMarkdown(md).errors).toContain('description 不能为空')
  })
})

// ─── JSON Schema 生成 ────────────────────────────────────────────────────────

describe('paramsToJsonSchema', () => {
  it('无参数返回空对象 schema', () => {
    expect(paramsToJsonSchema(undefined)).toEqual({ type: 'object', properties: {}, required: [] })
    expect(paramsToJsonSchema([])).toEqual({ type: 'object', properties: {}, required: [] })
  })

  it('正确转换参数数组', () => {
    const { meta } = parseSkillMarkdown(SAMPLE_MD)
    const schema = paramsToJsonSchema(meta.parameters)
    expect(schema.type).toBe('object')
    expect(schema.properties).toHaveProperty('text')
    expect(schema.properties).toHaveProperty('style')
    expect(schema.required).toEqual(['text'])
    expect((schema.properties as Record<string, unknown>).text).toHaveProperty('description')
  })

  it('enum 与 default 透传', () => {
    const { meta } = parseSkillMarkdown(SAMPLE_MD)
    const schema = paramsToJsonSchema(meta.parameters)
    const styleProp = (schema.properties as Record<string, { enum?: unknown[]; default?: unknown }>).style
    expect(styleProp.enum).toEqual(['正式', '简洁'])
    expect(styleProp.default).toBe('正式')
  })
})

// ─── 模板渲染 ────────────────────────────────────────────────────────────────

describe('renderPromptTemplate', () => {
  it('替换已有参数', () => {
    const out = renderPromptTemplate('风格：{{style}}，文本：{{text}}', { style: '正式', text: '你好' })
    expect(out).toBe('风格：正式，文本：你好')
  })

  it('未提供的参数保留原占位符', () => {
    const out = renderPromptTemplate('风格：{{style}}', {})
    expect(out).toBe('风格：{{style}}')
  })

  it('支持数字参数', () => {
    const out = renderPromptTemplate('数量：{{count}}', { count: 5 })
    expect(out).toBe('数量：5')
  })

  it('支持布尔参数', () => {
    const out = renderPromptTemplate('启用：{{on}}', { on: true })
    expect(out).toBe('启用：true')
  })

  it('无占位符的模板原样返回', () => {
    expect(renderPromptTemplate('无占位符', { a: 1 })).toBe('无占位符')
  })
})

// ─── ChatCompletionTool 生成 ─────────────────────────────────────────────────

describe('skillToTool', () => {
  it('生成带 skill__ 前缀的工具名', () => {
    const tool = skillToTool(makeSkill())
    expect(tool.type).toBe('function')
    expect(tool.function.name).toBe(`${USER_SKILL_PREFIX}polish_text`)
    expect(tool.function.description).toBe('以指定风格润色文案')
  })

  it('parameters 来自 paramsToJsonSchema', () => {
    const tool = skillToTool(makeSkill())
    expect((tool.function.parameters as Record<string, unknown>).type).toBe('object')
  })
})

describe('skillsToTools', () => {
  it('批量转换', () => {
    const tools = skillsToTools([makeSkill(), makeSkill({ slug: 'other', id: 'test-2' })])
    expect(tools).toHaveLength(2)
    expect(tools[0].function.name).toBe('skill__polish_text')
    expect(tools[1].function.name).toBe('skill__other')
  })
})

// ─── 上下文筛选 ──────────────────────────────────────────────────────────────

describe('filterSkillsForContext', () => {
  it('过滤掉禁用的技能', () => {
    const skills = [makeSkill({ enabled: true }), makeSkill({ id: '2', slug: 'b', enabled: false })]
    expect(filterSkillsForContext(skills, 'doc')).toHaveLength(1)
  })

  it('scope=any 的技能在所有页面可用', () => {
    const skills = [makeSkill({ scope: 'any' })]
    expect(filterSkillsForContext(skills, 'doc')).toHaveLength(1)
    expect(filterSkillsForContext(skills, 'sheet')).toHaveLength(1)
    expect(filterSkillsForContext(skills, undefined)).toHaveLength(1)
  })

  it('scope=doc 只在文档页可用', () => {
    const skills = [makeSkill({ scope: 'doc' })]
    expect(filterSkillsForContext(skills, 'doc')).toHaveLength(1)
    expect(filterSkillsForContext(skills, 'sheet')).toHaveLength(0)
  })

  it('scope=sheet 只在表格页可用', () => {
    const skills = [makeSkill({ scope: 'sheet' })]
    expect(filterSkillsForContext(skills, 'sheet')).toHaveLength(1)
    expect(filterSkillsForContext(skills, 'doc')).toHaveLength(0)
  })

  it('kind=base 时 sheet/doc scope 都不匹配', () => {
    const skills = [makeSkill({ scope: 'sheet' }), makeSkill({ id: '2', slug: 'b', scope: 'doc' })]
    expect(filterSkillsForContext(skills, 'base')).toHaveLength(0)
  })
})

// ─── 工具名判断 ──────────────────────────────────────────────────────────────

describe('isUserSkillTool / slugFromToolName', () => {
  it('识别 skill__ 前缀', () => {
    expect(isUserSkillTool('skill__polish_text')).toBe(true)
    expect(isUserSkillTool('create_table')).toBe(false)
  })

  it('提取 slug', () => {
    expect(slugFromToolName('skill__polish_text')).toBe('polish_text')
    expect(slugFromToolName('create_table')).toBe('create_table')
  })
})

// ─── 执行 ────────────────────────────────────────────────────────────────────

describe('runUserSkill', () => {
  it('渲染模板并返回指令', () => {
    const skills = [makeSkill()]
    const result = runUserSkill('skill__polish_text', { style: '正式', text: '你好' }, skills)
    expect(result.status).toBe('ok')
    expect(result.skill).toBe('文案润色')
    expect(result.instruction).toContain('风格：正式')
    expect(result.instruction).toContain('原文：你好')
  })

  it('找不到技能时抛错', () => {
    expect(() => runUserSkill('skill__nonexistent', {}, [])).toThrow('未找到技能')
  })
})

// ─── system prompt 注入 ──────────────────────────────────────────────────────

describe('formatUserSkillsBlock', () => {
  it('无启用技能返回空串', () => {
    expect(formatUserSkillsBlock([])).toBe('')
    expect(formatUserSkillsBlock([makeSkill({ enabled: false })])).toBe('')
  })

  it('生成包含工具名与描述的说明块', () => {
    const block = formatUserSkillsBlock([makeSkill()])
    expect(block).toContain('## 用户自定义技能')
    expect(block).toContain('skill__polish_text')
    expect(block).toContain('以指定风格润色文案')
  })

  it('scope 提示正确', () => {
    const block = formatUserSkillsBlock([makeSkill({ scope: 'doc' })])
    expect(block).toContain('仅文档页')
    const block2 = formatUserSkillsBlock([makeSkill({ scope: 'sheet' })])
    expect(block2).toContain('仅表格页')
  })
})

// ─── slug 冲突 ───────────────────────────────────────────────────────────────

describe('slugConflict', () => {
  it('检测冲突', () => {
    const existing = [makeSkill()]
    expect(slugConflict('polish_text', existing)).toBe(true)
    expect(slugConflict('other_slug', existing)).toBe(false)
  })

  it('排除自身 id', () => {
    const existing = [makeSkill({ id: 'self' })]
    expect(slugConflict('polish_text', existing, 'self')).toBe(false)
  })
})

// ─── 导出 ────────────────────────────────────────────────────────────────────

describe('exportUserSkills', () => {
  it('生成合法 JSON', () => {
    const json = exportUserSkills([makeSkill()])
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(1)
    expect(parsed.skills).toHaveLength(1)
    expect(parsed.skills[0].rawMarkdown).toBe(SAMPLE_MD)
  })
})

// ─── 内置技能 ────────────────────────────────────────────────────────────────

describe('buildBuiltinSkills', () => {
  it('生成 3 个内置技能', () => {
    const skills = buildBuiltinSkills()
    expect(skills).toHaveLength(3)
    expect(skills.every((s) => s.builtIn === true)).toBe(true)
    expect(skills.every((s) => s.enabled === true)).toBe(true)
  })

  it('每个内置 skill 都能通过校验', () => {
    for (const md of BUILTIN_SKILL_MARKDOWNS) {
      const r = validateSkillMarkdown(md)
      expect(r.ok, r.errors.join('; ')).toBe(true)
    }
  })

  it('内置 slug 唯一', () => {
    const skills = buildBuiltinSkills()
    const slugs = skills.map((s) => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('内置 skill 的参数正确解析', () => {
    const skills = buildBuiltinSkills()
    const polish = skills.find((s) => s.slug === 'polish_text')!
    expect(polish.parameters).toHaveLength(2)
    expect(polish.parameters![0].name).toBe('text')
    expect(polish.parameters![0].required).toBe(true)
  })
})
