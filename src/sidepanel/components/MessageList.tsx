import React, { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../shared/types'
import { openUrlInNewTab } from '../../shared/url'
import './MessageList.css'

type ResourceKind = 'base' | 'sheet' | 'doc' | 'ppt'

interface Props {
  messages: ChatMessage[]
  /** Click an example chip to send it. Omit (undefined) to render chips disabled. */
  onExample?: (text: string) => void
  /** Current Feishu resource — drives a capability list tailored to it. 'wiki' is a
   *  transient unresolved state, treated as the general guide. */
  kind?: ResourceKind | 'wiki'
}

// Per-resource welcome: one-click quick actions tailored to the page. The layout is identical
// across all types (unified) — no title/sub, just the chips — only the example text adapts.
const GUIDE: Record<ResourceKind | 'none', { examples: string[] }> = {
  base: {
    examples: [
      '创建一个项目管理表格，含名称、状态、优先级、负责人、截止日期字段，并加 5 条示例数据',
      '在当前表格新增"进度"单选字段：未开始 / 进行中 / 已完成',
      '按"状态"分组统计每组的记录数和金额总和',
    ],
  },
  sheet: {
    examples: [
      '在 A1:C1 写表头"姓名 / 部门 / 工资"，再追加 3 行示例数据',
      '把 C 列 C2:C10 填上 =A{row}*B{row} 公式',
      '读取 A1:D20 的内容给我看',
    ],
  },
  doc: {
    examples: ['总结要点', '加一个代码块示例', '在文末加引用说明'],
  },
  ppt: {
    examples: [
      '总结这份演示文稿的要点',
      '为每页幻灯片生成演讲备注',
      '基于当前内容生成一份配套讲义文档',
    ],
  },
  none: {
    examples: [
      '做一张数据分析汇总表',
      '新建一个会议纪要文档',
      '新建一个待办事项清单文档',
    ],
  },
}

// Friendly Chinese labels for tool names — the raw machine name (e.g. `create_record`) is
// opaque to non-technical users. Falls back to the raw name if unmapped.
const TOOL_LABELS: Record<string, string> = {
  // 多维表格 (Base)
  render_data_app: '生成数据看板',
  feishu_api_call: '调用飞书接口',
  get_app_info: '读取表格信息',
  create_bitable_app: '新建多维表格',
  list_tables: '读取数据表列表',
  create_table: '新建数据表',
  delete_table: '删除数据表',
  list_fields: '读取字段列表',
  create_field: '新建字段',
  update_field: '更新字段',
  delete_field: '删除字段',
  list_records: '读取记录',
  create_record: '新建记录',
  batch_create_records: '批量新建记录',
  update_record: '更新记录',
  batch_update_records: '批量更新记录',
  search_records: '搜索记录',
  delete_record: '删除记录',
  batch_delete_records: '批量删除记录',
  dedupe_records: '去重记录',
  cross_table_lookup: '跨表匹配',
  update_where: '按条件更新',
  create_view: '新建视图',
  list_views: '读取视图列表',
  list_dashboards: '读取仪表盘列表',
  copy_dashboard: '复制仪表盘',
  base_table_to_sheet: '导出为电子表格',
  summarize_table: '分组汇总',
  base_to_doc_report: '生成汇总报告',
  generate_data_report: '生成数据报告',
  audit_table: '数据体检',
  // 电子表格 (Sheet)
  create_spreadsheet: '新建电子表格',
  get_spreadsheet: '读取电子表格信息',
  list_sheets: '读取工作表列表',
  add_sheet: '新建工作表',
  delete_sheet: '删除工作表',
  read_range: '读取单元格',
  write_range: '写入单元格',
  append_rows: '追加数据行',
  fill_column: '填充列公式',
  find_replace: '查找替换',
  set_number_format: '设置数字格式',
  insert_dimension: '插入行/列',
  delete_dimension: '删除行/列',
  // 文档 (Doc)
  create_document: '新建文档',
  create_doc_from_markdown: '生成文档',
  get_document_content: '读取文档内容',
  list_blocks: '读取文档结构',
  add_document_content: '插入文档内容',
  insert_table: '插入表格',
  insert_sheet: '插入电子表格',
  delete_document_blocks: '删除文档内容',
  audit_document: '文档体检',
  summarize_document: '总结文档',
}
function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

// Group consecutive non-user messages into one "reply block" so a single agent task
// (text → tool → text → tool → text) renders as ONE bubble with the steps flowing inside,
// instead of N separate bordered bubbles with gaps between them.
type TurnGroup = { kind: 'user'; msg: ChatMessage } | { kind: 'reply'; msgs: ChatMessage[] }
function groupTurns(messages: ChatMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  let reply: ChatMessage[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      if (reply.length) { groups.push({ kind: 'reply', msgs: reply }); reply = [] }
      groups.push({ kind: 'user', msg: m })
    } else {
      reply.push(m)
    }
  }
  if (reply.length) groups.push({ kind: 'reply', msgs: reply })
  return groups
}

