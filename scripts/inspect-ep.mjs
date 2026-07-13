import { readFileSync } from 'fs'
const c = readFileSync('dist/pptxgen.es.js', 'utf8')

// Find exportPresentation method definition
console.log('=== exportPresentation definition ===')
const patterns = [
  /exportPresentation\s*\(/g,
  /exportPresentation\s*\(t\)\s*\{/g,
]

for (const p of patterns) {
  let m, count = 0
  while ((m = p.exec(c)) && count < 3) {
    const ctx = c.slice(m.index, m.index + 50)
    if (ctx.includes('{')) {
      console.log(`\n@${m.index}:`)
      console.log(c.slice(m.index, m.index + 4000))
      count++
    }
  }
}

// Check how downloadSlidesPptx is called in the sidepanel
console.log('\n=== downloadSlidesPptx call site ===')
const c2 = readFileSync('dist/src/sidepanel/index.js', 'utf8')
let m2, re2 = /downloadSlidesPptx/g
while ((m2 = re2.exec(c2)) && m2.index < c2.length) {
  console.log(`\n@${m2.index}: ...${c2.slice(Math.max(0, m2.index - 200), m2.index + 200)}...`)
}
