import type { ChatCompletionTool } from 'openai/resources'

// 多维表格 Base 工具：App / 表 / 字段 / 记录 / 视图 / 仪表盘。
export const BASE_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_app_info',
      description:
        'Get info about the current Feishu Base (多维表格) app. ' +
        'If already on a Base page, app_token is auto-detected from the URL — no need to specify.',
      parameters: {
        type: 'object',
        properties: {
          app_token: { type: 'string', description: 'App token (optional if on Base page)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_bitable_app',
      description: 'Create a new Feishu Base (多维表格) application.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'App name' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tables',
      description: 'List all tables inside a Feishu Base app.',
      parameters: {
        type: 'object',
        required: ['app_token'],
        properties: {
          app_token: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_table',
      description:
        'Create a new table (数据表) in a Feishu Base. ' +
        'Optionally pass initial fields to avoid separate create_field calls. ' +
        'IMPORTANT: Choose field types based on the actual data content — do NOT default everything to Text(1). ' +
        'See field-type guide below.\n' +
        'Type selection guide:\n' +
        '- Text(1): names, descriptions, free-form notes, sentences\n' +
        '- Number(2): quantities, amounts, prices, scores, ages, counts\n' +
        '- SingleSelect(3): status, priority, category, type — any single-choice enum. Pass `options` with all possible values.\n' +
        '- MultiSelect(4): tags, labels, skills — any multi-choice enum. Pass `options`.\n' +
        '- DateTime(5): dates, deadlines, timestamps (e.g. "2024-01-15", "3月5号")\n' +
        '- Checkbox(7): yes/no, done/pending, boolean flags\n' +
        '- Person(11): owner, assignee, reviewer — who is responsible\n' +
        '- Phone(13): phone numbers\n' +
        '- URL(15): links, websites\n' +
        '- Attachment(17): files, images\n' +
        '- Formula(20): computed from other fields. Pass `formula_expression`.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_name'],
        properties: {
          app_token: { type: 'string' },
          table_name: { type: 'string' },
          fields: {
            type: 'array',
            description: 'Initial fields. Choose types based on data content — do NOT default all to Text(1). For select fields, always pass `options` with all possible values.',
            items: {
              type: 'object',
              required: ['field_name', 'type'],
              properties: {
                field_name: { type: 'string' },
                type: {
                  type: 'integer',
                  description:
                    '1=Text 2=Number 3=SingleSelect 4=MultiSelect 5=DateTime 7=Checkbox 11=Person 13=Phone 15=URL 17=Attachment 20=Formula',
                },
                options: {
                  type: 'array',
                  description: 'Required for SingleSelect(3) and MultiSelect(4). List ALL possible option values.',
                  items: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string' },
                      color: { type: 'integer', description: '0-54' },
                    },
                  },
                },
                formula_expression: {
                  type: 'string',
                  description: 'For formula fields (type=20). Reference fields by exact name, e.g. "数量*单价".',
                },
                description: { type: 'string' },
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
      name: 'delete_table',
      description:
        '破坏性操作·不可撤销。删除整张数据表及其所有记录。' +
        '调用前必须在回复中明确告知用户：将删除的表名（及大致记录数量），并等待用户明确确认（"确认"/"是"/"yes"）后才可调用。',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string', description: 'Table ID to delete' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_fields',
      description: 'List all fields (columns) in a table.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_field',
      description: 'Add a single field (column) to a table. Choose the field type based on the actual data content — do NOT default to Text(1). See create_table for the type selection guide.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'field_name', 'type'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          field_name: { type: 'string' },
          type: {
            type: 'integer',
            description: '1=Text 2=Number 3=SingleSelect 4=MultiSelect 5=DateTime 7=Checkbox 11=Person 13=Phone 15=URL 17=Attachment 20=Formula',
          },
          options: {
            type: 'array',
            description: 'Options for select fields (name + optional color 0-54)',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                color: { type: 'integer' },
              },
            },
          },
          formula_expression: {
            type: 'string',
            description:
              'For formula fields (type=20). Reference other fields by their EXACT name, e.g. "数量*单价" or "单价*0.8". 不要用 CurrentValue 或字段ID。',
          },
          description: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_records',
      description: 'List one page of records in a table. Returns {total, has_more, next_page_token, count, items}. When has_more=true, pass next_page_token as page_token to fetch the next page (do not improvise another way). page_size default 20, max 100.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          page_size: { type: 'integer', description: 'Max 100, default 20' },
          page_token: { type: 'string', description: '上一页返回的 next_page_token；has_more=true 时用它取下一页，直到 has_more=false' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_record',
      description: 'Create one record in a table.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'fields'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          fields: {
            type: 'object',
            description: 'Key = exact field name, value = cell value',
            additionalProperties: true,
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_create_records',
      description: 'Create multiple records at once (use this instead of looping create_record).',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'records'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          records: {
            type: 'array',
            items: {
              type: 'object',
              required: ['fields'],
              properties: {
                fields: {
                  type: 'object',
                  additionalProperties: true,
                },
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
      name: 'update_record',
      description: 'Update specific fields of an existing record.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'record_id', 'fields'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          record_id: { type: 'string' },
          fields: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_view',
      description: 'Create a new view (视图) for a table: grid, kanban, gallery, gantt, or form.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'view_name', 'view_type'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          view_name: { type: 'string' },
          view_type: {
            type: 'string',
            enum: ['grid', 'kanban', 'gallery', 'gantt', 'form'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_views',
      description: 'List all views of a table.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
        },
      },
    },
  },
  // ── Edit operations ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'update_field',
      description: 'Rename a field or update its select options. Use field_id (from list_fields or the context) for precision.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'field_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          field_id: { type: 'string', description: 'Field ID to update' },
          field_name: { type: 'string', description: 'New name (omit to keep current)' },
          options: {
            type: 'array',
            description: 'Full replacement options list for select fields. Provide ALL options, not just new ones.',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                color: { type: 'integer', description: '0-54' },
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
      name: 'delete_field',
      description:
        '破坏性操作·不可撤销。' +
        '调用前必须在回复中明确告知用户：将删除的字段名称和所属表名，并等待用户明确确认（"确认"/"是"/"yes"）后才可调用。',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'field_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          field_id: { type: 'string', description: 'Field ID from list_fields or Base context' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_records',
      description: 'Search records in a table with a filter expression. Returns {total, has_more, next_page_token, count, items} with each record ID. When has_more=true, pass next_page_token as page_token to fetch the next page.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          filter: {
            type: 'string',
            description: 'Feishu filter formula, e.g. CurrentValue.[状态]="待处理" or AND(CurrentValue.[优先级]="高",CurrentValue.[状态]!="已完成")',
          },
          page_size: { type: 'integer', description: 'Max 100' },
          view_id: { type: 'string', description: 'Optional: restrict to a specific view' },
          page_token: { type: 'string', description: '上一页返回的 next_page_token；has_more=true 时取下一页' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_update_records',
      description: 'Update multiple records at once. Each record must include its record_id. Use search_records first to find the IDs.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'records'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          records: {
            type: 'array',
            items: {
              type: 'object',
              required: ['record_id', 'fields'],
              properties: {
                record_id: { type: 'string' },
                fields: { type: 'object', additionalProperties: true },
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
      name: 'delete_record',
      description:
        '破坏性操作。删除后对话里会出现「↩ 撤销删除」按钮可一键恢复（重建该记录，10 分钟内有效）。' +
        '调用前仍必须告知用户将删除的记录关键内容，并获得明确确认后才可调用。' +
        '若用户想恢复，引导其点对话中的「↩ 撤销删除」，切勿建议用 Ctrl+Z（API 删除无法用前端撤销）。',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'record_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          record_id: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_delete_records',
      description:
        '批量破坏性操作。删除后对话里会出现「↩ 撤销删除」按钮可一键恢复（重建这些记录，10 分钟内有效）。' +
        '调用前仍必须告知用户将删除的记录数量和筛选条件，并获得明确确认后才可调用。' +
        '请先用 search_records 获取 ID 列表。若用户想恢复，引导其点「↩ 撤销删除」，切勿建议 Ctrl+Z。',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'record_ids'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          record_ids: { type: 'array', items: { type: 'string' }, description: 'Array of record IDs to delete' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dashboards',
      description: 'List all dashboards (仪表盘) in a Feishu Base app. Returns each dashboard name + block_id.',
      parameters: {
        type: 'object',
        required: ['app_token'],
        properties: {
          app_token: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_dashboard',
      description:
        '复制一个已存在的仪表盘（含其全部图表）到同一个 Base，生成一个新仪表盘。' +
        '这是飞书 API 唯一支持的仪表盘写操作——无法程序化新建仪表盘或单独添加图表。' +
        '**你必须自己先调 list_dashboards 拿到 dashboard_block_id，绝不要让用户去查或提供 block_id。**需对该 Base 有编辑权限。',
      parameters: {
        type: 'object',
        required: ['app_token', 'dashboard_block_id', 'name'],
        properties: {
          app_token: { type: 'string' },
          dashboard_block_id: { type: 'string', description: '源仪表盘的 block_id（来自 list_dashboards）' },
          name: { type: 'string', description: '新仪表盘名称' },
        },
      },
    },
  },
]
