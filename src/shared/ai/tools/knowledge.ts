import type { ChatCompletionTool } from 'openai/resources'

/** 只读知识库工具（构建启用知识库时默认注入；写入工具留后续计划）。 */
export const KNOWLEDGE_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        '在用户已连接的 Obsidian 知识库中全文检索笔记。返回匹配笔记的路径与片段（非整篇）。' +
        '用户问及个人笔记 / 知识库 / 过往记录，或点名某主题时调用——即使该主题与飞书无关（编程、指令文档等），' +
        '只要可能在知识库里就先查。引用时注明笔记路径。',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: '检索关键词或短语' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_knowledge_notes',
      description:
        '列出用户 Obsidian 知识库中最近修改的笔记（仅路径 + 时间，不含正文）。' +
        '用户问"我有哪些笔记 / 最近写了什么"，或 search 没命中、想浏览可用笔记时调用。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回条数，默认 30，最大 100', minimum: 1, maximum: 100 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_knowledge_note',
      description:
        '读取 Obsidian 知识库中指定路径笔记的完整正文（Markdown）。' +
        '先用 search_knowledge_base / list_knowledge_notes 拿到路径，再按需读全文。大笔记会被截断。',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'vault 内相对路径，如 "Inbox/想法.md"' },
        },
      },
    },
  },
]
