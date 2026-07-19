import { useEffect, useState } from 'react'
import FormSwitch from '../ui/FormSwitch'
import { IconTrash } from '../ui/icons'
import Tooltip from '../ui/Tooltip'
import IconButton from '../ui/IconButton'
import SettingsSection from './SettingsSection'
import SettingsSelect from './SettingsSelect'
import { HelpIcon, TitleWithHelp } from './HelpIcon'
import type { SettingsTabProps } from './types'
import { loadNewsSettings, saveNewsSettings } from '@/shared/news/store'
import type { TranslationEngine } from '@/shared/news/types'
import { clearRecipes, recipeCount } from '@/shared/ai/recipes'

const AUTO_CONFIRM_TIP = '删除文档行、字段、内容块及去重等操作不再确认。文件级删除始终拦截。'
const SWITCH_DOC_TIP = 'Follow（跟随标签页）模式下，切到别的文档时不再弹出"切换工作文档？"询问，直接跟随新文档；原会话保留在历史里。'
const TRANSLATION_TIP = 'Bing 翻译免费，AI 翻译使用已配置模型。翻译结果会缓存。'

/** 通用 tab：删除自动确认、本地经验、GitHub Trending翻译。 */
export default function GeneralTab({ form, patch }: SettingsTabProps) {
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
              onChange={(checked) => patch({ autoConfirm: checked })}
            />
          </span>
        </div>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">
              切换文档不再询问
              <HelpIcon tip={SWITCH_DOC_TIP} />
            </span>
            <span className="settings-row-desc">Follow 模式切到别的文档时直接跟随，不弹确认</span>
          </div>
          <span className="settings-row-control">
            <FormSwitch
              checked={form.skipSwitchDocPrompt === true}
              onChange={(checked) => patch({ skipSwitchDocPrompt: checked })}
            />
          </span>
        </div>
      </SettingsSection>

      {/* ── 本地经验 ── */}
      <SettingsSection title={<TitleWithHelp title="本地经验" tip={`任务成功后在本机提炼可复用经验（仅记录任务描述与工具名称，不含文档/表格数据），新任务自动匹配相似经验作为参考。上限 300 条，当前 ${recipeN ?? '…'} 条。`} />}>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">经验积累</span>
            <span className="settings-row-desc">完成后自动提炼经验，相似任务自动复用</span>
          </div>
          <span className="settings-row-control">
            <FormSwitch
              checked={form.learnFromHistory !== false}
              onChange={(checked) => patch({ learnFromHistory: checked })}
            />
            <Tooltip content="清空经验库" position="bottom">
              <IconButton aria-label="清空经验库" onClick={() => void handleClearRecipes()}>
                <IconTrash />
              </IconButton>
            </Tooltip>
          </span>
        </div>
      </SettingsSection>

      {/* ── GitHub Trending翻译 ── */}
      <SettingsSection title={<TitleWithHelp title="GitHub Trending翻译" tip={TRANSLATION_TIP} />}>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">翻译引擎</span>
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
    </>
  )
}

const ENGINE_OPTIONS: { value: TranslationEngine; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'bing', label: 'Bing翻译' },
  { value: 'ai', label: 'AI翻译' },
]
