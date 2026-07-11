/**
 * Data-viz / "data app": the AI generates a render(data, echarts, chart) code template once;
 * the data is re-fetched LIVE on every open. So a saved viz is a live dashboard that costs
 * nothing (no LLM) to re-open and always shows current table data.
 */

export type VizSource =
  | { kind: 'base'; appToken: string; tableId: string }
  | { kind: 'sheet'; spreadsheetToken: string; range: string }

/** A field's name + type, plus a few real sample values so the model knows the actual
 *  format (date layout, currency style, option labels) instead of guessing from the name. */
export interface VizField { name: string; type: string; samples?: string[] }
export interface VizData { schema: VizField[]; rows: Record<string, string>[] }

export interface SavedViz {
  id: string
  name: string
  source: VizSource
  /** Body of render(data, echarts, chart, container) — the saved artifact (no data inside).
   *  Optional now: store / no-remote-code builds save a declarative `spec` instead. */
  code?: string
  /** Plan B: declarative VizSpec (no-remote-code builds). One of code/spec is present. */
  spec?: import('./spec').VizSpec
  /** Original NL request, kept so a legacy code-only board can be re-generated as a spec. */
  request?: string
  createdAt: number
  /** 'viz' = chart/小程序 (default when absent). Cosmetic label only. */
  kind?: 'viz'
}
