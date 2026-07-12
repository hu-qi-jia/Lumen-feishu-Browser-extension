import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources'
import type { ChatMessage, AppSettings, PageContext, ToolCallDef } from '../types'
import { HAS_BUILTIN_CREDS, BUILD_CONFIG } from '../config'
import { assertSafeBaseUrl } from '../providers'
import { redactSensitive } from './redact'
import { loadRecipes, recordRecipe, relevantRecipes, formatRecipes, type Recipe } from './recipes'
import { loadUserSkills } from './userSkills'
import type { BaseCtx } from '../feishu/context'
import { invalidateToken } from '../feishu/auth'
import {
  isWritingApiCall,
  isDestructiveApiCall,
  isFileLevelDelete,
  FILE_LEVEL_DELETE_MSG,
  describeDestructiveOp,
  DESTRUCTIVE_TOOLS,
  WRITE_TOOLS,
  checkDestructiveConfirmation,
  truncateToolResult,
} from './agent-security'
import { CREATE_ONCE_TOOLS, READ_ONLY_TOOLS, toolsForContext } from './agent-context'
import { buildSystemPrompt } from './agent-prompt'
import { buildApiHistory } from './agent-history'
import {
  runToolWithFallback,
  rewriteFeishuOrigins,
  resolveTenantOrigin,
} from './agent-executor'

/** Resolve LLM endpoint config directly from user settings. */
function llmConfig(settings: AppSettings) {
  return {
    baseUrl: settings.openaiBaseUrl,
    apiKey: settings.openaiApiKey,
    model: settings.openaiModel,
    format: (settings.llmFormat ?? 'openai') as 'openai' | 'anthropic',
  }
}

export interface ConfirmRequest {
  kind: 'create_base' | 'delete' | 'write'
  /** Name of the Base the agent wants to create (kind === 'create_base'). */
  appName?: string
  /** Current page's Base app_token, if on a Base. */
  currentApp?: string
  /** Current page's Base name, if known. */
  currentBaseName?: string
  /** Whether the user's open_id is configured — if not, a new Base won't be editable by them. */
  ownerConfigured?: boolean
  /** Tool being confirmed (kind === 'delete'). */
  toolName?: string
  /** Human-readable summary of what will be deleted/modified (kind === 'delete'). */
  summary?: string
}

/** new = create a fresh Base · current = add to the current Base instead · confirm =
 *  approve a delete/write · cancel = abort. */
export type ConfirmChoice = 'new' | 'current' | 'confirm' | 'cancel'

export interface AgentCallbacks {
  onChunk: (text: string) => void
  onToolStart: (name: string, args: Record<string, unknown>) => void
  onToolEnd: (toolCallId: string, result: string, isError: boolean) => void
  onAssistantMessage: (msg: ChatMessage) => void
  onToolMessage: (msg: ChatMessage) => void
  /** Optional: ask the user to confirm an ambiguous action (e.g. creating a new Base). */
  requestConfirmation?: (req: ConfirmRequest) => Promise<ConfirmChoice>
}

// Safety checkpoint: max tool calls per turn before stopping to ask the user to continue
// (prevents runaway loops / mass operations). Default 60, tunable via VITE_MAX_TOOL_CALLS.
const MAX_TOOL_CALLS_PER_TURN = BUILD_CONFIG.maxToolCalls

/** 检测 LLM 拒绝 image_url part 的错误（非 vision 模型收到多模态消息时的典型报错）。
 *  用于 chat 上传图片时降级到纯文本元数据模式——insert_image 等工具调用不受影响。 */
export function isVisionUnsupportedError(message: string): boolean {
  return /image|multimodal|vision|content.*type|unsupported|invalid.*content|400/i.test(message)
}

// Low temperature for the orchestration loop: tool SELECTION and ARG values (row indices, counts,
// field names) should be deterministic, not creative — high temp is a top cause of wrong-tool /
// wrong-index destructive mistakes. (The creative viz/site codegen is a SEPARATE call, unaffected.)
const AGENT_TEMPERATURE = 0.2

// namespace prefix for the in-run create-dedup keys
const SIG_NS = 'e51b9f'

