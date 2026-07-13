/**
 * Standalone viz-viewer page — opened in its own tab so viewing a generated 看板 does NOT
 * depend on staying on a Feishu page (the on-page overlay does). Reads the viz payload from
 * `chrome.storage.session` (key `vizView`), embeds the sandbox iframe, and posts a
 * DATAVIZ_RENDER message to render the 看板 inside the sandbox.
 *
 * When `vizView.export` is set, the viewer renders the 看板, then asks the sandbox for its
 * rendered HTML + chart options, builds a standalone HTML file, and triggers a download.
 */
import type { VizSpec } from '@/shared/dataviz/spec'

interface VizView {
  code?: string
  spec?: VizSpec
  data: Array<Record<string, unknown>>
  name: string
  theme?: 'light' | 'dark'
  export?: boolean
}

const frame = document.getElementById('frame') as HTMLIFrameElement
const loading = document.getElementById('loading')!

frame.src = chrome.runtime.getURL('src/sandbox/index.html')

const urlParams = new URLSearchParams(location.search)
const isExport = urlParams.get('export') === '1'
const nonce = crypto.randomUUID()

window.addEventListener('message', (event) => {
  const data = event.data as { type?: string; nonce?: string; html?: string; css?: string; theme?: string; charts?: unknown[] }
  if (event.source !== frame.contentWindow) return

  // Sandbox is ready → load viz data from session storage and send render command.
  if (data.type === 'DATAVIZ_READY') {
    chrome.storage.session.get('vizView').then((res) => {
      const v = res?.vizView as VizView | undefined
      if (!v || (!v.code && !v.spec)) {
        loading.textContent = '没有可显示的看板'
        return
      }
      loading.style.display = 'none'
      document.title = v.name || '看板预览'
      frame.contentWindow?.postMessage({
        type: 'DATAVIZ_RENDER',
        nonce,
        code: v.code,
        spec: v.spec,
        data: v.data,
        theme: v.theme || 'light',
      }, '*')
      // If export mode, ask the sandbox for its rendered HTML after a short delay (let charts init).
      if (isExport || v.export) {
        setTimeout(() => {
          frame.contentWindow?.postMessage({ type: 'DATAVIZ_EXPORT', nonce }, '*')
        }, 800)
      }
    })
    return
  }

  // Sandbox rendered OK.
  if (data.type === 'RENDER_OK' && data.nonce === nonce) {
    // Charts are live; nothing to do for preview mode.
  }

  // Sandbox returned export data → build standalone HTML and download.
  if (data.type === 'VIZ_EXPORT_DATA' && data.nonce === nonce) {
    buildAndDownload(data.html || '', data.css || '', data.theme || 'light', data.charts || [])
  }

  // Render error.
  if (data.type === 'RENDER_ERR' && data.nonce === nonce) {
    loading.textContent = '渲染失败'
    loading.style.display = 'flex'
  }
})

function buildAndDownload(html: string, css: string, theme: string, charts: unknown[]) {
  chrome.storage.session.get('vizView').then((res) => {
    const v = res?.vizView as VizView | undefined
    const name = v?.name || '看板'

    // Re-init script: walk all [data-viz-chart] elements and restore their ECharts instances.
    const chartsJson = JSON.stringify(charts)
    const reinitScript = `
document.querySelectorAll('[data-viz-chart]').forEach(function(el, i) {
  try { if (window.__charts && window.__charts[i]) echarts.init(el).setOption(window.__charts[i]); } catch(e) {}
});
window.addEventListener('resize', function() {
  document.querySelectorAll('[data-viz-chart]').forEach(function(el) {
    var inst = echarts.getInstanceByDom(el); if (inst) inst.resize();
  });
});`

    const doc = `<!DOCTYPE html>
<html lang="zh" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(name)}</title>
<style>${css}</style>
<style>*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%;overflow:auto}#root{min-height:100%}</style>
</head>
<body>
<div id="root">${html}</div>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<script>window.__charts = ${chartsJson};</script>
<script>${reinitScript}</script>
</body>
</html>`

    // Prepend UTF-8 BOM so Chinese characters display correctly on all systems.
    const blob = new Blob(['\uFEFF' + doc], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.html`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      // Close the export tab after download.
      if (isExport) window.close()
    }, 1000)
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}
