/**
 * Link-driven source resolution for AI 幻灯片. A "source" is a pasted Feishu link (doc / sheet /
 * base). This module turns a URL into a named chip (resolveSource — light, for display) and, at
 * generate time, fetches the actual content (fetchMaterial — doc text or table schema+rows).
 *
 * Wiki links are rejected here (they wrap another type and need an extra API hop) — ask users to
 * paste the underlying doc/table link directly.
 */
import type { AppSettings } from '../types'
import { resolveToken, isPermissionError } from '../feishu/auth'
import { parseFeishuContext } from '../feishu/pageUrl'
import { getDocumentMeta, listBlocks } from '../feishu/docx'
import { serializeDocBlocks } from './slidesImages'
import { getSpreadsheet } from '../feishu/sheets'
import { getApp, getWikiNode } from '../feishu/api'
import { deriveVizSource, fetchVizData } from '../dataviz/data'
import type { VizField } from '../dataviz/types'
import type { SourceRef } from './slidesStore'

export type ResolvedSource = SourceRef

export type Material =
  | { kind: 'doc'; label: string; url: string; text: string; imageTokens: Array<{ token: string; context: string }> }
  | { kind: 'sheet'; label: string; url: string; schema: VizField[]; sampleRows: Record<string, string>[] }
  | { kind: 'base'; label: string; url: string; schema: VizField[]; sampleRows: Record<string, string>[] }

const isTable = (m: Material): m is Extract<Material, { kind: 'sheet' | 'base' }> => m.kind !== 'doc'
export { isTable }

/** Parse + name a pasted Feishu link (doc/sheet/base). Wiki links are resolved via API to
 *  their underlying resource type. Throws a user-facing message on failure. */
export async function resolveSource(settings: AppSettings, url: string): Promise<ResolvedSource> {
  const clean = url.trim()
  let ctx = parseFeishuContext(clean)
  if (!ctx) throw new Error('不是飞书文档 / 表格 / 多维表格链接')
  const token = await resolveToken(settings)

  // Wiki links wrap a doc/sheet/base — resolve to the real type via API, then rewrite the
  // URL to the underlying resource's canonical path so fetchMaterial's parseFeishuContext
  // (which only understands /base, /sheets, /docx — not /wiki) resolves the real token.
  if (ctx.kind === 'wiki' && ctx.wikiToken) {
    try {
      const res = (await getWikiNode(token, ctx.wikiToken)) as {
        node?: { obj_type: string; obj_token: string; title?: string }
      }
      const n = res.node
      if (!n) throw new Error('无法解析该知识库链接')
      const label = n.title?.trim()
      const origin = (() => { try { return new URL(clean).origin } catch { return '' } })()
      if (n.obj_type === 'bitable') return { kind: 'base', label: label || '未命名多维表格', url: `${origin}/base/${n.obj_token}` }
      if (n.obj_type === 'sheet') return { kind: 'sheet', label: label || '未命名表格', url: `${origin}/sheets/${n.obj_token}` }
      if (n.obj_type === 'docx' || n.obj_type === 'doc') return { kind: 'doc', label: label || '未命名文档', url: `${origin}/docx/${n.obj_token}` }
      throw new Error('知识库中的此类型暂不支持（支持文档、表格、多维表格）')
    } catch (e) {
      if (isPermissionError(e)) {
        throw new Error(
          '应用缺少知识库权限，无法解析此链接。请在文档/表格/多维表格页面内，从地址栏直接复制链接（不要从知识库目录中复制），或联系管理员给应用添加 wiki 权限。',
        )
      }
      throw e
    }
  }

  if (ctx.kind === 'doc' && ctx.documentId) {
    const meta = (await getDocumentMeta(token, ctx.documentId)) as { document?: { title?: string } }
    return { kind: 'doc', label: meta.document?.title?.trim() || '未命名文档', url: clean }
  }
  if (ctx.kind === 'sheet' && ctx.spreadsheetToken) {
    const meta = (await getSpreadsheet(token, ctx.spreadsheetToken)) as { spreadsheet?: { title?: string } }
    return { kind: 'sheet', label: meta.spreadsheet?.title?.trim() || '未命名表格', url: clean }
  }
  if (ctx.kind === 'base' && ctx.appToken) {
    const meta = (await getApp(token, ctx.appToken)) as { app?: { name?: string } }
    return { kind: 'base', label: meta.app?.name?.trim() || '未命名多维表格', url: clean }
  }
  throw new Error('无法识别该飞书链接')
}

/** Fetch the content backing an already-resolved source (called once, at generate time). */
export async function fetchMaterial(settings: AppSettings, src: ResolvedSource): Promise<Material> {
  if (src.kind === 'doc') {
    const token = await resolveToken(settings)
    const ctx = parseFeishuContext(src.url)
    const docId = ctx?.kind === 'doc' ? ctx.documentId : undefined
    if (!docId) throw new Error(`《${src.label}》链接无法解析`)
    const { items } = await listBlocks(token, docId)
    const { text, images: imageTokens } = serializeDocBlocks(items)
    if (!text.trim()) throw new Error(`《${src.label}》没有可读取的内容`)
    return { kind: 'doc', label: src.label, url: src.url, text, imageTokens }
  }
  // sheet / base → table data
  const ctx = parseFeishuContext(src.url)
  if (!ctx) throw new Error(`《${src.label}》链接无法解析`)
  const source = await deriveVizSource(settings, ctx)
  if (!source) throw new Error(`无法读取《${src.label}》的数据`)
  const { schema, rows } = await fetchVizData(settings, source, 1000)
  if (!schema.length) throw new Error(`《${src.label}》没有可用的字段`)
  return { kind: source.kind, label: src.label, url: src.url, schema, sampleRows: rows.slice(0, 150) }
}
