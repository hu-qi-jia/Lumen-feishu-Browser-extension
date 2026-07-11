import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchFillContext = vi.fn()
const inferFills = vi.fn()
const batchUpdate = vi.fn(async (..._a: unknown[]) => ({}))
vi.mock('./data', () => ({ fetchFillContext: (...a: unknown[]) => fetchFillContext(...a) }))
vi.mock('../ai/smartfill', () => ({ inferFills: (...a: unknown[]) => inferFills(...a) }))
vi.mock('../feishu/api', () => ({ batchUpdateRecords: (...a: unknown[]) => batchUpdate(...a) }))
vi.mock('../feishu/auth', () => ({ resolveToken: async () => 'u-token' }))

const { buildPlan, applyPlan, cachePlan, getCachedPlan, clearCachedPlan, summarizePlan } = await import('./plan')
const { DEFAULT_SETTINGS } = await import('../types')

const field = { id: 'f', name: '行业', type: 3, options: ['互联网', '金融', '教育'] }
const baseSrc = { kind: 'base', appToken: 'APP', tableId: 'TBL' } as const
const ctx = (records: Array<{ recordId: string; fields: Record<string, unknown> }>) => ({
  fields: [field, { id: 'c', name: '公司', type: 1 }],
  records,
  capped: false,
})
const req = (overwrite = false) => ({ targetField: '行业', instruction: '', overwrite })

beforeEach(() => { fetchFillContext.mockReset(); inferFills.mockReset(); batchUpdate.mockClear() })

describe('buildPlan', () => {
  it('targets only empty cells by default, uses filled rows as examples, maps values to the right record id', async () => {
    fetchFillContext.mockResolvedValue(ctx([
      { recordId: 'rec1', fields: { 公司: '星辰科技', 行业: '' } },
      { recordId: 'rec2', fields: { 公司: '未来教育', 行业: '' } },
      { recordId: 'rec3', fields: { 公司: '已知', 行业: '金融' } }, // filled → example, not a target
    ]))
    inferFills.mockResolvedValue(new Map([['r0', '互联网'], ['r1', '教育']]))
    const plan = await buildPlan(DEFAULT_SETTINGS, baseSrc, req(false))
    expect(plan.eligibleRows).toBe(2)
    expect(plan.examples).toBe(1)
    expect(plan.proposed).toEqual([
      expect.objectContaining({ recordId: 'rec1', value: '互联网' }),
      expect.objectContaining({ recordId: 'rec2', value: '教育' }),
    ])
  })

  it('skips a value that is not an existing select option (never invents)', async () => {
    fetchFillContext.mockResolvedValue(ctx([{ recordId: 'rec1', fields: { 公司: 'x', 行业: '' } }]))
    inferFills.mockResolvedValue(new Map([['r0', '航天']]))
    const plan = await buildPlan(DEFAULT_SETTINGS, baseSrc, req(false))
    expect(plan.proposed).toHaveLength(0)
    expect(plan.skipped[0].reason).toContain('不在选项内')
  })

  it('reports a row the model declined as skipped, not guessed', async () => {
    fetchFillContext.mockResolvedValue(ctx([{ recordId: 'rec1', fields: { 公司: 'x', 行业: '' } }]))
    inferFills.mockResolvedValue(new Map())
    const plan = await buildPlan(DEFAULT_SETTINGS, baseSrc, req(false))
    expect(plan.proposed).toHaveLength(0)
    expect(plan.skipped[0].reason).toContain('未填充')
  })

  it('overwrite=true also targets already-filled rows', async () => {
    fetchFillContext.mockResolvedValue(ctx([{ recordId: 'rec1', fields: { 公司: 'a', 行业: '金融' } }]))
    inferFills.mockResolvedValue(new Map([['r0', '互联网']]))
    const plan = await buildPlan(DEFAULT_SETTINGS, baseSrc, req(true))
    expect(plan.eligibleRows).toBe(1)
    expect(plan.proposed[0]).toMatchObject({ recordId: 'rec1', value: '互联网' })
  })

  it('rejects an unknown target field', async () => {
    fetchFillContext.mockResolvedValue(ctx([]))
    await expect(buildPlan(DEFAULT_SETTINGS, baseSrc, { targetField: '不存在', instruction: '', overwrite: false })).rejects.toThrow()
  })
})

