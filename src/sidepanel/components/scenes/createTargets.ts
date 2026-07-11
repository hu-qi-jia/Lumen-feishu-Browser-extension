/** 直插式创建目标 —— 文件导入 / PDF 转写共用。
 *  不走 AI agent：直接调用飞书 API 创建文档/电子表格/多维表格，把已解析的 Markdown
 *  原样写入（表格感知）。和「添加到文档」一样直接插入，不整理、不优化。 */
import { createDocFromMarkdown, markdownToSegments } from '@/shared/feishu/docx'
import { createSpreadsheet, listSheets, appendRows } from '@/shared/feishu/sheets'
import { createApp, createTable, batchCreateRecords, transferBaseOwner, FieldType } from '@/shared/feishu/api'
import { buildFeishuUrl } from '@/shared/feishu/pageUrl'
import type { AppSettings } from '@/shared/types'

export interface CreateResult {
  url: string
  name: string
}

/** 把新资源转交给当前用户（仅 tenant token 模式下需要；user token 模式直接归用户，调用会失败被忽略）。 */
async function maybeTransfer(token: string, objToken: string | undefined, objType: 'bitable' | 'sheet' | 'docx', settings?: AppSettings): Promise<void> {
  const owner = settings?.feishuOwnerOpenId?.trim()
  if (!owner || !objToken) return
  try { await transferBaseOwner(token, objToken, 'openid', owner, false, objType) } catch { /* 保留资源即使转交失败 */ }
}

/** 从 Markdown 中提取第一个表格的行（表头 + 数据行）；无表格时回退为单列文本行。 */
function extractRows(md: string): { header: string[]; rows: string[][] } {
  const segs = markdownToSegments(md)
  const table = segs.find((s) => s.kind === 'table') as { kind: 'table'; rows: string[][] } | undefined
  if (table && table.rows.length) {
    const [header, ...rest] = table.rows
    return { header: header.length ? header : ['列1'], rows: rest }
  }
  const lines = md.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return { header: ['内容'], rows: lines.map((l) => [l]) }
}

/** 新建文档并直接写入 Markdown（表格感知，一次成型）。 */
export async function createDocDirect(token: string, title: string, markdown: string, settings?: AppSettings): Promise<CreateResult> {
  const res = (await createDocFromMarkdown(token, title, markdown)) as { document?: { document_id?: string } }
  const id = res.document?.document_id
  if (!id) throw new Error('创建文档失败：未返回 document_id。')
  await maybeTransfer(token, id, 'docx', settings)
  return { url: buildFeishuUrl('doc', id), name: title }
}

/** 新建电子表格，把 Markdown 表格（表头+数据行）作为二维数组一次性追加写入。 */
export async function createSheetDirect(token: string, title: string, markdown: string, settings?: AppSettings): Promise<CreateResult> {
  const created = (await createSpreadsheet(token, title)) as { spreadsheet?: { spreadsheet_token?: string } }
  const spreadsheetToken = created.spreadsheet?.spreadsheet_token
  if (!spreadsheetToken) throw new Error('创建电子表格失败：未返回 spreadsheet_token。')
  await maybeTransfer(token, spreadsheetToken, 'sheet', settings)
  const sheetsRes = (await listSheets(token, spreadsheetToken)) as { sheets?: Array<{ sheet_id?: string }> }
  const sheetId = sheetsRes.sheets?.[0]?.sheet_id
  if (!sheetId) throw new Error('创建电子表格失败：未返回 sheet_id。')
  const { header, rows } = extractRows(markdown)
  await appendRows(token, spreadsheetToken, `${sheetId}!A1`, [header, ...rows])
  return { url: buildFeishuUrl('sheet', spreadsheetToken), name: title }
}

/** 新建多维表格：用表头建表（全文本字段），再把每行数据 batch_create_records 一次写入。 */
export async function createBaseDirect(token: string, title: string, markdown: string, settings?: AppSettings): Promise<CreateResult> {
  const appRes = (await createApp(token, title)) as { app?: { app_token?: string } }
  const appToken = appRes.app?.app_token
  if (!appToken) throw new Error('创建多维表格失败：未返回 app_token。')
  await maybeTransfer(token, appToken, 'bitable', settings)
  const { header, rows } = extractRows(markdown)
  const fields = header.map((name) => ({ field_name: name, type: FieldType.Text }))
  const tableRes = (await createTable(token, appToken, '数据', fields)) as { table_id?: string }
  const tableId = tableRes.table_id
  if (!tableId) throw new Error('创建多维表格失败：未返回 table_id。')
  if (rows.length) {
    const records = rows.map((row) => {
      const f: Record<string, string> = {}
      header.forEach((h, i) => { f[h] = row[i] ?? '' })
      return { fields: f }
    })
    await batchCreateRecords(token, appToken, tableId, records)
  }
  return { url: buildFeishuUrl('base', appToken), name: title }
}
