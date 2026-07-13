import type { ChatCompletionTool } from 'openai/resources'

// 电子表格 Spreadsheet 工具。
export const SHEET_TOOLS: ChatCompletionTool[] = [
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
  {
    type: 'function',
    function: {
      name: 'rename_sheet',
      description: 'Rename a worksheet (工作表) in a spreadsheet.',
      parameters: {
        type: 'object',
        required: ['sheet_id', 'title'],
        properties: {
          spreadsheet_token: { type: 'string', description: '电子表格 token（默认当前表格）' },
          sheet_id: { type: 'string', description: '工作表 ID（来自 list_sheets）' },
          title: { type: 'string', description: '新的工作表标题' },
        },
      },
    },
  },
]
