/** Saved PDF→Markdown conversions (PDF 转写历史). Local-only — a past conversion can be
 *  reopened without re-parsing. Mirrors slidesStore / recentFiles patterns. */
export interface SavedPdf {
  id: string
  fileName: string
  markdown: string
  createdAt: number
}

const KEY = 'pdfHistory_v1'
export const MAX_PDFS = 20
// Per-PDF byte cap. The `markdown` field holds the ENTIRE converted text of a PDF, which
// for a long document can be hundreds of KB. chrome.storage.local has a 10MB total quota
// shared with sessions/settings/news-cache — capping a single PDF's footprint prevents one
// huge conversion from evicting everything else. Oversized PDFs save with markdown truncated.
const MAX_PDF_BYTES = 800_000

function sanitizePdf(p: SavedPdf): SavedPdf {
  const json = JSON.stringify(p)
  if (json.length <= MAX_PDF_BYTES) return p
  // Truncate markdown to fit. UTF-16 chars in JS mean slice by char count is approximate,
  // but the JSON overhead is small relative to the markdown body, so this is good enough.
  // Keep a tail marker so the user sees the conversion was truncated on reopen.
  const overhead = json.length - p.markdown.length
  const keep = Math.max(0, MAX_PDF_BYTES - overhead - 20)
  return { ...p, markdown: p.markdown.slice(0, keep) + '\n\n[已截断]' }
}

function get(): Promise<SavedPdf[]> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res([]); return }
      chrome.storage.local.get([KEY], (r) => res(Array.isArray(r?.[KEY]) ? (r[KEY] as SavedPdf[]) : []))
    } catch { res([]) }
  })
}
function set(list: SavedPdf[]): Promise<void> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res(); return }
      chrome.storage.local.set({ [KEY]: list }, () => res())
    } catch { res() }
  })
}

export async function loadPdfs(): Promise<SavedPdf[]> {
  return get()
}
/** Upsert (dedup by id → lift to front) and cap at MAX_PDFS. Returns the new list. */
export async function savePdf(p: SavedPdf): Promise<SavedPdf[]> {
  const list = await get()
  const next = [sanitizePdf(p), ...list.filter((x) => x.id !== p.id)].slice(0, MAX_PDFS)
  await set(next)
  return next
}
export async function deletePdf(id: string): Promise<SavedPdf[]> {
  const next = (await get()).filter((x) => x.id !== id)
  await set(next)
  return next
}
