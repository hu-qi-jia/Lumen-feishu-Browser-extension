import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockChat = vi.fn()
vi.mock('./llm', () => ({ chatComplete: mockChat }))

const { polishMarkdown, chunkMarkdown } = await import('./mdPolish')
const { DEFAULT_SETTINGS } = await import('../types')

beforeEach(() => mockChat.mockReset())

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
    mockChat.mockResolvedValue('cleaned')
    await polishMarkdown(DEFAULT_SETTINGS, 'raw')
    const [, content, systemPrompt] = mockChat.mock.calls[0]
    expect(content).toBe('raw')
    expect(systemPrompt).toContain('只清理')
    expect(systemPrompt).toContain('不补造')
  })
  it('returns the cleaned text for a single chunk', async () => {
    mockChat.mockResolvedValue('## 标题\n正文')
    expect(await polishMarkdown(DEFAULT_SETTINGS, 'raw')).toBe('## 标题\n正文')
  })
  it('joins multiple chunks with blank lines', async () => {
    mockChat
      .mockResolvedValueOnce('A')
      .mockResolvedValueOnce('B')
    // 13000 chars at default maxChars=12000 → exactly 2 chunks (12000 + 1000).
    const big = 'a'.repeat(13000)
    const out = await polishMarkdown(DEFAULT_SETTINGS, big)
    expect(mockChat).toHaveBeenCalledTimes(2)
    expect(out).toBe('A\n\nB')
  })
  it('throws when the model returns empty', async () => {
    mockChat.mockResolvedValue('')
    await expect(polishMarkdown(DEFAULT_SETTINGS, 'raw')).rejects.toThrow(/未返回内容/)
  })
})
