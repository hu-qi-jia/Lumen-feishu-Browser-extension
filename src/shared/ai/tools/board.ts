import type { ChatCompletionTool } from 'openai/resources'

// 画板 Whiteboard 工具。
export const BOARD_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_whiteboard',
      description:
        '创建一个新的飞书画板（Whiteboard）并插入到文档中。飞书 API 不支持独立创建画板，实际是通过在文档中插入画板块（block_type 43）来创建。' +
        '若在文档页面使用且未传 document_id，会直接插入到当前文档；传了 document_id 则插入到指定文档；两者都没有时才新建一篇宿主文档。' +
        '返回 whiteboard_id + title + document_id + block_id。',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: '画板标题' },
          document_id: { type: 'string', description: '目标文档 token（默认当前文档；无目标文档时才新建宿主文档）' },
          index: { type: 'integer', description: '插入位置（0=文档开头，默认 0）' },
          folder_token: { type: 'string', description: '可选：仅当需要新建宿主文档时指定目标文件夹 token' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_whiteboard_info',
      description:
        '获取画板的元信息（标题、所有者等）。' +
        '若已在画板页面，whiteboard_id 会从当前页面自动识别，无需传入。',
      parameters: {
        type: 'object',
        properties: {
          whiteboard_id: { type: 'string', description: '可选：画板 ID（在画板页面时自动识别）' },
        },
      },
    },
  },
]
