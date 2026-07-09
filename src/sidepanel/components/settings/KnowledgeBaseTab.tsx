import { useEffect, useState } from 'react'
import type { SettingsTabProps } from './types'
import FeishuSteps, { type FeishuStep } from './FeishuSteps'
import { FormField, FormInput } from '../form'
import Button from '../Button'
import Tooltip from '../Tooltip'
import { pingObsidian } from '../../../shared/obsidian/api'
import { saveObsidianToken, getObsidianToken } from '../../../shared/obsidian/auth'
import './KnowledgeBaseTab.css'

const PLUGIN_URL = 'https://github.com/coddingtonbear/obsidian-local-rest-api'

type Result = { kind: 'ok' | 'err'; msg: string }

/** 设置页「知识库」tab：FeishuSteps 三步引导 + 端点/API Key + 测试连接 + 高级（inbox/exclude）。
 *  API Key 走独立加密键（测试连接成功即存）；端点/inbox/exclude/vault 通过 patch 进 form，
 *  随设置页底部「保存」批量落盘（与其余 tab 一致）。 */
export default function KnowledgeBaseTab({ form, patch }: SettingsTabProps) {
  const [apiKey, setApiKey] = useState('')
  const [hasStored, setHasStored] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [showAdv, setShowAdv] = useState(false)

  useEffect(() => { getObsidianToken().then((t) => setHasStored(!!t)) }, [])

  const canTest = !!apiKey.trim() || hasStored

  async function test() {
    setResult(null); setTesting(true)
    try {
      const token = apiKey.trim() || await getObsidianToken()
      const probe = await pingObsidian({ ...form }, token || undefined)
      if (!probe.ok) { setResult({ kind: 'err', msg: `无法连接到 ${form.obsidianBaseUrl}。请确认 Obsidian 已运行、插件已启用并打开了 HTTP server（端口 27123）。` }); return }
      if (!probe.authenticated) { setResult({ kind: 'err', msg: 'API Key 无效或已失效，请回 Obsidian 设置 → Local REST API 重新复制。' }); return }
      if (apiKey.trim()) await saveObsidianToken(apiKey.trim())
      if (probe.vault) patch({ obsidianVaultName: probe.vault })
      setHasStored(true)
      setResult({ kind: 'ok', msg: `已连接${probe.vault ? ` · ${probe.vault}` : ''}` })
    } catch (e) {
      setResult({ kind: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const steps: FeishuStep[] = [
    { title: '安装社区插件', description: <>安装 <a href={PLUGIN_URL} target="_blank" rel="noreferrer">Local REST API with MCP</a></> },
    {
      title: '开启 HTTP server',
      description: (
        <>
          Obsidian 设置 → Local REST API，打开「Enable non-encrypted (HTTP) server」
          <Tooltip content="扩展无法信任 HTTPS 的自签名证书，故走 HTTP（端口 27123）。流量仅在本机回环，API Key 仍加密存储。" position="right">
            <span className="kb-q" style={{ marginLeft: 4 }}>?</span>
          </Tooltip>
        </>
      ),
    },
    { title: '复制 API Key', description: '复制同页显示的 API Key，填到下方输入框。' },
  ]

  return (
    <div className="kb-tab">
      <FeishuSteps steps={steps} current={null} />

      <FormField label="端点" hint="Obsidian Local REST API 地址，默认本机 27123。">
        <FormInput type="url" value={form.obsidianBaseUrl ?? ''} onChange={(e) => patch({ obsidianBaseUrl: e.target.value })} placeholder="http://127.0.0.1:27123" />
      </FormField>

      <FormField label="API Key" hint={hasStored ? '已保存，留空则沿用；填写则覆盖。' : '粘贴 Obsidian Local REST API 页面显示的 API Key。'}>
        <FormInput type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasStored ? '••••••（已保存）' : '粘贴 API Key'} />
      </FormField>

      <div className="kb-tab-test">
        <Button variant="primary" onClick={test} loading={testing} disabled={!canTest}>测试连接</Button>
        {result && <span className={`kb-tab-result ${result.kind === 'ok' ? 'kb-tab-result--ok' : 'kb-tab-result--err'}`}>{result.msg}</span>}
      </div>

      <div className="kb-tab-adv">
        <button type="button" className="kb-link-btn" onClick={() => setShowAdv((v) => !v)}>{showAdv ? '收起' : '高级'}选项</button>
      </div>
      {showAdv && (
        <>
          <FormField label="收件箱路径" hint="新建笔记的默认落点（空 = vault 根）。">
            <FormInput type="text" value={form.obsidianInboxPath ?? ''} onChange={(e) => patch({ obsidianInboxPath: e.target.value })} placeholder="Inbox/" />
          </FormField>
          <FormField label="排除路径" hint="逗号分隔 glob，检索与列表都排除。">
            <FormInput type="text" value={form.obsidianExcludePaths ?? ''} onChange={(e) => patch({ obsidianExcludePaths: e.target.value })} placeholder="Archive/**, Daily/**" />
          </FormField>
        </>
      )}

      <p className="field-hint">开启后，检索到的笔记内容会发往你配置的 LLM 以供回答。</p>
    </div>
  )
}
