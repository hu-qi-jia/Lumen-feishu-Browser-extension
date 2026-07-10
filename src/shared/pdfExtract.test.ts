import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPdf2md = vi.fn()
vi.mock('@opendocsg/pdf2md', () => ({ default: mockPdf2md }))

const { extractMarkdown, detectScan, classifyPdfError, stripHtmlComments } = await import('./pdfExtract')

beforeEach(() => mockPdf2md.mockReset())

describe('detectScan', () => {
  it('flags near-empty text as a likely scan', () => {
    const r = detectScan('   \n  \t  ')
    expect(r.likelyScan).toBe(true)
    expect(r.reason).toContain('扫描件')
  })
  it('passes for real text', () => {
    expect(detectScan('这是一段足够长的正文内容，用于表明 PDF 有文本层。').likelyScan).toBe(false)
  })
  it('honors a custom threshold', () => {
    expect(detectScan('短文本', 100).likelyScan).toBe(true)
    expect(detectScan('短文本', 2).likelyScan).toBe(false)
  })
})

// classifyPdfError is unit-tested directly. The async reject path through extractMarkdown isn't
// integration-tested because vitest flags a mock's stored rejection as unhandled regardless of the
// caller's try/catch (same trade-off as src/shared/ai/vision.test.ts).
describe('classifyPdfError', () => {
  it('maps a password/encrypted error to a friendly message', () => {
    const err = classifyPdfError(new Error('Password required to decrypt'))
    expect(err.message).toMatch(/密码保护或损坏/)
  })
  it('rethrows other parse errors with context', () => {
    const err = classifyPdfError(new Error('boom'))
    expect(err.message).toMatch(/PDF 解析失败/)
    expect(err.message).toContain('boom')
  })
  it('handles non-Error throwables', () => {
    const err = classifyPdfError('weird string')
    expect(err.message).toContain('weird string')
    expect(err.message).toMatch(/PDF 解析失败/)
  })
})

describe('extractMarkdown', () => {
  it('passes the buffer as Uint8Array and returns pdf2md output', async () => {
    mockPdf2md.mockResolvedValue('# Title\nbody')
    const out = await extractMarkdown(new TextEncoder().encode('%PDF-1.4 ...').buffer)
    expect(mockPdf2md).toHaveBeenCalledTimes(1)
    expect(mockPdf2md.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect(out).toBe('# Title\nbody')
  })
  it('returns empty string when pdf2md yields non-string', async () => {
    mockPdf2md.mockResolvedValue(null)
    expect(await extractMarkdown(new ArrayBuffer(8))).toBe('')
  })
  it('strips HTML comments such as pdf2md PAGE_BREAK markers', async () => {
    mockPdf2md.mockResolvedValue('intro\n<!-- PAGE_BREAK -->\nmore')
    const out = await extractMarkdown(new ArrayBuffer(8))
    expect(out).not.toContain('<!--')
    expect(out).not.toContain('PAGE_BREAK')
    expect(out).toContain('intro')
    expect(out).toContain('more')
  })
})

describe('stripHtmlComments', () => {
  it('removes a single-line comment', () => {
    expect(stripHtmlComments('a<!-- PAGE_BREAK -->b')).toBe('ab')
  })
  it('removes multi-line comments non-greedily', () => {
    expect(stripHtmlComments('x<!-- multi\nline\ncomment -->y')).toBe('xy')
  })
  it('leaves surrounding text intact', () => {
    expect(stripHtmlComments('# H\nbody\n<!-- x -->\ntail')).toBe('# H\nbody\n\ntail')
  })
})
