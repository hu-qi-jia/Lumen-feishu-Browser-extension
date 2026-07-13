import { readFileSync } from 'fs'

// Compare key function presence between node_modules and dist versions
const src = readFileSync('node_modules/pptxgenjs/dist/pptxgen.es.js', 'utf8')
const dist = readFileSync('dist/pptxgen.es.js', 'utf8')

const checks = [
  'encodeSlideMediaRels',
  'exportPresentation',
  'writeFile',
  'generateAsync',
  'addImage',
  'addSlide',
  'createChartMediaRels',
  'writeFileToBrowser',
  '_relsMedia',
  '[Content_Types]',
  'ppt/slides/slide',
  'ppt/media/image',
]

console.log('Function presence comparison:')
console.log('%-30s %10s %10s', 'Pattern', 'src', 'dist')
for (const p of checks) {
  const sc = (src.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  const dc = (dist.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  console.log('%-30s %10d %10d %s', p, sc, dc, sc === dc ? '' : 'DIFF')
}

// Check what the dist version imports
console.log('\n=== import statements in dist/pptxgen.es.js ===')
const importRe = /import\s*[^;]*;/g
let m
while ((m = importRe.exec(dist)) && importRe.lastIndex < 10000) {
  console.log(m[0].slice(0, 200))
}

// Check what the src version imports  
console.log('\n=== import statements in node_modules/pptxgen.es.js (first 10) ===')
const importRe2 = /import\s*[^;]*;/g
let count = 0
while ((m = importRe2.exec(src)) && count < 10) {
  console.log(m[0].slice(0, 200))
  count++
}
