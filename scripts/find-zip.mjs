import { readFileSync } from 'fs'
const c = readFileSync('dist/pptxgen.es.js', 'utf8')

// Find all 'new ne' occurrences
console.log('=== All "new ne" occurrences ===')
let m, re = /new ne\b/g, count = 0
while ((m = re.exec(c)) && count < 10) {
  console.log(`\n@${m.index}: ...${c.slice(Math.max(0, m.index - 100), m.index + 100)}...`)
  count++
}

// Find the exportPresentation function more precisely
// It should be a method that creates a ZIP and calls generateAsync
console.log('\n=== Searching for exportPresentation method ===')
// Look for patterns like: exportPresentation(t){ or exportPresentation(){
const patterns = [
  /exportPresentation\s*\([^)]*\)\s*\{/g,
  /["']exportPresentation["']\s*:/g,
  /exportPresentation\s*\(.*?\)\s*\{[^}]*generateAsync/g,
]

for (const p of patterns) {
  let m2, c2 = 0
  while ((m2 = p.exec(c)) && c2 < 3) {
    console.log(`\nPattern ${p} @${m2.index}:`)
    // Print 200 chars before to see context
    console.log(c.slice(Math.max(0, m2.index - 100), m2.index + 500))
    c2++
  }
}

// Find where the main zip is created (look for 'new ne' near 'folder')
console.log('\n=== ZIP creation patterns (new ne + folder) ===')
re = /new ne/g; count = 0
while ((m = re.exec(c)) && count < 10) {
  const ctx = c.slice(m.index, m.index + 500)
  if (ctx.includes('folder') || ctx.includes('file(') || ctx.includes('_rels')) {
    console.log(`\n@${m.index}: ${ctx.slice(0, 300)}`)
  }
  count++
}

// Check where 'n.generateAsync' is called - 'n' is the zip variable
console.log('\n=== generateAsync call context ===')
re = /(\w)\.generateAsync/g; count = 0
while ((m = re.exec(c)) && count < 5) {
  console.log(`\n@${m.index}: var="${m[1]}" ...${c.slice(Math.max(0, m.index - 200), m.index + 100)}...`)
  count++
}
