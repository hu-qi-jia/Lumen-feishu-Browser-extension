import { useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { pingObsidian } from '../../shared/obsidian/api'
import TopBar from './TopBar'
import ObsidianVaultView from './ObsidianVaultView'
import Button from './Button'
import './KnowledgeBasePanel.css'

interface Props {
  settings: AppSettings
  onBack: () => void
  /** 去设置页配置/改连接（Hub 内不再内联接入表单）。 */
  onGoToSettings: () => void
}

type Conn = 'loading' | 'connected' | 'disconnected'

/** 知识库面板外壳：ping → loading/connected/disconnected。
 *  connected → ObsidianVaultView；disconnected → 门禁空态（引导去设置），不再内联接入表单。 */
export default function KnowledgeBasePanel({ settings, onBack, onGoToSettings }: Props) {
  const [conn, setConn] = useState<Conn>('loading')
  const [vault, setVault] = useState<string | undefined>(settings.obsidianVaultName)

  // 仅当端点变化才重新探活（接入成功后 saveSettings 换引用但端点未变 → 不应重 ping）。
  const baseUrl = settings.obsidianBaseUrl
  useEffect(() => {
    let alive = true
    setConn('loading')
    pingObsidian(settings).then((p) => {
      if (!alive) return
      setVault(p.vault ?? settings.obsidianVaultName)
      setConn(p.ok && p.authenticated ? 'connected' : 'disconnected')
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl])

  return (
    <div className="scenario-panel view-enter" key="kb">
      <TopBar title="知识库" onBack={onBack} />
      <div className="kb-body">
        {conn === 'loading' && (
          <div className="kb-loading" data-testid="kb-loading">连接 Obsidian 中…</div>
        )}
        {conn === 'connected' && (
          <ObsidianVaultView
            settings={{ ...settings, obsidianVaultName: vault || settings.obsidianVaultName }}
          />
        )}
        {conn === 'disconnected' && (
          <div className="kb-gate" data-testid="kb-gate">
            <p className="kb-gate-msg">尚未连接 Obsidian 知识库。</p>
            <Button variant="primary" onClick={onGoToSettings}>去设置完成配置</Button>
          </div>
        )}
      </div>
    </div>
  )
}
