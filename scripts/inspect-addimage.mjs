import { readFileSync } from 'fs'
const c = readFileSync('dist/pptxgen.es.js', 'utf8')

// Find addImage method
console.log('=== addImage method ===')
const addIdx = c.indexOf('addImage(')
if (addIdx >= 0) {
  console.log(c.slice(addIdx, addIdx + 3000))
}

// Find how data: URLs are handled in addImage
console.log('\n=== data: URL handling ===')
let m, re = /data:image/g, count = 0
while ((m = re.exec(c)) && count < 5) {
  console.log(`\n@${m.index}: ...${c.slice(Math.max(0, m.index - 150), m.index + 250)}...`)
  count++
}

// Find where r.data / _data is set for images
console.log('\n=== image data assignment ===')
re = /_data|\.data\s*=/g; count = 0
while ((m = re.exec(c)) && count < 3) {
  console.log(`\n@${m.index}: ...${c.slice(Math.max(0, m.index - 100), m.index + 200)}...`)
  count++
}
