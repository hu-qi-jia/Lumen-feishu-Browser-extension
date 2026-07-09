import { describe, it, expect } from 'vitest'
import { cleanMarkdown, DEFAULT_CLEAN, normalizeHeadingLevels } from './mdClean'

describe('cleanMarkdown — debreak', () => {
  it('merges a soft-wrapped latin sentence with a space at the boundary', () => {
    expect(cleanMarkdown('This is a\nlong sentence.')).toBe('This is a long sentence.')
  })
  it('merges Chinese soft-wrapped prose with no extra space', () => {
    expect(cleanMarkdown('这是一段\n中文正文。')).toBe('这是一段中文正文。')
  })
  it('leaves a heading and its body on separate lines', () => {
    expect(cleanMarkdown('# Title\nbody')).toBe('# Title\nbody')
  })
  it('does not merge list items', () => {
    expect(cleanMarkdown('- one\n- two')).toBe('- one\n- two')
  })
  it('does not merge ordered list items', () => {
    expect(cleanMarkdown('1. one\n2. two')).toBe('1. one\n2. two')
  })
  it('does not merge blockquote lines', () => {
    expect(cleanMarkdown('> quoted\n> more')).toBe('> quoted\n> more')
  })
  it('leaves a paragraph break (blank line) intact', () => {
    expect(cleanMarkdown('para one\n\npara two')).toBe('para one\n\npara two')
  })
  it('does not touch the contents of a fenced code block', () => {
    const md = '```\nline a\nline b\n```'
    expect(cleanMarkdown(md)).toBe(md)
  })
  it('does not merge table rows', () => {
    const md = '| a | b |\n| c | d |'
    expect(cleanMarkdown(md)).toBe(md)
  })
  it('does not merge a setext underline onto the heading text', () => {
    expect(cleanMarkdown('Title\n=====')).toBe('Title\n=====')
  })
  it('is idempotent', () => {
    const md = 'This is a\nlong sentence.\n\n# H\n- a\n- b'
    expect(cleanMarkdown(cleanMarkdown(md))).toBe(cleanMarkdown(md))
  })
})

describe('cleanMarkdown — squeezeBlank', () => {
  it('collapses 3+ blank lines into one', () => {
    expect(cleanMarkdown('a\n\n\n\nb')).toBe('a\n\nb')
  })
  it('leaves a single blank line as-is', () => {
    expect(cleanMarkdown('a\n\nb')).toBe('a\n\nb')
  })
})

describe('cleanMarkdown — opts', () => {
  it('keeps soft breaks when debreak is off', () => {
    expect(cleanMarkdown('hello\nworld', { debreak: false })).toBe('hello\nworld')
  })
  it('honors an all-off opts (returns the input essentially unchanged except CRLF)', () => {
    expect(cleanMarkdown('a\n\n\n\nb', { debreak: false, squeezeBlank: false })).toBe('a\n\n\n\nb')
  })
  it('DEFAULT_CLEAN has both cleaners on', () => {
    expect(DEFAULT_CLEAN).toEqual({ debreak: true, squeezeBlank: true })
  })
  it('empty input returns empty', () => {
    expect(cleanMarkdown('')).toBe('')
  })
})

describe('normalizeHeadingLevels — decimal-numbered outlines', () => {
  it('restores distinct levels when pdf2md flattens a numbered outline to one level', () => {
    // Ground truth: pdf2md emitted chapter, section, AND sub-section all as `##`.
    const md = [
      '# Research Report',
      '## 2 Method',
      'body about the method.',
      '## 2.1 Setup',
      'setup body.',
      '## 2.1.1 Participants',
      'participants body.',
      '## 2.2 Procedure',
      'procedure body.',
    ].join('\n')
    const out = normalizeHeadingLevels(md)
    // 2 → # (chapter, because 2.x exists), 2.1 → ##, 2.1.1 → ###, 2.2 → ##.
    expect(out).toContain('# 2 Method')
    expect(out).toContain('## 2.1 Setup')
    expect(out).toContain('### 2.1.1 Participants')
    expect(out).toContain('## 2.2 Procedure')
    // Crucially, 2.1 and 2.1.1 are NO LONGER the same level.
    expect(out.indexOf('## 2.1 Setup')).toBeLessThan(out.indexOf('### 2.1.1 Participants'))
  })
  it('re-levels multi-part sections even with no bare chapter heading', () => {
    const md = '## 1.1 Background\nbody\n## 1.1.1 Motivation\nbody'
    const out = normalizeHeadingLevels(md)
    expect(out).toContain('## 1.1 Background')
    expect(out).toContain('### 1.1.1 Motivation')
  })
  it('treats a bare chapter number as a chapter only when a deeper sub-section exists', () => {
    // "2" is promoted to # because "2.1" is present.
    const md = '## 2 Method\n## 2.1 Setup'
    expect(normalizeHeadingLevels(md)).toContain('# 2 Method')
  })
  it('leaves an unrelated numbered heading untouched (no sub-section anchors it)', () => {
    // No "10.x" anywhere → "10 Best Practices" is not a chapter root; stays ##.
    expect(normalizeHeadingLevels('## 10 Best Practices\nbody')).toBe('## 10 Best Practices\nbody')
  })
  it('does anchor a same-numbered chapter once a sub-section appears', () => {
    // Here "10.1 Detail" makes 10 a chapter root, so "10 Tips" is promoted.
    const out = normalizeHeadingLevels('## 10 Tips\n## 10.1 Detail')
    expect(out).toContain('# 10 Tips')
    expect(out).toContain('## 10.1 Detail')
  })
  it('never promotes a non-heading line (zero false positives on body / list items)', () => {
    // A flat "2.1 ..." paragraph and an ordered-list "1. item" must stay as-is.
    const md = '2.1 million users signed up.\n1. first step\n2. second step'
    expect(normalizeHeadingLevels(md)).toBe(md)
  })
  it('ignores numbered headings inside a fenced code block', () => {
    const md = '```\n## 2.1 Not a real heading\n```'
    expect(normalizeHeadingLevels(md)).toBe(md)
  })
  it('leaves non-numbered headings untouched', () => {
    expect(normalizeHeadingLevels('## Introduction\nbody')).toBe('## Introduction\nbody')
    expect(normalizeHeadingLevels('# 标题\n正文')).toBe('# 标题\n正文')
  })
  it('is idempotent', () => {
    const md = '# Report\n## 2 Method\n## 2.1 Setup\n## 2.1.1 Detail\nbody'
    expect(normalizeHeadingLevels(normalizeHeadingLevels(md))).toBe(normalizeHeadingLevels(md))
  })
  it('empty input returns empty', () => {
    expect(normalizeHeadingLevels('')).toBe('')
  })
})
