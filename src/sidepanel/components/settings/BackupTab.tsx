import { useRef, useState } from 'react'
import { HAS_ARTIFACT_SYNC } from '../../../shared/config'
import { restoreAllArtifacts } from '../../cloudRestore'
import { applyBackup, buildBackup } from '../../../shared/configBackup'
import SettingsSection from './SettingsSection'

/**
 * 备份 tab：企业云备份（条件渲染）+ 本地文件备份与恢复。
 * 两个操作都独立于 settings 表单——导出/导入/恢复不走 form，直接执行。
 */
export default function BackupTab() {
  // ── 企业云备份 ──
  const [restoring, setRestoring] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')

  // ── 本地文件备份 ──
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleExportBackup() {
    try {
      const file = await buildBackup({ includeSecrets, exportedAt: new Date().toISOString() })
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `feishu-ai-assistant-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setBackupMsg(
        includeSecrets
          ? '已导出（含明文密钥，请妥善保管文件）。'
          : '已导出（不含密钥，恢复后需重新填 API Key / 授权）。',
      )
    } catch (e) {
      setBackupMsg('导出失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleImportBackup(f: File) {
    setBackupMsg('正在恢复…')
    try {
      const sum = await applyBackup(JSON.parse(await f.text()))
      setBackupMsg(
        `已恢复：小程序/网站 ${sum.dataviz}、PPT ${sum.slides}、经验 ${sum.recipes}、会话 ${sum.sessions}${sum.settings ? '、配置已更新' : ''}。即将刷新生效…`,
      )
      setTimeout(() => {
        try {
          location.reload()
        } catch {
          /* ignore */
        }
      }, 1500)
    } catch (e) {
      setBackupMsg('恢复失败：' + (e instanceof Error ? e.message : '文件格式不对'))
    }
  }

  return (
    <>
      {/* ── 企业云备份（产物 → 企业自有对象存储；本地丢失可拉回） ── */}
      {HAS_ARTIFACT_SYNC && (
        <SettingsSection title="企业云备份（小程序 / 建站 / PPT）">
          <p className="field-hint">
            你保存的<b>小程序、AI建站、PPT</b>会自动备份到<b>本企业自有的</b>对象存储；
            一旦本地被清空、换设备或重装，可一键拉回。仅用你本人的飞书身份鉴权，按你的账号隔离，他人读不到你的备份。
          </p>
          <button
            className="btn-secondary"
            disabled={restoring}
            onClick={async () => {
              setRestoring(true)
              setRestoreMsg('')
              try {
                const n = await restoreAllArtifacts()
                setRestoreMsg(
                  n > 0
                    ? `已从云端恢复 ${n} 个（重新打开对应面板即可看到）。`
                    : '云端没有可补充的内容（本地已是最新）。',
                )
              } catch {
                setRestoreMsg('恢复失败：请确认已用本企业飞书账号授权、且网络可达企业代理。')
              } finally {
                setRestoring(false)
              }
            }}
            style={{ alignSelf: 'flex-start' }}
          >
            {restoring ? '正在从云端恢复…' : '从企业云端恢复'}
          </button>
          {restoreMsg && <p className="field-hint" style={{ marginTop: 6 }}>{restoreMsg}</p>}
        </SettingsSection>
      )}

      {/* ── 本地备份与恢复（导出到文件 / 从文件导入）—— 所有版本可用 ── */}
      <SettingsSection title="本地备份与恢复（文件）">
        <p className="field-hint">
          把你的<b>配置、保存的小程序 / AI建站 / PPT、本地经验、会话</b>导出成一个文件；
          换设备、重装或清缓存后导入即可恢复，<b>防止数据丢失</b>。全程在本机，不上传任何服务器。
        </p>
        <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={includeSecrets}
            onChange={(e) => setIncludeSecrets(e.target.checked)}
          />
          包含密钥（API Key / 飞书 Token / App Secret）
        </label>
        {includeSecrets && (
          <p className="field-hint" style={{ color: '#d4380d' }}>
            勾选后文件含<b>明文密钥</b>，请妥善保管、勿外发；不勾选则更安全，恢复后重新填一次 Key 即可。
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => void handleExportBackup()}>
            导出备份到文件
          </button>
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
            从文件恢复
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImportBackup(f)
              e.target.value = ''
            }}
          />
        </div>
        {backupMsg && <p className="field-hint" style={{ marginTop: 6 }}>{backupMsg}</p>}
      </SettingsSection>
    </>
  )
}
