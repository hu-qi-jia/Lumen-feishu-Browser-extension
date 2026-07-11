// Translation engines for GitHub repo descriptions. Two engines:
//
// - Bing Translator (default): uses the free Edge auth-token endpoint + batch translate API.
//   No API key needed, ~1-2s for 25 short descriptions, works in China. The auth token is
//   a JWT valid for 10 min; we cache it in a module-level variable and refresh on 401.
//
// - AI (optional): uses the user's configured LLM via chatComplete, split into parallel
//   batches of 5 to cut wall-clock time from ~20s to ~5s. Needs an API key.
//
// Both engines are wrapped by `translateDescriptions()` in github.ts, which handles the
// cache (hash → translation) so repeat refreshes skip the network entirely for ~90%+ of items.
import type { AppSettings } from '../types'
import { chatComplete } from '../ai/llm'

// ─── Bing Translator ───────────────────────────────────────────────────────────

const BING_AUTH_URL = 'https://edge.microsoft.com/translate/auth'
const BING_TRANSLATE_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate'

let bingToken: { value: string; expiresAt: number } | null = null

/** Reset the cached Bing auth token. Exported for test isolation only. */
export function _resetBingToken(): void {
  bingToken = null
}

async function getBingToken(): Promise<string> {
  if (bingToken && Date.now() < bingToken.expiresAt) return bingToken.value
  const res = await fetch(BING_AUTH_URL)
  if (!res.ok) throw new Error(`Bing auth HTTP ${res.status}`)
  const token = (await res.text()).trim()
  if (!token) throw new Error('Bing auth returned empty token')
  // JWT tokens are valid for 10 min; refresh after 8 min to be safe.
  bingToken = { value: token, expiresAt: Date.now() + 8 * 60_000 }
  return token
}

/**
 * Translate a batch of English texts to zh-Hans via Bing. Returns translations in the same
 * order as the input. The Bing API accepts up to 100 texts per request and 10000 chars total;
 * 25 short GitHub descriptions fit easily. Throws on HTTP/parse failure (caller falls back
 * to English).
 *
 * On 429 (rate limit) the batch request is retried one-by-one with a short delay — slower
 * but completes instead of leaving all descriptions untranslated.
 */
export async function translateViaBing(texts: string[]): Promise<(string | undefined)[]> {
  if (texts.length === 0) return []
  try {
    return await bingTranslateBatch(texts)
  } catch (e) {
    // 429 rate-limit → fall back to one-by-one so a single throttled batch request doesn't
    // kill the entire translation. Each sub-request gets its own error boundary.
    if (e instanceof Error && e.message.includes('429')) {
      const results: (string | undefined)[] = []
      for (const t of texts) {
        try {
          const r = await bingTranslateBatch([t])
          results.push(r[0])
        } catch {
          results.push(undefined)
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      return results
    }
    throw e
  }
}

/** Single Bing translate API call (batch). Handles 401 token refresh internally. */
async function bingTranslateBatch(texts: string[]): Promise<(string | undefined)[]> {
  const token = await getBingToken()
  const body = texts.map((t) => ({ Text: t }))
  const url = `${BING_TRANSLATE_URL}?api-version=3.0&from=en&to=zh-Hans`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    // Token expired or invalid — clear and retry once.
    bingToken = null
    const newToken = await getBingToken()
    const retry = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${newToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!retry.ok) throw new Error(`Bing translate HTTP ${retry.status}`)
    return parseBingResponse(await retry.json(), texts.length)
  }
  if (!res.ok) throw new Error(`Bing translate HTTP ${res.status}`)
  return parseBingResponse(await res.json(), texts.length)
}

function parseBingResponse(json: unknown, expected: number): (string | undefined)[] {
  if (!Array.isArray(json) || json.length !== expected) {
    throw new Error('Bing response shape mismatch')
  }
  return json.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return undefined
    const translations = (entry as { translations?: Array<{ text?: string }> }).translations
    if (!Array.isArray(translations) || !translations[0]) return undefined
    const text = translations[0].text
    return typeof text === 'string' && text.trim() ? text.trim() : undefined
  })
}

// ─── AI (LLM) parallel batch ──────────────────────────────────────────────────

const AI_BATCH_SIZE = 5

async function translateBatchViaAI(
  settings: AppSettings,
  batch: string[],
): Promise<(string | undefined)[]> {
  const lines = batch.map((t, i) => `${i}: ${t}`)
  const prompt =
    '将以下 GitHub 项目描述翻译成简体中文，保持简洁准确，保留专有名词（如框架名、语言名）不翻译。\n' +
    '只返回一个 JSON 字符串数组，不要包含任何其他文字。数组长度必须等于输入条数，按输入顺序对应。\n' +
    '如果某条描述无需翻译（已经是中文或无意义），返回原文。\n\n' +
    lines.join('\n')

  let raw: string
  try {
    raw = await chatComplete(settings, prompt)
  } catch {
    return batch.map(() => undefined)
  }

  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return batch.map(() => undefined)
  let translations: unknown
  try {
    translations = JSON.parse(jsonMatch[0])
  } catch {
    return batch.map(() => undefined)
  }
  if (!Array.isArray(translations) || translations.length !== batch.length) {
    return batch.map(() => undefined)
  }
  return batch.map((_, i) => {
    const t = translations[i]
    return typeof t === 'string' && t.trim() ? t.trim() : undefined
  })
}

/**
 * Translate texts via the user's LLM, split into parallel batches of AI_BATCH_SIZE to cut
 * wall-clock time. Returns translations in the same order as the input. Individual batch
 * failures degrade gracefully (those items return undefined).
 */
export async function translateViaAI(
  settings: AppSettings,
  texts: string[],
): Promise<(string | undefined)[]> {
  if (texts.length === 0) return []
  const batches: string[][] = []
  for (let i = 0; i < texts.length; i += AI_BATCH_SIZE) {
    batches.push(texts.slice(i, i + AI_BATCH_SIZE))
  }
  const results = await Promise.all(batches.map((b) => translateBatchViaAI(settings, b)))
  return results.flat()
}
