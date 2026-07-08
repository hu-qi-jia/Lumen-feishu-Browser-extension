import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { FormInput, FormSwitch } from '../form'
import Dropdown from '../Dropdown'
import Tooltip from '../Tooltip'
import SettingsSection from './SettingsSection'
import type { SettingsTabProps } from './types'
import { loadNewsSettings, saveNewsSettings } from '../../../shared/news/store'
import type { TranslationEngine } from '../../../shared/news/types'
import { clearRecipes, recipeCount } from '../../../shared/ai/recipes'

interface Props extends SettingsTabProps {
  policyLocks: Set<keyof AppSettings>
}

const AUTO_CONFIRM_TIP = '开启后，删除文档内的行 / 字段 / 内容块 / 去重等操作不再弹确认按钮。文件级删除（整表 / 电子表格 / 文档 / 云文件）始终拦截。'
const TRANSLATION_TIP = 'Bing 翻译使用免费接口，无需配置；AI 翻译使用已配置的模型，速度较慢但质量更高。翻译结果会缓存，重复刷新不会重复调用。'
const REGISTRY_TIP = '留空使用内置模版。填写任意可访问的地址（HTTPS，或 http://localhost 本地测试），「场景」Tab 即可拉取。支持单文件 bundle（一个 .json 内含全部模版）或 index.json + 多文件两种格式。'

/** 通用 tab：自动确认、GitHub Trending翻译、场景模版、模板库地址、本地经验。 */
export default function GeneralTab({ form, patch, set, policyLocks }: Props) {
  // News translation engine — stored in news_settings_v1 (separate from AppSettings), so
  // it's loaded/saved independently and takes effect immediately.
  const [engine, setEngine] = useState<TranslationEngine>('bing')
  useEffect(() => { void loadNewsSettings().then((s) => setEngine(s.translationEngine)) }, [])
  const changeEngine = (value: string) => {
    const next = value as TranslationEngine
    setEngine(next)
    void loadNewsSettings().then((s) => saveNewsSettings({ ...s, translationEngine: next }))
  }

  // 本地经验：条数 + 清空
  const [recipeN, setRecipeN] = useState<number | null>(null)
  useEffect(() => { void recipeCount().then(setRecipeN) }, [])
  async function handleClearRecipes() {
    await clearRecipes()
    setRecipeN(0)
  }

  return (
    <>
      {/* ── 自动确认 ── */}
      <SettingsSection
        title={titleHelp('自动确认', AUTO_CONFIRM_TIP)}
        action={
          <FormSwitch
            checked={form.autoConfirm === true}
            disabled={policyLocks.has('autoConfirm')}
            onChange={(checked) => patch({ autoConfirm: checked })}
          />
        }
      >
        {policyLocks.has('autoConfirm') && (
          <p className="field-hint">（由企业策略锁定）</p>
        )}
      </SettingsSection>

      {/* ── GitHub Trending翻译 ── */}
      <SettingsSection title={titleHelp('GitHub Trending翻译', TRANSLATION_TIP)}>
        <SettingsSelect
          options={ENGINE_OPTIONS}
          value={engine}
          onChange={changeEngine}
          ariaLabel="GitHub 描述翻译引擎"
        />
      </SettingsSection>

      {/* ── 场景模版 ── */}
      <SettingsSection title="场景模版">
        <p className="field-hint">
          在「场景」Tab 中一键搭建 CRM、电商、项目管理系统等应用。内置常用模版，也可通过下方配置接入自定义模版库。
        </p>
      </SettingsSection>

      {/* ── 模板库地址 ── */}
      <SettingsSection title={titleHelp('模板库地址', REGISTRY_TIP)}>
        <FormInput
          type="text"
          value={form.templateRegistryUrl}
          onChange={set('templateRegistryUrl')}
          placeholder="https://… 或 http://localhost:8787/registry.json"
        />
      </SettingsSection>

      {/* ── 本地经验 ── */}
      <SettingsSection
        title={titleHelp('本地经验', `每次任务成功后，仅在本机把「做了什么 + 下次怎么做最稳」提炼成一条经验（不含表格/文档数据），下次遇到相似任务自动参考、少走弯路。最多积累 300 条，已积累 ${recipeN ?? '…'} 条。`)}
        action={
          <FormSwitch
            checked={form.learnFromHistory !== false}
            disabled={policyLocks.has('learnFromHistory')}
            onChange={(checked) => patch({ learnFromHistory: checked })}
          />
        }
      >
        {policyLocks.has('learnFromHistory') && (
          <p className="field-hint">（由企业策略锁定）</p>
        )}
        <button className="btn-secondary" onClick={() => void handleClearRecipes()} style={{ alignSelf: 'flex-start' }}>
          清空学到的经验
        </button>
      </SettingsSection>
    </>
  )
}

function titleHelp(title: string, tip: string) {
  return (
    <>
      {title}
      <Tooltip content={tip} position="bottom">
        <span className="help-icon" aria-label="帮助">?</span>
      </Tooltip>
    </>
  )
}

const ENGINE_OPTIONS: { value: TranslationEngine; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'bing', label: 'Bing 翻译（默认）' },
  { value: 'ai', label: 'AI 翻译（需配置模型密钥）' },
]

interface SelectOption {
  value: string
  label: string
}

/**
 * 通用设置下拉。原 EngineDropdown 抽象而来：触发器 + 列表 + 选中勾，
 * 受控 open / value。供「翻译引擎」等离散选项复用。
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
