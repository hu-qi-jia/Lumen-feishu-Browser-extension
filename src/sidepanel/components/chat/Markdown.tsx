import type { ReactNode, MouseEvent, Key } from 'react'
import { openUrlInNewTab } from '@/shared/url'
import './Markdown.css'

/** Hand-rolled minimal markdown → React (headings, lists, tables, code, links).
 *  Extracted from MessageList so chat + PDF preview share one renderer. */
export default function Markdown({ children }: { children: string }) {
  // HTML comments aren't visible content (pdf2md emits <!-- PAGE_BREAK --> between pages).
  // Strip them at the render layer so a stray marker can never show up as literal text,
  // even if it survived into the source (e.g. a history item saved before the extract-time strip).
  const src = (children ?? '').replace(/<!--[\s\S]*?-->/g, '')
  const lines = src.split('\n')
  const elements: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++ }
      const joined = codeLines.join('\n').trim()
      const codeUrl = safeHref(joined)
      if (codeUrl && !/\s/.test(joined)) {
        elements.push(<p key={i} className="md-p">{linkEl(codeUrl, codeUrl, i)}</p>)
      } else {
        elements.push(
          <pre key={i} className="md-code-block">
            {lang && <span className="md-code-lang">{lang}</span>}
            <code>{codeLines.join('\n')}</code>
          </pre>,
        )
      }
    } else if (isTableHeader(lines, i)) {
      const header = splitCells(line)
      let j = i + 2
      const rows: string[][] = []
      while (j < lines.length && lines[j].trim().startsWith('|')) { rows.push(splitCells(lines[j])); j++ }
      elements.push(
        <table key={i} className="md-table">
          <thead><tr>{header.map((h, k) => <th key={k}>{inlineFormat(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{header.map((_, ci) => <td key={ci}>{inlineFormat(r[ci] ?? '')}</td>)}</tr>)}</tbody>
        </table>,
      )
      i = j - 1
    } else if (/^#{1,6}\s+.+/.test(line)) {
      const m = line.match(/^(#{1,6})\s+(.*)$/)!
      const level = m[1].length
      const txt = m[2]
      // Distinguish three levels so a doc's title (#) doesn't look identical to its sections (##).
      // Feishu docx only has heading1–3, so 4–6 clamp to h3 — matching the inserted document.
      if (level === 1) {
        elements.push(<h1 key={i} className="md-h1">{inlineFormat(txt)}</h1>)
      } else if (level === 2) {
        elements.push(<h2 key={i} className="md-h2">{inlineFormat(txt)}</h2>)
      } else {
        elements.push(<h3 key={i} className="md-h3">{inlineFormat(txt)}</h3>)
      }
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<li key={i} className="md-li">{inlineFormat(line.slice(2))}</li>)
    } else if (line.trim() === '') {
      elements.push(<br key={i} />)
    } else {
      elements.push(<p key={i} className="md-p">{inlineFormat(line)}</p>)
    }
    i++
  }
  return <div className="md-content">{elements}</div>
}

const safeHref = (url: string): string | null => (/^https?:\/\//i.test(url) ? url : null)

function splitCells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}
function isTableHeader(lines: string[], i: number): boolean {
  const sep = lines[i + 1]
  return lines[i].trim().startsWith('|') && !!sep && sep.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(sep)
}
function openExternal(e: MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault()
  openUrlInNewTab(href)
}
function linkEl(href: string, label: string, key: Key) {
  return <a key={key} className="md-link" href={href} target="_blank" rel="noreferrer" onClick={(e) => openExternal(e, href)}>{label}</a>
}
function linkInCode(inner: string, key: Key): ReactNode | null {
  const md = inner.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (md && safeHref(md[2])) return linkEl(safeHref(md[2])!, md[1], key)
  const href = safeHref(inner.trim())
  return href ? linkEl(href, inner.trim(), key) : null
}
function inlineFormat(text: string): ReactNode {
  // 图片语法 ![alt](src) 优先于链接语法 [text](url)
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('`') && part.endsWith('`')) {
      const inner = part.slice(1, -1)
      return linkInCode(inner, i) ?? <code key={i} className="md-code">{inner}</code>
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    // 图片：![alt](src)
    if (part.startsWith('![') && part.includes('](')) {
      const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
      if (imgMatch) return <img key={i} className="md-img" src={imgMatch[2]} alt={imgMatch[1]} />
    }
    const mdLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (mdLink) {
      const href = safeHref(mdLink[2])
      return href ? linkEl(href, mdLink[1], i) : mdLink[1]
    }
    if (safeHref(part)) return linkEl(part, part, i)
    return part
  })
}
