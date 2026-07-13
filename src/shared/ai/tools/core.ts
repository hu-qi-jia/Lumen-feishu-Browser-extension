import type { ChatCompletionTool } from 'openai/resources'

// 与产品无关的通用工具：数据看板生成 + 通用 OpenAPI 调用。
export const CORE_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'render_data_app',
      description:
        '把当前多维表格/电子表格的数据做成一个**嵌在飞书页面里的看板/数据应用**，渲染成可拖拽的浮窗。' +
        '能做：图表看板、可打印报表、汇报幻灯片、卡片墙/看板视图、交互计算器。' +
        '当用户说"做个看板/图表/报表/幻灯片/计算器/把这张表做成…"等需求时调用，模型按描述自动选类型。' +
        'request 用一句话描述要什么。数据源是当前页面的表，无需用户提供 id。',
      parameters: {
        type: 'object',
        required: ['request'],
        properties: {
          request: { type: 'string', description: '用户对图表的自然语言描述，例如「按地区统计销量做柱状图」' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'feishu_api_call',
      description:
        '通用飞书 OpenAPI 调用——当现有专用工具无法满足需求时，按飞书官方 API 文档自己构造请求直接调用。' +
        'path 是相对 /open-apis 的路径（以 / 开头，host 由部署环境决定），method 用 GET/POST/PUT/DELETE/PATCH，' +
        'body 是请求体对象，query 是查询参数对象。例如读取文档评论：GET /drive/v1/files/{document_id}/comments?file_type=docx。' +
        '用它做删除/批量修改等破坏性操作时，同样要先告知用户并获确认。优先用专用工具，专用工具没有的能力才用本工具。',
      parameters: {
        type: 'object',
        required: ['method', 'path'],
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
          path: { type: 'string', description: '相对 /open-apis 的接口路径，以 / 开头，如 /docx/v1/documents/xxx/blocks' },
          body: { type: 'object', description: '请求体（POST/PUT/PATCH 用）', additionalProperties: true },
          query: { type: 'object', description: '查询参数键值对', additionalProperties: true },
        },
      },
    },
  },
]
