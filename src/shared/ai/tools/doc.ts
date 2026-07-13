import type { ChatCompletionTool } from 'openai/resources'

// 文档 Docs 工具：文档/块/表格/图片。
export const DOC_TOOLS: ChatCompletionTool[] = [
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
  {
    type: 'function',
    function: {
      name: 'insert_bitable',
      description:
        '在文档中插入一个【多维表格】(Bitable) 块。插入后会自动创建一张新的多维表格，返回 app_token 和 table_id，' +
        '可继续用 Base 工具（create_field/create_record 等）操作其中的数据。',
      parameters: {
        type: 'object',
        properties: {
          document_id: { type: 'string', description: '文档 token（默认当前文档）' },
          index: { type: 'integer', description: '插入位置，默认 0' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_callout',
      description: '在文档中插入一个【高亮块】(Callout) 并填入文本。适合突出重要提示、警告或备注。',
      parameters: {
        type: 'object',
        required: ['text'],
        properties: {
          document_id: { type: 'string', description: '文档 token（默认当前文档）' },
          text: { type: 'string', description: '高亮块内的文本内容' },
          index: { type: 'integer', description: '插入位置，默认 0' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_iframe',
      description: '在文档中插入一个【内嵌网页】(Iframe) 块，可以嵌入外部网页链接。',
      parameters: {
        type: 'object',
        required: ['url'],
        properties: {
          document_id: { type: 'string', description: '文档 token（默认当前文档）' },
          url: { type: 'string', description: '要嵌入的网页 URL' },
          index: { type: 'integer', description: '插入位置，默认 0' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_document_block',
      description:
        '修改文档中某个已有文本块的内容或样式。需要先用 list_blocks 获取 block_id。' +
        '支持修改文本内容和样式（text/h1/h2/h3/bullet/ordered/quote/code/todo）。',
      parameters: {
        type: 'object',
        required: ['block_id', 'text'],
        properties: {
          document_id: { type: 'string', description: '文档 token（默认当前文档）' },
          block_id: { type: 'string', description: '要修改的块 ID（来自 list_blocks）' },
          text: { type: 'string', description: '新的文本内容' },
          style: {
            type: 'string',
            enum: ['text', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'quote', 'code', 'todo'],
            description: '块样式，默认 text',
          },
        },
      },
    },
  },
]
