import type { ChatCompletionMessageParam } from 'openai/resources'
import type { ChatMessage, Attachment } from '../types'

// ─── History sanitization for the API ───────────────────────────────────────
// The ChatPanel keeps a UI-oriented log: synthetic "tool started" indicators
// (assistant messages with placeholder tool_calls and no response), duplicate
// tool results, etc. Replaying that verbatim produces an invalid OpenAI sequence —
// strict providers (e.g. DeepSeek) reject it with 400 "an assistant message with
// 'tool_calls' must be followed by tool messages responding to each tool_call_id".
// Rebuild a valid sequence: keep only tool_calls that have a matching tool response,
// emit each assistant(tool_calls) immediately followed by those responses, and drop
// orphan tool messages and placeholder tool_calls.
export function buildApiHistory(history: ChatMessage[]): ChatCompletionMessageParam[] {
  const nonSystem = history.filter((m) => m.role !== 'system')

  // Index the latest tool response per tool_call_id (dedupes UI duplicates).
  const responses = new Map<string, string>()
  for (const m of nonSystem) {
    if (m.role === 'tool' && m.tool_call_id) responses.set(m.tool_call_id, m.content ?? '')
  }

  const out: ChatCompletionMessageParam[] = []
  for (const m of nonSystem) {
    if (m.role === 'tool') continue // emitted alongside their assistant message below

    if (m.role === 'assistant' && m.tool_calls?.length) {
      const paired = m.tool_calls.filter((tc) => responses.has(tc.id))
      if (paired.length === 0) {
        // A "tool started" placeholder or an unanswered call — keep any text, drop the calls.
        if (m.content) out.push({ role: 'assistant', content: m.content })
        continue
      }
      out.push({
        role: 'assistant',
        content: m.content,
        tool_calls: paired.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      })
      for (const tc of paired) {
        out.push({ role: 'tool', content: responses.get(tc.id) ?? '', tool_call_id: tc.id })
      }
      continue
    }

    if (m.role === 'user') {
      const attachments = m.attachments ?? []
      if (attachments.length === 0) {
        out.push({ role: 'user', content: m.content ?? '' })
      } else {
        // Represent attachments as TEXT metadata (attachment_id + name) so the agent can
        // reference them in tool calls (e.g. insert_image's attachment_id). We do NOT embed
        // image bytes as image_url vision parts — many configured LLMs aren't vision-capable
        // and reject the request ("unknown variant image_url, expected text"). The actual
        // image data reaches the tool via the separate `attachments` plumbing, so the agent
        // doesn't need to "see" the image to insert it.
        const bits: string[] = []
        if (m.content?.trim()) bits.push(m.content.trim())
        for (const a of attachments) {
          const meta = attachmentToMetaData(a)
          if (meta) bits.push(meta)
        }
        out.push({ role: 'user', content: bits.join('\n\n') })
      }
    } else if (m.role === 'assistant') {
      out.push({ role: m.role, content: m.content ?? '' })
    }
  }
  return out
}

/** 把一个附件渲染成喂给 LLM 的文本元数据。image/file 输出与历史完全一致（回归保护）；
 *  selection 是新增：把用户选中的文档片段（带定位上下文）作为可编辑目标交给 agent。
 *  返回 null 表示该附件无可渲染元数据（调用方跳过）。 */
export function attachmentToMetaData(a: Attachment): string | null {
  if (a.type === 'image' && a.dataUrl) return `【附件：图片 ${a.name}（attachment_id: ${a.id}）】`
  if (a.type === 'file' && a.content) return `\n\n【附件：${a.name}】\n${a.content}`
  if (a.type === 'selection' && a.selection) {
    const s = a.selection
    const head = s.headingText ? `｜标题：${s.headingText}` : ''
    const para = s.paragraphText ? `\n所在段落：${s.paragraphText}` : ''
    return `【引用文档片段｜文档：${s.docTitle || '当前文档'}${head}】${para}\n选中的内容：\n${s.selectedText}`
  }
  return null
}
