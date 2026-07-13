import { useEffect, useState } from 'react'
import type { AppSettings } from '@/shared/types'
import { readNote, writeNote, deleteNote } from '@/shared/obsidian/api'
import { sanitizeVaultPath } from '@/shared/obsidian/util'
import Markdown from '../../chat/Markdown'
import TopBar from '../../shell/TopBar'
import Button from '../../ui/Button'
import ConfirmModal from '../../ui/ConfirmModal'
import { IconEdit, IconTrash } from '../../ui/icons'
import IconButton from '../../ui/IconButton'
import './ObsidianNoteDetail.css'

interface Props {
  settings: AppSettings
  /** null = 新建态；否则 vault 相对路径。 */
  path: string | null
  onClose: () => void
  onDeleted: () => void
}

/** 笔记详情：读（Markdown 预览）⇄ 源码编辑；保存（PUT）；删除（DELETE，确认）；新建（空编辑态）。 */
export default function ObsidianNoteDetail({ settings, path, onClose, onDeleted }: Props) {
  const isNew = path === null
  const [title, setTitle] = useState(isNew ? '' : (path!.split('/').pop() || '').replace(/\.md$/i, ''))
  const [mode, setMode] = useState<'view' | 'edit'>(isNew ? 'edit' : 'view')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (isNew) return
    let alive = true; setLoading(true); setError('')
    readNote(settings, path!).then((md) => { if (!alive) return; setBody(md); setDraft(md) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [settings, path, isNew])

  async function save() {
    let target: string
    if (isNew) {
      const t = title.trim()
      // sanitizeVaultPath 对空串会抛错——这里先 gate，给出更友好的「请填写笔记标题」。
      if (!t) { setError('请填写笔记标题'); return }
      // 收件箱路径：新建笔记的默认落点（空 = vault 根）。与接入表单 hint 一致，避免误导。
      const inbox = (settings.obsidianInboxPath ?? '').trim().replace(/\/+$/, '')
      try {
        const name = sanitizeVaultPath(t) + '.md'
        target = inbox ? `${sanitizeVaultPath(inbox)}/${name}` : name
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); return }
    } else {
      target = path!
    }
    setSaving(true); setError('')
    try {
      await writeNote(settings, target, draft)
      setBody(draft); setMode('view')
      if (isNew) onClose() // 新建成功 → 回列表（列表会刷新）
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  async function remove() {
    setSaving(true); setError('')
    try { await deleteNote(settings, path!); onDeleted() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setSaving(false) }
  }

  return (
    <div className={`kb-detail${isNew ? ' kb-detail--new' : ''}`} data-testid="kb-note-detail">
      <TopBar
        title={isNew ? '新建笔记' : path}
        onBack={onClose}
        rightAction={
          !isNew ? (
            <div className="kb-detail-actions">
              {mode === 'view' && (
                <IconButton onClick={() => setMode('edit')} aria-label="编辑"><IconEdit /></IconButton>
              )}
              <IconButton onClick={() => setConfirmDelete(true)} aria-label="删除" disabled={saving}><IconTrash /></IconButton>
            </div>
          ) : undefined
        }
      />

      {error && <div className="kb-error">{error}</div>}
      {loading && <div className="kb-muted">载入中…</div>}

      {!loading && mode === 'view' && !isNew && (
        <div className="kb-detail-body"><Markdown>{body}</Markdown></div>
      )}

      {(!loading && mode === 'edit') || isNew ? (
        <div className="kb-detail-edit">
          {isNew && (
            <input className="kb-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="笔记标题" />
          )}
          <textarea
            className="kb-editor"
            data-testid="kb-editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="笔记正文"
            placeholder="输入 Markdown 正文…"
          />
          <div className="kb-detail-foot">
            {!isNew && <Button variant="secondary" onClick={() => { setDraft(body); setMode('view') }}>取消</Button>}
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={confirmDelete}
        title="删除笔记"
        message={`确认删除「${path}」？此操作不可撤销。`}
        confirmText="删除"
        danger
        onConfirm={() => { setConfirmDelete(false); void remove() }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
