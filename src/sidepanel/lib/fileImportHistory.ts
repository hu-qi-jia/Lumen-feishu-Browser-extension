/** 文件导入历史 —— 本地保存已解析的导入记录，可回看 / 重新写入，无需重新解析。
 *  结构与 pdfHistory.ts 一致（chrome.storage.local，键带 _v1，上限 20 条）。 */
export interface SavedFileImport {
  id: string
  fileName: string
  /** 文件扩展名（csv / tsv / txt），用于显示类型标签。 */
  fileType: string
  /** 解析后的 Markdown 内容（可编辑、可重新写入）。 */
  content: string
  /** 是否在解析时被截断（超过 MAX_CLIP_CHARS）。 */
  truncated: boolean
  createdAt: number
}

const KEY = 'fileImportHistory_v1'
export const MAX_FILE_IMPORTS = 20

function get(): Promise<SavedFileImport[]> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res([]); return }
      chrome.storage.local.get([KEY], (r) => res(Array.isArray(r?.[KEY]) ? (r[KEY] as SavedFileImport[]) : []))
    } catch { res([]) }
  })
}
function set(list: SavedFileImport[]): Promise<void> {
  return new Promise((res) => {
    try {
      if (typeof chrome === 'undefined') { res(); return }
      chrome.storage.local.set({ [KEY]: list }, () => res())
    } catch { res() }
  })
}

export async function loadFileImports(): Promise<SavedFileImport[]> {
  return get()
}
/** Upsert（按 id 去重并提到队首）并截断到 MAX_FILE_IMPORTS。返回新列表。 */
export async function saveFileImport(p: SavedFileImport): Promise<SavedFileImport[]> {
  const list = await get()
  const next = [p, ...list.filter((x) => x.id !== p.id)].slice(0, MAX_FILE_IMPORTS)
  await set(next)
  return next
}
export async function deleteFileImport(id: string): Promise<SavedFileImport[]> {
  const next = (await get()).filter((x) => x.id !== id)
  await set(next)
  return next
}
