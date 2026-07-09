import type { ChatCompletionTool } from 'openai/resources'

export const FEISHU_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'render_data_app',
      description:
        '把当前多维表格/电子表格的数据做成一个**嵌在飞书页面里的小程序/数据应用**，渲染成可拖拽的浮窗。' +
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
        'Optionally pass initial fields to avoid separate create_field calls.',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_name'],
        properties: {
          app_token: { type: 'string' },
          table_name: { type: 'string' },
          fields: {
            type: 'array',
            description: 'Initial fields (optional)',
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
                  description: 'For select fields',
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
      description: 'Add a single field (column) to a table.',
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
      name: 'base_table_to_sheet',
      description:
        '把多维表格的某个数据表（字段+全部记录）一键转换成一个新的电子表格。' +
        '飞书没有 Base→电子表格 的原生一键功能，这是多步联动实现（读全量记录→建表格→写入）。',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          title: { type: 'string', description: '新电子表格标题（可选）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_table',
      description:
        '对多维表格的数据表做分组聚合（数据透视），结果写入一个新电子表格。' +
        '飞书 Base API 没有任何聚合能力——本工具读全量记录后在本地按 group_by 分组，对 metrics 逐项算 count/sum/avg/max/min。' +
        '例：按"地区"分组，统计 sum(金额) 和 count → 各地区销售额与订单数。',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'group_by', 'metrics'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          group_by: { type: 'string', description: '分组字段名' },
          metrics: {
            type: 'array',
            description: '聚合指标列表',
            items: {
              type: 'object',
              required: ['field', 'op'],
              properties: {
                field: { type: 'string', description: '聚合字段名（op=count 时可留空）' },
                op: { type: 'string', enum: ['count', 'sum', 'avg', 'max', 'min'] },
              },
            },
          },
          title: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'base_to_doc_report',
      description:
        '读取整个多维表格(Base)的结构（各数据表、字段、记录数），自动生成一篇汇总报告飞书文档。' +
        '适合"把这个表的情况生成一份说明/周报文档"。注意：是内容生成，不是文件导出。',
      parameters: {
        type: 'object',
        required: ['app_token'],
        properties: {
          app_token: { type: 'string' },
          title: { type: 'string', description: '报告标题，默认"数据汇总报告"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_data_report',
      description:
        '对**当前**多维表格/电子表格的**数据本身**做 AI 叙事分析（摘要 / 关键发现 / 趋势异常 / 建议，结合真实数字），' +
        '生成一篇飞书文档并在文末附上源数据表。数据源是当前页面，无需 app_token。' +
        '区别于 base_to_doc_report（那个只汇总表/字段/记录数等结构信息）。',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          focus: { type: 'string', description: '可选，分析重点，例如「重点看销售趋势」' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'audit_document',
      description:
        '对**当前飞书文档**做一次 AI 体检/审稿：通读全文，找出逻辑断点 / 未定义术语 / 前后矛盾 / 遗留 TODO / ' +
        '过期数据 / 空小节等问题，返回可定位的问题清单。只读、不修改文档。' +
        '当用户说"帮我审一下这篇文档 / 体检 / 挑挑问题"时调用（数据源是当前文档页面）。',
      parameters: { type: 'object', required: [], properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_document',
      description:
        '总结**当前飞书文档**：通读全文，按用户设定的总结要求（可在「文档总结」面板里自定义、本机保存）生成' +
        '摘要 / 要点 / 待办等。只读、不修改文档。当用户说"总结 / 概括这篇文档"时调用（数据源是当前文档页面）。',
      parameters: {
        type: 'object',
        required: [],
        properties: { prompt: { type: 'string', description: '可选，本次总结要求；不传则用用户已保存的默认要求' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dedupe_records',
      description:
        '破坏性操作·不可撤销。按 key_fields 组合去重：扫描全表→按关键字段值分组→每组保留一条、删除其余重复记录。' +
        '调用前必须先用 dry_run=true 预览重复组数和将删除的记录数，在回复中告知用户，并获得明确确认（"确认"/"是"/"yes"）后才能真正删除。',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'key_fields'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          key_fields: {
            type: 'array',
            description: '组合去重的字段名列表，按这些字段的值拼成唯一键（全部相等才算重复）',
            items: { type: 'string' },
          },
          keep: { type: 'string', enum: ['first', 'last'], description: '每组保留哪条，默认 first（扫描顺序第一条）' },
          dry_run: { type: 'boolean', description: 'true 时只统计重复、不删除（务必先预览再删）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cross_table_lookup',
      description:
        '跨表 VLOOKUP（飞书原生没有跨表匹配能力）：用源表的 source_key_field 值去目标表的 target_key_field 匹配，' +
        '把目标表的 target_value_field 回填到源表的 into_field 列。into_field 不存在时默认自动新建文本列。多命中按 on_multiple 处理。',
      parameters: {
        type: 'object',
        required: [
          'app_token', 'source_table_id', 'source_key_field',
          'target_table_id', 'target_key_field', 'target_value_field', 'into_field',
        ],
        properties: {
          app_token: { type: 'string', description: '两张表所在的同一个 Base' },
          source_table_id: { type: 'string', description: '源表（被回填的 A 表）' },
          source_key_field: { type: 'string', description: 'A 表用于匹配的键字段名' },
          target_table_id: { type: 'string', description: '目标表（提供值的 B 表）' },
          target_key_field: { type: 'string', description: 'B 表用于匹配的键字段名' },
          target_value_field: { type: 'string', description: 'B 表要取出的值字段名' },
          into_field: { type: 'string', description: 'A 表回填目标列名（不存在则新建文本列）' },
          on_multiple: {
            type: 'string',
            enum: ['first', 'join', 'skip'],
            description: 'B 表多条匹配时：first=取第一条(默认)，join=逗号拼接全部，skip=跳过不写',
          },
          create_field_if_missing: { type: 'boolean', description: 'into_field 不存在时是否自动建文本列，默认 true' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_where',
      description:
        '按条件批量改：用 filter 搜出全部匹配记录→对每条写入 set 指定的字段值' +
        '（飞书没有"按条件 UPDATE"的原生能力，这是 search→batch_update 联动）。' +
        '会改动数据：建议先用 dry_run=true 看命中条数，并在回复中告知用户预计影响的记录数。',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id', 'filter', 'set'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          filter: {
            type: 'string',
            description: '飞书过滤语法（同 search_records），如 CurrentValue.[状态]="待处理"',
          },
          set: {
            type: 'object',
            description: '要写入的字段：{ 字段名: 新值 }，作用到所有命中记录',
            additionalProperties: true,
          },
          dry_run: { type: 'boolean', description: 'true 时只返回命中条数与样本、不修改' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'audit_table',
      description:
        '数据质量体检：扫描全表，检测空缺的必填字段、应唯一字段的重复值、数值字段的异常值（偏离均值 3σ），汇总成问题报告。' +
        'output=doc 时把报告生成一篇飞书文档；默认 summary 只返回 JSON 统计。' +
        '至少指定 required_fields / unique_fields / numeric_outlier_fields 之一才有检测项。',
      parameters: {
        type: 'object',
        required: ['app_token', 'table_id'],
        properties: {
          app_token: { type: 'string' },
          table_id: { type: 'string' },
          required_fields: { type: 'array', items: { type: 'string' }, description: '视为必填、检测是否为空的字段名' },
          unique_fields: { type: 'array', items: { type: 'string' }, description: '应唯一、检测重复值的字段名' },
          numeric_outlier_fields: { type: 'array', items: { type: 'string' }, description: '数值字段，做 3σ 异常值检测' },
          output: { type: 'string', enum: ['summary', 'doc'], description: 'summary=只返回统计(默认)，doc=同时生成报告文档' },
          title: { type: 'string', description: 'output=doc 时的文档标题' },
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

  // ── 电子表格 Spreadsheet (sheets) ───────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_spreadsheet',
      description: '创建一个新的飞书电子表格（Spreadsheet，区别于多维表格 Base）。返回 spreadsheet_token。',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: '表格标题' },
          folder_token: { type: 'string', description: '可选：目标文件夹 token' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_spreadsheet',
      description: '获取电子表格的元信息（标题、所有者等）。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token'],
        properties: { spreadsheet_token: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sheets',
      description: '列出电子表格内的所有工作表（sheet），返回每个 sheet 的 sheet_id、标题、行列数。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token'],
        properties: { spreadsheet_token: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_sheet',
      description: '在电子表格中新增一个工作表。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'title'],
        properties: {
          spreadsheet_token: { type: 'string' },
          title: { type: 'string' },
          index: { type: 'integer', description: '可选：插入位置（0 起）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_sheet',
      description: '破坏性操作·不可撤销。删除一个工作表及其全部数据。调用前必须告知用户工作表名并获明确确认。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'sheet_id'],
        properties: {
          spreadsheet_token: { type: 'string' },
          sheet_id: { type: 'string', description: '工作表 ID（来自 list_sheets）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_range',
      description: '读取一个单元格区域的值。range 格式 "{sheet_id}!A1:C10"。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'range'],
        properties: {
          spreadsheet_token: { type: 'string' },
          range: { type: 'string', description: '如 "abc123!A1:C10"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_range',
      description:
        '向指定区域写入二维数组（会覆盖原值）。values 行数/列数需与 range 匹配。' +
        '单元格写公式时直接用 Excel 语法字符串（以 = 开头），如 "=A2*B2"、"=SUM(C2:C10)"、"=IF(A2>2,\\"多\\",\\"少\\")"，会自动按公式计算（不会存成文本）。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'range', 'values'],
        properties: {
          spreadsheet_token: { type: 'string' },
          range: { type: 'string', description: '如 "abc123!A1:C3"' },
          values: {
            type: 'array',
            description: '二维数组，每行一个数组，如 [["姓名","年龄"],["张三",28]]',
            items: { type: 'array', items: {} },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_rows',
      description: '在工作表已有数据后追加若干行（不覆盖）。range 指定写入的搜索区域，如 "{sheet_id}!A1:C1"。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'range', 'values'],
        properties: {
          spreadsheet_token: { type: 'string' },
          range: { type: 'string' },
          values: { type: 'array', items: { type: 'array', items: {} } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_column',
      description:
        '把某一列从 start_row 到 end_row 批量填入同一公式/值模板，模板里的 "{row}" 会被替换成当前行号。' +
        '例：column="C", template="=A{row}*B{row}" → C2=A2*B2、C3=A3*B3…（整列计算神器）。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'sheet_id', 'column', 'start_row', 'end_row', 'template'],
        properties: {
          spreadsheet_token: { type: 'string' },
          sheet_id: { type: 'string' },
          column: { type: 'string', description: '列字母，如 "C"' },
          start_row: { type: 'integer' },
          end_row: { type: 'integer' },
          template: { type: 'string', description: '公式/值模板，用 {row} 代表行号' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_replace',
      description: '在指定区域查找文本并全部替换。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'sheet_id', 'range', 'find', 'replacement'],
        properties: {
          spreadsheet_token: { type: 'string' },
          sheet_id: { type: 'string' },
          range: { type: 'string' },
          find: { type: 'string' },
          replacement: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_number_format',
      description: '设置区域的数字格式。formatter 示例：千分位 "#,##0.00"、百分比 "0.00%"、人民币 "¥#,##0.00"、日期 "yyyy/mm/dd"。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'range', 'formatter'],
        properties: {
          spreadsheet_token: { type: 'string' },
          range: { type: 'string' },
          formatter: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_dimension',
      description: '在工作表中插入若干行或列。dimension=ROWS 插行、COLUMNS 插列；start_index 为 0 起的插入位置，count 为数量。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'sheet_id', 'dimension', 'start_index', 'count'],
        properties: {
          spreadsheet_token: { type: 'string' },
          sheet_id: { type: 'string' },
          dimension: { type: 'string', enum: ['ROWS', 'COLUMNS'] },
          start_index: { type: 'integer' },
          count: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_dimension',
      description: '破坏性操作。删除工作表中 [start_index, start_index+count) 的行或列及其数据。' +
        '删「行(ROWS)」时可在对话「↩ 撤销删除」一键恢复(插回原位+写回值)，删列暂不支持撤销。' +
        'start_index 是 0 基：第 1 行(通常是表头)= 0、"第 N 行" = N-1。**未经用户明确要求，不要删表头行**，' +
        '删某一行时 count 通常为 1。调用前告知用户并获确认。',
      parameters: {
        type: 'object',
        required: ['spreadsheet_token', 'sheet_id', 'dimension', 'start_index', 'count'],
        properties: {
          spreadsheet_token: { type: 'string' },
          sheet_id: { type: 'string' },
          dimension: { type: 'string', enum: ['ROWS', 'COLUMNS'] },
          start_index: { type: 'integer' },
          count: { type: 'integer' },
        },
      },
    },
  },

  // ── 文档 Docs (docx) ─────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_document',
      description: '创建一个新的飞书文档（Docx）。返回 document_id。',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          folder_token: { type: 'string', description: '可选：目标文件夹 token' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_doc_from_markdown',
      description:
        '一步生成排版好的飞书文档：传入 Markdown，自动建文档并解析为对应块（# 标题、- 列表、1. 有序、> 引用、```代码```、--- 分割线、- [ ] 待办，以及 **加粗**/*斜体*/`代码` 内联样式）。' +
        '适合"帮我写一份方案/周报/总结文档"这类需求——先用 Markdown 组织内容再调用本工具。',
      parameters: {
        type: 'object',
        required: ['title', 'markdown'],
        properties: {
          title: { type: 'string', description: '文档标题' },
          markdown: { type: 'string', description: '文档正文的 Markdown' },
          folder_token: { type: 'string', description: '可选：目标文件夹 token' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document_content',
      description: '获取文档的纯文本内容（用于阅读/总结现有文档）。',
      parameters: {
        type: 'object',
        required: ['document_id'],
        properties: { document_id: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_blocks',
      description:
        '读取文档结构：返回根块大纲 root_children_count（根块总数 N）+ outline（每条 {i 绝对索引, type, id, text 全文}）' +
        '+ has_more / next_start_index（分页把手）。支持分页与定位，一个工具读遍任意大小文档——长文档按 ' +
        'next_start_index 翻页直到 has_more=false；定位某节传 query。要改/删/插块时用 outline 里的 i 当 index、' +
        'id 当 block_id。不要为看全文而改用 get_document_content / feishu_api_call 反复横跳。',
      parameters: {
        type: 'object',
        required: ['document_id'],
        properties: {
          document_id: { type: 'string' },
          start_index: {
            type: 'integer',
            description: '从第几个根块开始读（0 基，默认 0）。has_more=true 时，把返回的 next_start_index 填这里取下一页，直到 has_more=false。',
          },
          limit: {
            type: 'integer',
            description: '本页最多返回多少个根块（默认 80；同时受单页字符预算约束，文本长的块会提前截页）。',
          },
          query: {
            type: 'string',
            description: '按文本子串过滤根块（大小写不敏感）。一步定位"目录 / 某标题 / 某关键词"所在块——返回 matched_count + 命中块的绝对索引 i 与 id。',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_document_content',
      description:
        '向文档插入内容块（段落/标题/列表/引用）。一次可插入多块，按数组顺序排列。' +
        'index 为插入位置（0=文档开头），新建空文档写正文用 0 即可。',
      parameters: {
        type: 'object',
        required: ['document_id', 'blocks'],
        properties: {
          document_id: { type: 'string' },
          index: { type: 'integer', description: '插入位置，默认 0（文档开头）' },
          blocks: {
            type: 'array',
            description: '内容块数组，按顺序排列',
            items: {
              type: 'object',
              required: ['text'],
              properties: {
                text: { type: 'string', description: '该块文字内容' },
                style: {
                  type: 'string',
                  enum: ['text', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'quote'],
                  description: '块样式，默认 text（正文段落）',
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
      name: 'insert_table',
      description:
        '在文档中插入一个【普通文档表格】(Table) 并填入内容。data 为二维数组（含表头行），如 [["姓名","分数"],["张三","90"]]。' +
        '若用户想要的是“可继续编辑的电子表格”，改用 insert_sheet。',
      parameters: {
        type: 'object',
        required: ['document_id', 'data'],
        properties: {
          document_id: { type: 'string' },
          index: { type: 'integer', description: '插入位置，默认 0' },
          data: {
            type: 'array',
            description: '二维字符串数组，第一行通常是表头',
            items: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_sheet',
      description:
        '在文档中嵌入一个【电子表格】(Sheet) 并可选填入内容。区别于 insert_table：这是嵌入的飞书电子表格，' +
        '支持公式、可后续用电子表格工具继续编辑。data 为二维字符串数组（可选，首行通常是表头）。',
      parameters: {
        type: 'object',
        required: ['document_id'],
        properties: {
          document_id: { type: 'string' },
          index: { type: 'integer', description: '插入位置，默认 0' },
          data: {
            type: 'array',
            description: '可选，二维字符串数组，首行通常是表头',
            items: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_document_blocks',
      description:
        '破坏性操作。删除某父块下 [start_index, end_index) 范围的子块。本插件不提供文档块的一键撤销，' +
        '但删错了可在飞书文档里通过「版本历史」回滚——删除完成后请主动告知用户：' +
        '可点文档右上角「···」→「历史记录 / 版本」恢复到删除前的版本。' +
        '调用前必须告知用户将删除的内容并获明确确认。父块为文档正文时 parent_block_id = document_id。',
      parameters: {
        type: 'object',
        required: ['document_id', 'parent_block_id', 'start_index', 'end_index'],
        properties: {
          document_id: { type: 'string' },
          parent_block_id: { type: 'string', description: '父块 id（文档正文用 document_id）' },
          start_index: { type: 'integer' },
          end_index: { type: 'integer', description: '不含该位置（半开区间）' },
        },
      },
    },
  },

  // ── Doc image tools ──
  {
    type: 'function',
    function: {
      name: 'insert_image',
      description:
        '把对话框里上传的一张图片插入到当前文档的指定位置（锚点定位，非光标）。' +
        'attachment_id 是当前消息里图片附件的 id；anchor.type 用 top/heading/text/section_end/end 指定插入点：' +
        'top=文档最顶部（在所有已有内容之前，含已有顶部图片）；' +
        'heading/text=匹配到对应标题/段落后插到其后面（value 为匹配文字）；' +
        'section_end=某标题所在节的末尾；end=文档末尾。' +
        '用户说"插到顶部/最前面/开头"时一律用 top，不要拿第一段文字凑。' +
        '只插入图片块本身，不要附带任何文字（标题/说明/图注/文件名都不要）。',
      parameters: {
        type: 'object',
        required: ['attachment_id', 'anchor'],
        properties: {
          attachment_id: { type: 'string', description: '当前消息里图片附件的 id' },
          anchor: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', enum: ['top', 'heading', 'text', 'section_end', 'end'] },
              value: { type: 'string', description: 'heading/text/section_end 时必填，匹配的标题/段落文字' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_document',
      description:
        '用飞书服务端深拷贝**保真克隆**一篇文档。' +
        '一次调用，全部内容（文本/表格/图片/内嵌表格）完整保留，零挖矿。适用于复制/备份/另存一份。',
      parameters: {
        type: 'object',
        properties: {
          source_doc_token: { type: 'string', description: '源文档 token（默认当前文档）' },
          new_title: { type: 'string', description: '新文档标题（默认"<源标题> 副本"）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_image',
      description:
        '替换文档中的一张已有图片为新图。按"第N张"或"某标题下那张"定位，删旧插新，原位保留。',
      parameters: {
        type: 'object',
        required: ['which', 'source'],
        properties: {
          which: {
            type: 'object',
            required: ['by', 'value'],
            properties: {
              by: { type: 'string', enum: ['index', 'heading'] },
              value: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'index 时写数字，heading 时写标题文字' },
            },
          },
          source: {
            type: 'object',
            required: ['attachment_id'],
            properties: {
              attachment_id: { type: 'string', description: '当前消息里新图的附件 id' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_doc_images',
      description: '把一篇文档里的全部图片批量导出，返回缩略图画廊 + 下载全部 ZIP。',
      parameters: {
        type: 'object',
        properties: {
          doc_token: { type: 'string', description: '文档 token（默认当前文档）' },
        },
      },
    },
  },
]

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
