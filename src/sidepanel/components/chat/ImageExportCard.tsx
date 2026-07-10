import { useState } from 'react'
import JSZip from 'jszip'
import Tooltip from '../ui/Tooltip'
import './ImageExportCard.css'

interface ImageExportCardProps {
  images: Array<{ name: string; context: string; dataUrl: string }>
  docTitle: string
  onClose: () => void
}

export default function ImageExportCard({ images, docTitle, onClose }: ImageExportCardProps) {
  const [zapping, setZapping] = useState(false)

  const valid = images.filter((im) => im.dataUrl)

  async function downloadZip() {
    setZapping(true)
    try {
      const zip = new JSZip()
      for (let i = 0; i < valid.length; i++) {
        const im = valid[i]
        const base64 = im.dataUrl.split(',')[1]
        if (base64) zip.file(im.name, base64, { base64: true })
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${docTitle || '文档图片'}.zip`
      document.body.appendChild(a); a.click()
      a.remove(); URL.revokeObjectURL(url)
    } finally { setZapping(false) }
  }

  async function downloadOne(im: typeof valid[number]) {
    const a = document.createElement('a')
    a.href = im.dataUrl; a.download = im.name
    document.body.appendChild(a); a.click()
    a.remove()
  }

  if (!valid.length) return (
    <div className="image-export-card">
      <div className="image-export-header"><span>图片导出</span><button onClick={onClose} type="button" aria-label="关闭">×</button></div>
      <p className="image-export-empty">没有可导出的图片</p>
    </div>
  )

  return (
    <div className="image-export-card">
      <div className="image-export-header">
        <span>{valid.length} 张图片（{docTitle}）</span>
        <div className="image-export-actions">
          <button className="image-export-dl-all" onClick={downloadZip} disabled={zapping} type="button">
            {zapping ? '打包中…' : '下载全部 ZIP'}
          </button>
          <button className="image-export-close" onClick={onClose} type="button" aria-label="关闭">×</button>
        </div>
      </div>
      <div className="image-export-gallery">
        {valid.map((im, i) => (
          <Tooltip key={i} content={im.context || im.name} position="top">
            <button className="image-export-item" onClick={() => downloadOne(im)} type="button">
              <img src={im.dataUrl} alt={im.context || im.name} loading="lazy" />
              {im.context && <span className="image-export-context">{im.context}</span>}
            </button>
          </Tooltip>
        ))}
        {valid.length < images.length && (
          <p className="image-export-failed">{images.length - valid.length} 张下载失败</p>
        )}
      </div>
    </div>
  )
}
