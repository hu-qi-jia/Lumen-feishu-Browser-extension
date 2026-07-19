/**
 * Session persistence on chrome.storage.local. Sharded so writing one session's
 * messages doesn't reserialize every session:
 *   sessions_index_v1            → SessionIndex (light, frequent read)
 *   session_msgs_v1::<id>        → ChatMessage[] (per session, lazy read / throttled write)
 */
import type { ChatMessage, SessionIndex } from '@/shared/types'

const IDX_KEY = 'sessions_index_v1'
const MSG_PREFIX = 'session_msgs_v1::'
// Per-attachment dataUrl byte cap. Image attachments can be large base64 blobs, and a single
// session with several high-res uploads could otherwise dominate chrome.storage.local's 10MB
// quota. Oversized dataUrls are dropped on save (the attachment metadata + filename stay, so
// the chat still shows the chip — just without the inline image on reload).
const MAX_ATTACHMENT_DATAURL_BYTES = 500_000

/** Strip oversized attachment dataUrls before persistence. Returns a shallow-cloned array
 *  only when sanitization actually changed a message; otherwise returns the input untouched
 *  so callers that just persist an unmodified array don't pay the clone cost. */
function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  let modified = false
  const out = messages.map((m) => {
    if (!m.attachments?.length) return m
    let mModified = false
    const atts = m.attachments.map((a) => {
      if (a.dataUrl && a.dataUrl.length > MAX_ATTACHMENT_DATAURL_BYTES) {
        mModified = true
        return { ...a, dataUrl: undefined }
      }
      return a
    })
    if (!mModified) return m
    modified = true
    return { ...m, attachments: atts }
  })
  return modified ? out : messages
}

function get<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) =>
    chrome.storage.local.get([key], (r) => resolve(r[key] as T | undefined))
  )
}

function set(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, () => resolve()))
}

export async function loadIndex(): Promise<SessionIndex | undefined> {
  try {
    return await get<SessionIndex>(IDX_KEY)
  } catch {
    return undefined
  }
}

export function saveIndex(index: SessionIndex): Promise<void> {
  return set({ [IDX_KEY]: index })
}

export async function loadMessages(id: string): Promise<ChatMessage[]> {
  return (await get<ChatMessage[]>(MSG_PREFIX + id)) ?? []
}

export function saveMessages(id: string, messages: ChatMessage[]): Promise<void> {
  return set({ [MSG_PREFIX + id]: sanitizeMessages(messages) })
}

export function removeMessages(id: string): Promise<void> {
  const local = chrome.storage.local as typeof chrome.storage.local & {
    remove?: (keys: string | string[], cb?: () => void) => void
  }
  if (typeof local.remove === 'function') {
    return new Promise((resolve) => local.remove!(MSG_PREFIX + id, () => resolve()))
  }
  // Fallback (e.g. dev mock without remove): logically empty it.
  return set({ [MSG_PREFIX + id]: [] })
}
