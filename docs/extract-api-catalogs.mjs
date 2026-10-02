// Extract the SERVICE_API / EVENT_API / CLIENT_BUILTIN_INSPECTION catalogs from
// an extracted dsh-cordis-client-runner.
//
//   node docs/extract-api-catalogs.mjs <path to dsh-cordis-client-runner/lib/client.js>
//
// The catalogs describe DeepSeek's bundle, so they are not committed: run this
// against your own install to regenerate them.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
if (process.argv[2] === undefined) {
  console.error('usage: node docs/extract-api-catalogs.mjs <dsh-cordis-client-runner/lib/client.js>')
  process.exit(2)
}
const SRC = resolve(process.argv[2])
const text = readFileSync(SRC, 'utf8')

function sliceArray(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) throw new Error(`marker not found: ${marker}`)
  const open = src.indexOf('[', at + marker.length - 1)
  let depth = 0, i = open, quote = null
  for (; i < src.length; i++) {
    const c = src[i]
    if (quote) { if (c === '\\') { i++; continue } ; if (c === quote) quote = null; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) { i++; break } }
  }
  return src.slice(open, i)
}

for (const [marker, out] of [
  ['const SERVICE_API = [', 'service-api.json'],
  ['const EVENT_API = [', 'event-api.json'],
  ['const CLIENT_BUILTIN_INSPECTION = [', 'builtin-inspection.json'],
]) {
  const arr = new Function(`return ${sliceArray(text, marker)}`)()
  writeFileSync(join(here, out), JSON.stringify(arr, null, 2))
  console.log(`### ${marker} -> ${arr.length} entries -> docs/${out}`)
  for (const e of arr) {
    const methods = (e.methods || e.signature || e.properties || []).length
    console.log(`- ${e.key}${e.name ? ` (${e.name})` : ''}${e.mode ? ` [${e.mode}]` : ''} :: ${String(e.summary || '').slice(0, 110)}`)
  }
  console.log()
}
