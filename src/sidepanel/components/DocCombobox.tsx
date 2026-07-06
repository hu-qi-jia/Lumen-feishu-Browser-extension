import { useState } from 'react'
import type { RecentFile } from '../recentFiles'
import { parseDocTokenFromUrl } from '../../shared/feishu/parseDocRef'
import Button from './Button'
import DocLinkField from './DocLinkField'
import './DocCombobox.css'

export interface DocTarget { token: string; title: string }

interface Props {
  recentFiles: RecentFile[]
  onRemoveRecent?: (token: string) => void
  target: DocTarget | null
  onTargetChange: (t: DocTarget | null) => void
  onConfirm: () => void
  writing?: boolean
}

/** A dropdown-style input: type/paste a doc link directly into the field, or click the chevron
 *  to drop down the recent-docs list. Picking a recent fills the field with its title. The input
 *  + dropdown live in the shared `DocLinkField`; this wrapper adds the single-target state model
 *  + the 写入 button (PDF "添加到文档" use case). */
export default function DocCombobox({ recentFiles, onRemoveRecent, target, onTargetChange, onConfirm, writing }: Props) {
  const [text, setText] = useState(target?.title ?? '')

  function onText(v: string) {
    setText(v)
    const parsed = parseDocTokenFromUrl(v)
    onTargetChange(parsed ? { token: parsed.token, title: v } : null)
  }
  // Pick a recent → resolve into a target + show its title in the field.
  function pick(f: RecentFile) {
    onTargetChange({ token: f.token, title: f.title })
    setText(f.title)
  }

  return (
    <div className="dc-combobox">
      <DocLinkField
        value={text}
        onValueChange={onText}
        recentFiles={recentFiles}
        onPickRecent={pick}
        onRemoveRecent={onRemoveRecent}
      />
      <Button variant="primary" block onClick={onConfirm} disabled={writing} loading={writing}>添加到文档</Button>
    </div>
  )
}
