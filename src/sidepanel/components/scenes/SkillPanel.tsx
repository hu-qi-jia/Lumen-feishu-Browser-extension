import { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../shell/TopBar'
import Button from '../ui/Button'
import SideDrawer from '../ui/SideDrawer'
import FormSwitch from '../ui/FormSwitch'
import Tooltip from '../ui/Tooltip'
import Markdown from '../chat/Markdown'
import SkillEditor from './SkillEditor'
import {
  IconPlus, IconEdit, IconTrash, IconEye, IconUpload, IconDownload, IconTools, IconCopy,
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
  // 项目内图标都是 24×24 stroke-based，直接复用。
  switch (name) {
    case 'sparkle': return <IconTools />
    case 'chart': return <IconTools />
    case 'report': return <IconTools />
    case 'file': return <IconTools />
    case 'book': return <IconTools />
    default: return <IconTools />
  }
}

type Drawer =
  | { mode: 'view'; skill: UserSkill }
  | { mode: 'edit'; skill: UserSkill }
  | { mode: 'new' }

export default function SkillPanel({ onBack }: Props) {
  const [skills, setSkills] = useState<UserSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawer, setDrawer] = useState<Drawer | null>(null)
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
          // 首次使用：写入内置示例，帮助用户理解格式。
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
    // 清空 input 以便重复选同一文件
    if (fileInput.current) fileInput.current.value = ''
  }

  // ── 新建/编辑保存 ──
  async function handleSave(md: string) {
    try {
      if (drawer?.mode === 'edit') {
        const input: UserSkillInput = { rawMarkdown: md, enabled: drawer.skill.enabled, category: drawer.skill.category }
        const next = await saveUserSkill(input, skills, drawer.skill.id)
        setSkills(next)
        showToast('已保存')
      } else if (drawer?.mode === 'new') {
        const v = validateSkillMarkdown(md)
        const input: UserSkillInput = { rawMarkdown: md, enabled: true, category: v.meta.category }
        const next = await saveUserSkill(input, skills)
        setSkills(next)
        showToast('已创建')
      }
      setDrawer(null)
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // ── 复制内置技能为我的技能 ──
  async function handleDuplicate(skill: UserSkill) {
    try {
      // 生成不冲突的 slug：_copy → _copy_2 → _copy_3 …
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

  const rightAction = (
    <div className="skill-panel-actions">
      <Tooltip content="导入 .md 文件" position="bottom">
        <button className="skill-head-btn" onClick={() => fileInput.current?.click()} type="button" aria-label="导入技能">
          <IconUpload />
        </button>
      </Tooltip>
      <Tooltip content="导出全部" position="bottom">
        <button className="skill-head-btn" onClick={handleExport} type="button" aria-label="导出技能" disabled={!skills.length}>
          <IconDownload />
        </button>
      </Tooltip>
      <Tooltip content="新建技能" position="bottom">
        <button className="skill-head-btn" onClick={() => setDrawer({ mode: 'new' })} type="button" aria-label="新建技能">
          <IconPlus />
        </button>
      </Tooltip>
    </div>
  )

  return (
    <div className="skill-panel">
      <TopBar title="技能库" onBack={onBack} rightAction={rightAction} />

      <input
        ref={fileInput}
        type="file"
        accept=".md,.markdown,text/markdown"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="skill-panel-body">
        {error && <div className="skill-panel-err">{error}</div>}
        {loading && <div className="skill-panel-empty">载入中…</div>}
        {!loading && !error && skills.length === 0 && (
          <div className="skill-panel-empty">
            <p>还没有技能。</p>
            <Button variant="primary" size="sm" icon={<IconPlus />} onClick={() => setDrawer({ mode: 'new' })}>
              新建第一个技能
            </Button>
          </div>
        )}

        {!loading && groups.map(([cat, list]) => (
          <div key={cat} className="skill-group">
            <div className="skill-group-label">{cat}</div>
            <ul className="skill-list">
              {list.map((s) => (
                <li key={s.id} className="skill-row">
                  <div className="skill-row-main">
                    <span className="skill-row-icon"><SkillIcon name={s.icon} /></span>
                    <span className="skill-row-meta">
                      <span className="skill-row-title">
                        {s.name}
                        {s.builtIn && <span className="skill-row-badge skill-row-badge--builtin">内置</span>}
                        <span className="skill-row-badge skill-row-badge--scope">{SCOPE_LABEL[s.scope] ?? s.scope}</span>
                      </span>
                      <span className="skill-row-desc">{s.description}</span>
                    </span>
                  </div>
                  <div className="skill-row-actions">
                    <FormSwitch checked={s.enabled} onChange={() => handleToggle(s.id)} />
                    <Tooltip content="查看" position="bottom">
                      <button className="skill-row-btn" onClick={() => setDrawer({ mode: 'view', skill: s })} type="button" aria-label="查看">
                        <IconEye />
                      </button>
                    </Tooltip>
                    <Tooltip content="编辑" position="bottom">
                      <button className="skill-row-btn" onClick={() => setDrawer({ mode: 'edit', skill: s })} type="button" aria-label="编辑">
                        <IconEdit />
                      </button>
                    </Tooltip>
                    {s.builtIn ? (
                      <Tooltip content="复制为我的技能" position="bottom">
                        <button className="skill-row-btn" onClick={() => handleDuplicate(s)} type="button" aria-label="复制">
                          <IconCopy />
                        </button>
                      </Tooltip>
                    ) : confirmId === s.id ? (
                      <>
                        <Tooltip content="确认删除" position="bottom">
                          <button className="skill-row-btn skill-row-btn--danger" onClick={() => handleDelete(s)} type="button" aria-label="确认删除">
                            <IconTrash />
                          </button>
                        </Tooltip>
                        <button className="skill-row-cancel" onClick={() => setConfirmId(null)} type="button">取消</button>
                      </>
                    ) : (
                      <Tooltip content="删除" position="bottom">
                        <button className="skill-row-btn" onClick={() => setConfirmId(s.id)} type="button" aria-label="删除">
                          <IconTrash />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {toast && <div className="skill-panel-toast">{toast}</div>}

      {/* 查看 / 编辑 / 新建 抽屉 */}
      {drawer && (
        <SideDrawer
          title={drawer.mode === 'new' ? '新建技能' : drawer.mode === 'edit' ? '编辑技能' : drawer.skill.name}
          onClose={() => setDrawer(null)}
        >
          {drawer.mode === 'view' ? (
            <SkillDetailView skill={drawer.skill} />
          ) : (
            <SkillEditor
              initialMarkdown={drawer.mode === 'edit' ? drawer.skill.rawMarkdown : ''}
              existing={skills}
              selfId={drawer.mode === 'edit' ? drawer.skill.id : undefined}
              onSave={handleSave}
              onClose={() => setDrawer(null)}
            />
          )}
        </SideDrawer>
      )}
    </div>
  )
}

/** 只读详情：frontmatter 元信息 + 渲染后的指令正文。 */
function SkillDetailView({ skill }: { skill: UserSkill }) {
  return (
    <div className="skill-detail">
      <dl className="skill-detail-meta">
        <div><dt>名称</dt><dd>{skill.name}</dd></div>
        <div><dt>标识</dt><dd><code>skill__{skill.slug}</code></dd></div>
        <div><dt>描述</dt><dd>{skill.description}</dd></div>
        <div><dt>作用域</dt><dd>{SCOPE_LABEL[skill.scope] ?? skill.scope}</dd></div>
        {skill.category && <div><dt>分类</dt><dd>{skill.category}</dd></div>}
        {skill.parameters?.length ? (
          <div>
            <dt>参数</dt>
            <dd>
              <ul className="skill-detail-params">
                {skill.parameters.map((p) => (
                  <li key={p.name}>
                    <code>{p.name}</code>
                    <span className="skill-detail-param-type">{p.type}</span>
                    {p.required && <span className="skill-detail-param-req">必填</span>}
                    {p.description && <span className="skill-detail-param-desc">{p.description}</span>}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="skill-detail-body">
        <div className="skill-detail-body-label">指令正文</div>
        <Markdown>{skill.bodyMarkdown}</Markdown>
      </div>
    </div>
  )
}
