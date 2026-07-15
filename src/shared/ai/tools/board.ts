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
  {
    type: 'function',
    function: {
      name: 'list_whiteboard_nodes',
      description:
        '列出画板中的所有节点（完整画布树）。每个节点含 id / type / parent_id / children / x / y / width / height / text 等字段。' +
        '用于查看画板现有内容、定位要删除的节点 ID。若已在画板页面，whiteboard_id 自动识别。',
      parameters: {
        type: 'object',
        properties: {
          whiteboard_id: { type: 'string', description: '可选：画板 ID（在画板页面时自动识别）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_whiteboard_diagram',
      description:
        '用 PlantUML 或 Mermaid 语法在画板中生成图形（推荐方式）。飞书会自动解析语法并排版为画板节点。' +
        '适合：流程图、时序图、类图、ER 图、思维导图、活动图等结构化图形。比 create_whiteboard_nodes 手动摆坐标简单得多——' +
        '只需写出语法，飞书自动布局。语法示例见系统提示词「画板图形语法」。',
      parameters: {
        type: 'object',
        required: ['code'],
        properties: {
          whiteboard_id: { type: 'string', description: '可选：画板 ID（在画板页面时自动识别）' },
          code: { type: 'string', description: 'PlantUML 或 Mermaid 代码（PlantUML 用 @startuml...@enduml 包裹）' },
          syntax_type: {
            type: 'integer',
            enum: [1, 2],
            description: '1=PlantUML（默认），2=Mermaid',
          },
          diagram_type: {
            type: 'integer',
            description: 'PlantUML 图形类型：0=自动识别（默认），1=思维导图，2=时序图，3=活动图，4=类图。Mermaid 时传 0。',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_whiteboard_nodes',
      description:
        '在画板中手动创建一个或多个节点（需自行指定坐标和尺寸）。适合放置便签、独立形状、连接线等非结构化元素。' +
        '节点类型：composite_shape（基础图形，需指定 shape 子类型）/ text_shape（纯文字）/ sticky_note（便签）/ connector（连线）/ section（分区）/ group（组合）/ image（图片）。' +
        '优先用 create_whiteboard_diagram 画结构化图形（流程图/时序图等），本工具用于零散元素或精确控制位置。',
      parameters: {
        type: 'object',
        required: ['whiteboard_id', 'nodes'],
        properties: {
          whiteboard_id: { type: 'string', description: '画板 ID' },
          nodes: {
            type: 'array',
            description: '要创建的节点数组（最多 3000 个）',
            items: {
              type: 'object',
              required: ['type'],
              properties: {
                type: {
                  type: 'string',
                  enum: ['composite_shape', 'text_shape', 'sticky_note', 'connector', 'section', 'group', 'image', 'mind_map'],
                  description: '节点类型',
                },
                parent_id: { type: 'string', description: '父节点 ID（容器类型：section/group/table/life_line）。顶层节点不传。' },
                x: { type: 'number', description: 'X 坐标（画布坐标系）' },
                y: { type: 'number', description: 'Y 坐标' },
                width: { type: 'number', description: '宽度' },
                height: { type: 'number', description: '高度' },
                z_index: { type: 'integer', description: '层级（数字越大越靠上）' },
                angle: { type: 'number', description: '旋转角度（度）' },
                shape: {
                  type: 'string',
                  description: 'composite_shape 的子类型：rect/diamond/ellipse/cylinder/round_rect/triangle/star/hexagon/parallelogram/trapezoid/forward_arrow/double_arrow/cloud 等',
                },
                text: {
                  type: 'object',
                  description: '节点文本',
                  properties: {
                    text: { type: 'string' },
                    font_size: { type: 'integer' },
                    bold: { type: 'boolean' },
                    italic: { type: 'boolean' },
                    horizontal_align: { type: 'string', enum: ['left', 'center', 'right'] },
                    vertical_align: { type: 'string', enum: ['top', 'mid', 'bottom'] },
                    text_color: { type: 'string', description: '十六进制颜色，如 #FF0000' },
                  },
                },
                fill_color: { type: 'string', description: '填充色（十六进制，如 #4f6bff）' },
                border_color: { type: 'string', description: '边框色（十六进制）' },
                border_width: { type: 'number', description: '边框宽度' },
                start_id: { type: 'string', description: 'connector 起点节点 ID' },
                end_id: { type: 'string', description: 'connector 终点节点 ID' },
                file_token: { type: 'string', description: 'image 类型的文件 token' },
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_whiteboard_nodes',
      description:
        '破坏性操作·不可撤销。按节点 ID 删除画板中的节点（递归删除所有子孙节点）。' +
        '调用前必须先用 list_whiteboard_nodes 查出要删的节点 ID，并在回复中告知用户将删除的内容。',
      parameters: {
        type: 'object',
        required: ['whiteboard_id', 'node_ids'],
        properties: {
          whiteboard_id: { type: 'string', description: '画板 ID' },
          node_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '要删除的节点 ID 列表（最多 100 个）',
          },
        },
      },
    },
  },
]
