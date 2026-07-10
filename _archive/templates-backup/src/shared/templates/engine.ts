import * as API from '../feishu/api'
import type {
  ScenarioTemplate, TemplateFieldDef,
  ProgressStep, CreationResult,
} from './types'

type OnProgress = (steps: ProgressStep[]) => void
type StepStatus = 'pending' | 'running' | 'done' | 'error'

function resolve(template: string, inputs: Record<string, string>): string {
  return template.replace(/\{\{inputs\.(\w+)\}\}/g, (_, k) => inputs[k] ?? '')
}

/** Convert template field to Feishu API field.
 *  Formula fields (type=20) are passed with formula_expression in property.
 *  Non-formula + non-select fields are passed with empty property to avoid API errors.
 */
function toApiField(f: TemplateFieldDef): API.FeishuField {
  const field: API.FeishuField = {
    field_name: f.name,
    type: f.type as API.FieldType,
  }
  if (f.options?.length) {
    field.property = { options: f.options.map(o => ({ name: o.name, color: o.color ?? 0 })) }
  }
  if (f.formula_expression) {
    field.property = { ...field.property, formula_expression: f.formula_expression }
  }
  if (f.description) {
    field.description = { text: f.description }
  }
  return field
}

// 鈹€鈹€鈹€ Main execution 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export async function executeTemplate(
  template: ScenarioTemplate,
  inputs: Record<string, string>,
  token: string,
  currentAppToken: string | undefined,
  onProgress: OnProgress,
  /** Optional: create dashboard via browser DOM automation, returns blockToken or null */
  createDashboard?: (name: string) => Promise<string | null>,
  /** Current page URL (used as the "open" link when target=current_app). */
  currentAppUrl?: string,
  /** Deprecated 鈥?kept for signature stability. Bases are created as the user now, so
   *  no ownership transfer is performed. */
  _ownerOpenId?: string
): Promise<CreationResult> {

  const hasDashboards = (template.dashboards?.length ?? 0) > 0

  // Build initial step list
  const steps: ProgressStep[] = [
    {
      id: 'app',
      label: template.target === 'new_app'
        ? `鍒涘缓搴旂敤銆?{resolve(inputs.app_name ?? template.name, inputs)}銆峘
        : '浣跨敤褰撳墠搴旂敤',
      status: 'pending',
    },
    ...template.tables.flatMap(t => [
      { id: `tbl-${t.ref}`, label: `鍒涘缓銆?{resolve(t.name, inputs)}銆嶈〃`, status: 'pending' as const },
      ...(t.views?.length ? [{ id: `view-${t.ref}`, label: `  娣诲姞瑙嗗浘`, status: 'pending' as const }] : []),
      ...(t.sample_records?.length
        ? [{ id: `rec-${t.ref}`, label: `  瀵煎叆 ${t.sample_records.length} 鏉＄ず渚嬫暟鎹甡, status: 'pending' as const }]
        : []),
    ]),
    ...(hasDashboards
      ? [{ id: 'dash', label: `鍒涘缓骞堕厤缃华琛ㄧ洏锛?{template.dashboards!.length} 涓級`, status: 'pending' as const }]
      : []),
  ]

  const set = (id: string, status: StepStatus, detail?: string) => {
    const s = steps.find(s => s.id === id)
    if (s) { s.status = status; if (detail) s.detail = detail }
    onProgress([...steps])
  }

  const tableMap: Record<string, string> = {}       // ref 鈫?table_id
  // field ref maps for dashboard resolution: tableRef 鈫?fieldName 鈫?field_id
  const fieldIdMaps: Record<string, Record<string, string>> = {}
  let appToken: string
  let appName: string
  let appUrl = ''

  // 鈹€鈹€ Step 1: App 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  set('app', 'running')
  try {
    if (template.target === 'new_app') {
      appName = resolve(inputs.app_name ?? template.name, inputs)
      // createApp returns the real Base URL on the tenant's domain 鈥?use it.
      // Building "https://base.feishu.cn/base/<token>" by hand 404s.
      const res = await API.createApp(token, appName) as { app: { app_token: string; url?: string } }
      appToken = res.app.app_token
      appUrl = res.app.url ?? ''
      // Created with the user's token 鈫?already owned by the user; no transfer needed.
    } else {
      if (!currentAppToken) throw new Error('鏈娴嬪埌褰撳墠 Base 搴旂敤锛岃鍏堟墦寮€涓€涓缁磋〃鏍奸〉闈?)
      appToken = currentAppToken
      const info = await API.getApp(token, appToken) as { app: { name: string } }
      appName = info.app.name
      // getApp doesn't return url 鈥?reuse the page the user is already on.
      appUrl = currentAppUrl ?? ''
    }
    set('app', 'done')
  } catch (err) {
    set('app', 'error', String(err))
    throw err
  }

  let totalRecords = 0

  // 鈹€鈹€ Step 2: Tables + Fields + Views + Records 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  for (const tableDef of template.tables) {
    const tableName = resolve(tableDef.name, inputs)

    // Relation/lookup fields (18 鍗曞悜鍏宠仈 / 19 鏌ユ壘寮曠敤 / 21 鍙屽悜鍏宠仈) require a
    // `property` pointing at a target table that templates can't express yet 鈥?    // creating them bare fails with "DuplexLink field property is null" and would
    // abort the whole table. Skip them defensively instead of tanking creation.
    const RELATION_TYPES = new Set([18, 19, 21])
    const usable = tableDef.fields.filter(f => {
      if (RELATION_TYPES.has(f.type) && !f.formula_expression) {
        console.warn(`璺宠繃妯℃澘銆?{tableDef.name}銆嶇殑鍏宠仈绫诲瓧娈点€?{f.name}銆?type=${f.type})锛氭ā鏉挎殏涓嶆敮鎸侀渶 property 鐨勫叧鑱?鏌ユ壘瀛楁`)
        return false
      }
      return true
    })

    // Separate non-formula and formula fields.
    // Formula fields must be added AFTER the fields they reference exist.
    const nonFormula = usable.filter(f => f.type !== 20)
    const formulaFields = usable.filter(f => f.type === 20)

    set(`tbl-${tableDef.ref}`, 'running')
    let tableId: string
    try {
      const res = await API.createTable(
        token, appToken, tableName, nonFormula.map(toApiField)
      ) as { table_id: string }
      tableId = res.table_id
      tableMap[tableDef.ref] = tableId
      fieldIdMaps[tableDef.ref] = {}
      set(`tbl-${tableDef.ref}`, 'done')
    } catch (err) {
      set(`tbl-${tableDef.ref}`, 'error', String(err))
      // Don't lose what's already built 鈥?surface the (half-built) Base so the user
      // can open it, see what's there, and琛ュ缓 or delete it (no silent orphan).
      const built = Object.entries(tableMap).map(([ref, id]) => `${ref}(${id})`).join('銆?) || '鏃?
      const link = appUrl ? `\n宸插缓濂界殑搴旂敤锛?{appUrl}` : ''
      throw new Error(
        `鍒涘缓鏁版嵁琛ㄣ€?{tableName}銆嶅け璐ワ細${err instanceof Error ? err.message : String(err)}銆俙 +
        `搴旂敤鍜屽墠闈㈢殑琛ㄥ凡鍒涘缓锛?{built}锛夛紝鏈洖婊氥€?{link}\n鍙墦寮€涓婇潰鐨勫簲鐢ㄦ煡鐪嬶紝鎴栧垹闄ゅ悗閲嶈瘯銆俙
      )
    }

    // Add formula fields individually AFTER other fields exist
    for (const f of formulaFields) {
      try {
        const res = await API.createField(token, appToken, tableId, toApiField(f)) as
          { field?: { field_id: string } } | { field_id?: string }
        const fid = ('field' in res ? res.field?.field_id : undefined) ?? (res as { field_id?: string }).field_id
        if (fid) fieldIdMaps[tableDef.ref][f.name] = fid
      } catch {
        // Formula field creation failure is non-fatal 鈥?expression may reference fields differently
      }
    }

    // Build field name 鈫?id map from list (most reliable)
    try {
      const fieldsRes = await API.listFields(token, appToken, tableId) as
        { items: Array<{ field_id: string; field_name: string }> }
      for (const f of fieldsRes.items ?? []) {
        fieldIdMaps[tableDef.ref][f.field_name] = f.field_id
      }
    } catch { /* field map is best-effort */ }

    // Views
    if (tableDef.views?.length) {
      set(`view-${tableDef.ref}`, 'running')
      try {
        for (const view of tableDef.views) {
          await API.createView(token, appToken, tableId, view.name, view.type)
        }
        set(`view-${tableDef.ref}`, 'done')
      } catch (err) {
        set(`view-${tableDef.ref}`, 'error', String(err))
      }
    }

    // Sample records 鈥?only write to fields that exist and are writable. Feishu
    // rejects the WHOLE batch with FieldNameNotFound (1254045) if any key is
    // unknown, and writing to formula/relation/auto/system fields also errors. So
    // filter against the real field names, dropping (and logging) anything else.
    if (tableDef.sample_records?.length) {
      set(`rec-${tableDef.ref}`, 'running')
      const NON_WRITABLE = new Set([18, 19, 20, 21, 1001, 1002, 1003, 1004, 1005])
      const writable = new Set(
        tableDef.fields
          .filter((f) => !NON_WRITABLE.has(f.type) && f.name in fieldIdMaps[tableDef.ref])
          .map((f) => f.name)
      )
      const dropped = new Set<string>()
      const records = tableDef.sample_records.map((r) => {
        const fields: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(r)) {
          if (writable.has(k)) fields[k] = v
          else dropped.add(k)
        }
        return { fields }
      })
      if (dropped.size) {
        console.warn(`妯℃澘銆?{tableDef.name}銆嶇ず渚嬫暟鎹腑涓㈠純浜嗕笉鍙啓/涓嶅瓨鍦ㄧ殑瀛楁锛?{[...dropped].join('銆?)}`)
      }
      try {
        // Verify against what was ACTUALLY created, not what we sent 鈥?Feishu can
        // create fewer than requested. Report the real count, not a virtual success.
        const res = (await API.batchCreateRecords(token, appToken, tableId, records)) as {
          records?: unknown[]
        }
        const created = res.records?.length ?? records.length
        totalRecords += created
        if (created < records.length) {
          set(`rec-${tableDef.ref}`, 'done', `浠呭啓鍏?${created}/${records.length} 鏉)
        } else {
          set(`rec-${tableDef.ref}`, 'done')
        }
      } catch (err) {
        set(`rec-${tableDef.ref}`, 'error', String(err))
      }
    }
  }

  // 鈹€鈹€ Step 3: Dashboards 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  const dashboardWarnings: string[] = []
  const dashboardsCreated: string[] = []

  if (hasDashboards) {
    set('dash', 'running')
    try {
      const dashRes = await API.listDashboards(token, appToken) as
        { dashboards?: Array<{ block_token: string; name: string }> }
      const existingDashboards = dashRes.dashboards ?? []

      for (const dash of template.dashboards!) {
        let blockToken: string | null = null

        const existing = existingDashboards.find(d => d.name === dash.name)
        if (existing) {
          blockToken = existing.block_token
        } else if (createDashboard) {
          // Try DOM automation to create the dashboard in the browser
          try {
            blockToken = await createDashboard(dash.name)
            if (blockToken) dashboardsCreated.push(dash.name)
          } catch { /* fall through to warning */ }
        }

        // 椋炰功 OpenAPI 涓嶆敮鎸佺▼搴忓寲鏂板缓浠〃鐩樻垨鍥捐〃锛?../dashboards/{id}/blocks 瀹炴祴 404锛夈€?        // 琛?瀛楁/瑙嗗浘/鏁版嵁閮藉凡寤哄ソ锛屼华琛ㄧ洏鍜屽浘琛ㄩ渶鍦ㄩ涔﹂噷鎵嬪姩娣诲姞鈥斺€旇繖鏄涔︾殑闄愬埗锛?        // 涓嶉渶瑕併€佷篃涓嶈璁╃敤鎴峰幓鏌?block_token銆?        if (!blockToken) {
          dashboardWarnings.push(`浠〃鐩樸€?{dash.name}銆嶉渶鍦ㄩ涔﹂噷鎵嬪姩娣诲姞锛堥涔?API 涓嶆敮鎸佺▼搴忓寲鍒涘缓浠〃鐩?鍥捐〃锛塦)
          continue
        }
        if (dash.blocks.length > 0) {
          dashboardWarnings.push(`浠〃鐩樸€?{dash.name}銆嶇殑鍥捐〃闇€鍦ㄩ涔﹂噷鎵嬪姩閰嶇疆锛堥涔?API 涓嶆敮鎸佺▼搴忓寲鍒涘缓鍥捐〃锛塦)
        }
      }

      set('dash', 'done',
        dashboardsCreated.length > 0 ? `${dashboardsCreated.length} 涓┖浠〃鐩樺凡寤猴紝鍥捐〃闇€鎵嬪姩閰嶇疆` :
        dashboardWarnings.length > 0 ? '浠〃鐩橀渶鍦ㄩ涔﹂噷鎵嬪姩鍔? : '鏃犱华琛ㄧ洏'
      )
    } catch (err) {
      set('dash', 'error', String(err))
      dashboardWarnings.push(String(err))
    }
  }

  return {
    appToken,
    appName,
    appUrl: appUrl || `https://feishu.cn/base/${appToken}`,
    tables: template.tables.map(t => ({
      ref: t.ref,
      name: resolve(t.name, inputs),
      tableId: tableMap[t.ref] ?? '',
    })),
    totalRecords,
    dashboardWarnings,
    dashboardsCreated,
  }
}
