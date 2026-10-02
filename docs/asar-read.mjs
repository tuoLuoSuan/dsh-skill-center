// Minimal asar reader: parse the archive header and list/extract entries.
// Usage:
//   node asar-read.mjs list <needle>
//   node asar-read.mjs cat  <path-inside-asar>
import { readFileSync } from 'node:fs'

const archive = process.argv[2]
const mode = process.argv[3]
const needle = process.argv[4] ?? ''

const fd = readFileSync(archive)
// Chromium pickle layout: [4-byte size][4-byte headerPickleSize][4-byte
// headerStringSize?][4-byte headerSize] then the JSON header, then the payload.
// The header JSON therefore starts at 16 and the file data at 16 + headerSize —
// using 8 here shifts every extracted file 8 bytes into the previous entry.
const headerSize = fd.readUInt32LE(12)
const header = JSON.parse(fd.subarray(16, 16 + headerSize).toString('utf8'))
const dataStart = 16 + headerSize

const walk = (node, prefix, visit) => {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (entry.files !== undefined) walk(entry, path, visit)
    else visit(path, entry)
  }
}

if (mode === 'list') {
  const hits = []
  walk(header, '', (path, entry) => {
    if (path.includes(needle)) hits.push({ path, size: Number(entry.size ?? 0) })
  })
  hits.sort((a, b) => a.path.localeCompare(b.path))
  for (const hit of hits.slice(0, 300)) console.log(String(hit.size).padStart(10), hit.path)
  console.log(`--- ${hits.length} match(es) for ${JSON.stringify(needle)}`)
} else if (mode === 'cat') {
  let found
  walk(header, '', (path, entry) => {
    if (path === needle.replace(/^\/+/, '')) found = entry
  })
  if (found === undefined) {
    console.error(`not found: ${needle}`)
    process.exit(1)
  }
  const offset = Number(found.offset)
  const size = Number(found.size)
  process.stdout.write(fd.subarray(dataStart + offset, dataStart + offset + size))
} else {
  console.error('usage: asar-read.mjs <archive> list <needle> | cat <path>')
  process.exit(2)
}
