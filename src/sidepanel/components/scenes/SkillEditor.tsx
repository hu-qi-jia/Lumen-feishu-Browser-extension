import { useMemo, useRef, useState } from 'react'
import Markdown from '../chat/Markdown'
import Button from '../ui/Button'
import Tooltip from '../ui/Tooltip'
import { validateSkillMarkdown, slugConflict, type UserSkill } from '@/shared/ai/userSkills'
import './SkillEditor.css'

interface Props {
  initialMarkdown: string
  /** 现有技能列表，用于 slug 冲突检查。 */
  existing: UserSkill[]
  /** 编辑现有技能时传其 id（排除自身做冲突检查）；新建时不传。 */
  selfId?: string
  onSave: (markdown: string) => void
  onClose: () => void
}

/** frontmatter 格式模板——点「插入模板」时追加到编辑器（仅在内容为空或末尾无 frontmatter 时）。 */
const TEMPLATE = `---
name: 技能名称
slug: my_skill
description: 一句话说明这个技能做什么
scope: any
icon: sparkle
category: 自定义
parameters:
  - name: text
    type: string
    description: 输入文本
    required: true
---

# 技能名称

在这里写指令正文。用 \`{{text}}\` 引用上方 parameters 里定义的参数。
模型会拿到渲染后的指令，再据此调用飞书工具完成任务。`

/** 简单的 frontmatter 字段说明，折叠展示。 */
const FIELD_DOCS = [
  ['name', '技能显示名（必填）'],
  ['slug', '工具标识，仅小写字母/数字/下划线，2-40 字符（必填）'],
  ['description', '一句话描述，模型据此判断是否调用该技能（必填）'],
  ['scope', 'any | doc | sheet —— 限定技能在哪种页面可用'],
  ['icon', '图标名：sparkle / chart / report / file / book（可选）'],
  ['category', '分类名，用于列表分组（可选）'],
  ['parameters', '参数列表，每项含 name/type/description/required/enum/default'],
  ['{{param}}', '正文中用双花括号引用参数值，运行时被替换'],
]

/**
 * Skill 的 Markdown 编辑器：左编辑 + 右实时预览，带 frontmatter 校验与 tab 支持。
 * 作为 SideDrawer 的 body 使用——drawer 提供标题与关闭按钮，本组件只管编辑内容。
 */
export default function SkillEditor({ initialMarkdown, existing, selfId, onSave, onClose }: Props) {
  const [md, setMd] = useState(initialMarkdown)
  const [showHelp, setShowHelp] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 实时校验：parse + 规则 + slug 冲突
  const validation = useMemo(() => {
    const v = validateSkillMarkdown(md)
    const conflicts: string[] = []
    if (v.ok && v.meta.slug && slugConflict(v.meta.slug, existing, selfId)) {
      conflicts.push(`slug「${v.meta.slug}」已被其他技能占用，请换一个`)
    }
    return { ...v, errors: [...v.errors, ...conflicts] }
  }, [md, existing, selfId])

  const canSave = validation.ok && validation.errors.length === 0

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setMd(e.target.value)
  }

  // Tab 键插入两个空格而非切焦点——写 frontmatter/缩进 parameters 时必需。
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = md.slice(0, start) + '  ' + md.slice(end)
      setMd(next)
      // 恢复光标位置（在下一帧，等 React 更新完）
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
    // Cmd/Ctrl+S 保存
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canSave) onSave(md)
    }
  }

  function insertTemplate() {
    if (!md.trim()) {
      setMd(TEMPLATE)
    } else {
      setMd(md + (md.endsWith('\n') ? '' : '\n') + TEMPLATE)
    }
    requestAnimationFrame(() => taRef.current?.focus())
  }

  return (
    <div className="skill-editor">
      <div className="skill-editor-toolbar">
        <button
          type="button"
          className="skill-editor-help-btn"
          onClick={() => setShowHelp((v) => !v)}
          aria-expanded={showHelp}
        >
          {showHelp ? '收起格式说明' : '格式说明'}
        </button>
        <button type="button" className="skill-editor-help-btn" onClick={insertTemplate}>
          插入模板
        </button>
      </div>

      {showHelp && (
        <div className="skill-editor-docs">
          <p className="skill-editor-docs-title">Skill 由 frontmatter + 指令正文组成：</p>
          <ul className="skill-editor-docs-list">
            {FIELD_DOCS.map(([k, d]) => (
              <li key={k}><code>{k}</code> — {d}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="skill-editor-split">
        <div className="skill-editor-pane">
          <div className="skill-editor-pane-label">编辑</div>
          <textarea
            ref={taRef}
            className="skill-editor-textarea"
            value={md}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder="在此编写 Skill 的 Markdown（frontmatter + 指令正文）…"
            autoFocus
          />
        </div>
        <div className="skill-editor-pane">
          <div className="skill-editor-pane-label">预览</div>
          <div className="skill-editor-preview">
            {validation.body.trim() ? <Markdown>{validation.body}</Markdown> : (
              <span className="skill-editor-preview-empty">指令正文预览区</span>
            )}
          </div>
        </div>
      </div>

      {validation.errors.length > 0 && (
        <ul className="skill-editor-errors">
          {validation.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      <div className="skill-editor-actions">
        <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
        <Tooltip content={canSave ? '保存（Ctrl+S）' : '请先修复上方的校验问题'} position="top">
          <Button variant="primary" size="sm" disabled={!canSave} onClick={() => onSave(md)}>
            保存
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
