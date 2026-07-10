import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources'
import type { ChatMessage, AppSettings, PageContext, ToolCallDef } from '../types'
import { HAS_BUILTIN_CREDS, BUILD_CONFIG } from '../config'
import { assertSafeBaseUrl } from '../providers'
import { resolveLlmConfig } from './llmConfig'
import { redactSensitive } from './redact'
import { loadRecipes, recordRecipe, relevantRecipes, formatRecipes, type Recipe } from './recipes'
import { matchSkills, formatSkills, preloadSkills, type Skill } from './skills'
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
  // Enterprise managed mode resolves the company LLM config from the proxy; else user settings.
  // "越用越聪明": feed back the most relevant locally-learned recipes (if enabled).
  const learn = settings.learnFromHistory !== false
  const resourceKind = context.feishu?.kind ?? 'general'
  const lastUserText = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''

  // Run the independent turn-start I/O CONCURRENTLY so the first model request fires after
  // max() not sum(): resolveLlmConfig (a proxy fetch on enterprise cold-start, else instant)
  // overlaps loading the local recipe store. The skill match still follows recipes — its query
  // is the lesson distilled FROM them — so it stays one step after. Behavior-preserving: a
  // recipe-load failure still yields [] (the .catch), matching the old try/catch default.
  const [llmCfg, loadedRecipes] = await Promise.all([
    resolveLlmConfig(settings),
    learn && lastUserText ? loadRecipes().catch(() => [] as Recipe[]) : Promise.resolve([] as Recipe[]),
  ])

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

  let systemPrompt = buildSystemPrompt(context, settings, baseCtx, kbEnabled)

  // Community skills matched at turn start — re-surfaced once at a failure point (Phase 4). Empty
  // unless enterprise+proxy, so the fallback never fires on the store/BYO build.
  let matchedSkills: Skill[] = []
  if (learn && lastUserText) {
    let recipes: Recipe[] = []
    try {
      recipes = relevantRecipes(loadedRecipes, lastUserText, resourceKind)
      const hints = formatRecipes(recipes)
      if (hints) systemPrompt += '\n\n' + hints
    } catch { /* recall is best-effort */ }
    // Community skills from the shared server — no-op unless enterprise+proxy (store unaffected).
    // PRIVACY: NEVER send the raw task text to the proxy. Match on a DE-IDENTIFIED query — the top
    // locally-distilled lesson (data-free) when we have one; otherwise fall back to kind-based preload
    // (no user text leaves at all). Kept in `matchedSkills` to RE-SURFACE on failure (Phase 4).
    try {
      const lessonQuery = recipes.find((r) => r.lesson?.trim())?.lesson ?? ''
      matchedSkills = lessonQuery
        ? await matchSkills({ resourceKind, intent: lessonQuery })
        : await preloadSkills(resourceKind)
      const skillHints = formatSkills(matchedSkills)
      if (skillHints) systemPrompt += '\n\n' + skillHints
    } catch { /* best-effort */ }
  }

  const msgs: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...buildApiHistory(history),
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
  // Phase 4 fallback: re-surface community skills ONCE, at the first failing round, to nudge a retry.
  let skillFallbackTried = false

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

    const stream = await client.chat.completions.create({
      model: llmCfg.model,
      messages: msgs,
      tools: toolsForContext(context.feishu?.kind, { kbEnabled }), // only the current resource's tools (+ core)
      tool_choice: 'auto',
      temperature: AGENT_TEMPERATURE,
      stream: true,
    }, { signal })

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
        const p = runToolWithFallback(c.function.name, a, context, settings, [], fieldsCache)
        p.catch(() => {}) // mark handled now; the real await + error handling happens in the loop
        preReads.set(c.id, p)
      }
    }

    let roundHadError = false
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
            data = await runToolWithFallback(tc.function.name, args, context, settings, latestAttachments)
          }
        } else {
          // Use the concurrently-started read if we kicked one off above; else run it now.
          data = await (preReads.get(tc.id) ?? runToolWithFallback(tc.function.name, args, context, settings, latestAttachments, fieldsCache))
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
      if (isError) roundHadError = true

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

    // Phase 4 — failure fallback: a tool just errored. Re-surface the community's high-score
    // skills (matched at turn start) as a fresh nudge right at the failure point, so the model
    // retries with what worked for others instead of blindly repeating. Once per turn; reuses the
    // turn-start match (no extra network, no new outbound data); empty off proxy → never fires.
    if (roundHadError && !skillFallbackTried && matchedSkills.length) {
      skillFallbackTried = true
      const hint = formatSkills(matchedSkills)
      if (hint) msgs.push({
        role: 'system',
        content: '【上一步出错了——下面是社区里很多人这样做成功的做法，换个思路再试一次；务必按当前真实数据/字段名校准、先读后写，别照搬名称与值】\n' + hint,
      })
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
