import { describe, it, expect } from 'vitest'
import { parseDocTokenFromUrl } from './parseDocRef'

describe('parseDocTokenFromUrl', () => {
  it('parses a docx URL with query string', () => {
    expect(parseDocTokenFromUrl('https://abc.feishu.cn/docx/DOCM1234567890abc?from=copy')).toEqual({ token: 'DOCM1234567890abc' })
  })
  it('parses a /docs/ URL', () => {
    expect(parseDocTokenFromUrl('https://abc.feishu.cn/docs/DOCMabcdef1234')).toEqual({ token: 'DOCMabcdef1234' })
  })
  it('accepts a bare token', () => {
    expect(parseDocTokenFromUrl('DOCMabcdef1234')).toEqual({ token: 'DOCMabcdef1234' })
  })
  it('returns null for empty / garbage', () => {
    expect(parseDocTokenFromUrl('')).toBeNull()
    expect(parseDocTokenFromUrl('not a link at all!!!')).toBeNull()
  })
  it('returns null for non-doc paths', () => {
    expect(parseDocTokenFromUrl('https://abc.feishu.cn/sheets/shtXXXX')).toBeNull()
  })
})
