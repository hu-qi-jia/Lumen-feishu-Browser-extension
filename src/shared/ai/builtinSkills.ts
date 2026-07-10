/**
 * 内置示例技能——首次进入技能库时写入存储，帮助用户理解 skill 格式与用法。
 * builtIn 标记为 true：可编辑、可禁用，但不可删除。可「复制为我的技能」后自由改。
 */
import type { UserSkill } from './userSkills'
import { parseSkillMarkdown } from './userSkills'

/** 内置 skill 的原始 Markdown 内容。 */
export const BUILTIN_SKILL_MARKDOWNS: string[] = [
  // 1. 文案润色（通用）
  `---
name: 文案润色
slug: polish_text
description: 以指定风格润色文案，保持原意不变，使表达更专业流畅
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
    enum: ["正式", "简洁", "学术", "活泼"]
    default: 正式
---

# 文案润色

你是一位资深文字编辑。请按以下要求润色文案：

## 要求
- 风格：{{style}}
- 保持原意不变，不增删关键信息
- 用词准确，逻辑清晰，表达流畅
- 修正语病、错别字、标点错误

## 原文
{{text}}

## 输出
直接输出润色后的文案，不要附加解释说明。`,

  // 2. 表格智能填充（表格场景）
  `---
name: 智能填充列
slug: fill_column_smart
description: 根据已有数据规律，推断并填充指定列的空缺值
scope: sheet
icon: chart
category: 表格
parameters:
  - name: column
    type: string
    description: 需要填充的列名
    required: true
  - name: rule
    type: string
    description: 填充规则说明（如"按上下文推断""按日期递增"等）
    required: true
---

# 智能填充列

请按以下要求帮用户填充表格数据：

## 任务
- 目标列：{{column}}
- 填充规则：{{rule}}

## 步骤
1. 先用 list_records 或 read_range 读取当前数据，理解列的含义与已有规律
2. 根据规则推断空缺值
3. 用 batch_update_records 或 write_range 写回（写入前向用户确认）

## 注意
- 无法确定推断时，停下来问用户而不是瞎填
- 涉及日期/编号类递增，务必先看现有值的规律再续填`,

  // 3. 会议纪要整理（文档场景）
  `---
name: 会议纪要整理
slug: meeting_notes
description: 将文档中的会议记录整理为结构化纪要（议题、决议、待办）
scope: doc
icon: report
category: 文档
parameters:
  - name: focus
    type: string
    description: 整理重点（如"决议与待办""讨论过程"等），默认全面整理
    default: 全面整理
---

# 会议纪要整理

请把当前文档中的会议记录整理为结构化纪要。

## 整理重点
{{focus}}

## 步骤
1. 用 get_document_content 读取整篇文档
2. 提取以下结构化信息：
   - 会议议题
   - 讨论要点
   - 形成的决议
   - 待办事项（含负责人、截止时间）
3. 用 add_document_content 在文档末尾追加「## 纪要」段落，写入整理结果
4. 告知用户已整理完成

## 输出格式
纪要应简洁清晰，待办事项用列表呈现，便于后续追踪。`,
]

/** 把内置 markdown 构造为 UserSkill[]（builtIn=true）。调用方负责写入存储。 */
export function buildBuiltinSkills(): UserSkill[] {
  const now = Date.now()
  return BUILTIN_SKILL_MARKDOWNS.map((md, idx) => {
    const { meta, body } = parseSkillMarkdown(md)
    return {
      id: `builtin_${idx}_${meta.slug}`,
      ...meta,
      rawMarkdown: md,
      bodyMarkdown: body,
      enabled: true,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    } as UserSkill
  })
}
