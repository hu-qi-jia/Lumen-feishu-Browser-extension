// 模拟浏览器环境：注入 process polyfill，然后用 pptxgenjs 生成 PPTX
// 检查 isNode 检测是否被 process polyfill 误导

// 先注入 process polyfill（模拟 Vite 注入的）
globalThis.process = {
  env: {},
  versions: { node: '18.0.0' },  // 模拟 polyfill
  release: { name: 'node' },
}

console.log('Before patch:')
console.log('  typeof process:', typeof process)
console.log('  process.versions.node:', process.versions.node)
console.log('  process.release.name:', process.release.name)

// 应用我们的 patch
const savedVersionsNode = globalThis.process?.versions?.node
const savedReleaseName = globalThis.process?.release?.name
if (globalThis.process?.versions) globalThis.process.versions.node = undefined
if (globalThis.process?.release) globalThis.process.release.name = undefined

console.log('After patch:')
console.log('  process.versions.node:', process.versions.node)
console.log('  process.release.name:', process.release.name)

// 现在 import pptxgenjs
const PptxGenJS = (await import('pptxgenjs')).default
console.log('PptxGenJS loaded:', typeof PptxGenJS)

const pptx = new PptxGenJS()
pptx.layout = 'LAYOUT_WIDE'
pptx.title = 'Test with process polyfill'

const slide = pptx.addSlide()
slide.background = { color: 'ffffff' }
slide.addText('Hello with patched process', {
  x: 0.5, y: 0.5, w: 10, h: 1,
  fontSize: 28, color: '000000', bold: true, align: 'center',
})
slide.addImage({
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  x: 1, y: 2, w: 4, h: 3,
})

try {
  const blob = await pptx.write({ outputType: 'blob' })
  const buf = Buffer.from(await blob.arrayBuffer())
  console.log('Blob size:', buf.length)

  // 检查 ZIP
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const entries = Object.keys(zip.files).sort()
  console.log('ZIP entries:', entries.length)

  const mediaFiles = entries.filter((n) => n.startsWith('ppt/media/'))
  console.log('Media files:', mediaFiles)

  const slide1Xml = await zip.file('ppt/slides/slide1.xml').async('string')
  console.log('slide1.xml has <p:pic>:', slide1Xml.includes('<p:pic>'))
  console.log('slide1.xml has <a:blip>:', slide1Xml.includes('<a:blip'))

  // 写文件
  const { writeFileSync } = await import('fs')
  writeFileSync('test-polyfill.pptx', buf)
  console.log('Written to test-polyfill.pptx')
} catch (e) {
  console.error('ERROR:', e.message)
  console.error('STACK:', e.stack)
}

// 恢复
if (globalThis.process?.versions && savedVersionsNode !== undefined)
  globalThis.process.versions.node = savedVersionsNode
if (globalThis.process?.release && savedReleaseName !== undefined)
  globalThis.process.release.name = savedReleaseName
