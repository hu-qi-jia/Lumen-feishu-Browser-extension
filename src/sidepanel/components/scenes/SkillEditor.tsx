import { useMemo, useRef, useState } from 'react'
import Markdown from '../chat/Markdown'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import SegmentedTabs from '../ui/SegmentedTabs'
import Tooltip from '../ui/Tooltip'
import { IconHelpCircle, IconFilePlus } from '../ui/icons'
import { validateSkillMarkdown, slugConflict, type UserSkill } from '@/shared/ai/userSkills'
import './SkillEditor.css'

const TAB_OPTIONS = [
  { value: 'edit', label: '编辑' },
  { value: 'preview', label: '预览' },
] as const

interface Props {
  initialMarkdown: string
  /** 现有技能列表，用于 slug 冲突检查。 */
  existing: UserSkill[]
  /** 编辑现有技能时传其 id（排除自身做冲突检查）；新建时不传。 */
  selfId?: string
  onSave: (markdown: string) => void
  onClose: () => void
}

/** frontmatter 格式模板——点「插入模板」时追加到编辑器。 */
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
  { field: 'name', desc: '技能显示名', required: true },
  { field: 'slug', desc: '工具标识，仅小写字母/数字/下划线，2-40 字符', required: true },
  { field: 'description', desc: '一句话描述，模型据此判断是否调用该技能', required: true },
  { field: 'scope', desc: 'any | doc | sheet —— 限定技能在哪种页面可用', required: false },
  { field: 'icon', desc: '图标名：sparkle / chart / report / file / book', required: false },
  { field: 'category', desc: '分类名，用于技能库分组展示', required: false },
  { field: 'parameters', desc: '参数列表，每项含 name/type/description/required/enum/default', required: false },
  { field: '{{param}}', desc: '正文中用双花括号引用参数值，运行时被替换', required: false },
]

/**
 * Skill 的 Markdown 编辑器：tab 切换编辑/预览，带 frontmatter 校验。
 */
export default function SkillEditor({ initialMarkdown, existing, selfId, onSave, onClose }: Props) {
  const [md, setMd] = useState(initialMarkdown)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
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
    setTab('edit')
    requestAnimationFrame(() => taRef.current?.focus())
  }

  return (
    <div className="sl-body sk-editor">
      <div className="sk-editor-head">
        <SegmentedTabs
          options={TAB_OPTIONS.slice()}
          value={tab}
          onChange={(v) => setTab(v as 'edit' | 'preview')}
        />
        <div className="sk-editor-tools">
          <Tooltip content={showHelp ? '收起说明' : '格式说明'} position="bottom">
            <IconButton active={showHelp} onClick={() => setShowHelp((v) => !v)} aria-label={showHelp ? '收起说明' : '格式说明'}>
              <IconHelpCircle />
            </IconButton>
          </Tooltip>
          <Tooltip content="插入模板" position="bottom">
            <IconButton onClick={insertTemplate} aria-label="插入模板">
              <IconFilePlus />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {showHelp && (
        <div className="sk-editor-help">
          <p className="sk-editor-help-title">Skill 格式参考</p>
          <p className="sk-editor-help-sub">由 YAML frontmatter + Markdown 指令正文组成，保存后 Agent 即可按需调用。</p>
          <dl className="sk-editor-help-list">
            {FIELD_DOCS.map((item) => (
              <div key={item.field} className="sk-editor-help-item">
                <dt className="sk-editor-help-field">
                  <code>{item.field}</code>
                  {item.required && <span className="sk-editor-help-req">必填</span>}
                </dt>
                <dd className="sk-editor-help-desc">{item.desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {tab === 'edit' ? (
        <div className="sk-editor-field">
          <label className="sl-label">Markdown 源码</label>
          <textarea
            ref={taRef}
            className="sk-editor-textarea"
            value={md}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder="在此编写 Skill 的 Markdown（frontmatter + 指令正文）…"
            autoFocus
          />
        </div>
      ) : (
        <div className="sk-editor-field">
          <label className="sl-label">指令预览</label>
          <div className="sk-editor-preview">
            {validation.body.trim() ? <Markdown>{validation.body}</Markdown> : (
              <span className="sk-editor-preview-empty">frontmatter 之后的指令正文会在这里渲染</span>
            )}
          </div>
        </div>
      )}

      {validation.errors.length > 0 && (
        <ul className="sk-editor-errors">
          {validation.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      <div className="sk-editor-actions">
        <Button variant="secondary" block onClick={onClose}>取消</Button>
        <Tooltip content={canSave ? '保存（Ctrl+S）' : '请先修复上方的校验问题'} position="top">
          <Button variant="primary" block disabled={!canSave} onClick={() => onSave(md)}>
            保存
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
