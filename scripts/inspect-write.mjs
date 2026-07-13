import { readFileSync } from 'fs'
const c = readFileSync('dist/pptxgen.es.js', 'utf8')

// Find the write() method (not writeFile)
console.log('=== Searching for write() method ===')
const patterns = [
  /write\(t\)\s*\{/,
  /write\(t,\s*options\)/,
  /write\s*\(.*outputType/,
  /\.write\s*=/,
]

for (const p of patterns) {
  let m, re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g'), count = 0
  while ((m = re.exec(c)) && count < 3) {
    console.log(`\nPattern ${p} @${m.index}:`)
    console.log(c.slice(m.index, m.index + 2000))
    count++
  }
}

// Search for outputType handling
console.log('\n=== outputType handling ===')
let m, re = /outputType/g, count = 0
while ((m = re.exec(c)) && count < 8) {
  console.log(`\n@${m.index}: ...${c.slice(Math.max(0, m.index - 100), m.index + 200)}...`)
  count++
}
