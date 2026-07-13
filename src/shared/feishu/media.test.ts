import { vi, describe, it, expect } from 'vitest'
import { downloadMedia } from './media'

vi.mock('./http', () => ({
  feishuFetch: vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 })),
}))
import { feishuFetch } from './http'

describe('downloadMedia', () => {
  it('GETs the drive media download path and returns a Blob', async () => {
    const blob = await downloadMedia('tok123', 'user-tok')
    expect(feishuFetch).toHaveBeenCalledWith('GET', '/drive/v1/medias/tok123/download', 'user-tok', undefined, undefined)
    expect(blob).toBeInstanceOf(Blob)
  })

  it('passes extra param as JSON string when provided', async () => {
    await downloadMedia('tok456', 'user-tok', { docType: 'docx' })
    expect(feishuFetch).toHaveBeenCalledWith('GET', '/drive/v1/medias/tok456/download', 'user-tok', undefined, { extra: '{"docType":"docx"}' })
  })
})
