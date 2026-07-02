import { feishuFetch } from './http'

/** Download a Feishu drive media (e.g. docx image-block token) as a Blob.
 *  Uses feishuFetch so the outbound guard + feishu host allowlist still apply. */
export async function downloadMedia(fileToken: string, userToken: string): Promise<Blob> {
  const res = await feishuFetch('GET', `/drive/v1/medias/${fileToken}/download`, userToken)
  if (!res.ok) throw new Error(`图片下载失败 (${res.status})`)
  return res.blob()
}
