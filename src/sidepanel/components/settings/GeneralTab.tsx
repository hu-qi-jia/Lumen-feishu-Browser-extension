import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { FormInput, FormSwitch } from '../form'
import Tooltip from '../Tooltip'
import SettingsSection from './SettingsSection'
import SettingsSelect from './SettingsSelect'
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

/** 通用 tab：删除自动确认、本地经验、模板库地址、GitHub Trending翻译、场景模板。 */
export default function GeneralTab({ form, patch, set, policyLocks }: Props) {
  const [engine, setEngine] = useState<TranslationEngine>('bing')
  useEffect(() => { void loadNewsSettings().then((s) => setEngine(s.translationEngine)) }, [])
  const changeEngine = (value: string) => {
    const next = value as TranslationEngine
    setEngine(next)
    void loadNewsSettings().then((s) => saveNewsSettings({ ...s, translationEngine: next }))
  }

  const [recipeN, setRecipeN] = useState<number | null>(null)
  useEffect(() => { void recipeCount().then(setRecipeN) }, [])
  async function handleClearRecipes() {
    await clearRecipes()
    setRecipeN(0)
  }

  return (
    <>
      {/* ── 删除自动确认 ── */}
      <SettingsSection
        title={titleHelp('删除自动确认', AUTO_CONFIRM_TIP)}
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

      {/* ── 本地经验 ── */}
      <SettingsSection
        title={titleHelp('本地经验', `每次任务成功后，仅在本机把「做了什么 + 下次怎么做最稳」提炼成一条经验（不含表格/文档数据），下次遇到相似任务自动参考、少走弯路。最多积累 300 条，已积累 ${recipeN ?? '…'} 条。`)}
        action={
          <span className="section-inline-actions">
            <FormSwitch
              checked={form.learnFromHistory !== false}
              disabled={policyLocks.has('learnFromHistory')}
              onChange={(checked) => patch({ learnFromHistory: checked })}
            />
            <Tooltip content="清空学到的经验" position="bottom">
              <button
                type="button"
                className="icon-btn"
                aria-label="清空学到的经验"
                onClick={() => void handleClearRecipes()}
              >
                <TrashIcon />
              </button>
            </Tooltip>
          </span>
        }
      >
        {policyLocks.has('learnFromHistory') && (
          <p className="field-hint">（由企业策略锁定）</p>
        )}
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

      {/* ── GitHub Trending翻译 ── */}
      <SettingsSection title={titleHelp('GitHub Trending翻译', TRANSLATION_TIP)}>
        <SettingsSelect
          options={ENGINE_OPTIONS}
          value={engine}
          onChange={changeEngine}
          ariaLabel="GitHub 描述翻译引擎"
        />
      </SettingsSection>

      {/* ── 场景模板 ── */}
      <SettingsSection title="场景模板">
        <p className="field-hint">
          在「场景」Tab 中一键搭建 CRM、电商、项目管理系统等应用。内置常用模版，也可通过上方「模板库地址」接入自定义模版库。
        </p>
      </SettingsSection>
    </>
  )
}

function titleHelp(title: string, tip: string) {
  return (
    <>
      {title}
      <Tooltip content={tip} position="bottom">
        <span className="help-icon" aria-label="帮助">
          <InfoIcon />
        </span>
      </Tooltip>
    </>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

const ENGINE_OPTIONS: { value: TranslationEngine; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'bing', label: 'Bing 翻译（默认）' },
  { value: 'ai', label: 'AI 翻译（需配置模型密钥）' },
]
