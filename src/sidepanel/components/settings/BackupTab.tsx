import { useEffect, useRef, useState } from 'react'
import { HAS_ARTIFACT_SYNC } from '../../../shared/config'
import { restoreAllArtifacts } from '../../cloudRestore'
import { applyBackup, buildBackup } from '../../../shared/configBackup'
import { FormCheckbox, FormSelect } from '../form'
import Button from '../Button'
import SettingsSection from './SettingsSection'
import {
  cleanupImpact,
  clearAllUserData,
  loadCleanupSettings,
  saveCleanupSettings,
  type CleanupIntervalDays,
} from '../../../shared/dataCleanup'

/**
 * 数据与备份 tab：本地备份与恢复（文件）、数据清理，以及企业云备份（条件渲染）。
 * 备份/恢复/清理操作都独立于 settings 表单——直接执行。
 */
export default function BackupTab() {
  // ── 企业云备份 ──
  const [restoring, setRestoring] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')

  // ── 本地文件备份 ──
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // ── 数据清理 ──
  const [cleanupDays, setCleanupDays] = useState<CleanupIntervalDays>(0)
  const [impactBytes, setImpactBytes] = useState<number | null>(null)
  const [lastCleanedAt, setLastCleanedAt] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [cleanupMsg, setCleanupMsg] = useState('')
  useEffect(() => {
    void (async () => {
      const cs = await loadCleanupSettings()
      setCleanupDays(cs.intervalDays)
      setLastCleanedAt(cs.lastCleanedAt)
      setImpactBytes((await cleanupImpact()).bytes)
    })()
  }, [])
  const changeInterval = (value: string) => {
    const next = Number(value) as CleanupIntervalDays
    setCleanupDays(next)
    void loadCleanupSettings().then((s) => saveCleanupSettings({ ...s, intervalDays: next }))
  }
  const handleClearAll = async () => {
    setClearing(true)
    setCleanupMsg('')
    try {
      const { freedBytes } = await clearAllUserData()
      const now = Date.now()
      setLastCleanedAt(now)
      setImpactBytes((await cleanupImpact()).bytes)
      void loadCleanupSettings().then((s) => saveCleanupSettings({ ...s, lastCleanedAt: now }))
      setCleanupMsg(`已清除${freedBytes > 0 ? `（释放约 ${formatBytes(freedBytes)}）` : ''}，即将刷新生效…`)
      // 会话/PPT/建站等列表都缓存在 React state 里；清存储后必须刷新面板才能看到空状态。
      setTimeout(() => { try { location.reload() } catch { /* ignore */ } }, 1200)
    } catch (e) {
      setCleanupMsg('清除失败：' + (e instanceof Error ? e.message : String(e)))
      setClearing(false)
      setConfirming(false)
    }
  }

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
      {/* ── 本地备份与恢复（导出到文件 / 从文件导入）—— 所有版本可用 ── */}
      <SettingsSection title="本地备份与恢复（文件）">
        <p className="field-hint">
          把你的<b>配置、保存的小程序 / AI建站 / PPT、本地经验、会话</b>导出成一个文件；
          换设备、重装或清缓存后导入即可恢复，<b>防止数据丢失</b>。全程在本机，不上传任何服务器。
        </p>
        <FormCheckbox
          checked={includeSecrets}
          onChange={setIncludeSecrets}
        >
          <>包含密钥（API Key / 飞书 Token / App Secret）</>
        </FormCheckbox>
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

      {/* ── 数据清理 ── */}
      <SettingsSection title="数据清理">
        <div className="cache-row">
          <span className="cache-row-label">自动清理</span>
          <FormSelect value={String(cleanupDays)} onChange={(e) => changeInterval(e.target.value)}>
            {CLEANUP_INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FormSelect>
        </div>
        <p className="field-hint">
          清除<b>全部会话记录、保存的 PPT / 建站 / PDF、图片附件、本地经验</b>等，只保留你的设置（API Key、
          飞书授权、主题等）。<b>不可恢复。</b>
          {impactBytes != null && impactBytes > 0 && <> 当前约 <b>{formatBytes(impactBytes)}</b> 可清除。</>}
          {lastCleanedAt && <> 上次清理：{relTime(lastCleanedAt)}。</>}
        </p>
        {confirming ? (
          <div className="cache-confirm">
            <p className="field-hint" style={{ color: 'var(--color-error)' }}>
              确认清除？将删除全部会话、PPT、建站、PDF、图片等，<b>只保留设置，且不可恢复</b>。
            </p>
            <div className="cache-confirm-actions">
              <Button variant="danger" loading={clearing} onClick={() => void handleClearAll()}>
                确认清除
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={clearing}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <button className="btn-secondary" onClick={() => setConfirming(true)} style={{ alignSelf: 'flex-start' }}>
            清除全部数据
          </button>
        )}
        {cleanupMsg && <p className="field-hint" style={{ marginTop: 6 }}>{cleanupMsg}</p>}
      </SettingsSection>

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
    </>
  )
}

const CLEANUP_INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: '关闭' },
  { value: '3', label: '每 3 天' },
  { value: '7', label: '每 7 天' },
  { value: '30', label: '每 30 天' },
]

/** 字节数 → 人类可读。 */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 时间戳 → 相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）。 */
function relTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}
