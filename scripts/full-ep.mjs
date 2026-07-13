import { readFileSync } from 'fs'
const c = readFileSync('dist/pptxgen.es.js', 'utf8')

// Get the full exportPresentation function starting at @267683
console.log('=== Full exportPresentation (from @267683) ===')
console.log(c.slice(267683, 267683 + 4000))
