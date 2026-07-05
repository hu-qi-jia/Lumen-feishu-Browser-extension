import { feishuUpload } from './http'

/** Upload an image into a docx document and return its file_token, for use as the
 *  `replace_image.token` when binding the material to an image block.
 *
 *  Per Feishu's authoritative "如何插入图片" FAQ + "素材概述", the upload step (Step 2 of the
 *  3-step flow) MUST use:
 *    - parent_type = `docx_image`
 *    - parent_node = the **image block's block_id** (created empty in Step 1) — NOT the document id
 *    - extra       = `{"drive_route_token":"<document_id>"}` (the doc the block lives in)
 *  Other combinations (e.g. parent_node=docId, or parent_type=ccm_doc_open_block) return a
 *  file_token that the docx block API then rejects with `1770001 invalid param`. */
export async function uploadMedia(opts: {
  blob: Blob
  fileName: string
  blockId: string     // the image block's block_id (parent_node) — created empty in Step 1
  docToken: string    // docx document_id; goes into extra.drive_route_token (resolve wiki → obj_token first)
  token: string       // user_access_token
}): Promise<string> {
  const MAX = 20 * 1024 * 1024
  if (opts.blob.size > MAX) {
    throw new Error(`图片过大（${(opts.blob.size / 1024 / 1024).toFixed(1)} MB），上限 20 MB`)
  }

  const fd = new FormData()
  fd.append('file_name', opts.fileName)
  fd.append('parent_type', 'docx_image')
  fd.append('parent_node', opts.blockId)
  fd.append('size', String(opts.blob.size))
  fd.append('extra', JSON.stringify({ drive_route_token: opts.docToken }))
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