export async function runAgent(
  history: ChatMessage[],
  settings: AppSettings,
  context: PageContext,
  callbacks: AgentCallbacks,
  baseCtx?: BaseCtx,
  /** Cancels the in-flight model stream when the panel unmounts or a new turn starts. */
  signal?: AbortSignal,
  /** 本会话是否启用知识库（chat 工具开关）。仅 ChatPanel 传入；其余调用点不传 → KB 关闭。 */
  kbEnabled?: boolean,
): Promise<void> {
  // Validate the endpoint before sending any conversation/table content to it — a
  // tampered or mistyped base URL must fail loudly here, never silently exfiltrate.
  // "越用越聪明": feed back the most relevant locally-learned recipes (if enabled).
  const learn = settings.learnFromHistory !== false
  const resourceKind = context.feishu?.kind ?? 'general'
  const lastUserText = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''

  // Run the independent turn-start I/O CONCURRENTLY so the first model request fires after
  // max() not sum(): loading the local recipe store AND the local user-skill store.
  // Behavior-preserving: a recipe-load / user-skill-load failure still yields []
  // (the .catch), matching the old try/catch default.
  const [loadedRecipes, loadedUserSkills] = await Promise.all([
    learn && lastUserText ? loadRecipes().catch(() => [] as Recipe[]) : Promise.resolve([] as Recipe[]),
    loadUserSkills().catch(() => []),
  ])

  const llmCfg = llmConfig(settings)
  const baseURL = assertSafeBaseUrl(llmCfg.baseUrl, BUILD_CONFIG.openaiAllowedHosts)
  // Agent 工具调用循环深度集成 OpenAI Chat Completions 格式（tool_calls / function calling）。
  // Anthropic 原生 Messages 格式不兼容此协议——选择 Anthropic 格式时，请填写 OpenAI 兼容端点
  // （如代理 / one-api / Anthropic 的兼容层）。格式不匹配时直接报错，避免静默失败。
  if (llmCfg.format === 'anthropic') {
    throw new Error('当前选择了 Anthropic Messages 格式，Agent 工具调用仅支持 OpenAI 兼容端点。请在「API 协议」切换为 OpenAI 格式，或填写兼容端点地址。')
  }
  const client = new OpenAI({
    baseURL,
    apiKey: llmCfg.apiKey,
    dangerouslyAllowBrowser: true,
  })

  let systemPrompt = buildSystemPrompt(context, settings, baseCtx, kbEnabled, loadedUserSkills)

  if (learn && lastUserText) {
    try {
      const recipes = relevantRecipes(loadedRecipes, lastUserText, resourceKind)
      const hints = formatRecipes(recipes)
      if (hints) systemPrompt += '\n\n' + hints
    } catch { /* recall is best-effort */ }
  }

  // vision 降级标志：非 vision 模型首次拒绝 image_url part 后置为 false，
  // 重建 msgs 让所有图片走纯文本元数据（attachment_id 仍保留），insert_image 等工具不受影响。
  // 这样"插入图片到文档"等不需要 LLM 看图的操作在非 vision 模型下也能正常工作。
  let visionEnabled = true
  let msgs: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...buildApiHistory(history, visionEnabled),
  ]

  let totalToolCalls = 0
  // Per-turn idempotency for create-once tools — see CREATE_ONCE_TOOLS.
  const executedCreates = new Map<string, unknown>()
  // Per-turn list_fields cache so a batch of update_field (e.g. N column renames) shares ONE
  // list_fields fetch instead of N (was N×2 API calls). Invalidated on create_field/delete_field
  // for that table. Keyed `fields:${app}:${tableId}`. Optional everywhere → no-op when absent.
  const fieldsCache = new Map<string, unknown>()
  // Per-turn blind-retry guard for destructive calls: signatures (name + raw args JSON) of
  // destructive calls that ERRORED this turn. An EXACT repeat is the model "trying the same
  // thing harder" — pointless, and it would re-pop a confirm card for an already-doomed op
  // (the 4-confirm-card failure was round 3 = byte-identical repeat of the failed round 1).
  // A genuinely corrected call differs in args → different sig → NOT blocked. Mirrors the
  // create-once dedup pattern: trust a code guard, not the model's self-discipline.
  const erroredDestructiveSigs = new Set<string>()
  // Tool names that succeeded this turn (in order) — captured as a recipe on success.
  const succeededTools: string[] = []

  // Latest user-message attachments for image tools to consume
  const latestAttachments = (() => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'user' && history[i].attachments?.length) {
        return history[i].attachments
      }
    }
    return []
  })()

  // Agentic loop — runs until no more tool calls or hard limit reached
  for (;;) {
    // Stop cleanly if the turn was cancelled (panel unmounted / new send / nav away).
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

    if (totalToolCalls >= MAX_TOOL_CALLS_PER_TURN) {
      // Surface the safety stop as a tool-result so the UI can display it
      const stopMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `本轮工具调用已达上限（${MAX_TOOL_CALLS_PER_TURN}次）。任务未丢失——回复「继续」即可带上下文接着执行。`,
        createdAt: Date.now(),
      }
      callbacks.onAssistantMessage(stopMsg)
      break
    }

    let textAccum = ''
    const rawToolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []

    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    try {
      stream = await client.chat.completions.create({
        model: llmCfg.model,
        messages: msgs,
        tools: toolsForContext(context.feishu?.kind, { kbEnabled, userSkills: loadedUserSkills }), // only the current resource's tools (+ core)
        tool_choice: 'auto',
        temperature: AGENT_TEMPERATURE,
        stream: true,
      }, { signal })
    } catch (e) {
      // 非 vision 模型收到 image_url part 会直接拒绝（"unknown variant image_url, expected text" 等）。
      // 降级而非报错：重建 msgs 让所有图片走纯文本元数据（attachment_id 仍保留），重试本轮。
      // 这样"插入图片到文档"等不需要 LLM 看图的操作在非 vision 模型下仍能正常工作；
      // 而"识别图片内容"类操作降级后 LLM 看不到图，会回复"我无法查看图片内容"——合理反馈。
      // 仅当本轮消息确实含图片且错误匹配 vision 不支持特征时才降级；其余错误原样抛出。
      // 降级只发生一次：已降级还失败说明是其他原因，原样抛出避免死循环。
      const hasImage = latestAttachments?.some((a) => a.type === 'image' && a.dataUrl) ?? false
      if (visionEnabled && hasImage && e instanceof Error && e.name !== 'AbortError' && isVisionUnsupportedError(e.message)) {
        visionEnabled = false
        // 重建 msgs：图片走纯文本元数据。此时 msgs 还没被 push 任何 assistant/tool 消息
        // （请求在 push 之前就失败了），所以重建是安全的——不丢上下文。
        msgs = [
          { role: 'system', content: systemPrompt },
          ...buildApiHistory(history, false),
        ]
        continue // 重试本轮，用降级后的纯文本 msgs
      }
      throw e
    }

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) {
        textAccum += delta.content
        callbacks.onChunk(delta.content)
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!rawToolCalls[idx]) {
            rawToolCalls[idx] = {
              id: tc.id ?? '',
              type: 'function',
              function: { name: tc.function?.name ?? '', arguments: '' },
            }
          }
          if (tc.id) rawToolCalls[idx].id = tc.id
          if (tc.function?.name) rawToolCalls[idx].function.name = tc.function.name
          if (tc.function?.arguments) rawToolCalls[idx].function.arguments += tc.function.arguments
        }
      }
    }

    const toolCallDefs: ToolCallDef[] = rawToolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }))

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      // Normalize any hand-written Feishu link to the tenant origin (else clip/report links drop
      // the tenant subdomain and won't open). Single output-boundary guard → no recurrence.
      content: textAccum ? rewriteFeishuOrigins(textAccum, await resolveTenantOrigin(context)) : null,
      role: 'assistant',
      tool_calls: toolCallDefs.length > 0 ? toolCallDefs : undefined,
      createdAt: Date.now(),
    }
    callbacks.onAssistantMessage(assistantMsg)

    if (rawToolCalls.length === 0) break

    msgs.push({
      role: 'assistant',
      content: textAccum || null,
      tool_calls: rawToolCalls,
    })

    // Kick off every READ-ONLY call in this round CONCURRENTLY up front — even when the round
    // also mixes in writes. Reads are independent + side-effect-free, so running them in parallel
    // with each other (writes still run serially below, after their confirm gate) only removes
    // latency. The model sequences a dependent read→write across SEPARATE rounds, so a read emitted
    // in the same round as a write is, by construction, not meant to observe that write's result.
    const preReads = new Map<string, Promise<unknown>>()
    if (rawToolCalls.length > 1) {
      for (const c of rawToolCalls) {
        if (!READ_ONLY_TOOLS.has(c.function.name)) continue // writes stay serial in the loop below
        let a: Record<string, unknown> = {}
        try { a = JSON.parse(c.function.arguments) as Record<string, unknown> } catch { /* malformed */ }
        const p = runToolWithFallback(c.function.name, a, context, settings, [], fieldsCache, loadedUserSkills)
        p.catch(() => {}) // mark handled now; the real await + error handling happens in the loop
        preReads.set(c.id, p)
      }
    }

    for (const tc of rawToolCalls) {
      totalToolCalls++

      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        /* ignore malformed */
      }

      callbacks.onToolStart(tc.function.name, args)

      let result: string
      let isError = false
      try {
        // Hard block: the assistant never deletes whole files/tables/docs (principle:
        // deletion must be the user's own action). Refuse before any confirmation.
        if (isFileLevelDelete(tc.function.name, args)) {
          throw new Error(FILE_LEVEL_DELETE_MSG)
        }

        // Blind-retry guard (see erroredDestructiveSigs): an EXACT repeat (same tool + same
        // args) of a destructive call that already errored this turn is skipped BEFORE the
        // confirm gate — no second confirm card, no re-execute. Hands back a self-heal note.
        const errSig = `${SIG_NS}:err:${tc.function.name}:${tc.function.arguments}`
        if (
          (DESTRUCTIVE_TOOLS.has(tc.function.name) || isDestructiveApiCall(tc.function.name, args)) &&
          erroredDestructiveSigs.has(errSig)
        ) {
          throw new Error('该删除/写调用与本次已失败的那一次参数完全相同，已跳过、不再弹确认。请先重新 list_blocks / read_range 核对真实结构与数量，改对参数后再调用，严禁原样重试。')
        }

        // Content-level deletion / generic write — confirm with a BUTTON in the chat
        // (no typing). A whole-file delete is already hard-blocked above. Cancelling
        // skips execution and tells the model to stop, instead of throwing an error.
        // Auto mode (settings.autoConfirm) skips this content-level confirmation entirely
        // — but never the file-level hard block above.
        let gateCancelled: unknown = null
        const isDelete = DESTRUCTIVE_TOOLS.has(tc.function.name) || isDestructiveApiCall(tc.function.name, args)
        const needsConfirm = isDelete || WRITE_TOOLS.has(tc.function.name) || isWritingApiCall(tc.function.name, args)
        if (needsConfirm && !settings?.autoConfirm) {
          if (callbacks.requestConfirmation) {
            const choice = await callbacks.requestConfirmation({
              // 'write' → neutral confirm card (not a misleading「删除」) for bulk updates.
              kind: isDelete ? 'delete' : 'write',
              toolName: tc.function.name,
              summary: describeDestructiveOp(tc.function.name, args),
            })
            if (choice === 'cancel') {
              gateCancelled = { _cancelled: true, note: '用户在确认框点了「取消」，未执行该删除/写操作。请勿重试，改为询问用户下一步。' }
            }
          } else if (!checkDestructiveConfirmation(history, msgs)) {
            // Headless / no interactive UI — fall back to requiring a typed confirmation.
            throw new Error(
              `安全拦截：${tc.function.name} 是破坏性/写操作，必须先告知用户操作内容并获得明确确认后才能执行。`
            )
          }
        }

        let data: unknown
        const createSig = `${SIG_NS}:${tc.function.name}:${tc.function.arguments}`
        if (gateCancelled) {
          data = gateCancelled
        }
        // Idempotency: an exact repeat of a create-once call in this turn is almost
        // certainly an accidental duplicate — skip it, don't create a second one.
        else if (CREATE_ONCE_TOOLS.has(tc.function.name) && executedCreates.has(createSig)) {
          data = {
            _deduped: true,
            note: '本轮已执行过完全相同的创建调用，已自动跳过以避免重复创建（如建出两张同名表）。沿用上次结果即可。',
            previous: executedCreates.get(createSig),
          }
        }
        // Confirm before creating a brand-new Base: let the user choose new vs
        // adding to the current Base (or cancel), instead of the agent guessing.
        else if (tc.function.name === 'create_bitable_app' && callbacks.requestConfirmation) {
          const currentApp = context.feishu?.appToken
          const choice = await callbacks.requestConfirmation({
            kind: 'create_base',
            appName: String(args.name ?? '新应用'),
            currentApp,
            currentBaseName: baseCtx?.appName,
            ownerConfigured: !!settings?.feishuOwnerOpenId?.trim(),
          })
          if (choice === 'cancel') {
            data = { _cancelled: true, note: '用户取消了新建 Base。请停止建表，并询问用户希望如何继续。' }
          } else if (choice === 'current' && currentApp) {
            data = {
              _use_current: true,
              app_token: currentApp,
              note: '用户选择加到当前 Base。请使用此 app_token 继续 create_table 等操作，不要新建 Base。',
            }
          } else {
            data = await runToolWithFallback(tc.function.name, args, context, settings, latestAttachments, undefined, loadedUserSkills)
          }
        } else {
          // Use the concurrently-started read if we kicked one off above; else run it now.
          data = await (preReads.get(tc.id) ?? runToolWithFallback(tc.function.name, args, context, settings, latestAttachments, fieldsCache, loadedUserSkills))
        }
        // Remember successful create-once results so an exact repeat is deduped.
        // (Reached only when the call succeeded — a thrown error skips to catch.)
        if (CREATE_ONCE_TOOLS.has(tc.function.name) && !executedCreates.has(createSig)) {
          executedCreates.set(createSig, data)
        }
        // Redact PII from tool results too (the agent's main data channel) when enabled — covers the
        // copy sent to the LLM, replayed in history, and shown in the (collapsed) tool view alike.
        // 字符串结果（如 read_knowledge_note 的 markdown）直通，避免被 JSON.stringify 再包一层
        // 引号+转义；对象/数组用紧凑 JSON（不缩进）——8k 字符上限下省下缩进 token，多塞真数据，
        // 模型解析 JSON 无需缩进。
        const raw = typeof data === 'string' ? data : JSON.stringify(data)
        result = redactSensitive(truncateToolResult(raw))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/99|403|unauthorized|token/i.test(msg) && HAS_BUILTIN_CREDS) {
          invalidateToken(import.meta.env.VITE_FEISHU_APP_ID ?? '')
        }
        result = `Error: ${msg}`
        isError = true
      }
      // Record a failed destructive call's signature so an exact repeat is short-circuited by
      // the blind-retry guard above (no second confirm card) instead of annoying the user.
      if (isError && (DESTRUCTIVE_TOOLS.has(tc.function.name) || isDestructiveApiCall(tc.function.name, args))) {
        erroredDestructiveSigs.add(`${SIG_NS}:err:${tc.function.name}:${tc.function.arguments}`)
      }

      callbacks.onToolEnd(tc.id, result, isError)
      // Record only real, successful operations.
      if (!isError) succeededTools.push(tc.function.name)

      const toolMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'tool',
        content: result,
        tool_call_id: tc.id,
        name: tc.function.name,
        createdAt: Date.now(),
      }
      callbacks.onToolMessage(toolMsg)

      msgs.push({ role: 'tool', content: result, tool_call_id: tc.id })
    }
  }

  // Turn completed without throwing (no abort/error) → remember what worked, so the
  // assistant gets better at this kind of task over time. Best-effort, local-only.
  if (learn && succeededTools.length) {
    void recordRecipe(
      { kind: resourceKind, task: lastUserText, tools: [...new Set(succeededTools)] },
      (input) => summarizeLesson(client, llmCfg.model, input),
    )
  }
}

/**
 * Distill a successful turn into a one-line, reusable lesson — given the task + tool NAMES
 * only (never any data). Best-effort and fire-and-forget (runs after the user already has
 * their answer), and only for NEW patterns, so the added cost is roughly one short call per
 * novel task type. Recurring tasks reuse the stored lesson with no LLM spend.
 */
async function summarizeLesson(
  client: OpenAI,
  model: string,
  input: { kind: string; task: string; tools: string[] },
): Promise<string> {
  const resp = await client.chat.completions.create({
    model,
    stream: false,
    messages: [{
      role: 'user',
      content:
        `把这次"成功操作"提炼成一句给未来自己看的经验，方便下次遇到同类任务少走弯路。\n` +
        `只说关键做法 / 顺序 / 易错点，30 字以内，不要复述工具清单、不要包含任何具体数据。\n` +
        `任务（${input.kind}）：${input.task}\n依次用到的操作：${input.tools.join(' → ')}\n经验：`,
    }],
  })
  return resp.choices[0]?.message?.content ?? ''
}
