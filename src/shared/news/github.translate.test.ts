import { describe, it, expect, vi, beforeEach } from 'vitest'
import { translateDescriptions } from './github'
import type { GitHubTrendingRepo } from './types'
import type { AppSettings } from '../types'

// Mock chatComplete so the test never hits the network.
vi.mock('../ai/llm', () => ({
  chatComplete: vi.fn(),
}))

import { chatComplete } from '../ai/llm'

const settings = {} as AppSettings

function mkRepo(desc: string): GitHubTrendingRepo {
  return {
    rank: 1, fullName: 'a/b', url: 'https://github.com/a/b',
    description: desc, language: 'Go', languageColor: '#00ADD8',
    stars: 100, forks: 10, starsSince: 5, sinceLabel: 'today',
  }
}

describe('translateDescriptions', () => {
  beforeEach(() => { vi.mocked(chatComplete).mockReset() })

  it('sets descriptionZh from a clean JSON array response', async () => {
    vi.mocked(chatComplete).mockResolvedValue('["一个很棒的仓库", "Linux 内核源码"]')
    const repos = [mkRepo('An awesome repo'), mkRepo('Linux kernel source tree')]
    await translateDescriptions(settings, repos)
    expect(repos[0].descriptionZh).toBe('一个很棒的仓库')
    expect(repos[1].descriptionZh).toBe('Linux 内核源码')
  })

  it('parses JSON array wrapped in markdown code fences', async () => {
    vi.mocked(chatComplete).mockResolvedValue('```json\n["翻译一", "翻译二"]\n```')
    const repos = [mkRepo('desc1'), mkRepo('desc2')]
    await translateDescriptions(settings, repos)
    expect(repos[0].descriptionZh).toBe('翻译一')
    expect(repos[1].descriptionZh).toBe('翻译二')
  })

  it('parses JSON array with surrounding prose', async () => {
    vi.mocked(chatComplete).mockResolvedValue('Here are the translations:\n["翻译一", "翻译二"]\nHope this helps!')
    const repos = [mkRepo('desc1'), mkRepo('desc2')]
    await translateDescriptions(settings, repos)
    expect(repos[0].descriptionZh).toBe('翻译一')
  })

  it('leaves descriptions untranslated when LLM throws', async () => {
    vi.mocked(chatComplete).mockRejectedValue(new Error('API down'))
    const repos = [mkRepo('desc1')]
    await translateDescriptions(settings, repos)
    expect(repos[0].descriptionZh).toBeUndefined()
  })

  it('leaves descriptions untranslated when response is not JSON', async () => {
    vi.mocked(chatComplete).mockResolvedValue('Sorry, I cannot translate these.')
    const repos = [mkRepo('desc1')]
    await translateDescriptions(settings, repos)
    expect(repos[0].descriptionZh).toBeUndefined()
  })

  it('leaves descriptions untranslated when array length mismatch', async () => {
    vi.mocked(chatComplete).mockResolvedValue('["only one"]')
    const repos = [mkRepo('desc1'), mkRepo('desc2')]
    await translateDescriptions(settings, repos)
    expect(repos[0].descriptionZh).toBeUndefined()
  })

  it('skips repos with empty descriptions', async () => {
    vi.mocked(chatComplete).mockResolvedValue('["翻译一"]')
    const repos = [mkRepo('desc1'), mkRepo('')]
    await translateDescriptions(settings, repos)
    expect(repos[0].descriptionZh).toBe('翻译一')
    expect(repos[1].descriptionZh).toBeUndefined()
  })

  it('does nothing when all descriptions are empty', async () => {
    const repos = [mkRepo(''), mkRepo('')]
    await translateDescriptions(settings, repos)
    expect(chatComplete).not.toHaveBeenCalled()
  })
})
