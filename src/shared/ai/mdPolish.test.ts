import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mockCreate } } } }))

const { polishMarkdown, chunkMarkdown } = await import('./mdPolish')
const { DEFAULT_SETTINGS } = await import('../types')

beforeEach(() => mockCreate.mockReset())

describe('chunkMarkdown', () => {
  it('returns [] for empty input', () => {
    expect(chunkMarkdown('')).toEqual([])
  })
  it('returns a single chunk under the limit', () => {
    expect(chunkMarkdown('hello')).toEqual(['hello'])
  })
  it('splits header-less long text into chunks ≤ maxChars', () => {
    const big = 'a'.repeat(30000)
    const chunks = chunkMarkdown(big, 12000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(12000)
    expect(chunks.join('')).toBe(big)
  })
  it('keeps section boundaries when splitting', () => {
    const sec = '## Section\n' + 'x'.repeat(8000)
    const md = [sec, sec, sec].join('\n')
    const chunks = chunkMarkdown(md, 12000)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const c of chunks) expect(c).toContain('## Section')
  })
})

describe('polishMarkdown', () => {
  it('embeds the 只清理不补造 constraint in the system prompt', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'cleaned' } }] })
    await polishMarkdown(DEFAULT_SETTINGS, 'raw')
    const messages = mockCreate.mock.calls[0][0].messages
    expect(messages[0].content).toContain('只清理')
    expect(messages[0].content).toContain('不补造')
    expect(messages[1].content).toBe('raw')
  })
  it('returns the cleaned text for a single chunk', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '## 标题\n正文' } }] })
    expect(await polishMarkdown(DEFAULT_SETTINGS, 'raw')).toBe('## 标题\n正文')
  })
  it('joins multiple chunks with blank lines', async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: 'A' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'B' } }] })
    // 13000 chars at default maxChars=12000 → exactly 2 chunks (12000 + 1000).
    // (30000 would yield 3 chunks and exhaust the 2-value mock queue.)
    const big = 'a'.repeat(13000)
    const out = await polishMarkdown(DEFAULT_SETTINGS, big)
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(out).toBe('A\n\nB')
  })
  it('throws when the model returns empty', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] })
    await expect(polishMarkdown(DEFAULT_SETTINGS, 'raw')).rejects.toThrow(/未返回内容/)
  })
})
