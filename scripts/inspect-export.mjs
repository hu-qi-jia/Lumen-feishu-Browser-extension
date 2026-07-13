import { readFileSync } from 'fs'
const c = readFileSync('dist/pptxgen.es.js', 'utf8')

// Get full context around media file writing
console.log('=== Media file writing logic (@266870 area) ===')
console.log(c.slice(266700, 267400))

// Check for any globalThis.process or process = assignments
console.log('\n=== process polyfill / definition ===')
let m, re = /globalThis\.process|self\.process|window\.process|global\.process|\bprocess\s*=\s*|process\s*=\s*\{/g, count = 0
while ((m = re.exec(c)) && count < 5) {
  console.log(`\n@${m.index}: ...${c.slice(Math.max(0, m.index - 80), m.index + 120)}...`)
  count++
}

// Check the full exportPresentation function
console.log('\n=== exportPresentation ===')
const epIdx = c.indexOf('exportPresentation(')
if (epIdx >= 0) {
  // Find the definition (not call)
  let defIdx = c.indexOf('exportPresentation(t){', epIdx)
  if (defIdx < 0) defIdx = c.indexOf('exportPresentation(', epIdx + 20)
  if (defIdx >= 0) {
    console.log(c.slice(defIdx, defIdx + 3000))
  }
}
