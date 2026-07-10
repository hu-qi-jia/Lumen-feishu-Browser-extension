import { useEffect, useRef, useState } from 'react'
import TopBar from '../shell/TopBar'
import Button from '../ui/Button'
import Tooltip from '../ui/Tooltip'
import Markdown from '../chat/Markdown'
import SkillEditor from './SkillEditor'
import ListView from '../ui/ListView'
import { IconPlus, IconEdit, IconTrash, IconX, IconUpload, IconDownload, IconTools } from '../ui/icons'
import {
  loadUserSkills, saveUserSkill, saveAllUserSkills, deleteUserSkill, toggleUserSkill,
  validateSkillMarkdown, exportUserSkills,
  type UserSkill, type UserSkillInput,
} from '@/shared/ai/userSkills'
import { buildBuiltinSkills } from '@/shared/ai/builtinSkills'
import './SkillPanel.css'

interface Props {
  onBack: () => void
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
  const fileInput = useRef<HTMLInputElement>(null)

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

  // ── 导出全部 ──
  function handleExport() {
    const blob = new Blob([exportUserSkills(skills)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `feishu-skills-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── List view ──
  if (view.mode === 'list') {
    const listAction = (
      <div className="sk-head-actions">
        <Tooltip content="导入 .md" position="bottom">
          <button className="sl-history-btn" onClick={() => fileInput.current?.click()} type="button" aria-label="导入">
            <IconUpload />
          </button>
        </Tooltip>
        <Tooltip content="导出全部" position="bottom">
          <button className="sl-history-btn" onClick={handleExport} type="button" aria-label="导出" disabled={!skills.length}>
            <IconDownload />
          </button>
        </Tooltip>
        <Tooltip content="新建技能" position="bottom">
          <button className="sl-history-btn" onClick={() => setView({ mode: 'edit' })} type="button" aria-label="新建技能">
            <IconPlus />
          </button>
        </Tooltip>
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

        <div className="sl-body sk-list-body">
          {error && <p className="sl-hint sl-hint--err">{error}</p>}

          {loading && <p className="sl-hint">载入中…</p>}

          {!loading && !error && skills.length === 0 && (
            <div className="sk-empty">
              <div className="sk-empty-icon"><IconTools /></div>
              <p className="sk-empty-title">还没有技能</p>
              <p className="sk-empty-desc">点击右上角导入 .md 文件，或新建第一个技能。</p>
              <Button variant="primary" size="sm" icon={<IconPlus />} onClick={() => setView({ mode: 'edit' })}>
                新建第一个技能
              </Button>
            </div>
          )}

          {!loading && skills.length > 0 && (
            <ListView
              items={skills}
              keyExtractor={(s) => s.id}
              renderItem={(s) => (
                <SkillRow
                  skill={s}
                  confirmId={confirmId}
                  onView={() => setView({ mode: 'detail', skill: s })}
                  onEdit={() => setView({ mode: 'edit', skill: s })}
                  onToggle={() => handleToggle(s.id)}
                  onDelete={() => handleDelete(s)}
                  onRequestDelete={() => setConfirmId(s.id)}
                  onCancelDelete={() => setConfirmId(null)}
                />
              )}
            />
          )}
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
            skill.builtIn ? null : (
              <div className="sk-head-actions">
                <Tooltip content="编辑" position="bottom">
                  <button className="sl-history-btn" onClick={() => setView({ mode: 'edit', skill })} type="button" aria-label="编辑">
                    <IconEdit />
                  </button>
                </Tooltip>
                <Tooltip content="删除" position="bottom">
                  <button className="sl-history-btn sk-head-btn--danger" onClick={() => handleDelete(skill)} type="button" aria-label="删除">
                    <IconTrash />
                  </button>
                </Tooltip>
              </div>
            )
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
          view.skill && !view.skill.builtIn ? (
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

// ── Skill row (flat list item) ──

interface SkillRowProps {
  skill: UserSkill
  confirmId: string | null
  onView: () => void
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
}

function SkillRow({ skill, confirmId, onView, onEdit, onToggle, onDelete, onRequestDelete, onCancelDelete }: SkillRowProps) {
  const isConfirm = confirmId === skill.id
  return (
    <>
      <button className="sk-row-main" type="button" onClick={onView} aria-label={`查看 ${skill.name}`}>
        <span className="sk-row-title">{skill.name}</span>
        <span className="sk-row-desc">{skill.description}</span>
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
            {!skill.builtIn && (
              <Tooltip content="编辑" position="bottom">
                <button className="sk-row-btn" onClick={onEdit} type="button" aria-label="编辑">
                  <IconEdit />
                </button>
              </Tooltip>
            )}
            {!skill.builtIn && (
              <Tooltip content="删除" position="bottom">
                <button className="sk-row-btn sk-row-btn--danger" onClick={onRequestDelete} type="button" aria-label="删除">
                  <IconTrash />
                </button>
              </Tooltip>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ── Skill detail (readonly) ──

function SkillDetailView({ skill, onToggle }: { skill: UserSkill; onToggle: () => void }) {
  return (
    <div className="sl-body sk-detail-body">
      <div className="sk-detail-head">
        <div className="sk-detail-meta">
          <div className="sk-detail-name">{skill.name}</div>
          <div className="sk-detail-sub">
            <code>skill__{skill.slug}</code>
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
