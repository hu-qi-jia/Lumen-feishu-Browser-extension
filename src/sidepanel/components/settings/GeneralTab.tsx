import { useEffect, useState } from 'react'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../../../shared/theme'
import type { AppSettings } from '../../../shared/types'
import { FormSwitch, FormToggle } from '../form'
import Button from '../Button'
import Dropdown from '../Dropdown'
import SettingsSection from './SettingsSection'
import type { SettingsTabProps } from './types'
import { loadNewsSettings, saveNewsSettings } from '../../../shared/news/store'
import type { TranslationEngine } from '../../../shared/news/types'
import {
  cacheBytes,
  clearCache,
  loadCacheSettings,
  saveCacheSettings,
  type CacheCleanupDays,
} from '../../../shared/cacheCleanup'

interface Props extends SettingsTabProps {
  accent: string
  onAccentChange: (hex: string) => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
  policyLocks: Set<keyof AppSettings>
}

/** 通用 tab：主题色、外观模式、自动确认。 */
export default function GeneralTab({
  form,
  patch,
  accent,
  onAccentChange,
  theme,
  onThemeChange,
  policyLocks,
}: Props) {
  const accentChanged = accent.toLowerCase() !== DEFAULT_ACCENT.toLowerCase()

  // News translation engine — stored in news_settings_v1 (separate from AppSettings), so
  // it's loaded/saved independently and takes effect immediately (like theme/accent).
  const [engine, setEngine] = useState<TranslationEngine>('bing')
  useEffect(() => { void loadNewsSettings().then((s) => setEngine(s.translationEngine)) }, [])
  const changeEngine = (value: string) => {
    const next = value as TranslationEngine
    setEngine(next)
    void loadNewsSettings().then((s) => saveNewsSettings({ ...s, translationEngine: next }))
  }

  // 缓存清理：间隔存在 cache_settings_v1（独立于 AppSettings），改了立即生效；后台 onChanged
  // 监听会重 arm 清理 alarm。当前缓存体积 + 上次清理时间仅用于展示。
  const [cacheDays, setCacheDays] = useState<CacheCleanupDays>(0)
  const [cacheBytesVal, setCacheBytesVal] = useState<number | null>(null)
  const [lastCleanedAt, setLastCleanedAt] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)
  const [cacheMsg, setCacheMsg] = useState('')
  useEffect(() => {
    void (async () => {
      const cs = await loadCacheSettings()
      setCacheDays(cs.intervalDays)
      setLastCleanedAt(cs.lastCleanedAt)
      setCacheBytesVal((await cacheBytes()).bytes)
    })()
  }, [])
  const changeInterval = (value: string) => {
    const next = Number(value) as CacheCleanupDays
    setCacheDays(next)
    void loadCacheSettings().then((s) => saveCacheSettings({ ...s, intervalDays: next }))
  }
  const handleClearCache = async () => {
    setClearing(true)
    setCacheMsg('')
    try {
      const { freedBytes } = await clearCache()
      const now = Date.now()
      setLastCleanedAt(now)
      setCacheBytesVal(0)
      void loadCacheSettings().then((s) => saveCacheSettings({ ...s, lastCleanedAt: now }))
      setCacheMsg(`已清理${freedBytes > 0 ? `（约 ${formatBytes(freedBytes)}）` : ''}`)
    } catch (e) {
      setCacheMsg('清理失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      {/* ── 主题色 ── */}
      <SettingsSection title="主题色">
        <div className="accent-row">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex}
              className={`accent-swatch ${accent.toLowerCase() === p.hex.toLowerCase() ? 'accent-swatch--active' : ''}`}
              style={{ background: p.hex }}
              title={p.name}
              aria-label={p.name}
              onClick={() => onAccentChange(p.hex)}
            />
          ))}
          <label className="accent-custom" title="自定义颜色" aria-label="自定义颜色">
            <input
              type="color"
              value={accent}
              onChange={(e) => onAccentChange(e.target.value)}
            />
          </label>
        </div>
        {accentChanged && (
          <button className="btn-link" onClick={() => onAccentChange(DEFAULT_ACCENT)}>
            恢复默认
          </button>
        )}
      </SettingsSection>

      {/* ── 外观模式 ── */}
      <SettingsSection title="外观模式">
        <FormToggle
          options={[
            { value: 'light', label: '亮色' },
            { value: 'dark', label: '深色' },
          ]}
          value={theme}
          onChange={(v) => onThemeChange(v as 'light' | 'dark')}
        />
      </SettingsSection>

      {/* ── 自动确认 ── */}
      <SettingsSection title="自动确认">
        <FormSwitch
          checked={form.autoConfirm === true}
          disabled={policyLocks.has('autoConfirm')}
          onChange={(checked) => patch({ autoConfirm: checked })}
          hint={
            <>
              开启后，删除文档内的行 / 字段 / 内容块 / 去重等操作<b>不再弹确认按钮</b>。
              文件级删除（整表 / 电子表格 / 文档 / 云文件）始终拦截。
              {policyLocks.has('autoConfirm') && <span className="field-hint">（由企业策略锁定）</span>}
            </>
          }
          hintColor={form.autoConfirm ? '#d4380d' : undefined}
        >
          删除文档内容时自动确认
        </FormSwitch>
      </SettingsSection>

      {/* ── 资讯 ── */}
      <SettingsSection title="GitHub 项目描述翻译">
        <SettingsSelect
          options={ENGINE_OPTIONS}
          value={engine}
          onChange={changeEngine}
          ariaLabel="GitHub 描述翻译引擎"
        />
        <p className="field-hint">
          Bing 翻译使用免费接口，无需配置；AI 翻译使用已配置的模型，速度较慢但质量更高。翻译结果会缓存，重复刷新不会重复调用。
        </p>
      </SettingsSection>

      {/* ── 缓存 ── */}
      <SettingsSection title="缓存">
        <div className="cache-row">
          <span className="cache-row-label">自动清理</span>
          <SettingsSelect
            options={CACHE_INTERVAL_OPTIONS}
            value={String(cacheDays)}
            onChange={changeInterval}
            ariaLabel="缓存自动清理频率"
          />
        </div>
        <p className="field-hint">
          定期清除可再生的运行时缓存（资讯、翻译、企业下发的模型 / App ID 等），下次用到会自动重新拉取；
          <b>不会影响你的配置、会话和已保存的小程序 / PPT / 经验。</b>
          {cacheBytesVal != null && cacheBytesVal > 0 && <> 当前缓存约 <b>{formatBytes(cacheBytesVal)}</b>。</>}
          {lastCleanedAt && <> 上次清理：{relTime(lastCleanedAt)}。</>}
        </p>
        <Button variant="secondary" loading={clearing} onClick={() => void handleClearCache()} style={{ alignSelf: 'flex-start' }}>
          立即清理缓存
        </Button>
        {cacheMsg && <p className="field-hint" style={{ marginTop: 6 }}>{cacheMsg}</p>}
      </SettingsSection>
    </>
  )
}

const ENGINE_OPTIONS: { value: TranslationEngine; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'bing', label: 'Bing 翻译（默认）' },
  { value: 'ai', label: 'AI 翻译（需配置模型密钥）' },
]

const CACHE_INTERVAL_OPTIONS: { value: string; label: string }[] = [
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

interface SelectOption {
  value: string
  label: string
}

/**
 * 通用设置下拉（复用 engine-* 样式）。原 EngineDropdown 抽象而来：触发器 + 列表 + 选中勾，
 * 受控 open / value。供「翻译引擎」「缓存自动清理频率」等离散选项复用。
 */
function SettingsSelect({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const currentLabel = options.find((o) => o.value === value)?.label ?? ''
  return (
    <Dropdown
      className="engine-dropdown"
      open={open}
      onOpenChange={setOpen}
      align="left"
      trigger={
        <button
          type="button"
          className={`engine-trigger${open ? ' is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
        >
          <span className="engine-trigger-label">{currentLabel}</span>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      }
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            className={`engine-item${selected ? ' is-active' : ''}`}
            onClick={() => { onChange(o.value); setOpen(false) }}
          >
            <span className="engine-item-label">{o.label}</span>
            {selected && (
              <svg className="engine-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        )
      })}
    </Dropdown>
  )
}