describe('applyPlan', () => {
  const base = {
    source: baseSrc, field, totalRows: 1, eligibleRows: 1, consideredRows: 1,
    morePending: false, examples: 0, overwrite: false, capped: false, skipped: [],
  }

  it('writes update-only to the bound table with the coerced value', async () => {
    const plan = { ...base, proposed: [{ recordId: 'rec1', rowLabel: 'x', value: '互联网', display: '互联网' }] }
    const r = await applyPlan(DEFAULT_SETTINGS, plan)
    expect(batchUpdate).toHaveBeenCalledWith('u-token', 'APP', 'TBL', [{ record_id: 'rec1', fields: { 行业: '互联网' } }])
    expect(r.done).toBe(1)
  })

  it('no-op when nothing is proposed', async () => {
    const r = await applyPlan(DEFAULT_SETTINGS, { ...base, proposed: [] })
    expect(batchUpdate).not.toHaveBeenCalled()
    expect(r).toEqual({ done: 0, total: 0, remaining: 0 })
  })

  it('counts what Feishu ACKNOWLEDGED (data.records), not the batch size — no over-report', async () => {
    batchUpdate.mockResolvedValueOnce({ records: [{ record_id: 'rec1' }] }) // acks 1 of 2
    const plan = { ...base, proposed: [
      { recordId: 'rec1', rowLabel: 'a', value: '互联网', display: '互联网' },
      { recordId: 'rec2', rowLabel: 'b', value: '金融', display: '金融' },
    ] }
    const r = await applyPlan(DEFAULT_SETTINGS, plan)
    expect(r).toEqual({ done: 1, total: 2, remaining: 1 })
  })

  it('collapses duplicate record ids into a single update (last value wins)', async () => {
    batchUpdate.mockResolvedValueOnce({ records: [{ record_id: 'rec1' }] })
    const plan = { ...base, proposed: [
      { recordId: 'rec1', rowLabel: 'a', value: '互联网', display: '互联网' },
      { recordId: 'rec1', rowLabel: 'a2', value: '金融', display: '金融' },
    ] }
    await applyPlan(DEFAULT_SETTINGS, plan)
    const sentBatch = batchUpdate.mock.calls[0][3] as Array<{ record_id: string; fields: Record<string, unknown> }>
    expect(sentBatch).toHaveLength(1)
    expect(sentBatch[0]).toEqual({ record_id: 'rec1', fields: { 行业: '金融' } })
  })
})

describe('plan cache (chat-agent smart_fill_apply)', () => {
  beforeEach(() => clearCachedPlan())

  it('cachePlan / getCachedPlan round-trips a plan; clearCachedPlan empties the slot', () => {
    expect(getCachedPlan()).toBeNull()
    const plan = { source: baseSrc, field, totalRows: 0, eligibleRows: 0, consideredRows: 0, morePending: false, examples: 0, overwrite: false, capped: false, proposed: [], skipped: [] }
    cachePlan(plan)
    expect(getCachedPlan()).toBe(plan)
    clearCachedPlan()
    expect(getCachedPlan()).toBeNull()
  })
})

describe('summarizePlan — compact LLM-facing preview', () => {
  it('returns counts + a capped sample, never the full proposed list', () => {
    const proposed = Array.from({ length: 30 }, (_, i) => ({ recordId: `r${i}`, rowLabel: `行${i}`, value: '互联网', display: '互联网' }))
    const plan = {
      source: baseSrc, field, totalRows: 100, eligibleRows: 30, consideredRows: 30,
      morePending: false, examples: 3, overwrite: false, capped: false, proposed, skipped: [],
    }
    const s = summarizePlan(plan) as Record<string, unknown>
    expect(s.target_field).toBe('行业')
    expect(s.proposed_count).toBe(30)
    expect(s.eligible_rows).toBe(30)
    // Preview sample is capped (15), not the whole 30-row proposed list
    expect((s.preview as unknown[]).length).toBe(15)
    expect(JSON.stringify(s).length).toBeLessThan(2000)
  })

  it('includes skipped samples and the "confirm before apply" note', () => {
    const plan = {
      source: baseSrc, field, totalRows: 2, eligibleRows: 1, consideredRows: 1,
      morePending: true, examples: 0, overwrite: false, capped: true,
      proposed: [{ recordId: 'r0', rowLabel: '甲', value: '金融', display: '金融' }],
      skipped: [{ rowLabel: '乙', reason: '模型未填充（不确定）' }],
    }
    const s = summarizePlan(plan) as Record<string, unknown>
    expect(s.skipped_count).toBe(1)
    expect((s.skipped_samples as unknown[])[0]).toMatchObject({ row: '乙', reason: '模型未填充（不确定）' })
    expect(String(s.note)).toContain('smart_fill_apply')
    expect(s.more_pending).toBe(true)
    expect(s.capped).toBe(true)
  })
})
