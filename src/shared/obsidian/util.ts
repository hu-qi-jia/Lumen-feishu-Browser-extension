/** Obsidian vault path utilities.
 *  Vault paths are POSIX-style and relative to the vault root (e.g. 'Folder/Note.md').
 *  These sanitize agent/user-supplied paths before they reach the REST API. */

// Obsidian-forbidden inside links/filenames (see Internal links doc).
const INVALID_NOTE_CHARS = /[#|^:`%%\[\]]/
// Windows-forbidden filename chars (per-segment; no '/' — segments are pre-split).
const WIN_INVALID = /[<>:"\\|?*\x00-\x1f]/

/** Sanitize a vault-relative path. Strips a leading slash, normalizes backslashes,
 *  rejects '..' / '.' segments and Obsidian/Windows-invalid characters.
 *  Returns the cleaned path; throws on unrecoverable input. */
export function sanitizeVaultPath(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('vault 路径为空')
  const p = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  for (const seg of p.split('/')) {
    if (seg === '..' || seg === '.') throw new Error(`非法 vault 路径（禁止 .. / .）：${raw}`)
    if (seg === '') continue
    if (INVALID_NOTE_CHARS.test(seg) || WIN_INVALID.test(seg)) throw new Error(`vault 路径含非法字符：${seg}`)
  }
  return p
}

/** URL-encode a vault path for /vault/{path}, preserving '/' separators. */
export function encodeVaultPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
