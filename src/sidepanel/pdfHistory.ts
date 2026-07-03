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
  const next = [p, ...list.filter((x) => x.id !== p.id)].slice(0, MAX_PDFS)
  await set(next)
  return next
}
export async function deletePdf(id: string): Promise<SavedPdf[]> {
  const next = (await get()).filter((x) => x.id !== id)
  await set(next)
  return next
}
