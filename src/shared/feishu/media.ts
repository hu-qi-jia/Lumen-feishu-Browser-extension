import { feishuFetch } from './http'

/** HTTP statuses worth retrying on a GET — transient rate-limiting / server blips. Feishu's medias
 *  download is a common 429 source when slides harvest many doc images concurrently. */
const RETRYABLE = new Set([429, 500, 502, 503, 504])

/** Download a Feishu drive media (e.g. docx image-block token) as a Blob.
 *  Uses feishuFetch so the outbound guard + feishu host allowlist still apply.
 *
 *  Retries transient failures (429/5xx) with backoff — this is a GET (idempotent), so retrying is
 *  safe under the project's "writes never retry, reads may" rule. robustFetch already retries when
 *  fetch() *throws* (network drop), but a 429 returns a Response with !ok and would otherwise be
 *  counted as a permanent failure. Up to 3 attempts. */
export async function downloadMedia(fileToken: string, userToken: string): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    const res = await feishuFetch('GET', `/drive/v1/medias/${fileToken}/download`, userToken)
    if (res.ok) return res.blob()
    // Drain the body so the connection can be reused before we throw or back off.
    try { await res.blob() } catch { /* ignore — we only care about the status */ }
    const retryable = RETRYABLE.has(res.status)
    if (!retryable || attempt >= 2) throw new Error(`图片下载失败 (${res.status})`)
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
}
