import { feishuUpload } from './http'

export async function uploadMedia(opts: {
  blob: Blob
  fileName: string
  mimeType: string
  parentNode: string      // document obj_token (resolve wiki → obj_token before calling)
  parentType: 'docx_image'
  token: string            // user_access_token
}): Promise<string> {
  const MAX = 20 * 1024 * 1024
  if (opts.blob.size > MAX) {
    throw new Error(`图片过大（${(opts.blob.size / 1024 / 1024).toFixed(1)} MB），上限 20 MB`)
  }

  const fd = new FormData()
  fd.append('file_name', opts.fileName)
  fd.append('parent_type', opts.parentType)
  fd.append('parent_node', opts.parentNode)
  fd.append('size', String(opts.blob.size))
  fd.append('file', opts.blob, opts.fileName)

  const res = await feishuUpload('/drive/v1/medias/upload_all', fd, opts.token)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`上传失败：${res.status} ${res.statusText}\n${text}`)
  }
  const json = (await res.json()) as { code: number; msg?: string; data?: { file_token?: string } }
  if (json.code !== 0) throw new Error(json.msg || '上传失败')
  if (!json.data?.file_token) throw new Error('上传成功但未返回 file_token')
  return json.data.file_token
}
