import { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../shell/TopBar'
import Button from '../ui/Button'
import Tooltip from '../ui/Tooltip'
import Markdown from '../chat/Markdown'
import UploadDrop from '../ui/UploadDrop'
import SkillEditor from './SkillEditor'
import {
  IconPlus, IconEdit, IconTrash, IconX, IconUpload, IconDownload, IconTools, IconCopy,
} from '../ui/icons'
import {
  loadUserSkills, saveUserSkill, saveAllUserSkills, deleteUserSkill, toggleUserSkill,
  validateSkillMarkdown, slugConflict, exportUserSkills,
  type UserSkill, type UserSkillInput,
} from '@/shared/ai/userSkills'
import { buildBuiltinSkills } from '@/shared/ai/builtinSkills'
import './SkillPanel.css'

interface Props {
  onBack: () => void
}

/** scope → 中文标签。 */
const SCOPE_LABEL: Record<string, string> = {
  any: '通用',
  doc: '文档',
  sheet: '表格',
}

/** skill.icon 字段 → 图标组件。未知/缺省用 IconTools。 */
function SkillIcon({ name }: { name?: string }) {
  switch (name) {
    case 'sparkle': return <IconTools />
    case 'chart': return <IconTools />
    case 'report': return <IconTools />
    case 'file': return <IconTools />
    case 'book': return <IconTools />
    default: return <IconTools />
  }
}

type View =
  | { mode: 'list' }
  | { mode: 'detail'; skill: UserSkill }
  | { mode: 'edit'; skill?: UserSkill }

export default function SkillPanel({ onBack }: Props) {
  const [skills, setSkills] = useState<UserSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>({ mode: 'list' })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 首次进入：加载技能；若为空则写入内置示例技能。
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true); setError('')
      try {
        let list = await loadUserSkills()
        if (!list.length) {
          const builtins = buildBuiltinSkills()
          await saveAllUserSkills(builtins)
          list = builtins
        }
        if (alive) setSkills(list)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // 点击外部关闭导入/导出菜单。
  useEffect(() => {
    if (!menuOpen) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  // ── 上传 .md 文件 ──
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setError('')
    let okCount = 0
    let lastErr = ''
    for (const file of Array.from(files)) {
      if (file.size > 64 * 1024) {
        lastErr = `${file.name} 超过 64KB 限制`
        continue
      }
      try {
        const text = await file.text()
        const v = validateSkillMarkdown(text)
        if (!v.ok) {
          lastErr = `${file.name}：${v.errors.join('；')}`
          continue
        }
        const input: UserSkillInput = { rawMarkdown: text, enabled: true, category: v.meta.category }
        const next = await saveUserSkill(input, skills)
        setSkills(next)
        okCount++
      } catch (e) {
        lastErr = `${file.name}：${e instanceof Error ? e.message : String(e)}`
      }
    }
    if (okCount) showToast(`已导入 ${okCount} 个技能`)
    if (lastErr) setError(lastErr)
    if (fileInput.current) fileInput.current.value = ''
    setMenuOpen(false)
  }

  // ── 新建/编辑保存 ──
  async function handleSave(md: string, fromSkill?: UserSkill) {
    try {
      if (fromSkill) {
        const input: UserSkillInput = { rawMarkdown: md, enabled: fromSkill.enabled, category: fromSkill.category }
        const next = await saveUserSkill(input, skills, fromSkill.id)
        setSkills(next)
        const updated = next.find((s) => s.id === fromSkill.id)
        if (updated) setView({ mode: 'detail', skill: updated })
        else setView({ mode: 'list' })
        showToast('已保存')
      } else {
        const v = validateSkillMarkdown(md)
        const input: UserSkillInput = { rawMarkdown: md, enabled: true, category: v.meta.category }
        const next = await saveUserSkill(input, skills)
        setSkills(next)
        setView({ mode: 'list' })
        showToast('已创建')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // ── 删除（内置不可删）──
  async function handleDelete(skill: UserSkill) {
    try {
      const next = await deleteUserSkill(skill.id, skills)
      setSkills(next)
      setConfirmId(null)
      if (view.mode === 'detail' && view.skill.id === skill.id) setView({ mode: 'list' })
      showToast('已删除')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // ── 切换启用 ──
  async function handleToggle(id: string) {
    try {
      const next = await toggleUserSkill(id, skills)
      setSkills(next)
      if (view.mode === 'detail') {
        const updated = next.find((s) => s.id === view.skill.id)
        if (updated) setView({ mode: 'detail', skill: updated })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // ── 复制内置技能为我的技能 ──
  async function handleDuplicate(skill: UserSkill) {
    try {
      let suffix = '_copy'
      let n = 2
      while (slugConflict(`${skill.slug}${suffix}`, skills)) {
        suffix = `_copy_${n++}`
      }
      const md = skill.rawMarkdown.replace(/^(slug:\s*)(.+)$/m, `$1${skill.slug}${suffix}`)
      const input: UserSkillInput = { rawMarkdown: md, enabled: true, category: skill.category }
      const next = await saveUserSkill(input, skills)
      setSkills(next)
      showToast('已复制为我的技能')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // ── 导出全部 ──
  function handleExport() {
    const blob = new Blob([exportUserSkills(skills)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `feishu-skills-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMenuOpen(false)
  }

  // 按 category 分组（无 category 归入「其他」）
  const groups = useMemo(() => {
    const m = new Map<string, UserSkill[]>()
    for (const s of skills) {
      const k = s.category?.trim() || '其他'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(s)
    }
    return Array.from(m.entries())
  }, [skills])

  const userSkills = useMemo(() => skills.filter((s) => !s.builtIn), [skills])

  // ── List view ──
  if (view.mode === 'list') {
    const listAction = (
      <div className="sk-head-actions">
        <Tooltip content="新建技能" position="bottom">
          <button className="sl-history-btn" onClick={() => setView({ mode: 'edit' })} type="button" aria-label="新建技能">
            <IconPlus />
          </button>
        </Tooltip>
        <div className="sk-menu-wrap" ref={menuRef}>
          <Tooltip content="导入 / 导出" position="bottom">
            <button className="sl-history-btn" onClick={() => setMenuOpen((v) => !v)} type="button" aria-label="导入导出">
              <IconUpload />
            </button>
          </Tooltip>
          {menuOpen && (
            <div className="sk-menu">
              <button type="button" className="sk-menu-item" onClick={() => fileInput.current?.click()}>
                <IconUpload /> 导入 .md
              </button>
              <button type="button" className="sk-menu-item" onClick={handleExport} disabled={!skills.length}>
                <IconDownload /> 导出全部
              </button>
            </div>
          )}
        </div>
      </div>
    )

    return (
      <div className="scenario-panel view-enter" key="skill-list">
        <TopBar title="技能库" onBack={onBack} rightAction={listAction} />

        <input
          ref={fileInput}
          type="file"
          accept=".md,.markdown,text/markdown"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />

        <div className="sl-body">
          <p className="sl-sub">上传 Markdown 技能文件或自行编写。Agent 会根据任务匹配描述，调用对应技能完成文案润色、表格填充等工作。</p>

          <div className="sl-field">
            <label className="sl-label">导入技能</label>
            <UploadDrop
              busy={false}
              max={50}
              count={userSkills.length}
              mainText="点击或拖入 .md 技能文件"
              hintText={`最多 ${50 - userSkills.length} 个 · 单文件 ≤64KB`}
              onFiles={handleFiles}
              onTrigger={() => fileInput.current?.click()}
            />
          </div>

          {error && <p className="sl-hint sl-hint--err">{error}</p>}

          {loading && <p className="sl-hint">载入中…</p>}

          {!loading && !error && skills.length === 0 && (
            <div className="sk-empty">
              <div className="sk-empty-icon"><IconTools /></div>
              <p className="sk-empty-title">还没有技能</p>
              <p className="sk-empty-desc">从上方导入 .md 文件，或新建第一个技能。</p>
              <Button variant="primary" size="sm" icon={<IconPlus />} onClick={() => setView({ mode: 'edit' })}>
                新建第一个技能
              </Button>
            </div>
          )}

          {!loading && groups.map(([cat, list]) => (
            <div key={cat} className="sl-field sk-group">
              <label className="sl-label">{cat} <span className="sl-label-hint">{list.length} 个</span></label>
              <div className="sk-rows">
                {list.map((s) => (
                  <SkillRow
                    key={s.id}
                    skill={s}
                    confirmId={confirmId}
                    onView={() => setView({ mode: 'detail', skill: s })}
                    onEdit={() => setView({ mode: 'edit', skill: s })}
                    onToggle={() => handleToggle(s.id)}
                    onDuplicate={() => handleDuplicate(s)}
                    onDelete={() => handleDelete(s)}
                    onRequestDelete={() => setConfirmId(s.id)}
                    onCancelDelete={() => setConfirmId(null)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {toast && <div className="sk-toast">{toast}</div>}
      </div>
    )
  }

  // ── Detail view ──
  if (view.mode === 'detail') {
    const { skill } = view
    return (
      <div className="scenario-panel view-enter" key="skill-detail">
        <TopBar
          title={skill.name}
          onBack={() => setView({ mode: 'list' })}
          rightAction={
            <div className="sk-head-actions">
              {skill.builtIn ? (
                <Tooltip content="复制为我的技能" position="bottom">
                  <button className="sl-history-btn" onClick={() => handleDuplicate(skill)} type="button" aria-label="复制">
                    <IconCopy />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content="编辑" position="bottom">
                  <button className="sl-history-btn" onClick={() => setView({ mode: 'edit', skill })} type="button" aria-label="编辑">
                    <IconEdit />
                  </button>
                </Tooltip>
              )}
            </div>
          }
        />
        <SkillDetailView skill={skill} onToggle={() => handleToggle(skill.id)} />
      </div>
    )
  }

  // ── Edit / Create view ──
  return (
    <div className="scenario-panel view-enter" key="skill-edit">
      <TopBar
        title={view.skill ? '编辑技能' : '新建技能'}
        onBack={() => setView({ mode: 'list' })}
        rightAction={
          view.skill ? (
            <Tooltip content="删除" position="bottom">
              <button className="sl-history-btn sk-head-btn--danger" onClick={() => view.skill && handleDelete(view.skill)} type="button" aria-label="删除">
                <IconTrash />
              </button>
            </Tooltip>
          ) : null
        }
      />
      <SkillEditor
        initialMarkdown={view.skill?.rawMarkdown ?? ''}
        existing={skills}
        selfId={view.skill?.id}
        onSave={(md) => handleSave(md, view.skill)}
        onClose={() => setView({ mode: 'list' })}
      />
    </div>
  )
}

// ── Skill row (list item) ──

interface SkillRowProps {
  skill: UserSkill
  confirmId: string | null
  onView: () => void
  onEdit: () => void
  onToggle: () => void
  onDuplicate: () => void
  onDelete: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
}

function SkillRow({ skill, confirmId, onView, onEdit, onToggle, onDuplicate, onDelete, onRequestDelete, onCancelDelete }: SkillRowProps) {
  const isConfirm = confirmId === skill.id
  return (
    <div className="sk-row">
      <button className="sk-row-main" type="button" onClick={onView} aria-label={`查看 ${skill.name}`}>
        <span className="sk-row-icon"><SkillIcon name={skill.icon} /></span>
        <span className="sk-row-meta">
          <span className="sk-row-title">
            {skill.name}
            {skill.builtIn && <span className="sk-row-tag sk-row-tag--builtin">内置</span>}
            <span className="sk-row-tag sk-row-tag--scope">{SCOPE_LABEL[skill.scope] ?? skill.scope}</span>
          </span>
          <span className="sk-row-desc">{skill.description}</span>
        </span>
      </button>
      <div className="sk-row-actions">
        {isConfirm ? (
          <>
            <button className="sk-row-btn sk-row-btn--danger" onClick={onDelete} type="button" aria-label="确认删除">
              <IconTrash />
            </button>
            <button className="sk-row-btn" onClick={onCancelDelete} type="button" aria-label="取消">
              <IconX />
            </button>
          </>
        ) : (
          <>
            <Tooltip content={skill.enabled ? '已启用' : '已禁用'} position="bottom">
              <button
                className={`sk-row-toggle${skill.enabled ? ' sk-row-toggle--active' : ''}`}
                onClick={onToggle}
                type="button"
                aria-label={skill.enabled ? '禁用' : '启用'}
              >
                <span className="sk-row-toggle-dot" />
              </button>
            </Tooltip>
            <Tooltip content="编辑" position="bottom">
              <button className="sk-row-btn" onClick={onEdit} type="button" aria-label="编辑">
                <IconEdit />
              </button>
            </Tooltip>
            {skill.builtIn ? (
              <Tooltip content="复制为我的技能" position="bottom">
                <button className="sk-row-btn" onClick={onDuplicate} type="button" aria-label="复制">
                  <IconCopy />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="删除" position="bottom">
                <button className="sk-row-btn sk-row-btn--danger" onClick={onRequestDelete} type="button" aria-label="删除">
                  <IconTrash />
                </button>
              </Tooltip>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Skill detail (readonly) ──

function SkillDetailView({ skill, onToggle }: { skill: UserSkill; onToggle: () => void }) {
  return (
    <div className="sl-body sk-detail-body">
      <div className="sk-detail-head">
        <div className="sk-detail-icon"><SkillIcon name={skill.icon} /></div>
        <div className="sk-detail-meta">
          <div className="sk-detail-name">{skill.name}</div>
          <div className="sk-detail-sub">
            <code>skill__{skill.slug}</code>
            <span className="sk-detail-scope">{SCOPE_LABEL[skill.scope] ?? skill.scope}</span>
            {skill.builtIn && <span className="sk-detail-scope">内置</span>}
          </div>
        </div>
        <button
          className={`sk-row-toggle${skill.enabled ? ' sk-row-toggle--active' : ''}`}
          onClick={onToggle}
          type="button"
          aria-label={skill.enabled ? '禁用' : '启用'}
        >
          <span className="sk-row-toggle-dot" />
        </button>
      </div>

      <div className="sl-field">
        <label className="sl-label">描述</label>
        <p className="sk-detail-desc">{skill.description}</p>
      </div>

      {skill.parameters && skill.parameters.length > 0 && (
        <div className="sl-field">
          <label className="sl-label">参数</label>
          <div className="sk-params">
            {skill.parameters.map((p) => (
              <div key={p.name} className="sk-param">
                <code>{p.name}</code>
                <span className="sk-param-type">{p.type}</span>
                {p.required && <span className="sk-param-req">必填</span>}
                <span className="sk-param-desc">{p.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sl-field">
        <label className="sl-label">指令正文</label>
        <div className="sk-detail-preview">
          <Markdown>{skill.bodyMarkdown}</Markdown>
        </div>
      </div>
    </div>
  )
}
