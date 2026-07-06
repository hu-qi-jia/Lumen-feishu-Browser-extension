import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppSettings } from '../types'

// Mock chatComplete for the AI path.
vi.mock('../ai/llm', () => ({
  chatComplete: vi.fn(),
}))

import { translateViaBing, translateViaAI, _resetBingToken } from './translate'
import { chatComplete } from '../ai/llm'

// Mock global fetch for Bing tests.
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const settings = {} as AppSettings

describe('translateViaBing', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    _resetBingToken()
  })

  it('returns translations in order for a successful response', async () => {
    // First call: auth token. Second call: translate API.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('fake-jwt-token'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { translations: [{ text: '一个仓库' }] },
          { translations: [{ text: '另一个仓库' }] },
        ]),
      })

    const result = await translateViaBing(['A repo', 'Another repo'])
    expect(result).toEqual(['一个仓库', '另一个仓库'])
    // Auth call + translate call.
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][0]).toContain('api-edge.cognitive.microsofttranslator.com')
  })

  it('retries with a new token on 401', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('expired-token') }) // auth
      .mockResolvedValueOnce({ ok: false, status: 401 }) // translate → 401
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('fresh-token') }) // auth retry
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ translations: [{ text: '翻译' }] }]),
      }) // translate retry

    const result = await translateViaBing(['desc'])
    expect(result).toEqual(['翻译'])
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('throws on non-ok response after retry', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('token') })
      .mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(translateViaBing(['desc'])).rejects.toThrow('Bing translate HTTP 500')
  })

  it('returns empty array for empty input', async () => {
    const result = await translateViaBing([])
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('translateViaAI', () => {
  beforeEach(() => {
    vi.mocked(chatComplete).mockReset()
  })

  it('splits into parallel batches and flattens results', async () => {
    // 7 items → 2 batches of 5 + 2.
    vi.mocked(chatComplete)
      .mockResolvedValueOnce('["t1","t2","t3","t4","t5"]')
      .mockResolvedValueOnce('["t6","t7"]')

    const texts = Array.from({ length: 7 }, (_, i) => `desc${i + 1}`)
    const result = await translateViaAI(settings, texts)
    expect(result).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7'])
    expect(chatComplete).toHaveBeenCalledTimes(2)
  })

  it('degrades gracefully when a batch fails', async () => {
    vi.mocked(chatComplete)
      .mockResolvedValueOnce('["t1","t2","t3","t4","t5"]')
      .mockRejectedValueOnce(new Error('API down'))

    const texts = Array.from({ length: 7 }, (_, i) => `desc${i + 1}`)
    const result = await translateViaAI(settings, texts)
    expect(result.slice(0, 5)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(result.slice(5)).toEqual([undefined, undefined])
  })

  it('returns empty array for empty input', async () => {
    const result = await translateViaAI(settings, [])
    expect(result).toEqual([])
    expect(chatComplete).not.toHaveBeenCalled()
  })
})
