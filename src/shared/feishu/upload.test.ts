import { describe, it, expect, vi } from 'vitest'
import { uploadMedia } from './upload'

// Mock feishuUpload — vi.mock can't mock sibling default exports of the same module
// tree cleanly, so we mock the http module and let uploadMedia call through.
vi.mock('./http', () => ({ feishuUpload: vi.fn() }))

describe('uploadMedia', () => {
  it('constructs FormData correctly', async () => {
    const { feishuUpload } = await import('./http')
    const mockUp = vi.mocked(feishuUpload)
    mockUp.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 0, data: { file_token: 'tok-abc' } }), { status: 200 })
    )
    const blob = new Blob(['fake'], { type: 'image/png' })
    const token = await uploadMedia({
      blob, fileName: 'test.png', mimeType: 'image/png',
      parentNode: 'doc123', parentType: 'docx_image', token: 'u_tok',
    })
    expect(token).toBe('tok-abc')
    expect(mockUp).toHaveBeenCalledTimes(1)
    const fd: FormData = mockUp.mock.calls[0][1]
    expect(fd.get('file_name')).toBe('test.png')
    expect(fd.get('parent_type')).toBe('docx_image')
    expect(fd.get('parent_node')).toBe('doc123')
    expect(fd.get('size')).toBe('4')
    expect(fd.get('file')).toBeInstanceOf(File)
  })

  it('throws on non-zero code', async () => {
    const { feishuUpload } = await import('./http')
    vi.mocked(feishuUpload).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 99991672, msg: 'permission denied' }), { status: 403 })
    )
    await expect(uploadMedia({
      blob: new Blob(['x']), fileName: 'x.png', mimeType: 'image/png',
      parentNode: 'docx', parentType: 'docx_image', token: 'u_tok',
    })).rejects.toThrow('permission denied')
  })

  it('throws on >20MB blob', async () => {
    const big = new Blob([new Uint8Array(21 * 1024 * 1024)])
    await expect(uploadMedia({
      blob: big, fileName: 'big.png', mimeType: 'image/png',
      parentNode: 'd', parentType: 'docx_image', token: 't',
    })).rejects.toThrow('20 MB')
  })
})
