import { useEffect, useRef, useState } from 'react'
import { HAS_ARTIFACT_SYNC } from '../../../shared/config'
import { restoreAllArtifacts } from '../../cloudRestore'
import { applyBackup, buildBackup } from '../../../shared/configBackup'
import { FormCheckbox } from '../form'
import { IconDownload, IconUpload } from '../icons'
import Button from '../Button'
import ConfirmDialog from '../ConfirmDialog'
import Tooltip from '../Tooltip'
import SettingsSection from './SettingsSection'
import SettingsSelect from './SettingsSelect'
import { TitleWithHelp } from './HelpIcon'
import type { ConfirmRequest } from '../../../shared/ai/agent'
import '../IconButton.css'
import {
  cleanupImpact,
  clearAllUserData,
  loadCleanupSettings,
  saveCleanupSettings,
  type CleanupIntervalDays,
} from '../../../shared/dataCleanup'

const BACKUP_TIP = '导出配置、小程序、AI 建站、PPT、本地经验及会话为一个文件；换设备或重装后导入即可恢复。数据仅存储在本地。'


/**
 * 数据与备份 tab：本地备份与恢复、数据清理，以及企业云备份（条件渲染）。
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
  const [clearing, setClearing] = useState(false)
  const [cleanupMsg, setCleanupMsg] = useState('')
  const [clearDialog, setClearDialog] = useState<ConfirmRequest | null>(null)

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
      setTimeout(() => { try { location.reload() } catch { /* ignore */ } }, 1200)
    } catch (e) {
      setCleanupMsg('清除失败：' + (e instanceof Error ? e.message : String(e)))
      setClearing(false)
    } finally {
      setClearDialog(null)
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
      {/* ── 本地备份与恢复 ── */}
      <SettingsSection title={<TitleWithHelp title="本地备份与恢复" tip={BACKUP_TIP} />}>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">备份文件</span>
            <span className="settings-row-desc">导出或导入本地备份</span>
          </div>
          <span className="settings-row-control">
            <Tooltip content="导出备份" position="bottom">
              <button
                type="button"
                className="icon-action"
                aria-label="导出备份"
                onClick={() => void handleExportBackup()}
              >
                <IconDownload />
              </button>
            </Tooltip>
            <Tooltip content="从文件导入" position="bottom">
              <button
                type="button"
                className="icon-action"
                aria-label="从文件导入"
                onClick={() => fileRef.current?.click()}
              >
                <IconUpload />
              </button>
            </Tooltip>
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
          </span>
        </div>

        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">导出包含密钥</span>
            <span className="settings-row-desc">备份文件中包含 API Key、飞书 Token 及 App Secret</span>
          </div>
          <span className="settings-row-control">
            <FormCheckbox checked={includeSecrets} onChange={setIncludeSecrets}>
              <></>
            </FormCheckbox>
          </span>
        </div>
        {includeSecrets && (
          <p className="field-hint" style={{ color: 'var(--color-error)' }}>
            勾选后文件含<b>明文密钥</b>，请妥善保管、勿外发；不勾选则更安全，恢复后重新填一次 Key 即可。
          </p>
        )}
        {backupMsg && <p className="field-hint">{backupMsg}</p>}
      </SettingsSection>

      {/* ── 数据清理 ── */}
      <SettingsSection title={<TitleWithHelp title="数据清理" tip={cleanupTip(impactBytes, lastCleanedAt)} />}>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">自动清理</span>
            <span className="settings-row-desc">按周期清理会话与缓存</span>
          </div>
          <span className="settings-row-control">
            <SettingsSelect
              options={CLEANUP_INTERVAL_OPTIONS}
              value={String(cleanupDays)}
              onChange={changeInterval}
              ariaLabel="自动清理频率"
            />
          </span>
        </div>
        <div className="settings-field">
          <div className="settings-row-main">
            <span className="settings-row-title">清除全部数据</span>
            <span className="settings-row-desc">清除会话、PPT、建站、PDF 等数据，仅保留设置</span>
          </div>
          <Button
            variant="danger"
            block
            loading={clearing}
            onClick={() => setClearDialog({ kind: 'delete', summary: '即将清除全部会话、PPT、建站、PDF、图片等，只保留设置，且不可恢复。' })}
          >
            清除全部数据
          </Button>
        </div>
        {cleanupMsg && <p className="field-hint">{cleanupMsg}</p>}
      </SettingsSection>

      {/* ── 企业云备份 ── */}
      {HAS_ARTIFACT_SYNC && (
        <SettingsSection title="企业云备份">
          <div className="settings-row">
            <div className="settings-row-main">
              <span className="settings-row-title">小程序 / 建站 / PPT</span>
              <span className="settings-row-desc">自动备份至企业自有对象存储，本地清空后可恢复</span>
            </div>
            <span className="settings-row-control">
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
              >
                {restoring ? '恢复中…' : '从云端恢复'}
              </button>
            </span>
          </div>
          {restoreMsg && <p className="field-hint" style={{ marginTop: 6 }}>{restoreMsg}</p>}
        </SettingsSection>
      )}

      {clearDialog && (
        <ConfirmDialog
          req={clearDialog}
          onChoose={(choice) => {
            if (choice === 'confirm') {
              void handleClearAll()
            } else {
              setClearDialog(null)
            }
          }}
        />
      )}
    </>
  )
}

function cleanupTip(impactBytes: number | null, lastCleanedAt: number | null): string {
  let tip = '清除会话、PPT、建站、PDF、图片附件及本地经验，仅保留设置。不可恢复。'
  if (impactBytes != null && impactBytes > 0) tip += ` 当前约 ${formatBytes(impactBytes)} 可清除。`
  if (lastCleanedAt) tip += ` 上次清理：${relTime(lastCleanedAt)}。`
  return tip
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
