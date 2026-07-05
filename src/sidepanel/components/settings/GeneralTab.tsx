import { WEB_SPEECH_ALLOWED } from '../../../shared/config'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../../../shared/theme'
import type { AppSettings } from '../../../shared/types'
import SettingsSection from './SettingsSection'
import type { SettingsTabProps } from './types'

interface Props extends SettingsTabProps {
  accent: string
  onAccentChange: (hex: string) => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
  policyLocks: Set<keyof AppSettings>
}

/** 通用 tab：外观主题色、语音输入、Auto 模式（自动确认删除）。 */
export default function GeneralTab({
  form,
  patch,
  accent,
  onAccentChange,
  theme,
  onThemeChange,
  policyLocks,
}: Props) {
  return (
    <>
      {/* ── 外观 · 主题色 ── */}
      <SettingsSection title="外观 · 主题色">
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
          <label className="accent-custom" title="自定义颜色">
            <input
              type="color"
              value={accent}
              onChange={(e) => onAccentChange(e.target.value)}
            />
            <span>主题色</span>
          </label>
        </div>
        <div className="theme-row">
          {(['light', 'dark'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`theme-btn ${theme === t ? 'theme-btn--active' : ''}`}
              onClick={() => onThemeChange(t)}
            >
              {t === 'light' ? '浅色' : '深色'}
            </button>
          ))}
        </div>
        <p className="field-hint">
          主题色即时生效并记住选择；与浅/深色模式独立。
          {accent.toLowerCase() !== DEFAULT_ACCENT.toLowerCase() && (
            <> <button className="btn-link" onClick={() => onAccentChange(DEFAULT_ACCENT)}>恢复默认</button></>
          )}
        </p>
      </SettingsSection>

      {/* ── 语音输入 ── */}
      {WEB_SPEECH_ALLOWED && (
        <SettingsSection title="语音输入">
          <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.voiceInput !== false}
              onChange={(e) => patch({ voiceInput: e.target.checked })}
            />
            在输入框显示语音输入
          </label>
          <p className="field-hint">
            用浏览器内置语音识别(zh-CN)把说话转成文字填进输入框，可编辑后再发。
            语音识别由浏览器走 Google 服务完成，音频会发往外部——私有化/内网部署已自动禁用本功能。
          </p>
        </SettingsSection>
      )}

      {/* ── Auto 模式（自动确认删除） ── */}
      <SettingsSection title="Auto 模式（自动确认删除）">
        <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={form.autoConfirm === true}
            disabled={policyLocks.has('autoConfirm')}
            onChange={(e) => patch({ autoConfirm: e.target.checked })}
          />
          开启后，文档内的内容删除（行 / 字段 / 内容块 / 去重）<b>自动确认、不再弹按钮</b>
          {policyLocks.has('autoConfirm') && <span className="field-hint">（由企业策略锁定）</span>}
        </label>
        <p className="field-hint" style={{ color: form.autoConfirm ? '#d4380d' : undefined }}>
          谨慎开启：开启后助手删除文档内容前<b>不再向你确认</b>。
          <b>文件级删除（整表 / 电子表格 / 文档 / 云文件）始终被拦截</b>，Auto 模式也不会放开。
        </p>
      </SettingsSection>
    </>
  )
}
