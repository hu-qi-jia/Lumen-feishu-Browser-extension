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
export function buildApiHistory(history: ChatMessage[], visionEnabled = true): ChatCompletionMessageParam[] {
  const nonSystem = history.filter((m) => m.role !== 'system')

  // Index the latest tool response per tool_call_id (dedupes UI duplicates).
  const responses = new Map<string, string>()
  for (const m of nonSystem) {
    if (m.role === 'tool' && m.tool_call_id) responses.set(m.tool_call_id, m.content ?? '')
  }

  // 找到最新一条 user 消息：仅对它（如果带图片，且 vision 启用）做 image_url 多模态编码，
  // 让 vision-capable 的 LLM 能直接"看图"（识别表格/内容并据此调工具）。
  // 历史消息里的图片仍走纯文本元数据——既避免多轮历史塞多张图导致 token 爆炸，
  // 又防止非 vision 模型在历史回放时被 image_url part 直接拒绝。
  // 注意：判定标准是"最后一条 user 消息是否带图"，而非"最后一条带图的 user 消息"——
  // 用户先发图后发纯文本追问时，图已成历史，应走纯文本。
  // visionEnabled=false（降级模式，非 vision 模型）时所有图片都走纯文本元数据——
  // 这样"插入图片到文档"等不需要 LLM 看图的操作仍能正常工作（attachment_id 文本仍保留）。
  let lastUserIdx = -1
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    if (nonSystem[i].role === 'user') { lastUserIdx = i; break }
  }

  const out: ChatCompletionMessageParam[] = []
  for (let idx = 0; idx < nonSystem.length; idx++) {
    const m = nonSystem[idx]
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
      const isLastUserWithImage =
        visionEnabled &&
        idx === lastUserIdx &&
        attachments.some((a) => a.type === 'image' && a.dataUrl)
      if (attachments.length === 0) {
        out.push({ role: 'user', content: m.content ?? '' })
      } else if (isLastUserWithImage) {
        // 最新一条 user 消息且带图片（且 vision 启用）：输出多模态 content。
        // 关键：image_url part 旁必须保留 attachment_id 文本元数据——LLM 需要从这段文本
        // 读出 UUID 才能正确填入 insert_image 等工具的 args.attachment_id（工具执行端按
        // id 从 latestAttachments 数组查原图）。只对最新消息做，历史消息走下面 else 分支。
        out.push({ role: 'user', content: attachmentToContentParts(m, attachments) })
      } else {
        // 历史消息的附件（或降级模式下的所有图片附件）：纯文本元数据（attachment_id + name），
        // 不嵌图片字节。既防止非 vision 模型在历史回放时被 image_url 拒绝，又避免 token 爆炸。
        // 降级模式下 attachment_id 文本仍保留——insert_image 等工具调用不受影响。
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

/** 把最新一条 user 消息的附件编码成 OpenAI 多模态 content parts。
 *  - 图片：先输出 text part（含 attachment_id 元数据），再紧跟 image_url part。
 *    LLM 既能"看图"识别表格/内容，又能从文本读出 UUID 调 insert_image 等工具。
 *  - 文件/选区：走原文本元数据（attachmentToMetaData）。
 *  - 用户输入文本：作为首个 text part。 */
function attachmentToContentParts(
  m: ChatMessage,
  attachments: Attachment[],
): Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
> {
  const parts: ReturnType<typeof attachmentToContentParts> = []
  if (m.content?.trim()) parts.push({ type: 'text', text: m.content.trim() })
  for (const a of attachments) {
    if (a.type === 'image' && a.dataUrl) {
      // 先输出 attachment_id 文本元数据——LLM 据此填工具 args；
      // 再紧跟 image_url part，让 vision-capable 模型直接看图。
      const meta = attachmentToMetaData(a)
      if (meta) parts.push({ type: 'text', text: meta })
      parts.push({ type: 'image_url', image_url: { url: a.dataUrl, detail: 'auto' } })
    } else {
      const meta = attachmentToMetaData(a)
      if (meta) parts.push({ type: 'text', text: meta })
    }
  }
  return parts
}

/** 把一个附件渲染成喂给 LLM 的文本元数据。image/file 输出与历史完全一致（回归保护）；
 *  selection 是新增：把用户选中的文档片段（带定位上下文）作为可编辑目标交给 agent。
 *  docref 是引用整篇文档：告诉 agent 这是一个可参考的文档及其 token，agent 可按需读取。
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
  if (a.type === 'docref' && a.docref) {
    const d = a.docref
    const kindLabel =
      d.kind === 'base' ? '多维表格' :
      d.kind === 'sheet' ? '电子表格' :
      d.kind === 'wiki' ? '知识库节点' : '文档'
    // 用户已指定子表时，把 id 直接喂给 agent，省去 list_sheets / list_tables 枚举步骤。
    const subLabel =
      d.kind === 'sheet' && d.sheetId ? `｜子表：${d.sheetName || d.sheetId}` :
      d.kind === 'base' && d.tableId ? `｜数据表：${d.tableName || d.tableId}` : ''
    const subHint =
      d.kind === 'sheet' && d.sheetId
        ? `\n用户已指定工作表（sheet_id=${d.sheetId}），请直接用 read_range（spreadsheetToken=${d.docToken}，range 以 "${d.sheetId}!" 开头）读取该子表，无需再调 list_sheets 枚举。`
        : d.kind === 'base' && d.tableId
          ? `\n用户已指定数据表（table_id=${d.tableId}），请直接用 list_fields / list_records（appToken=${d.docToken}，tableId=${d.tableId}）读取该表，无需再调 list_tables 枚举。`
          : ''
    const toolHint =
      d.kind === 'doc' ? 'get_document_content / list_blocks（document_id' :
      d.kind === 'sheet' ? 'get_spreadsheet / read_range（spreadsheetToken' :
      d.kind === 'base' ? 'list_tables / list_fields / list_records（appToken' :
      'get_document_content / list_blocks（document_id'
    return `【引用${kindLabel}｜标题：${d.docTitle || '未命名'}${subLabel}｜链接：${d.url}】\n用户希望参考此文档的内容。你可使用 ${toolHint}=${d.docToken}）按需读取其内容后，在当前工作文档中进行引用或参考。${subHint}`
  }
  return null
}
