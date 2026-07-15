import type { AppSettings, PageContext, Attachment } from '../types'
import * as API from '../feishu/api'
import * as Sheets from '../feishu/sheets'
import * as Docx from '../feishu/docx'
import type { BlockSpec, BlockStyle } from '../feishu/docx'
import * as Compose from '../feishu/compose'
import type { Metric } from '../feishu/compose'
import { feishuReq } from '../feishu/http'
import { storageGet } from '../storage'
import { captureRecords, captureSheetRows, saveDeleteUndo } from '../feishu/undo'
import { isTenantHost, TENANT_ORIGIN_KEY } from '../feishu/tenant'
import { resolveToken, isPermissionError, isTokenExpiredError, forceRefreshUserToken } from '../feishu/auth'
import { BUILD_CONFIG } from '../config'
import { generateViz } from './dataviz'
import { deriveVizSource, fetchVizData } from '../dataviz/data'
import { buildDataReport } from '../report/build'
import { runDocAudit } from './docaudit'
import { runDocSummary } from './docsummary'
import { resolveFillSource } from '../smartfill/data'
import { buildPlan, applyPlan, cachePlan, getCachedPlan, clearCachedPlan, summarizePlan } from '../smartfill/plan'
import { uploadMedia } from '../feishu/upload'
import { downloadMedia } from '../feishu/media'
import { reloadActiveTab } from '@/sidepanel/services/tabReload'
import { compressImageToDataUrl, dataUrlToBlob } from '../attachments'
import { searchVault, readNote, recentNotes } from '../obsidian/api'
import {
  assertApiCallAllowed,
  isFileLevelDelete,
  FILE_LEVEL_DELETE_MSG,
  sanitizeToken,
} from './agent-security'
import { SHEET_TOOLS, DOC_TOOLS } from './agent-context'
import { isUserSkillTool, runUserSkill, type UserSkill } from './userSkills'

// ─── Tenant origin resolution ───────────────────────────────────────────────

/**
 * Resolve the Feishu TENANT origin (e.g. https://<tenant>.kastd01.statusfeishu.cn) — the prefix
 * every clickable doc/base/sheet link needs. Prefer the current page's origin (carries the
 * tenant subdomain); else the last-seen tenant origin the content script persisted. Returns
 * `null` when NO real tenant is known — callers must then NOT rewrite (rewriting a correct
 * tenant link down to the bare base domain would BREAK it).
 */
export async function resolveTenantOrigin(context: PageContext): Promise<string | null> {
  if (isTenantHost(context.url)) { try { return new URL(context.url).origin } catch { /* fall through */ } }
  const stored = await storageGet(TENANT_ORIGIN_KEY)
  if (typeof stored === 'string' && isTenantHost(stored)) return stored
  return null
}

/**
 * Recurrence guard: rewrite the ORIGIN of every Feishu resource link in `text` to the tenant
 * origin. The model often hand-writes links (clip "give a clickable link", reports, etc.) and
 * guesses the bare base domain → tenant-less, unopenable URLs. Normalizes ALL of them in one
 * place at the output boundary. NO-OP when `tenantOrigin` is null/empty — without a known tenant
 * we must not touch links (downgrading a correct one to the bare base domain would break it).
 */
export function rewriteFeishuOrigins(text: string, tenantOrigin: string | null): string {
  if (!text || !tenantOrigin) return text
  const d = BUILD_CONFIG.feishuBaseDomain
  return text.replace(
    /https?:\/\/([a-z0-9.:-]+)(\/(?:docx|docs|base|sheets|wiki|whiteboard)\/[A-Za-z0-9]+)/gi,
    (m, host: string, rest: string) => {
      const h = host.toLowerCase().replace(/:\d+$/, '')
      return h === d || h.endsWith('.' + d) ? tenantOrigin.replace(/\/+$/, '') + rest : m
    },
  )
}

// docx's create API returns no `url`, so build a clickable one from the tenant origin (falling
// back to the bare base domain only when no tenant is known — the link still names the doc).
async function withDocUrl(
  r: { document?: { document_id?: string } },
  context: PageContext
): Promise<unknown> {
  const id = r.document?.document_id
  if (!id) return r
  const origin = (await resolveTenantOrigin(context)) ?? `https://${BUILD_CONFIG.feishuBaseDomain}`
  return { ...r, document: { ...r.document, url: `${origin}/docx/${id}` } }
}

// ─── Image insertion helpers ─────────────────────────────────────────────────

/**
 * Resolve an insert_image anchor to a 0-based index into the doc's root children.
 *  - `top`         → 0 (the very beginning; BEFORE any existing top block, including a top image)
 *  - `end`         → append (rootChildren.length)
 *  - `heading`/`text` → immediately AFTER the first block whose text contains `value`
 *  - `section_end` → just before the next same-or-higher-level heading (i.e. end of that section)
 *
 * Pure (no I/O) so the index math is unit-testable.
 */
