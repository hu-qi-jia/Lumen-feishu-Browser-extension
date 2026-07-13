import { readFileSync } from 'fs'
const c = readFileSync('dist/pptxgen.es.js', 'utf8')

// Search for _relsMedia push (where images are stored)
console.log('=== _relsMedia push ===')
let m, re = /_relsMedia\.push/g, count = 0
while ((m = re.exec(c)) && count < 5) {
  console.log(`\n@${m.index}: ...${c.slice(Math.max(0, m.index - 300), m.index + 400)}...`)
  count++
}

// Search for addImage definition on slide
console.log('\n=== addImage definition ===')
re = /addImage\s*\(/g; count = 0
while ((m = re.exec(c)) && count < 10) {
  const ctx = c.slice(Math.max(0, m.index - 30), m.index + 50)
  // Look for method definitions (not calls)
  if (ctx.includes('addImage(t') || ctx.includes('addImage(e') || ctx.includes('addImage({')) {
    console.log(`\n@${m.index}: ${c.slice(m.index, m.index + 1500)}`)
    count++
  }
}

// Search for where data is stripped of data: prefix
console.log('\n=== data: prefix stripping ===')
re = /data:image|data:.*base64|\.split\(",/g; count = 0
while ((m = re.exec(c)) && count < 10) {
  console.log(`\n@${m.index}: ...${c.slice(Math.max(0, m.index - 80), m.index + 150)}...`)
  count++
}
