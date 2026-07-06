import { describe, it, expect } from 'vitest'
import { parseWeiboHotSearch } from './weibo'

// Captured shape of weibo.com/ajax/side/hotSearch (trimmed). Field set mirrors the live
// response: realpos, word, num, label_name, category (often empty), word_scheme.
const SAMPLE = JSON.stringify({
  ok: 1,
  data: {
    realtime: [
      { realpos: 1, word: '热搜词条一', num: 1234567, label_name: '沸', category: '文娱', word_scheme: '热搜词条一' },
      { realpos: 2, word: '热搜词条二', num: 987654, label_name: '热', category: '', word_scheme: '热搜词条二' },
      { realpos: 3, word: '词条三 &quot;带引号&quot;', num: 555, label_name: '', category: '科技' },
      { realpos: 4, word: '', num: 0, label_name: '' }, // skipped — empty word
    ],
  },
})

describe('parseWeiboHotSearch', () => {
  it('extracts rank, keyword, hotValue, label, category, url', () => {
    const items = parseWeiboHotSearch(SAMPLE)
    expect(items).toHaveLength(3)

    const i0 = items[0]
    expect(i0.rank).toBe(1)
    expect(i0.keyword).toBe('热搜词条一')
    expect(i0.hotValue).toBe(1234567)
    expect(i0.labelName).toBe('沸')
    expect(i0.category).toBe('文娱')
    expect(i0.url).toBe(`https://s.weibo.com/weibo?q=%23${encodeURIComponent('热搜词条一')}%23`)
  })

  it('falls back to index when realpos is missing', () => {
    const json = JSON.stringify({ data: { realtime: [
      { word: 'a' }, // realpos undefined → 1
      { word: 'b' }, // realpos undefined → 2
    ] } })
    const items = parseWeiboHotSearch(json)
    expect(items.map((i) => i.rank)).toEqual([1, 2])
  })

  it('returns empty array on malformed JSON', () => {
    expect(parseWeiboHotSearch('not json')).toEqual([])
  })

  it('returns empty array when realtime array is missing', () => {
    expect(parseWeiboHotSearch(JSON.stringify({ data: {} }))).toEqual([])
  })

  it('skips entries with empty word', () => {
    const json = JSON.stringify({ data: { realtime: [
      { word: 'keep' },
      { word: '   ' },
      { word: 'also-keep' },
    ] } })
    const items = parseWeiboHotSearch(json)
    expect(items.map((i) => i.keyword)).toEqual(['keep', 'also-keep'])
  })

  it('treats missing num as 0', () => {
    const items = parseWeiboHotSearch(JSON.stringify({ data: { realtime: [{ word: 'x' }] } }))
    expect(items[0].hotValue).toBe(0)
  })
})
