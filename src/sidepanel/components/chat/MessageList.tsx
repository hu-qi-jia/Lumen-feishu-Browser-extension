import React, { useEffect, useRef } from 'react'
import type { ChatMessage } from '@/shared/types'
import Markdown from './Markdown'
import Tooltip from '../ui/Tooltip'
import ReplyActions from './ReplyActions'
import './MessageList.css'

type ResourceKind = 'base' | 'sheet' | 'doc' | 'ppt'

interface Props {
  messages: ChatMessage[]
  /** Click an example chip to send it. Omit (undefined) to render chips disabled. */
  onExample?: (text: string) => void
  /** Regenerate the last agent reply (the 重试 action). Lifted to ChatPanel. */
  onRetry?: () => void
  /** Current Feishu resource — drives a capability list tailored to it. 'wiki' is a
   *  transient unresolved state, treated as the general guide. */
  kind?: ResourceKind | 'wiki'
  /** True while a reply turn is streaming — drives the transient 思考中… indicator. */
  streaming?: boolean
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

// Group consecutive non-user messages into one "reply block" so a single agent task
// (text → tool → text → tool → text) renders as ONE bubble with the segments flowing inside,
// instead of N separate bordered bubbles with gaps between them. Tool calls/results are
// filtered out before this (hidden from the UI), so a multi-round turn reads as one answer.
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

export default function MessageList({ messages, onExample, onRetry, kind, streaming }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // `behavior:'auto'` (instant), not 'smooth' — this fires on every streamed token (a new
    // messages ref per chunk), and a smooth scroll restarting mid-animation each token stutters
    // and never catches the bottom. Instant pins to the bottom per token cleanly.
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages])

  // Tool chatter is hidden from the UI ENTIRELY — a turn reads as just its text answer, with a
  // 思考中… bubble filling the thinking gaps. The tool messages STAY in `messages` (API history,
  // dataviz / image-export interception, the undo stash all depend on the data); they're simply
  // not drawn. A future "show tool details" toggle could re-surface them.
  const visible = messages.filter(
    (m) =>
      m.role !== 'system' &&
      m.role !== 'tool' &&
      !(m.role === 'assistant' && m.tool_calls?.length && !m.content),
  )

  // The 思考中… indicator fills every "thinking gap": a turn is streaming AND no assistant text
  // bubble is actively streaming content right now — i.e. before the first token of a round, and
  // between rounds / while tools run. As soon as text starts flowing it hides (the streaming
  // bubble + its blinking cursor take over). `streaming` comes from ChatPanel (whole-turn flag).
  const hasStreamingText = visible.some(
    (m) => m.role === 'assistant' && m.isStreaming && (m.content ?? '').trim().length > 0,
  )
  const thinking = !!streaming && !hasStreamingText

  const groups = groupTurns(visible)
  const lastGroup = groups[groups.length - 1]
  // Keep the whole turn in ONE bubble: when a thinking gap hits mid-turn (between rounds),
  // render the indicator INSIDE the in-flight reply block — appended under the prior text —
  // instead of a separate thinking bubble that interrupts the answer. Only fall back to a
  // standalone thinking bubble at turn start, when no reply block exists yet.
  const thinkingInsideReply = thinking && lastGroup?.kind === 'reply'
  const thinkingStandalone = thinking && !thinkingInsideReply

  return (
    <div className="msg-list">
      {visible.length === 0 && <Welcome kind={kind} onExample={onExample} />}
      {groups.map((g, i) => {
        if (g.kind === 'user') return <UserBubble key={g.msg.id} msg={g.msg} />
        const isLastGroup = i === groups.length - 1
        const groupThinking = thinkingInsideReply && isLastGroup
        const replyComplete = !g.msgs.some((m) => m.isStreaming)
        const hasText = g.msgs.some((m) => typeof m.content === 'string' && m.content.trim().length > 0)
        // Copy/retry show under a COMPLETED reply that has text. Retry only on the latest
        // reply (regenerating a middle one would delete the conversation after it), and never
        // mid-turn — during streaming the group is either streaming text or showing 思考中.
        const showActions = replyComplete && !groupThinking && hasText
        const canRetry = showActions && isLastGroup && !streaming
        return (
          <ReplyBlock
            key={g.msgs[0].id}
            msgs={g.msgs}
            thinking={groupThinking}
            showActions={showActions}
            onRetry={canRetry ? onRetry : undefined}
          />
        )
      })}
      {thinkingStandalone && <ThinkingBubble />}
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
          <Tooltip
            key={ex}
            content={onExample ? '点击发送' : '请先在设置中完成配置'}
            position="top"
          >
            <button
              type="button"
              className="example-chip"
              onClick={() => onExample?.(ex)}
              disabled={!onExample}
            >
              <span className="example-text">{ex}</span>
              <svg className="example-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

// One full-width reply per agent turn (no bubble — ChatGPT-style: only the user's question
// is bubbled; the answer flows as plain full-width text so wide content isn't constrained).
// All text segments flow inside one reply, and the 思考中… indicator renders inline (under
// the text) during a mid-turn gap so the answer stays one continuous block. A completed reply
// shows copy/retry actions under the text (retry only on the latest reply).
function ReplyBlock({ msgs, thinking, showActions, onRetry }: {
  msgs: ChatMessage[]
  thinking?: boolean
  showActions?: boolean
  onRetry?: () => void
}) {
  // Copy text = every round's markdown joined (blank rounds dropped).
  const text = msgs.map((m) => m.content ?? '').filter(Boolean).join('\n\n')
  return (
    <div className="msg-row msg-row--assistant">
      <div className="reply-block">
        {msgs.map((m) => <ReplyItem key={m.id} msg={m} />)}
        {thinking && <ThinkingIndicator />}
        {showActions && <ReplyActions text={text} onRetry={onRetry} />}
      </div>
    </div>
  )
}

// Memoized: ChatPanel rebuilds the whole messages array every streamed token, but only the
// in-flight item's object identity changes. Without memo, EVERY item re-parses its markdown
// per token → O(n²) jank on long replies. A shallow `msg` compare skips the stable items.
const ReplyItem = React.memo(function ReplyItem({ msg }: { msg: ChatMessage }) {
  return (
    <div className="reply-text">
      <Markdown>{msg.content ?? ''}</Markdown>
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

// Inner 思考中… content (spinner + text + animated dots) — shared by the inline indicator
// (inside a reply block) and the standalone indicator (turn start). Pure CSS, no emoji.
function ThinkingDots() {
  return (
    <>
      <svg className="thinking-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <span className="thinking-text">思考中</span>
      <span className="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
    </>
  )
}

// Inline thinking indicator — rendered inside a reply block so a mid-turn gap stays with
// the answer instead of interrupting it with a separate block.
function ThinkingIndicator() {
  return (
    <div className="reply-thinking" role="status" aria-live="polite">
      <ThinkingDots />
    </div>
  )
}

// Transient standalone "思考中…" indicator — shown only at a turn's start, before any reply
// exists. No bubble (matches the bubbleless agent reply); once text streams the reply block
// takes over, with the indicator appended inline under the text.
function ThinkingBubble() {
  return (
    <div className="msg-row msg-row--assistant">
      <ThinkingIndicator />
    </div>
  )
}
