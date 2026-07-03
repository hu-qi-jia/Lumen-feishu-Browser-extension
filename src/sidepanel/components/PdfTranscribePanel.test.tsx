/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const mockExtract = vi.fn(); const mockDetect = vi.fn()
vi.mock('../../shared/pdfExtract', () => ({ extractMarkdown: mockExtract, detectScan: mockDetect }))
const mockPolish = vi.fn()
vi.mock('../../shared/ai/mdPolish', () => ({ polishMarkdown: mockPolish }))
const mockListBlocks = vi.fn(); const mockInsertContent = vi.fn()
vi.mock('../../shared/feishu/docx', () => ({
  markdownToBlocks: vi.fn((md: string) => [{ text: md, style: 'text' as const }]),
  insertContentBlocks: mockInsertContent, listBlocks: mockListBlocks,
}))
const mockResolveToken = vi.fn()
vi.mock('../../shared/feishu/auth', () => ({ resolveToken: mockResolveToken }))
const mockSavePdf = vi.fn(); const mockLoadPdfs = vi.fn(); const mockDeletePdf = vi.fn()
vi.mock('../pdfHistory', () => ({ loadPdfs: mockLoadPdfs, savePdf: mockSavePdf, deletePdf: mockDeletePdf }))

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
  mockSavePdf.mockReset(); mockLoadPdfs.mockReset(); mockDeletePdf.mockReset()
  mockLoadPdfs.mockResolvedValue([])
  mockSavePdf.mockImplementation(async (p: any) => [p])
})
afterEach(cleanup)

describe('PdfTranscribePanel', () => {
  it('select → convert (no polish by default) → result; savePdf recorded', async () => {
    mockExtract.mockResolvedValue('# T\nbody'); mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} recentFiles={[]} onBack={() => {}} />)
    pickFile()
    await waitFor(() => expect(screen.getByText('转换')).toBeTruthy())
    fireEvent.click(screen.getByText('转换'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
    expect(mockPolish).not.toHaveBeenCalled()
    expect(mockSavePdf).toHaveBeenCalled()
  })
  it('AI 润色 on demand updates content', async () => {
    mockExtract.mockResolvedValue('# T\nbody'); mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockPolish.mockResolvedValue('# T\nbody (润色)')
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} recentFiles={[]} onBack={() => {}} />)
    pickFile(); fireEvent.click(screen.getByText('转换'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
    fireEvent.click(screen.getByText('AI 润色'))
    await waitFor(() => expect(mockPolish).toHaveBeenCalled())
  })
  it('disables AI 润色 when disabled (no key)', async () => {
    mockExtract.mockResolvedValue('# T'); mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={true} recentFiles={[]} onBack={() => {}} />)
    pickFile(); fireEvent.click(screen.getByText('转换'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
    // Button wraps its label in a <span class="btn-label">, so getByText returns the span —
    // climb to the actual <button> to read its `disabled` property.
    expect((screen.getByText('AI 润色').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
  it('adds to the selected recent doc at end index', async () => {
    mockExtract.mockResolvedValue('# T'); mockDetect.mockReturnValue({ likelyScan: false, reason: '' })
    mockResolveToken.mockResolvedValue('USER_TOKEN')
    mockListBlocks.mockResolvedValue({ items: [{ block_id: 'CURDOC', children: ['b1', 'b2'] }] })
    mockInsertContent.mockResolvedValue({ blocks_inserted: 1 })
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} recentFiles={[{ token: 'CURDOC', title: '当前文档', kind: 'doc', seen: 1 }]} onBack={() => {}} />)
    pickFile(); fireEvent.click(screen.getByText('转换'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
    fireEvent.click(screen.getByText('添加到文档'))
    await waitFor(() => expect(mockInsertContent).toHaveBeenCalled())
    expect(mockInsertContent).toHaveBeenCalledWith('USER_TOKEN', 'CURDOC', expect.any(Array), 2)
  })
  it('opens history drawer and loads a past conversion', async () => {
    mockLoadPdfs.mockResolvedValue([{ id: 'h1', fileName: '旧文件', markdown: '# 旧内容', createdAt: 1 }])
    render(<PdfTranscribePanel settings={DEFAULT_SETTINGS} context={ctx()} disabled={false} recentFiles={[]} onBack={() => {}} />)
    await waitFor(() => expect(mockLoadPdfs).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('历史记录'))
    await waitFor(() => expect(screen.getByText('旧文件')).toBeTruthy())
    fireEvent.click(screen.getByText('旧文件'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
  })
})
