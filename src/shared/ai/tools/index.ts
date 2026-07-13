import type { ChatCompletionTool } from 'openai/resources'
import { CORE_TOOLS } from './core'
import { BASE_TOOLS } from './base'
import { COMPOSE_TOOLS } from './compose'
import { SHEET_TOOLS } from './sheet'
import { DOC_TOOLS } from './doc'
import { KNOWLEDGE_TOOLS } from './knowledge'
import { BOARD_TOOLS } from './board'

// 飞书工具全集：通用 + Base + 复合 + 电子表格 + 文档 + 画板。
// 工具顺序对 LLM 调用无功能性影响（模型看到全部工具），按产品分组便于维护。
export const FEISHU_TOOLS: ChatCompletionTool[] = [
  ...CORE_TOOLS,
  ...BASE_TOOLS,
  ...COMPOSE_TOOLS,
  ...SHEET_TOOLS,
  ...DOC_TOOLS,
  ...BOARD_TOOLS,
]

export { KNOWLEDGE_TOOLS }