export default function MessageList({ messages, onExample, kind }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // `behavior:'auto'` (instant), not 'smooth' — this fires on every streamed token (a new
    // messages ref per chunk), and a smooth scroll restarting mid-animation each token stutters
    // and never catches the bottom. Instant pins to the bottom per token cleanly.
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages])

  const visible = messages.filter((m) => m.role !== 'system')

  // A tool-call indicator (assistant + tool_calls + no content) renders as a "calling" card
  // ONLY while in-flight. Once its tool result lands (a later `tool` message), the result card
  // already conveys the done state — showing both is redundant. An indicator is "done" if a
  // tool message appears after it BEFORE the next indicator (the agent calls tools serially:
  // start → result → start → result, so each indicator pairs with the next tool message).
  const doneIndicators = new Set<string>()
  for (let i = 0; i < visible.length; i++) {
    const m = visible[i]
    if (!(m.role === 'assistant' && m.tool_calls?.length && !m.content)) continue
    for (let j = i + 1; j < visible.length; j++) {
      const n = visible[j]
      if (n.role === 'tool') { doneIndicators.add(m.id); break }
      if (n.role === 'assistant' && n.tool_calls?.length && !n.content) break // another in-flight call first
    }
  }
  const rendered = visible.filter(
    (m) => !(m.role === 'assistant' && m.tool_calls?.length && !m.content && doneIndicators.has(m.id)),
  )

  return (
    <div className="msg-list">
      {visible.length === 0 && <Welcome kind={kind} onExample={onExample} />}
      {groupTurns(rendered).map((g) =>
        g.kind === 'user'
          ? <UserBubble key={g.msg.id} msg={g.msg} />
          : <ReplyBlock key={g.msgs[0].id} msgs={g.msgs} />,
      )}
      <div ref={bottomRef} />
    </div>
  )
}

