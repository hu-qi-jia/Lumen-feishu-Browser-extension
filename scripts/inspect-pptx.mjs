import { readFileSync } from 'fs'
const c = readFileSync('dist/pptxgen.es.js', 'utf8')

// Find all isNode-related patterns
const patterns = [
  /typeof process/,
  /process\.versions/,
  /process\.release/,
  /isNode/,
  /encodeSlideMediaRels/,
]

for (const p of patterns) {
  console.log(`\n=== Pattern: ${p} ===`)
  let m, re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g'), count = 0
  while ((m = re.exec(c)) && count < 6) {
    const start = Math.max(0, m.index - 80)
    const end = Math.min(c.length, m.index + 120)
    console.log(`@${m.index}: ...${c.slice(start, end)}...`)
    count++
  }
}

// Find the WA function definition
console.log('\n=== WA function (encodeSlideMediaRels) ===')
const waIdx = c.indexOf('function WA(')
if (waIdx >= 0) {
  console.log(c.slice(waIdx, waIdx + 1500))
} else {
  // Try to find it as an arrow function or const
  const altIdx = c.search(/WA\s*[=(]/)
  if (altIdx >= 0) {
    console.log(`@${altIdx}: ${c.slice(altIdx, altIdx + 1500)}`)
  } else {
    console.log('WA not found')
  }
}
