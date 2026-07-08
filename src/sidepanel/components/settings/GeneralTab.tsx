import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { FormInput, FormSwitch } from '../form'
import { IconTrash } from '../icons'
import Tooltip from '../Tooltip'
import SettingsSection from './SettingsSection'
import SettingsSelect from './SettingsSelect'
import { HelpIcon, TitleWithHelp } from './HelpIcon'
import type { SettingsTabProps } from './types'
import '../IconButton.css'
import { loadNewsSettings, saveNewsSettings } from '../../../shared/news/store'
import type { TranslationEngine } from '../../../shared/news/types'
import { clearRecipes, recipeCount } from '../../../shared/ai/recipes'

interface Props extends SettingsTabProps {
  policyLocks: Set<keyof AppSettings>
}

const AUTO_CONFIRM_TIP = '删除文档行、字段、内容块及去重等操作不再确认。文件级删除始终拦截。'
const TRANSLATION_TIP = 'Bing 翻译免费，AI 翻译使用已配置模型。翻译结果会缓存。'
const REGISTRY_TIP = '留空使用内置模板库。支持 HTTPS 或本地测试地址，格式为单文件 bundle 或 index.json。'

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
            <span className="settings-row-desc">删除行、字段、内容块时跳过确认</span>
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
      <SettingsSection title={<TitleWithHelp title="本地经验" tip={`任务成功后在本机提炼执行经验（不含表格/文档数据），相似任务自动参考。最多 300 条，已积累 ${recipeN ?? '…'} 条。`} />}>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">记住成功经验</span>
            <span className="settings-row-desc">相似任务自动参考历史经验</span>
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
                className="icon-action"
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
      <SettingsSection title={<TitleWithHelp title="模板库地址" tip={REGISTRY_TIP} />}>
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
      <SettingsSection title={<TitleWithHelp title="GitHub Trending翻译" tip={TRANSLATION_TIP} />}>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">翻译引擎</span>
            <span className="settings-row-desc">GitHub 项目描述的翻译方式</span>
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
        <div className="settings-field">
          <span className="settings-field-label">可用模板</span>
          <span className="settings-field-desc">内置 CRM、电商、项目管理系统等常用模板，也可通过「模板库地址」接入自定义模板库。</span>
        </div>
      </SettingsSection>
    </>
  )
}

const ENGINE_OPTIONS: { value: TranslationEngine; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'bing', label: 'Bing 翻译（默认）' },
  { value: 'ai', label: 'AI 翻译（需配置模型密钥）' },
]
