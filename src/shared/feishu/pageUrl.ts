import type { PageContext, SessionKind } from '../types'

/**
 * Parse a Feishu resource context out of a page URL — Base (多维表格), Spreadsheet
 * (电子表格), Doc (文档), Slides (演示文稿) or Whiteboard (画板). Used by both the content
 * script (location.href) and the side panel as a fallback when the content script isn't injected.
 *   /base/{appToken}?table=&view=   → Base
 *   /sheets/{spreadsheetToken}      → Spreadsheet
 *   /docx|docs/{documentId}         → Doc
 *   /slides/{slideToken}            → Slides (PPT)
 *   /whiteboard/{whiteboardId}      → Whiteboard (画板)
 * (/wiki/ wraps another type and needs an API lookup to resolve — not handled here.)
 */
export function parseFeishuContext(url: string): PageContext['feishu'] | undefined {
  const base = url.match(/\/base\/([A-Za-z0-9]+)/)
  if (base) {
    const qIdx = url.indexOf('?')
    const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx) : '')
    return {
      isBase: true,
      kind: 'base',
      appToken: base[1],
      tableId: params.get('table') ?? undefined,
      viewId: params.get('view') ?? undefined,
    }
  }
  const sheet = url.match(/\/sheets\/([A-Za-z0-9]+)/)
  if (sheet) return { isBase: false, kind: 'sheet', spreadsheetToken: sheet[1] }

  const doc = url.match(/\/(?:docx|docs)\/([A-Za-z0-9]+)/)
  if (doc) return { isBase: false, kind: 'doc', documentId: doc[1] }

  const slides = url.match(/\/slides\/([A-Za-z0-9]+)/)
  if (slides) return { isBase: false, kind: 'ppt', slideToken: slides[1] }

  const board = url.match(/\/whiteboard\/([A-Za-z0-9]+)/)
  if (board) return { isBase: false, kind: 'board', whiteboardId: board[1] }

  // Wiki node wraps a doc/sheet/base — needs an API lookup to resolve the real type.
  const wiki = url.match(/\/wiki\/([A-Za-z0-9]+)/)
  if (wiki) return { isBase: false, kind: 'wiki', wikiToken: wiki[1] }

  return undefined
}

// Host is irrelevant to parseFeishuContext (it matches on the path), so any feishu.cn origin
// round-trips. The bare apex is enough and keeps these synthetic URLs out of any one tenant.
const FEISHU_URL_BASE = 'https://feishu.cn'

/** Inverse of parseFeishuContext for the resource kinds that work as link-driven sources: build a
 *  Feishu URL from a (kind, token) pair. Used to turn a cached recent doc (which only stores
 *  token + kind) back into a link that resolveSource/fetchMaterial can consume. Returns '' for
 *  kinds with no content-source path (e.g. 'ppt'). */
export function buildFeishuUrl(kind: SessionKind, token: string): string {
  switch (kind) {
    case 'doc': return `${FEISHU_URL_BASE}/docx/${token}`
    case 'sheet': return `${FEISHU_URL_BASE}/sheets/${token}`
    case 'base': return `${FEISHU_URL_BASE}/base/${token}`
    case 'wiki': return `${FEISHU_URL_BASE}/wiki/${token}`
    case 'board': return `${FEISHU_URL_BASE}/whiteboard/${token}`
    default: return '' // 'ppt' — not valid source material for the doc/table → PPT flow
  }
}

/**
 * Turn a browser tab title into a clean document name: strip the trailing
 * "- 飞书云文档 / - Feishu Docs / - Lark Sheets" suffix, and reject the placeholder
 * titles ("飞书", "Loading", empty) that Feishu's SPA briefly shows DURING navigation —
 * those used to get written as the session name, which is the visible "unstable name" bug.
 * Returns '' when the title isn't a real, settled name (caller should then keep the old one).
 */
export function cleanDocTitle(title: string): string {
  // Some (esp. private/on-prem) doc pages briefly expose the URL itself as document.title —
  // never use a URL as the doc name (it produced "name = full URL" on kastd01.*).
  if (/^https?:\/\//i.test((title || '').trim())) return ''
  const name = (title || '')
    // SaaS / Lark brand suffix: "… - 飞书云文档" / "… - Feishu Docs" / "… - Lark".
    .replace(/\s*[-–—|]\s*(飞书|feishu|lark)[^-–—|]*$/i, '')
    // Private/on-prem brand suffix: "… - <品牌>云文档 / 云空间". Anchored to these unambiguous
    // Chinese product words only — NOT English Docs/Sheets/Wiki, which are common real-title
    // endings (e.g. a doc genuinely named "接口Docs" must not be truncated). The doc/sheet title
    // is also fetched cleanly via API now (getDocumentMeta/getSpreadsheet), so this is just a
    // fallback for document.title.
    .replace(/\s*[-–—|]\s*[^-–—|]*?(云文档|云空间)\s*$/i, '')
    .trim()
  if (!name || /^(飞书|feishu|lark|飞书云文档|云文档|loading|加载中)$/i.test(name)) return ''
  return name
}
