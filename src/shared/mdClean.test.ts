import { describe, it, expect } from 'vitest'
import { cleanMarkdown, DEFAULT_CLEAN } from './mdClean'

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
