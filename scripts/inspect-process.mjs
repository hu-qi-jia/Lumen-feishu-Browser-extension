import { readFileSync } from 'fs'

// Check sidepanel HTML for process polyfill
console.log('=== Sidepanel HTML ===')
try {
  const html = readFileSync('dist/src/sidepanel/index.html', 'utf8')
  // Look for process-related scripts
  const lines = html.split('\n')
  lines.forEach((l, i) => {
    if (l.includes('process') || l.includes('polyfill') || l.includes('globalThis')) {
      console.log(`L${i+1}: ${l.trim().slice(0, 200)}`)
    }
  })
  console.log('First 500 chars:')
  console.log(html.slice(0, 500))
} catch (e) { console.log('No sidepanel HTML:', e.message) }

// Check if process is referenced anywhere in sidepanel index.js (not pptxgen)
console.log('\n=== process references in sidepanel/index.js ===')
const c = readFileSync('dist/src/sidepanel/index.js', 'utf8')
let m, re = /\bprocess\b/g, count = 0
while ((m = re.exec(c)) && count < 10) {
  const ctx = c.slice(Math.max(0, m.index - 50), m.index + 80)
  // Skip if it's in a string literal
  console.log(`@${m.index}: ...${ctx}...`)
  count++
}

// Find exportPresentation in pptxgen.es.js
console.log('\n=== exportPresentation in pptxgen.es.js ===')
const c2 = readFileSync('dist/pptxgen.es.js', 'utf8')
// Search for the method definition pattern
const epPatterns = [
  /exportPresentation\s*\(\s*\)\s*\{/g,
  /exportPresentation\s*\(\s*t\s*\)\s*\{/g,
  /exportPresentation\s*\(\s*\{[^}]*\}\s*\)\s*\{/g,
  /exportPresentation\s*=\s*\(/g,
  /["']exportPresentation["']/g,
]

for (const p of epPatterns) {
  let m2, c2count = 0
  while ((m2 = p.exec(c2)) && c2count < 2) {
    console.log(`\nPattern ${p} @${m2.index}:`)
    console.log(c2.slice(m2.index, m2.index + 3000))
    c2count++
  }
}

// Also search for the generateAsync call
console.log('\n=== generateAsync calls ===')
re = /generateAsync/g; count = 0
while ((m = re.exec(c2)) && count < 5) {
  console.log(`\n@${m.index}: ...${c2.slice(Math.max(0, m.index - 200), m.index + 150)}...`)
  count++
}
