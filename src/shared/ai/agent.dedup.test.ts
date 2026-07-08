// Integration test for the blind-retry guard (fix 2) in runAgent's loop. Drives the real
// agent loop with a FAKE OpenAI client (scripted model rounds) and mocked Feishu tools, so
// we can assert loop-level behavior that a pure-function test can't reach:
//   - an EXACT repeat (same tool + same args) of a failed destructive call is short-circuited
//     BEFORE the confirm gate → no second confirm card, no re-execute;
//   - a CORRECTED retry (different args) is NOT blocked — only byte-identical repeats are.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatMessage, AppSettings, PageContext } from '../types'
import type { AgentCallbacks, ConfirmChoice, ConfirmRequest } from './agent'

// Scripted model rounds. Each entry is the list of streaming deltas for ONE chat.completions
// call. vi.hoisted so the vi.mock factory (hoisted above imports) can close over it.
const { scripts } = vi.hoisted(() => ({ scripts: [] as unknown[] }))

vi.mock('openai', () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: async () => {
          const deltas = (scripts.shift() ?? []) as Array<Record<string, unknown>>
          const chunks = deltas.map((d) => ({ choices: [{ delta: d }] }))
          return {
            async *[Symbol.asyncIterator]() {
              for (const c of chunks) yield c
            },
          }
        },
      },
    }
  }
  return { default: FakeOpenAI }
})

// No network: a tiny doc tree (2 root children) so delete_document_blocks(73,74) fails the
// pre-flight with a precise error and gets recorded; the real assertValidDeleteRange runs.
vi.mock('../feishu/docx', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../feishu/docx')>()
  return {
    ...orig,
    listBlocks: async () => ({
      items: [
        { block_id: 'p', parent_id: '', index: 0, block_type: 1 },
        { block_id: 'a', parent_id: 'doc1', index: 0, block_type: 2 },
        { block_id: 'b', parent_id: 'doc1', index: 1, block_type: 2 },
      ],
      root_children_count: 2,
      root_children: [{ i: 0, t: 'text', s: '' }, { i: 1, t: 'text', s: '' }],
    }),
    deleteBlocks: async () => ({ ok: true }),
  }
})

vi.mock('../feishu/auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../feishu/auth')>()
  return { ...orig, resolveToken: async () => 'tok', forceRefreshUserToken: async () => null }
})

// Imported AFTER the vi.mock calls so runAgent sees the fakes.
const { runAgent } = await import('./agent')

const settings = {
  openaiBaseUrl: 'https://api.invalid/v1', openaiApiKey: 'sk', openaiModel: 'm',
  learnFromHistory: false,
} as unknown as AppSettings
const docCtx = {
  url: 'https://acme.feishu.cn/docx/doc1', title: 't', selectedText: '',
  feishu: { isBase: false, kind: 'doc', documentId: 'doc1' },
} as unknown as PageContext

function makeCallbacks() {
  const confirms = vi.fn(async (_req: ConfirmRequest): Promise<ConfirmChoice> => 'confirm')
  const toolEnds: { err: boolean; msg: string }[] = []
  const callbacks: AgentCallbacks = {
    onChunk: () => {},
    onToolStart: () => {},
    onToolEnd: (_id, msg, err) => toolEnds.push({ err, msg }),
    onAssistantMessage: () => {},
    onToolMessage: () => {},
    requestConfirmation: confirms,
  }
  return { callbacks, confirms, toolEnds }
}

const del = (id: string, start: number, end: number) => ({
  index: 0, id, type: 'function',
  function: { name: 'delete_document_blocks', arguments: JSON.stringify({ document_id: 'doc1', parent_block_id: 'doc1', start_index: start, end_index: end }) },
})

describe('runAgent — blind-retry guard (fix 2)', () => {
  beforeEach(() => { scripts.length = 0 })

  it('an EXACT repeat of a failed destructive call is skipped without re-confirming', async () => {
    // Round 1: delete(73,74) → confirm → pre-flight throws (only 2 root children) → recorded.
    // Round 2: SAME delete(73,74) → blind-retry guard throws BEFORE confirm/execute.
    // Round 3: plain text → loop ends.
    scripts.push(
      [{ tool_calls: [del('c1', 73, 74)] }],
      [{ tool_calls: [del('c2', 73, 74)] }],
      [{ content: 'done' }],
    )
    const { callbacks, confirms, toolEnds } = makeCallbacks()
    const history: ChatMessage[] = [{ id: 'u1', role: 'user', content: '删掉最后那块', createdAt: 0 }]

    await runAgent(history, settings, docCtx, callbacks)

    // Only ONE confirm card (round 1). Round 2 was short-circuited → no second confirm.
    expect(confirms).toHaveBeenCalledTimes(1)
    expect(toolEnds).toHaveLength(2)
    expect(toolEnds[0].err).toBe(true) // pre-flight invalid range
    expect(toolEnds[1].err).toBe(true) // blind-retry guard
    expect(toolEnds[1].msg).toMatch(/已跳过.*不再弹确认|严禁原样重试/)
  })

  it('a CORRECTED retry (different args) is NOT blocked — only exact repeats are', async () => {
    // Round 1: delete(73,74) → fails pre-flight. Round 2: delete(1,2) → valid → succeeds.
    scripts.push(
      [{ tool_calls: [del('c1', 73, 84)] }],
      [{ tool_calls: [del('c2', 1, 2)] }],
      [{ content: 'done' }],
    )
    const { callbacks, confirms, toolEnds } = makeCallbacks()
    await runAgent([{ id: 'u1', role: 'user', content: '删', createdAt: 0 }], settings, docCtx, callbacks)

    // Different args → both reach the confirm gate (2 confirms), and the corrected one succeeds.
    expect(confirms).toHaveBeenCalledTimes(2)
    expect(toolEnds).toHaveLength(2)
    expect(toolEnds[0].err).toBe(true) // bad range
    expect(toolEnds[1].err).toBe(false) // valid range → deleteBlocks ran
  })
})
