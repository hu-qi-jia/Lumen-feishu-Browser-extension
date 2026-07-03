/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const mockExtract = vi.fn()
const mockDetect = vi.fn()
vi.mock('../../shared/pdfExtract', () => ({ extractMarkdown: mockExtract, detectScan: mockDetect }))
const mockPolish = vi.fn()
vi.mock('../../shared/ai/mdPolish', () => ({ polishMarkdown: mockPolish }))
const mockListBlocks = vi.fn()
const mockInsertContent = vi.fn()
vi.mock('../../shared/feishu/docx', () => ({
  markdownToBlocks: vi.fn((md: string) => [{ text: md, style: 'text' as const }]),
  insertContentBlocks: mockInsertContent,
  listBlocks: mockListBlocks,
}))
const mockResolveToken = vi.fn()
vi.mock('../../shared/feishu/auth', () => ({ resolveToken: mockResolveToken }))

const PdfTranscribePanel = (await import('./PdfTranscribePanel')).default
const { DEFAULT_SETTINGS } = await import('../../shared/types')

function ctx() {
  return { feishu: { kind: 'doc', appToken: 'CURDOC', isBase: false }, url: 'https://x.feishu.cn/docx/CURDOC' } as any
}
function pickFile(name = 'demo.pdf') {
  fireEvent.change(screen.getByTestId('pdf-input'), {
    target: { files: [new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' })] },
  })
}

beforeEach(() => {
  mockExtract.mockReset(); mockDetect.mockReset(); mockPolish.mockReset()
  mockListBlocks.mockReset(); mockInsertContent.mockReset(); mockResolveToken.mockReset()
})
afterEach(cleanup)

describe('PdfTranscribePanel', () => {
  it('extracts → polishes → shows polished text in editor', async () => {
    mockExtract.mockResolvedValue('# T\nbody')
    mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockPolish.mockResolvedValue('# T\nbody (polished)')
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByTestId('pdf-editor')).toBeTruthy())
    expect((screen.getByTestId('pdf-editor') as HTMLTextAreaElement).value).toContain('polished')
    expect(mockPolish).toHaveBeenCalledWith(DEFAULT_SETTINGS, '# T\nbody')
  })

  it('aborts with a message on scan detection (no editor)', async () => {
    mockExtract.mockResolvedValue('   ')
    mockDetect.mockReturnValue({ likelyScan: true, reason: '未检测到文本层（可能是扫描件）' })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByText(/未检测到文本层/)).toBeTruthy())
    expect(screen.queryByTestId('pdf-editor')).toBeNull()
  })

  it('falls back to raw markdown when polish fails', async () => {
    mockExtract.mockResolvedValue('raw text here')
    mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockPolish.mockRejectedValue(new Error('boom'))
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByTestId('pdf-editor')).toBeTruthy())
    expect((screen.getByTestId('pdf-editor') as HTMLTextAreaElement).value).toContain('raw text here')
    expect(screen.getByText(/AI 润色失败/)).toBeTruthy()
  })

  it('appends to the current doc via listBlocks + insertContentBlocks', async () => {
    mockExtract.mockResolvedValue('# T\nbody')
    mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockPolish.mockResolvedValue('# T\nbody')
    mockResolveToken.mockResolvedValue('USER_TOKEN')
    mockListBlocks.mockResolvedValue({ items: [{ block_id: 'CURDOC', children: ['b1', 'b2'] }] })
    mockInsertContent.mockResolvedValue({ blocks_inserted: 1 })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByTestId('pdf-editor')).toBeTruthy())
    fireEvent.click(screen.getByText('添加到文档'))
    await waitFor(() => expect(mockInsertContent).toHaveBeenCalled())
    // appended at the END: index = root children length = 2
    expect(mockInsertContent).toHaveBeenCalledWith('USER_TOKEN', 'CURDOC', expect.any(Array), 2)
  })
})