function Welcome({ kind, onExample }: { kind?: ResourceKind | 'wiki'; onExample?: (text: string) => void }) {
  const g = GUIDE[kind === 'base' || kind === 'sheet' || kind === 'doc' || kind === 'ppt' ? kind : 'none']
  return (
    <div className="welcome">
      <div className="welcome-head">
        <div className="welcome-title">你好，我是飞书文档助手</div>
        <div className="welcome-sub">试试这些，或直接在下方描述你要做的事</div>
      </div>
      <div className="welcome-examples">
        {g.examples.map((ex) => (
          <button
            key={ex}
            type="button"
            className="example-chip"
            onClick={() => onExample?.(ex)}
            disabled={!onExample}
            title={onExample ? '点击发送' : '请先在设置中完成配置'}
          >
            <span className="example-text">{ex}</span>
            <svg className="example-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}

// One bubble per agent turn — text segments + tool cards flow inside a single bubble, so a
// multi-round task (text → tool → text → …) reads as one reply instead of N boxed bubbles.
function ReplyBlock({ msgs }: { msgs: ChatMessage[] }) {
  return (
    <div className="msg-row msg-row--assistant">
      <div className="bubble bubble--assistant reply-block">
        {msgs.map((m) => <ReplyItem key={m.id} msg={m} />)}
      </div>
    </div>
  )
}

// Memoized: ChatPanel rebuilds the whole messages array every streamed token, but only the
// in-flight item's object identity changes. Without memo, EVERY item re-parses its markdown
// per token → O(n²) jank on long replies. A shallow `msg` compare skips the stable items.
const ReplyItem = React.memo(function ReplyItem({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'tool') return <ToolResult msg={msg} />
  if (msg.role === 'assistant' && msg.tool_calls?.length && !msg.content) return <ToolCallIndicator msg={msg} />
  return (
    <div className="reply-text">
      <MarkdownText text={msg.content ?? ''} />
      {msg.isStreaming && <span className="cursor">▋</span>}
    </div>
  )
})

function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="msg-row msg-row--user">
      <div className="bubble bubble--user">
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="msg-attachments">
            {msg.attachments.map((a) => (
              <div key={a.id} className="msg-attachment-chip">
                {a.type === 'image' && a.dataUrl ? (
                  <img src={a.dataUrl} alt={a.name} className="msg-attachment-img" />
                ) : (
                  <span>{a.name}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {msg.content}
      </div>
    </div>
  )
}

// Shown only while a tool is being called — a "calling" card with a spinner and the tool
// name. No arguments (which can contain sensitive ids like app_token). Visually unified with
// ToolResult (same height / font) so calling → done reads as one step changing state.
function ToolCallIndicator({ msg }: { msg: ChatMessage }) {
  const tc = msg.tool_calls![0]
  return (
    <div className="tool-call">
      <svg className="tool-call-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <span className="tool-call-label">调用中</span>
      <span className="tool-call-name" title={tc.function.name}>{toolLabel(tc.function.name)}</span>
    </div>
  )
}

// Collapsed by default to a compact status card — a check / cross icon + the tool
// name, expandable to the raw result on demand. No raw content (ids / PII) is shown
// until the user expands it.
function ToolResult({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false)
  const content = msg.content ?? ''
  const isError = content.startsWith('Error:')
  const rawName = msg.name && msg.name !== 'ok' && msg.name !== 'error' ? msg.name : ''
  const label = rawName ? toolLabel(rawName) : '工具结果'

  return (
    <div className={`tool-result${isError ? ' tool-result--error' : ''}`}>
      <button className="tool-result-header" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="tool-result-status">
          {isError ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          )}
        </span>
        <span className="tool-result-name" title={rawName || undefined}>{label}</span>
        <svg className={`tool-result-chev${expanded ? ' tool-result-chev--open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && <pre className="tool-result-body">{content}</pre>}
    </div>
  )
}

function MarkdownText({ text }: { text: string }) {
  // Minimal markdown: bold, inline code, code blocks, lists
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      // A fenced block that's just a URL (models sometimes "format" the open link this
      // way) would be a dead monospace string — render it as a clickable link instead.
      const joined = codeLines.join('\n').trim()
      const codeUrl = safeHref(joined)
      if (codeUrl && !/\s/.test(joined)) {
        elements.push(<p key={i} className="md-p">{linkEl(codeUrl, codeUrl, i)}</p>)
      } else {
        elements.push(
          <pre key={i} className="md-code-block">
            {lang && <span className="md-code-lang">{lang}</span>}
            <code>{codeLines.join('\n')}</code>
          </pre>
        )
      }
    } else if (isTableHeader(lines, i)) {
      // GitHub-style table: header row, a |---|---| separator, then body rows.
      const header = splitCells(line)
      let j = i + 2
      const rows: string[][] = []
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        rows.push(splitCells(lines[j]))
        j++
      }
      elements.push(
        <table key={i} className="md-table">
          <thead>
            <tr>{header.map((h, k) => <th key={k}>{inlineFormat(h)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{header.map((_, ci) => <td key={ci}>{inlineFormat(r[ci] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
      i = j - 1 // the trailing i++ steps past the last consumed body row
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="md-h3">{inlineFormat(line.slice(4))}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="md-h2">{inlineFormat(line.slice(3))}</h2>)
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="md-h2">{inlineFormat(line.slice(2))}</h2>)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<li key={i} className="md-li">{inlineFormat(line.slice(2))}</li>)
    } else if (line.trim() === '') {
      elements.push(<br key={i} />)
    } else {
      elements.push(<p key={i} className="md-p">{inlineFormat(line)}</p>)
    }
    i++
  }

  return <div className="md-content">{elements}</div>
}

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : null)

// Split a markdown table row "| a | b |" → ['a','b'] (drop the outer pipes).
function splitCells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

// A table starts when this line is a "| … |" row and the NEXT line is a |---|:---| separator.
function isTableHeader(lines: string[], i: number): boolean {
  const sep = lines[i + 1]
  return (
    lines[i].trim().startsWith('|') &&
    !!sep &&
    sep.includes('-') &&
    /^\s*\|?[\s:|-]+\|?\s*$/.test(sep)
  )
}

// A plain <a target="_blank"> click is unreliable inside a Chrome side panel (the panel
// swallows the navigation), so links look "dead". Open via chrome.tabs.create instead.
function openExternal(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault()
  openUrlInNewTab(href)
}

function linkEl(href: string, label: string, key: React.Key) {
  return (
    <a key={key} className="md-link" href={href} target="_blank" rel="noreferrer" onClick={(e) => openExternal(e, href)}>
      {label}
    </a>
  )
}

// A URL the model wrapped in backticks (`https://…`) or as a `[text](url)` inside backticks
// should still be clickable — return an anchor, else null (caller keeps the <code>).
function linkInCode(inner: string, key: React.Key): React.ReactNode | null {
  const md = inner.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (md && safeHref(md[2])) return linkEl(safeHref(md[2])!, md[1], key)
  const href = safeHref(inner.trim())
  return href ? linkEl(href, inner.trim(), key) : null
}

function inlineFormat(text: string): React.ReactNode {
  // Split on inline code / bold / markdown links / bare URLs so links render as
  // clickable anchors (created-document links open in a new tab — no copy-paste).
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('`') && part.endsWith('`')) {
      const inner = part.slice(1, -1)
      // Models often wrap the "open" URL in backticks → it'd render as a dead monospace
      // string. If the code span is really a URL/link, make it clickable instead.
      return linkInCode(inner, i) ?? <code key={i} className="md-code">{inner}</code>
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    const mdLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (mdLink) {
      const href = safeHref(mdLink[2])
      return href ? linkEl(href, mdLink[1], i) : mdLink[1]
    }
    if (safeHref(part)) {
      return linkEl(part, part, i)
    }
    return part
  })
}
