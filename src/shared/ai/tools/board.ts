import type { ChatCompletionTool } from 'openai/resources'

// 画板 Whiteboard 工具。
export const BOARD_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_whiteboard',
      description: '创建一个新的飞书画板（Whiteboard）。返回 whiteboard_id + title。',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: '画板标题' },
          folder_token: { type: 'string', description: '可选：目标文件夹 token' },
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
