import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { FormInput, FormSwitch } from '../form'
import { IconTrash } from '../icons'
import Tooltip from '../Tooltip'
import SettingsSection from './SettingsSection'
import SettingsSelect from './SettingsSelect'
import type { SettingsTabProps } from './types'
import '../SessionDrawer.css'
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
      {/* ── 操作确认 ── */}
      <SettingsSection title="操作确认">
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">
              删除自动确认
              <HelpIcon tip={AUTO_CONFIRM_TIP} />
            </span>
            <span className="settings-row-desc">删除文档内容时不再弹确认，文件级删除始终拦截</span>
          </div>
          <span className="settings-row-control">
            <FormSwitch
              checked={form.autoConfirm === true}
              disabled={policyLocks.has('autoConfirm')}
              onChange={(checked) => patch({ autoConfirm: checked })}
            />
          </span>
        </div>
        {policyLocks.has('autoConfirm') && (
          <p className="field-hint">（由企业策略锁定）</p>
        )}
      </SettingsSection>

      {/* ── 本地经验 ── */}
      <SettingsSection title={titleHelp('本地经验', `每次任务成功后，仅在本机把「做了什么 + 下次怎么做最稳」提炼成一条经验（不含表格/文档数据），下次遇到相似任务自动参考、少走弯路。最多积累 300 条，已积累 ${recipeN ?? '…'} 条。`)}>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">记住成功经验</span>
            <span className="settings-row-desc">从任务中提炼本地经验，下次遇到相似任务自动参考</span>
          </div>
          <span className="settings-row-control">
            <FormSwitch
              checked={form.learnFromHistory !== false}
              disabled={policyLocks.has('learnFromHistory')}
              onChange={(checked) => patch({ learnFromHistory: checked })}
            />
            <Tooltip content="清空学到的经验" position="bottom">
              <button
                type="button"
                className="drawer-row-btn"
                aria-label="清空学到的经验"
                onClick={() => void handleClearRecipes()}
              >
                <IconTrash />
              </button>
            </Tooltip>
          </span>
        </div>
        {policyLocks.has('learnFromHistory') && (
          <p className="field-hint">（由企业策略锁定）</p>
        )}
      </SettingsSection>

      {/* ── 模板库地址 ── */}
      <SettingsSection title={titleHelp('模板库地址', REGISTRY_TIP)}>
        <div className="settings-field">
          <span className="settings-field-label">自定义模板库地址</span>
          <FormInput
            type="text"
            value={form.templateRegistryUrl}
            onChange={set('templateRegistryUrl')}
            placeholder="https://… 或 http://localhost:8787/registry.json"
          />
        </div>
      </SettingsSection>

      {/* ── GitHub Trending翻译 ── */}
      <SettingsSection title={titleHelp('GitHub Trending翻译', TRANSLATION_TIP)}>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">翻译引擎</span>
            <span className="settings-row-desc">选择项目描述翻译方式</span>
          </div>
          <span className="settings-row-control">
            <SettingsSelect
              options={ENGINE_OPTIONS}
              value={engine}
              onChange={changeEngine}
              ariaLabel="GitHub 描述翻译引擎"
            />
          </span>
        </div>
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
          <HelpIconSvg />
        </span>
      </Tooltip>
    </>
  )
}

function HelpIcon({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} position="bottom">
      <span className="help-icon" aria-label="帮助">
        <HelpIconSvg />
      </span>
    </Tooltip>
  )
}

function HelpIconSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

const ENGINE_OPTIONS: { value: TranslationEngine; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'bing', label: 'Bing 翻译（默认）' },
  { value: 'ai', label: 'AI 翻译（需配置模型密钥）' },
]
