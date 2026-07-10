import type { ChatCompletionTool } from 'openai/resources'

// 复合工具：飞书原生缺失的多步联动（去重/跨表/批量改/体检）+ AI 叙事报告。
export const COMPOSE_TOOLS: ChatCompletionTool[] = [
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
]
