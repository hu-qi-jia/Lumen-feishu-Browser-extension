export type MessageRole = 'user' | 'assistant' | 'tool' | 'system'

export interface ToolCallDef {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface SelectionAttachmentData {
  kind: 'doc' | 'wiki'
  /** Resolved to the underlying doc token (wiki → obj_token) before staging, so list_blocks works. */
  docToken: string
  docTitle: string
  url: string
  selectedText: string
  /** Resolved async from list_blocks text-match; undefined until then. */
  paragraphText?: string
  headingText?: string
}

/** Wire payload sent content-script → background → side panel (no resolved context yet). */
export interface DocSelectionPayload {
  kind: 'doc' | 'wiki'
  docToken: string
  docTitle: string
  url: string
  selectedText: string
}

/** A whole Feishu resource referenced as context (doc / sheet / base / wiki). Unlike a
 *  selection (a text snippet), this points at the entire document — the agent reads it on
 *  demand via the matching read tool (get_document_content / list_tables / read_range …). */
export interface DocRefAttachmentData {
  kind: SessionKind
  docToken: string
  docTitle: string
  url: string
  /** 电子表格选中的工作表 id（kind === 'sheet' 时可选；不填则交给 AI 自行枚举）。 */
  sheetId?: string
  /** 电子表格选中的工作表名，仅用于 chip 展示。 */
  sheetName?: string
  /** 多维表格选中的数据表 id（kind === 'base' 时可选；不填则交给 AI 自行枚举）。 */
  tableId?: string
  /** 多维表格选中的数据表名，仅用于 chip 展示。 */
  tableName?: string
}

export type AttachmentType = 'image' | 'file' | 'selection' | 'docref'

export interface Attachment {
  id: string
  type: AttachmentType
  name: string
  mimeType: string
  size: number
  /** Base64 data URL for image attachments. */
  dataUrl?: string
  /** Text content for file attachments (csv/tsv/txt). */
  content?: string
  /** type === 'selection' — a doc snippet staged as chat context. */
  selection?: SelectionAttachmentData
  /** type === 'docref' — a whole document referenced as context. */
  docref?: DocRefAttachmentData
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string | null
  tool_calls?: ToolCallDef[]
  tool_call_id?: string
  name?: string
  createdAt: number
  isStreaming?: boolean
  attachments?: Attachment[]
}

export interface PageContext {
  url: string
  title: string
  selectedText: string
  feishu?: {
    isBase: boolean
    appToken?: string
    tableId?: string
    viewId?: string
    /** Detected Feishu resource kind. 'wiki' is unresolved until the wiki node is
     *  looked up (it wraps a doc / sheet / base). */
    kind?: 'base' | 'sheet' | 'doc' | 'wiki' | 'ppt'
    /** Spreadsheet token when kind === 'sheet'. */
    spreadsheetToken?: string
    /** Document id when kind === 'doc'. */
    documentId?: string
    /** Wiki node token when kind === 'wiki' (resolve to the real obj via API). */
    wikiToken?: string
    /** Slide token when kind === 'ppt' (Feishu 演示文稿). */
    slideToken?: string
  }
}

/**
 * Runtime settings stored (encrypted) in chrome.storage.local.
 * Feishu App Credentials are NOT here — they come from build-time env vars.
 */
export interface AppSettings {
  openaiBaseUrl: string
  openaiApiKey: string
  openaiModel: string
  /** user_access_token — only used when no built-in App Credentials */
  feishuAccessToken: string
  /**
   * The current user's open_id. When set, Bases created via create_bitable_app
   * (app/tenant identity) are auto-transferred to this user so they appear in the
   * user's own drive. Obtained from authen/v1/user_info after OAuth.
   */
  feishuOwnerOpenId: string
  /** "越用越聪明": remember successful operation patterns locally and feed the most
   *  relevant back into the prompt next time. Default on. */
  learnFromHistory?: boolean
  /** Auto mode: auto-approve CONTENT-level deletes (rows/fields/blocks/dedupe) within a
   *  document — no per-action button click. File-level deletes stay hard-blocked. Default off. */
  autoConfirm?: boolean
  /** API 协议格式。仅支持 'openai'（Chat Completions）；字段保留以兼容旧存储。 */
  llmFormat?: 'openai' | 'anthropic'
  /** Obsidian Local REST API base URL (loopback only). Default http://127.0.0.1:27123. */
  obsidianBaseUrl?: string
  /** Default folder for new KB notes created without an explicit target (empty = vault root). */
  obsidianInboxPath?: string
  /** Comma-separated glob exclusions for retrieval/listing (e.g. 'Archive/**, Daily/**'). */
  obsidianExcludePaths?: string
  /** Display name of the connected vault (cosmetic). */
  obsidianVaultName?: string
}

import { DEFAULT_PROVIDER } from './providers'

// ─── Sessions (persisted conversations) ───────────────────────────────────────

export type SessionKind = 'base' | 'sheet' | 'doc' | 'wiki' | 'ppt'

export interface SessionMeta {
  id: string
  /** Display name — for doc sessions this becomes the Base/document title. */
  title: string
  /** Bound document: appToken for a per-document session, null for a general one. */
  appToken: string | null
  createdAt: number
  updatedAt: number
  /** Message count (for the list, so we don't load message bodies). */
  messageCount: number
  /** Whether `title` has been filled from the real Base appName (vs a placeholder). */
  titleResolved: boolean
  /** True when the user manually renamed the session — auto-sync (a doc rename) must not
   *  overwrite a name the user chose by hand. */
  titleCustom?: boolean
  /** Feishu resource kind — drives the doc icon when grouping the history by document.
   *  Undefined on legacy sessions created before this field existed. */
  kind?: SessionKind
  /** Truncated first user message — a one-line preview so the flat list reads at a glance
   *  and powers search without loading message bodies. Set once (never overwritten). */
  preview?: string
  /** 本会话是否启用知识库（chat 工具开关）。缺省 false（旧会话无此键）。 */
  kbEnabled?: boolean
}

export interface SessionIndex {
  sessions: SessionMeta[]
  /** Currently selected session id. */
  activeId: string | null
  /** appToken → sessionId, for fast find-on-document-switch. */
  byAppToken: Record<string, string>
  /** The single "general" session (used on non-Base pages). */
  generalId: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Default to a Chinese model (DeepSeek). Overseas providers stay selectable in Settings.
  openaiBaseUrl: DEFAULT_PROVIDER.baseUrl,
  openaiApiKey: '',
  openaiModel: DEFAULT_PROVIDER.models[0],
  feishuAccessToken: '',
  feishuOwnerOpenId: '',
  learnFromHistory: true,
  autoConfirm: false,
  llmFormat: 'openai',
  obsidianBaseUrl: 'http://127.0.0.1:27123',
  obsidianInboxPath: '',
  obsidianExcludePaths: '',
  obsidianVaultName: '',
}
