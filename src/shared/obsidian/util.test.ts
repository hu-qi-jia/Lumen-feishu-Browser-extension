import { describe, it, expect } from 'vitest'
import { sanitizeVaultPath, encodeVaultPath } from './util'

describe('sanitizeVaultPath', () => {
  it('strips leading slash + normalizes backslashes', () => {
    expect(sanitizeVaultPath('/Folder/Note.md')).toBe('Folder/Note.md')
    expect(sanitizeVaultPath('\\Folder\\Note.md')).toBe('Folder/Note.md')
  })
  it('rejects path traversal (.. / .)', () => {
    expect(() => sanitizeVaultPath('../secret')).toThrow(/非法/)
    expect(() => sanitizeVaultPath('a/../../b')).toThrow(/非法/)
    expect(() => sanitizeVaultPath('./x')).toThrow(/非法/)
  })
  it('rejects Obsidian-invalid characters (# | ^ : %% [[ ]])', () => {
    expect(() => sanitizeVaultPath('a#b.md')).toThrow(/非法字符/)
    expect(() => sanitizeVaultPath('a[[b]].md')).toThrow(/非法字符/)
    expect(() => sanitizeVaultPath('a|b.md')).toThrow(/非法字符/)
  })
  it('rejects Windows-invalid characters (< > ? *)', () => {
    expect(() => sanitizeVaultPath('a<b.md')).toThrow(/非法字符/)
    expect(() => sanitizeVaultPath('a?b.md')).toThrow(/非法字符/)
  })
  it('rejects empty input', () => {
    expect(() => sanitizeVaultPath('')).toThrow(/为空/)
    expect(() => sanitizeVaultPath('   ')).toThrow(/为空/)
  })
  it('keeps a clean nested path incl. unicode', () => {
    expect(sanitizeVaultPath('Projects/2026/Obsidian 接入.md')).toBe('Projects/2026/Obsidian 接入.md')
  })
})

describe('encodeVaultPath', () => {
  it('encodes segments but preserves slashes', () => {
    expect(encodeVaultPath('Folder/My Note.md')).toBe('Folder/My%20Note.md')
  })
})
