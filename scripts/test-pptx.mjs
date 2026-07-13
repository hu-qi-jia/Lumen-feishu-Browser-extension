// 调试：用项目实际的渲染逻辑生成 PPTX，检查 ZIP 结构
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { writeFileSync } from 'fs'

async function main() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'test'
  pptx.title = 'test'

  // 模拟一个带图片的 slide（dataUrl 用 1x1 png）
  const slide1 = pptx.addSlide()
  slide1.background = { color: 'ffffff' }
  slide1.addText('Hello Title', {
    x: 0.5, y: 0.5, w: 10, h: 1,
    fontSize: 28, color: '000000', bold: true, align: 'center',
  })
  slide1.addImage({
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    x: 1, y: 2, w: 4, h: 3,
  })

  // 模拟 addShape
  const slide2 = pptx.addSlide()
  slide2.background = { color: 'f5f5f5' }
  slide2.addShape('roundRect', {
    x: 0.5, y: 0.5, w: 4, h: 2,
    fill: { color: '4472C4' }, line: { color: '2F5496', width: 1 },
  })
  slide2.addText('Card content', {
    x: 0.5, y: 0.5, w: 4, h: 2,
    fontSize: 14, color: 'ffffff', align: 'center', valign: 'middle',
  })

  const blob = await pptx.write({ outputType: 'blob' })
  const buf = Buffer.from(await blob.arrayBuffer())
  writeFileSync('test-actual.pptx', buf)
  console.log('blob size:', buf.length)

  // 检查 ZIP
  const zip = await JSZip.loadAsync(buf)
  const entries = Object.keys(zip.files).sort()
  console.log('ZIP entries (' + entries.length + '):')
  entries.forEach((name) => {
    const f = zip.files[name]
    console.log(f.dir ? '  [DIR] ' + name : '  [FILE] ' + name + ' (' + f._data?.uncompressedSize + ' bytes)')
  })

  // 检查 slide1.xml 是否有图片引用
  const slide1Xml = await zip.file('ppt/slides/slide1.xml').async('string')
  console.log('\nslide1.xml has <p:pic>:', slide1Xml.includes('<p:pic>'))
  console.log('slide1.xml has <a:blip>:', slide1Xml.includes('<a:blip'))

  // 检查 media 目录
  const mediaFiles = entries.filter((n) => n.startsWith('ppt/media/'))
  console.log('\nmedia files:', mediaFiles)
}

main().catch(console.error)
