// Extract the CLIENT_SLOT_API catalog from an extracted dsh-cordis-client-runner.
//
// This reads DeepSeek's own bundle out of whatever DSH install you point it at,
// so it is deliberately not shipped with a baked-in results file: run it
// yourself against your own install to regenerate docs/slot-catalog-<version>.json.
//
//   node docs/extract-slot-catalog.mjs <path to dsh-cordis-client-runner/lib/client.js>
//
// Get that file by unpacking app.asar — see docs/asar-extract.mjs.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

if (process.argv[2] === undefined) {
  console.error('usage: node docs/extract-slot-catalog.mjs <dsh-cordis-client-runner/lib/client.js>')
  process.exit(2)
}
const SRC = resolve(process.argv[2])
if (!SRC.endsWith('client.js')) {
  console.error(`expected a path to client.js, got ${SRC}`)
  process.exit(2)
}
const text = readFileSync(SRC, 'utf8')

function sliceArray(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) throw new Error(`marker not found: ${marker}`)
  const open = src.indexOf('[', at + marker.length - 1)
  // scan for matching close bracket, respecting strings
  let depth = 0
  let i = open
  let quote = null
  for (; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) { i++; break } }
  }
  return src.slice(open, i)
}

const literal = sliceArray(text, 'const CLIENT_SLOT_API = [')
const slots = new Function(`return ${literal}`)()
console.log(`CLIENT_SLOT_API entries: ${slots.length}`)

const OUT = join(here, 'slot-catalog.json')
writeFileSync(OUT, JSON.stringify(slots, null, 2))
console.log(`wrote ${OUT}`)

// Compact table
const rows = slots.map((s) => [
  s.key,
  s.kind,
  s.scope,
  (s.occupants || []).join(', ') || '-',
  s.declaredBy || '-',
  s.replaceRisk || '-',
].join(' | '))
console.log(rows.join('\n'))

console.log('\n--- keys only ---')
console.log(slots.map((s) => s.key).join('\n'))
