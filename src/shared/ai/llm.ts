import type { AppSettings } from '../types'
import { assertSafeBaseUrl } from '../providers'
import { BUILD_CONFIG } from '../config'
import { resolveLlmConfig } from './llmConfig'

/**
 * One-shot (non-streaming) chat completion via plain `fetch`.
 *
 * Unlike the OpenAI SDK, this runs in ANY context — including the MV3 background service
 * worker (the SDK assumes a browser/Node env and silently fails in a SW). Used by the
 * features that can run headlessly from the on-page quick actions (doc audit, data report).
 * Same egress guard as everywhere else (assertSafeBaseUrl).
 */
export async function chatComplete(
  settings: AppSettings,
  content: string,
  systemPrompt?: string,
): Promise<string> {
  const cfg = await resolveLlmConfig(settings)
  const baseURL = assertSafeBaseUrl(cfg.baseUrl, BUILD_CONFIG.openaiAllowedHosts)

  if (cfg.format === 'anthropic') {
    const json = await anthropicRequest(baseURL, cfg.apiKey, cfg.model, content, false, systemPrompt)
    return (json.content?.[0]?.text ?? '').trim()
  }

  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`
  const messages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, { role: 'user', content }]
    : [{ role: 'user', content }]
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, stream: false, messages }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`AI 接口错误（${res.status}）：${body.slice(0, 200) || res.statusText}`)
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return (json.choices?.[0]?.message?.content ?? '').trim()
}

export interface StreamOpts { onChunk?: (full: string) => void; signal?: AbortSignal }

/**
 * Streaming chat completion — same as chatComplete but yields the accumulated text via
 * `onChunk` as it arrives, so the UI can show real progress ("已生成 N 字") instead of a
 * frozen spinner, and `signal` lets the user cancel a slow/hung generation.
 */
export async function chatCompleteStream(settings: AppSettings, content: string, opts: StreamOpts = {}): Promise<string> {
  const cfg = await resolveLlmConfig(settings)
  const baseURL = assertSafeBaseUrl(cfg.baseUrl, BUILD_CONFIG.openaiAllowedHosts)

  if (cfg.format === 'anthropic') {
    return anthropicStream(baseURL, cfg.apiKey, cfg.model, content, opts)
  }

  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, stream: true, messages: [{ role: 'user', content }] }),
    signal: opts.signal,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`AI 接口错误（${res.status}）：${body.slice(0, 200) || res.statusText}`)
  }
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).trim() // no stream support → return raw body
  const decoder = new TextDecoder()
  let buf = '', full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const d = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content
        if (d) { full += d; opts.onChunk?.(full) }
      } catch { /* a partial JSON line — wait for the rest */ }
    }
  }
  return full.trim()
}

// ── Anthropic Messages API helpers ──────────────────────────────────────────

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>
  error?: { message?: string }
}

async function anthropicRequest(
  baseURL: string,
  apiKey: string,
  model: string,
  content: string,
  stream: boolean,
  systemPrompt?: string,
  signal?: AbortSignal,
): Promise<AnthropicResponse> {
  const url = `${baseURL.replace(/\/+$/, '')}/v1/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(stream ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      stream,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content }],
    }),
    signal,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`AI 接口错误（${res.status}）：${body.slice(0, 200) || res.statusText}`)
  }
  return (await res.json()) as AnthropicResponse
}

async function anthropicStream(
  baseURL: string,
  apiKey: string,
  model: string,
  content: string,
  opts: StreamOpts,
  systemPrompt?: string,
): Promise<string> {
  const url = `${baseURL.replace(/\/+$/, '')}/v1/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      stream: true,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content }],
    }),
    signal: opts.signal,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`AI 接口错误（${res.status}）：${body.slice(0, 200) || res.statusText}`)
  }
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).trim()
  const decoder = new TextDecoder()
  let buf = '', full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const evt = JSON.parse(data) as { type: string; delta?: { type: string; text?: string } }
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          full += evt.delta.text
          opts.onChunk?.(full)
        }
      } catch { /* partial JSON — wait */ }
    }
  }
  return full.trim()
}
