import { readFileSync } from 'fs'
const c = readFileSync('dist/src/sidepanel/index.js', 'utf8')
const i = c.indexOf('outputType:"blob"')
if (i < 0) { console.log('NOT FOUND'); process.exit(0) }
console.log('=== Around outputType:"blob" ===')
console.log(c.slice(Math.max(0, i - 1200), i + 300))
console.log('=== process.versions occurrences ===')
let m, re = /process\.versions/g, count = 0
while ((m = re.exec(c)) && count < 5) {
  console.log(`@${m.index}: ...${c.slice(Math.max(0, m.index - 60), m.index + 80)}...`)
  count++
}
console.log('=== process.release occurrences ===')
re = /process\.release/g; count = 0
while ((m = re.exec(c)) && count < 5) {
  console.log(`@${m.index}: ...${c.slice(Math.max(0, m.index - 60), m.index + 80)}...`)
  count++
}