export function resolveImageInsertIndex(
  anchor: { type: string; value?: string },
  rootChildren: Array<Record<string, unknown>>,
): number {
  const t = anchor.type
  if (t === 'top') return 0
  if (t === 'end') return rootChildren.length
  if ((t === 'heading' || t === 'text') && anchor.value) {
    const needle = anchor.value.toLowerCase()
    const idx = rootChildren.findIndex((b) => {
      if (t === 'heading') {
        const bt = b.block_type as number
        if (bt !== 3 && bt !== 4 && bt !== 5) return false
      } else if (b.block_type !== 2) return false
      const el = (b as Record<string, unknown>)[t === 'heading' ? `heading${(b.block_type as number) - 2}` : 'text'] as { elements?: Array<{ text_run?: { content?: string } }> }
      const txt = (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('').toLowerCase()
      return txt.includes(needle)
    })
    if (idx === -1) throw new Error(`找不到匹配的${t === 'heading' ? '标题' : '段落'}："${anchor.value}"`)
    return idx + 1
  }
  if (t === 'section_end' && anchor.value) {
    const needle = anchor.value.toLowerCase()
    const hIdx = rootChildren.findIndex((b) => {
      const bt = b.block_type as number
      if (bt !== 3 && bt !== 4 && bt !== 5) return false
      const hKey = `heading${bt - 2}`
      const el = (b as Record<string, unknown>)[hKey] as { elements?: Array<{ text_run?: { content?: string } }> }
      return (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('').toLowerCase().includes(needle)
    })
    if (hIdx === -1) throw new Error(`找不到匹配的标题："${anchor.value}"`)
    const hLevel = rootChildren[hIdx].block_type as number
    const next = rootChildren.findIndex((b, i) => i > hIdx && (b.block_type as number) >= 3 && (b.block_type as number) <= 5 && (b.block_type as number) <= hLevel)
    return next === -1 ? rootChildren.length : next
  }
  throw new Error(`不支持的锚点类型：${t}`)
}

// ─── Spreadsheet tool execution ─────────────────────────────────────────────

async function executeSheetTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  settings?: AppSettings
): Promise<unknown> {
  const ss = sanitizeToken(args.spreadsheet_token as string | undefined)
  const range = args.range as string | undefined
  const values = args.values as unknown[][] | undefined

  switch (name) {
    case 'create_spreadsheet': {
      const r = (await Sheets.createSpreadsheet(
        token, args.title as string,
        sanitizeToken(args.folder_token as string | undefined)
      )) as { spreadsheet?: { spreadsheet_token?: string } }
      await maybeTransfer(token, r.spreadsheet?.spreadsheet_token, 'sheet', settings)
      return r
    }
    case 'get_spreadsheet':
      return Sheets.getSpreadsheet(token, ss!)
    case 'list_sheets':
      return Sheets.listSheets(token, ss!)
    case 'add_sheet':
      return Sheets.addSheet(token, ss!, args.title as string, args.index as number | undefined)
    case 'delete_sheet':
      return Sheets.deleteSheet(token, ss!, sanitizeToken(args.sheet_id as string | undefined)!)
    case 'rename_sheet':
      return Sheets.renameSheet(token, ss!, sanitizeToken(args.sheet_id as string | undefined)!, args.title as string)
    case 'read_range':
      return Sheets.readRange(token, ss!, range!)
    case 'write_range':
      return Sheets.writeRange(token, ss!, range!, values ?? [])
    case 'append_rows':
      return Sheets.appendRows(token, ss!, range!, values ?? [])
    case 'fill_column':
      return Sheets.fillColumn(
        token, ss!, sanitizeToken(args.sheet_id as string | undefined)!,
        args.column as string, args.start_row as number, args.end_row as number,
        args.template as string
      )
    case 'find_replace':
      return Sheets.findReplace(
        token, ss!, sanitizeToken(args.sheet_id as string | undefined)!,
        range!, args.find as string, args.replacement as string
      )
    case 'set_number_format':
      return Sheets.setNumberFormat(token, ss!, range!, args.formatter as string)
    case 'insert_dimension':
      return Sheets.insertDimension(
        token, ss!, sanitizeToken(args.sheet_id as string | undefined)!,
        args.dimension as 'ROWS' | 'COLUMNS', args.start_index as number, args.count as number
      )
    case 'delete_dimension': {
      const sheetId = sanitizeToken(args.sheet_id as string | undefined)!
      const dim = args.dimension as 'ROWS' | 'COLUMNS'
      const start = args.start_index as number, n = args.count as number
      // Capture row VALUES before deleting so the UI can offer 撤销 (re-insert rows + write back).
      // ROWS only — column deletes are rarer and far wider to snapshot.
      const undo = dim === 'ROWS' ? await captureSheetRows(token, ss!, sheetId, start, n) : null
      const r = await Sheets.deleteDimension(token, ss!, sheetId, dim, start, n)
      if (undo) await saveDeleteUndo(undo)
      return r
    }
    default:
      throw new Error(`未知工具: ${name}`)
  }
}

// ─── Document tool execution ────────────────────────────────────────────────

async function executeDocTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  context: PageContext,
  settings?: AppSettings,
  attachments?: Attachment[],
  /** Per-turn cache; blocks:${docId} caches listBlocks to avoid repeat full-fetches
   *  within a turn (agent list_blocks → insert_image would otherwise fetch twice).
   *  Invalidated on add_document_content / delete_document_blocks for that doc. */
  turnCache?: Map<string, unknown>,
): Promise<unknown> {
  void attachments // consumed by image-tool dispatch cases
  // Most doc tools expose `document_id` in their schema and the agent fills it. But insert_image /
  // replace_image have NO document_id field (only attachment_id/anchor), so args.document_id is
  // undefined for them — without this fallback `doc` is undefined and the very first listBlocks
  // call hits /docx/v1/documents/undefined/blocks → 1770001, before any anchor/upload logic runs.
  const doc = sanitizeToken(args.document_id as string | undefined)
    ?? (context.feishu?.kind === 'doc' ? context.feishu.documentId : undefined)

  switch (name) {
    case 'create_document': {
      const r = (await Docx.createDocument(
        token, args.title as string,
        sanitizeToken(args.folder_token as string | undefined)
      )) as { document?: { document_id?: string } }
      await maybeTransfer(token, r.document?.document_id, 'docx', settings)
      return await withDocUrl(r, context)
    }
    case 'create_doc_from_markdown': {
      const r = (await Docx.createDocFromMarkdown(
        token, args.title as string, args.markdown as string,
        sanitizeToken(args.folder_token as string | undefined)
      )) as { document?: { document_id?: string } }
      await maybeTransfer(token, r.document?.document_id, 'docx', settings)
      return await withDocUrl(r, context)
    }
    case 'insert_table':
      return Docx.insertTable(
        token, doc!, (args.data as string[][]) ?? [],
        (args.index as number | undefined) ?? 0
      )
    case 'insert_sheet':
      return Docx.insertSheet(
        token, doc!, (args.data as string[][]) ?? [],
        (args.index as number | undefined) ?? 0
      )
    case 'insert_bitable':
      return Docx.insertBitable(token, doc!, (args.index as number | undefined) ?? 0)
    case 'insert_callout':
      return Docx.insertCallout(token, doc!, args.text as string, (args.index as number | undefined) ?? 0)
    case 'insert_iframe':
      return Docx.insertIframe(token, doc!, args.url as string, (args.index as number | undefined) ?? 0)
    case 'get_document_content':
      return Docx.getDocumentContent(token, doc!)
    case 'list_blocks': {
      const cacheKey = `blocks:${doc}`
      const lb = (turnCache?.get(cacheKey) ?? (await Docx.listBlocks(token, doc!))) as {
        items?: Array<Record<string, unknown>>; has_more?: boolean
      }
      turnCache?.set(cacheKey, lb)
      const summary = Docx.summarizeDocument(lb.items ?? [], doc!, {
        start: args.start_index as number | undefined,
        limit: args.limit as number | undefined,
        query: args.query as string | undefined,
      })
      return { ...summary, fetch_truncated: !!lb.has_more }
    }
    case 'add_document_content':
      turnCache?.delete(`blocks:${doc}`)
      return Docx.insertContentBlocks(
        token, doc!,
        (args.blocks as BlockSpec[]) ?? [],
        (args.index as number | undefined) ?? 0
      )
    case 'update_document_block': {
      const blockId = sanitizeToken(args.block_id as string)!
      const text = args.text as string
      const style = (args.style as BlockStyle) ?? 'text'
      return Docx.updateBlockText(token, doc!, blockId, text, style)
    }
    case 'delete_document_blocks': {
      const parent = sanitizeToken(args.parent_block_id as string | undefined)
      const start = args.start_index as number
      const end = args.end_index as number
      const lbKey = `blocks:${doc}`
      const cached = turnCache?.get(lbKey) as { items?: Array<Record<string, unknown>> } | undefined
      const { items } = cached ?? (await Docx.listBlocks(token, doc!)) as { items?: Array<Record<string, unknown>> }
      turnCache?.set(lbKey, { items })
      const childCount = (items ?? []).filter((b) => b.parent_id === parent).length
      Docx.assertValidDeleteRange(parent, start, end, childCount)
      const r = await Docx.deleteBlocks(token, doc!, parent!, start, end)
      turnCache?.delete(lbKey) // structure changed — invalidate
      return r
    }
    case 'insert_image': {
      const attachmentId = args.attachment_id as string
      const anchor = args.anchor as { type: string; value?: string }
      if (!attachments?.length) throw new Error('当前没有附件，请先在对话框里上传图片。')
      const att = attachments.find((a) => a.id === attachmentId && a.type === 'image')
      if (!att || !att.dataUrl) throw new Error(`附件 ${attachmentId} 不存在或不是图片。`)

      const blob = dataUrlToBlob(att.dataUrl)
      if (blob.size === 0) throw new Error('无法读取图片数据。')

      const lbKey = `blocks:${doc}`
      const cached = turnCache?.get(lbKey) as { items?: Array<Record<string, unknown>> } | undefined
      const lb = cached ?? (await Docx.listBlocks(token, doc!)) as { items?: Array<Record<string, unknown>> }
      turnCache?.set(lbKey, lb)
      const { items } = lb
      if (!items || !Array.isArray(items)) throw new Error('无法读取文档结构。')
      const rootChildren = items
        .filter((b) => b.parent_id === doc)
        .sort((a, b) => (a.index as number ?? 0) - (b.index as number ?? 0))

      const insertAt = resolveImageInsertIndex(anchor, rootChildren)

      const created = (await Docx.insertBlocks(token, doc!, [{ text: '', style: 'image' }], insertAt)) as {
        children?: Array<{ block_id?: string }>
      }
      const imageBlockId = created.children?.[0]?.block_id
      if (!imageBlockId) throw new Error('创建图片块失败。')
      const fileToken = await uploadMedia({
        blob,
        fileName: att.name || 'image.png',
        blockId: imageBlockId,
        docToken: doc!,
        token,
      })
      await Docx.patchBlock(token, doc!, imageBlockId, { replace_image: { token: fileToken } })

      void reloadActiveTab()
      const where = anchor.type === 'top' ? '文档顶部'
        : anchor.type === 'end' ? '文档末尾'
        : `"${anchor.value ?? ''}"${anchor.type === 'section_end' ? '节末' : '后面'}`
      return `已插入到${where}`
    }
    case 'copy_document': {
      const currentDocId = context.feishu?.kind === 'doc' ? context.feishu.documentId : undefined
      const sourceToken = sanitizeToken(args.source_doc_token as string | undefined) ?? currentDocId
      if (!sourceToken) throw new Error('请在一篇飞书文档页面使用，或指定 source_doc_token。')
      let sourceTitle = '文档副本'
      try {
        const meta = (await Docx.getDocumentMeta(token, sourceToken)) as { document?: { title?: string } }
        sourceTitle = meta.document?.title || '文档副本'
      } catch { /* fallback */ }
      const newTitle = (args.new_title as string) || `${sourceTitle} 副本`

      const rootMeta = (await feishuReq('GET', '/drive/explorer/v2/root_folder/meta', token)) as { token?: string }
      const folderToken = rootMeta.token
      if (!folderToken) throw new Error('复制文档失败：无法获取根目录 token')

      const copyRes = (await feishuReq('POST', `/drive/v1/files/${sourceToken}/copy`, token, {
        name: newTitle,
        type: 'docx',
        folder_token: folderToken,
      })) as { file?: { token?: string; url?: string } }

      const newToken = copyRes.file?.token ?? copyRes.file?.url
      if (!newToken) throw new Error('复制文档失败：未返回新文档 token')

      void reloadActiveTab()
      return { message: '已保真克隆为新文档（保存在「我的空间」根目录）', document: copyRes }
    }

    case 'replace_image': {
      const which = args.which as { by: string; value: number | string }
      const src = args.source as { attachment_id: string }
      if (!attachments?.length) throw new Error('当前没有附件。')
      const att = attachments.find((a) => a.id === src.attachment_id && a.type === 'image')
      if (!att || !att.dataUrl) throw new Error(`附件 ${src.attachment_id} 不存在或不是图片。`)

      const riKey = `blocks:${doc}`
      const riCached = turnCache?.get(riKey) as { items?: Array<Record<string, unknown>> } | undefined
      const riLb = riCached ?? (await Docx.listBlocks(token, doc!)) as { items?: Array<Record<string, unknown>> }
      turnCache?.set(riKey, riLb)
      const { items } = riLb
      if (!items || !Array.isArray(items)) throw new Error('无法读取文档结构。')
      const imgBlocks: Array<{ id: string; parent_id: string; idx: number; heading?: string }> = []
      let lastHeading = ''
      for (const b of items) {
        const bt = b.block_type as number
        if (bt === 3 || bt === 4 || bt === 5) {
          const hKey = `heading${bt - 2}`
          const el = (b as Record<string, unknown>)[hKey] as { elements?: Array<{ text_run?: { content?: string } }> }
          lastHeading = (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('')
        }
        if (bt === 27) {
          imgBlocks.push({
            id: b.block_id as string,
            parent_id: (b.parent_id as string) ?? doc!,
            idx: (b.index as number) ?? imgBlocks.length,
            heading: lastHeading || undefined,
          })
        }
      }
      if (!imgBlocks.length) throw new Error('文档中没有图片。')

      let target: (typeof imgBlocks)[number] | undefined
      if (which.by === 'index') {
        const n = Number(which.value) - 1
        target = imgBlocks[n]
        if (!target) throw new Error(`只有 ${imgBlocks.length} 张图片，没有第 ${n + 1} 张。`)
      } else if (which.by === 'heading') {
        const needle = String(which.value).toLowerCase()
        target = imgBlocks.find((b) => b.heading?.toLowerCase().includes(needle))
        if (!target) throw new Error(`找不到标题"${which.value}"下的图片。`)
      } else {
        throw new Error(`不支持的定位方式：${which.by}（仅支持 index 或 heading）`)
      }

      const blob = dataUrlToBlob(att.dataUrl)
      const fileToken = await uploadMedia({
        blob, fileName: att.name || 'image.png', blockId: target.id, docToken: doc!, token,
      })
      await Docx.patchBlock(token, doc!, target.id, { replace_image: { token: fileToken } })

      void reloadActiveTab()
      return `已将${which.by === 'index' ? `第 ${Number(which.value)} 张` : `"${String(which.value)}"标题下的`}图片替换为新图。`
    }
    case 'export_doc_images': {
      const exportDocToken = sanitizeToken(args.doc_token as string | undefined) ?? doc!
      const exKey = `blocks:${exportDocToken}`
      const exCached = turnCache?.get(exKey) as { items?: Record<string, unknown>[] } | undefined
      const exLb = exCached ?? (await Docx.listBlocks(token, exportDocToken)) as { items?: Record<string, unknown>[] }
      turnCache?.set(exKey, exLb)
      const { items } = exLb
      if (!items || !Array.isArray(items)) throw new Error('无法读取文档结构')

      const imgBlocks: Array<{ token: string; context: string }> = []
      let lastHeading = ''
      for (const b of items) {
        const bt = b.block_type as number
        if (bt === 3 || bt === 4 || bt === 5) {
          const hKey = `heading${bt - 2}`
          const el = (b as Record<string, unknown>)[hKey] as { elements?: Array<{ text_run?: { content?: string } }> }
          lastHeading = (el?.elements ?? []).map((e) => e.text_run?.content ?? '').join('')
        }
        if (bt === 27) {
          const img = (b as { image?: { token?: string } }).image
          if (typeof img?.token === 'string' && img.token) {
            imgBlocks.push({ token: img.token, context: lastHeading })
          }
        }
      }

      if (!imgBlocks.length) return JSON.stringify({ __image_export: true, images: [], docTitle: exportDocToken })

      const images: Array<{ name: string; context: string; dataUrl: string }> = []
      let cursor = 0
      async function worker() {
        while (cursor < imgBlocks.length) {
          const idx = cursor++
          const { token: imgTok, context } = imgBlocks[idx]
          try {
            const blob = await downloadMedia(imgTok, token, { docType: 'docx' })
            const dataUrl = await compressImageToDataUrl(blob)
            images[idx] = { name: `image-${idx + 1}.${blob.type.split('/')[1] || 'png'}`, context, dataUrl }
          } catch {
            images[idx] = { name: `failed-${idx + 1}`, context, dataUrl: '' }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, imgBlocks.length) }, () => worker()))

      return JSON.stringify({ __image_export: true, images, docTitle: exportDocToken })
    }
    default:
      throw new Error(`未知工具: ${name}`)
  }
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

function parseField(f: Record<string, unknown>): API.FeishuField {
  const field: API.FeishuField = {
    field_name: f.field_name as string,
    type: (f.type ?? f.field_type) as API.FieldType,
  }
  if (f.options) {
    field.property = { options: f.options as NonNullable<API.FeishuField['property']>['options'] }
  }
  const formula = (f.formula_expression ?? f.formula) as string | undefined
  if (formula) {
    field.property = { ...(field.property ?? {}), formula_expression: formula }
  }
  if (f.description) {
    field.description = { text: f.description as string }
  }
  return field
}

// Transfer a newly-created resource to the configured user so it shows in their
// drive (tenant-created resources are app-owned & invisible otherwise). Non-fatal.
async function maybeTransfer(
  token: string,
  objToken: string | undefined,
  objType: 'bitable' | 'sheet' | 'docx' | 'board',
  settings?: AppSettings
): Promise<void> {
  const owner = settings?.feishuOwnerOpenId?.trim()
  if (!owner || !objToken) return
  try {
    await API.transferBaseOwner(token, objToken, 'openid', owner, false, objType)
  } catch { /* keep the resource even if transfer fails */ }
}

// Read a Base's structure and generate a summary report document.
async function baseToDocReport(
  token: string,
  appToken: string,
  title: string,
  settings?: AppSettings
): Promise<unknown> {
  const tablesRes = (await API.listTables(token, appToken)) as {
    items?: Array<{ table_id: string; name: string }>
  }
  const lines = [`# ${title}`, '', '本报告由 AI 自动汇总自多维表格。', '']
  for (const tb of tablesRes.items ?? []) {
    const fields = (await API.listFields(token, appToken, tb.table_id)) as {
      items?: Array<{ field_name: string }>
    }
    const recs = (await API.listRecords(token, appToken, tb.table_id, 1)) as { total?: number }
    lines.push(`## ${tb.name}`)
    lines.push(`- 记录数：${recs.total ?? 0}`)
    lines.push(`- 字段（${fields.items?.length ?? 0}）：${(fields.items ?? []).map((f) => f.field_name).join('、')}`)
    lines.push('')
  }
  const r = (await Docx.createDocFromMarkdown(token, title, lines.join('\n'))) as {
    document?: { document_id?: string }
  }
  await maybeTransfer(token, r.document?.document_id, 'docx', settings)
  return r
}

// Render an audit_table report as Markdown for create_doc_from_markdown.
function renderAuditMarkdown(report: Compose.AuditReport, title: string): string {
  const lines = [
    `# ${title}`,
    '',
    `扫描记录数：${report.scanned}${report.capped ? '（已达扫描上限，仅覆盖前若干条）' : ''}`,
    `问题总数：${report.issues_total}`,
    '',
  ]

  const empties = Object.entries(report.empty_required)
  if (empties.length) {
    lines.push('## 空缺的必填字段', '')
    for (const [field, info] of empties) lines.push(`- **${field}**：${info.count} 条记录为空`)
    lines.push('')
  }

  const dups = Object.entries(report.duplicates)
  if (dups.length) {
    lines.push('## 重复值', '')
    for (const [field, list] of dups) {
      lines.push(`### ${field}`)
      for (const d of list) lines.push(`- "${d.value}"：出现 ${d.count} 次`)
      lines.push('')
    }
  }

  const outliers = Object.entries(report.outliers)
  if (outliers.length) {
    lines.push('## 数值异常（偏离均值 3σ 以上）', '')
    for (const [field, o] of outliers) {
      lines.push(`- **${field}**：均值 ${o.mean}，标准差 ${o.std}，疑似异常 ${o.count} 条`)
    }
    lines.push('')
  }

  if (report.issues_total === 0) lines.push('未发现明显数据质量问题。')
  return lines.join('\n')
}

// ─── Tool dispatch (the giant switch) ────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  context: PageContext,
  settings?: AppSettings,
  attachments?: Attachment[],
  /** Per-turn cache (e.g. list_fields for update_field backfill). Optional → no-op when absent. */
  turnCache?: Map<string, unknown>,
  /** 用户自定义技能列表——skill__ 前缀工具按 slug 匹配并渲染指令模板返回。 */
  userSkills?: UserSkill[],
): Promise<unknown> {
  // Backstop for the file-level-delete block (primary check is in the agent loop) — the
  // assistant must never delete a whole table/spreadsheet/document/file by any path.
  if (isFileLevelDelete(name, args)) throw new Error(FILE_LEVEL_DELETE_MSG)

  // 用户自定义技能：渲染指令模板并返回（纯文本指令，模型据此继续执行飞书工具）。
  // 必须放在其他分发之前——skill__ 工具名不在任何已有 Set 里，否则会落到末尾的「未知工具」。
  if (isUserSkillTool(name)) {
    if (!userSkills?.length) return 'Error: 技能未加载，请到「应用 → 技能库」检查。'
    const r = runUserSkill(name, args, userSkills)
    return JSON.stringify(r)
  }

  // 知识库（只读）——构建启用时默认可用。返回结构化数据/原始 markdown（非预序列化字符串）。
  if (name === 'search_knowledge_base') {
    if (!settings) return 'Error: 缺少配置。'
    try {
      return await searchVault(settings, String(args.query ?? ''))
    } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (name === 'list_knowledge_notes') {
    if (!settings) return 'Error: 缺少配置。'
    try {
      const limit = Math.min(Math.max(1, Number(args.limit) || 30), 100)
      return await recentNotes(settings, limit)
    } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (name === 'read_knowledge_note') {
    if (!settings) return 'Error: 缺少配置。'
    try {
      return await readNote(settings, String(args.path ?? ''))
    } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}` }
  }

  // Generic Feishu OpenAPI call
  if (name === 'feishu_api_call') {
    const method = String(args.method ?? 'GET').toUpperCase()
    const path = String(args.path ?? '')
    assertApiCallAllowed(path)
    const query = args.query as Record<string, string> | undefined
    return feishuReq(method, path, token, args.body, query)
  }

  // Spreadsheet / Doc tools carry their own resource token — dispatch before the
  // Base app_token guard below.
  if (SHEET_TOOLS.has(name)) return executeSheetTool(name, args, token, settings)
  if (DOC_TOOLS.has(name)) return executeDocTool(name, args, token, context, settings, attachments, turnCache)

  // 画板 Whiteboard 工具——自带 whiteboard_id（或在画板页面自动识别），需在 Base app_token 守卫之前分发。
  if (name === 'create_whiteboard') {
    const Board = await import('../feishu/board')
    // Resolve target document: explicit arg → current doc page → none (create new host doc).
    const targetDoc = sanitizeToken(args.document_id as string | undefined)
      ?? (context.feishu?.kind === 'doc' ? context.feishu.documentId : undefined)
    const r = await Board.createWhiteboard(
      token,
      args.title as string,
      sanitizeToken(args.folder_token as string | undefined),
      targetDoc,
      (args.index as number | undefined) ?? 0,
    ) as { whiteboard?: { whiteboard_id?: string; title?: string }; document_id?: string }
    // Only transfer ownership when a new host document was created (standalone case).
    // Inserting into an existing doc doesn't change its owner.
    if (!targetDoc) {
      await maybeTransfer(token, r.document_id, 'docx', settings)
    }
    return r
  }
  if (name === 'get_whiteboard_info') {
    const Board = await import('../feishu/board')
    const id = sanitizeToken(args.whiteboard_id as string | undefined)
      ?? (context.feishu?.kind === 'board' ? context.feishu.whiteboardId : undefined)
    if (!id) throw new Error('未检测到画板 ID，请传入 whiteboard_id 或在画板页面使用')
    return Board.getWhiteboard(token, id)
  }

  // Data-viz
  if (name === 'render_data_app') {
    if (!settings) return 'Error: 缺少配置。'
    if (!context.feishu) return 'Error: 请在多维表格或电子表格页面使用可视化。'
    const source = await deriveVizSource(settings, context.feishu)
    if (!source) return 'Error: 无法识别当前表的数据源。'
    const sample = await fetchVizData(settings, source, 30)
    if (!sample.schema.length) return 'Error: 这张表没有可用字段。'
    const viz = await generateViz(settings, { schema: sample.schema, sampleRows: sample.rows, request: String(args.request ?? '') })
    return JSON.stringify({ __dataviz: true, name: viz.name, code: viz.code, source })
  }

  // Data report
  if (name === 'generate_data_report') {
    if (!settings) return 'Error: 缺少配置。'
    if (!context.feishu) return 'Error: 请在多维表格或电子表格页面使用。'
    const source = await deriveVizSource(settings, context.feishu)
    if (!source) return 'Error: 无法识别当前表的数据源。'
    return buildDataReport(settings, source, String(args.focus ?? ''), context)
  }

  // Doc audit
  if (name === 'audit_document') {
    if (!settings) return 'Error: 缺少配置。'
    const docId = context.feishu?.kind === 'doc' ? context.feishu.documentId : undefined
    if (!docId) return 'Error: 请在一篇飞书文档页面使用。'
    return runDocAudit(settings, docId)
  }

  // Doc summary
  if (name === 'summarize_document') {
    if (!settings) return 'Error: 缺少配置。'
    const docId = context.feishu?.kind === 'doc' ? context.feishu.documentId : undefined
    if (!docId) return 'Error: 请在一篇飞书文档页面使用。'
    return runDocSummary(settings, docId, args.prompt ? String(args.prompt) : undefined)
  }

  // Smart fill — preview (read-only) and apply (write). Source resolved from current page,
  // so dispatched before the Base app_token guard. Wraps buildPlan/applyPlan, giving the chat
  // agent the same key-mapping + type-coercion + write-back-re-read safety guarantees.
  if (name === 'smart_fill_preview') {
    if (!settings) return 'Error: 缺少配置。'
    const f = context.feishu
    if (!f || (f.kind !== 'base' && f.kind !== 'sheet')) {
      return 'Error: 智能填充仅支持多维表格和电子表格，请先打开相应页面。'
    }
    const source = await resolveFillSource(settings, f)
    if (!source) return 'Error: 识别到表格，但找不到可填充的数据，请刷新页面后重试。'
    const plan = await buildPlan(settings, source, {
      targetField: String(args.target_field ?? ''),
      instruction: String(args.instruction ?? '').trim(),
      sourceFields: args.source_fields as string[] | undefined,
      overwrite: Boolean(args.overwrite),
    })
    cachePlan(plan)
    return summarizePlan(plan)
  }
  if (name === 'smart_fill_apply') {
    if (!settings) return 'Error: 缺少配置。'
    const plan = getCachedPlan()
    if (!plan) return 'Error: 没有可应用的预览结果。请先调用 smart_fill_preview 生成预览，展示给用户确认后再调用本工具。'
    const r = await applyPlan(settings, plan)
    if (!r.failed) clearCachedPlan()
    return r
  }

  // Resolve app token — prefer explicit arg, fall back to current page
  const app = sanitizeToken(args.app_token as string | undefined) ?? context.feishu?.appToken
  if (!app && name !== 'create_bitable_app') {
    throw new Error('未检测到 app_token，请先打开一个飞书多维表格页面。')
  }

  const tableId = sanitizeToken(args.table_id as string | undefined)
  const fieldId = sanitizeToken(args.field_id as string | undefined)
  const recordId = sanitizeToken(args.record_id as string | undefined)
  const pageSize = Math.min(Math.max(Number(args.page_size ?? 20), 1), 100)

  switch (name) {
    case 'get_app_info':
      return API.getApp(token, app!)

    case 'create_bitable_app': {
      return API.createApp(token, args.name as string)
    }

    case 'list_tables':
      return API.listTables(token, app!)

    case 'create_table': {
      const rawFields = args.fields as Array<Record<string, unknown>> | undefined
      const fields: API.FeishuField[] = (rawFields ?? []).map(parseField)
      return API.createTable(token, app!, args.table_name as string, fields)
    }

    case 'list_fields':
      return API.listFields(token, app!, tableId!)

    case 'create_field':
      turnCache?.delete(`fields:${app}:${tableId}`)
      return API.createField(token, app!, tableId!, parseField(args))

    case 'list_records': {
      const data = await API.listRecords(token, app!, tableId!, pageSize, args.page_token as string | undefined) as {
        items?: unknown[]; has_more?: boolean; page_token?: string; total?: number
      }
      const items = data.items ?? []
      return {
        total: data.total,
        page_size: pageSize,
        has_more: data.has_more === true,
        next_page_token: data.has_more ? data.page_token : undefined,
        count: items.length,
        items,
      }
    }

    case 'create_record':
      return API.createRecord(token, app!, tableId!, args.fields as Record<string, unknown>)

    case 'batch_create_records':
      return API.batchCreateRecords(
        token, app!, tableId!,
        args.records as Array<{ fields: Record<string, unknown> }>
      )

    case 'update_record':
      return API.updateRecord(token, app!, tableId!, recordId!, args.fields as Record<string, unknown>)

    case 'create_view':
      return API.createView(
        token, app!, tableId!,
        args.view_name as string,
        args.view_type as 'grid' | 'kanban' | 'gallery' | 'gantt' | 'form'
      )

    case 'list_views':
      return API.listViews(token, app!, tableId!)

    case 'update_field': {
      const fieldsCacheKey = `fields:${app}:${tableId}`
      const current = (turnCache?.get(fieldsCacheKey) ?? await API.listFields(token, app!, tableId!)) as {
        items?: Array<{ field_id: string; field_name: string; type: number; property?: API.FeishuField['property'] }>
      }
      turnCache?.set(fieldsCacheKey, current)
      const existing = current.items?.find((f) => f.field_id === fieldId)
      if (!existing) throw new Error(`字段不存在: ${fieldId ?? '(未提供 field_id)'}`)
      const update: API.FeishuField = {
        field_name: (args.field_name as string) ?? existing.field_name,
        type: existing.type as API.FieldType,
      }
      if (args.options) {
        update.property = { options: args.options as NonNullable<API.FeishuField['property']>['options'] }
      } else if (existing.property?.options) {
        update.property = existing.property
      }
      return API.updateField(token, app!, tableId!, fieldId!, update)
    }

    case 'delete_field':
      turnCache?.delete(`fields:${app}:${tableId}`)
      return API.deleteField(token, app!, tableId!, fieldId!)

    case 'delete_table':
      return API.deleteTable(token, app!, tableId!)

    case 'update_table':
      return API.updateTable(token, app!, sanitizeToken(args.table_id as string)!, args.name as string)

    case 'search_records': {
      const data = await API.searchRecords(
        token, app!, tableId!,
        args.filter as string | undefined,
        pageSize,
        args.view_id as string | undefined,
        args.page_token as string | undefined
      ) as { items?: unknown[]; has_more?: boolean; page_token?: string; total?: number }
      const items = data.items ?? []
      return {
        total: data.total,
        page_size: pageSize,
        has_more: data.has_more === true,
        next_page_token: data.has_more ? data.page_token : undefined,
        count: items.length,
        items,
      }
    }

    case 'batch_update_records':
      return API.batchUpdateRecords(
        token, app!, tableId!,
        args.records as Array<{ record_id: string; fields: Record<string, unknown> }>
      )

    case 'delete_record': {
      const captured = await captureRecords(token, app!, tableId!, [recordId!])
      const r = await API.deleteRecord(token, app!, tableId!, recordId!)
      await saveDeleteUndo({ kind: 'records', appToken: app!, tableId: tableId!, records: captured })
      return r
    }

    case 'batch_delete_records': {
      const ids = (args.record_ids as string[]) ?? []
      const captured = await captureRecords(token, app!, tableId!, ids)
      const r = await API.batchDeleteRecords(token, app!, tableId!, ids)
      await saveDeleteUndo({ kind: 'records', appToken: app!, tableId: tableId!, records: captured })
      return r
    }

    case 'list_dashboards':
      return API.listDashboards(token, app!)

    case 'base_to_doc_report':
      return baseToDocReport(token, app!, (args.title as string) || '数据汇总报告', settings)

    case 'base_table_to_sheet': {
      const r = await Compose.tableToSheet(token, app!, tableId!, args.title as string | undefined)
      await maybeTransfer(token, r.spreadsheet_token, 'sheet', settings)
      return r
    }

    case 'summarize_table': {
      const r = await Compose.summarizeTable(
        token, app!, tableId!,
        args.group_by as string,
        (args.metrics as Metric[]) ?? [{ field: '', op: 'count' }],
        args.title as string | undefined
      )
      await maybeTransfer(token, r.spreadsheet_token, 'sheet', settings)
      return r
    }

    case 'copy_dashboard':
      return API.copyDashboard(
        token, app!,
        sanitizeToken(args.dashboard_block_id as string | undefined)!,
        args.name as string
      )

    case 'dedupe_records':
      return Compose.dedupeRecords(
        token, app!, tableId!,
        args.key_fields as string[],
        (args.keep as 'first' | 'last') ?? 'first',
        Boolean(args.dry_run)
      )

    case 'cross_table_lookup': {
      const srcTable = sanitizeToken(args.source_table_id as string | undefined)!
      const tgtTable = sanitizeToken(args.target_table_id as string | undefined)!
      return Compose.crossTableLookup(
        token, app!, srcTable,
        args.source_key_field as string,
        tgtTable,
        args.target_key_field as string,
        args.target_value_field as string,
        args.into_field as string,
        (args.on_multiple as 'first' | 'join' | 'skip') ?? 'first',
        args.create_field_if_missing !== false
      )
    }

    case 'update_where':
      return Compose.updateWhere(
        token, app!, tableId!,
        args.filter as string,
        args.set as Record<string, unknown>,
        Boolean(args.dry_run)
      )

    case 'audit_table': {
      const report = await Compose.auditTable(token, app!, tableId!, {
        requiredFields: (args.required_fields as string[]) ?? [],
        uniqueFields: (args.unique_fields as string[]) ?? [],
        numericFields: (args.numeric_outlier_fields as string[]) ?? [],
      })
      if (args.output === 'doc') {
        const title = (args.title as string) || '数据质量报告'
        const r = (await Docx.createDocFromMarkdown(token, title, renderAuditMarkdown(report, title))) as {
          document?: { document_id?: string }
        }
        await maybeTransfer(token, r.document?.document_id, 'docx', settings)
        return { ...report, report_doc: r.document }
      }
      return report
    }

    default:
      throw new Error(`未知工具: ${name}`)
  }
}

// ─── Tool execution with auth fallback ───────────────────────────────────────

/**
 * Run a tool strictly as the USER (resolveToken returns the user_access_token only).
 * There is deliberately NO escalation to the app/tenant identity: a permission error
 * means the USER lacks access, and the assistant must not exceed the user's permissions
 * (principle 3). We surface that clearly instead of retrying with a broader identity.
 */
export async function runToolWithFallback(
  name: string,
  args: Record<string, unknown>,
  context: PageContext,
  settings?: AppSettings,
  attachments?: Attachment[],
  turnCache?: Map<string, unknown>,
  userSkills?: UserSkill[],
): Promise<unknown> {
  const token = await resolveToken(settings ?? ({} as AppSettings))
  try {
    return await executeTool(name, args, token, context, settings, attachments, turnCache, userSkills)
  } catch (err) {
    if (isPermissionError(err)) {
      throw new Error(
        `你（当前飞书账号）没有该文档/资源的相应权限，AI 不会越权访问或修改。` +
        `如需操作，请先在飞书中获取权限，或改用你有权限的文档。\n原始错误：${err instanceof Error ? err.message : String(err)}`
      )
    }
    // Access token expired/invalid → force-refresh the user token and retry ONCE.
    if (isTokenExpiredError(err)) {
      const fresh = await forceRefreshUserToken()
      if (fresh) return await executeTool(name, args, fresh, context, settings, attachments, turnCache, userSkills)
      throw new Error('飞书登录已过期，且自动续期失败（refresh_token 可能已失效，约 30 天）。请到「设置 → 用飞书账号授权」重新授权一次。')
    }
    throw err
  }
}
