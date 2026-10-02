// Extract a subtree of an asar archive to a real directory.
// Usage: node asar-extract.mjs <archive> <inside-prefix> <outDir> [needle]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const archive = process.argv[2]
const prefix = (process.argv[3] ?? '').replace(/^\/+|\/+$/g, '')
const outDir = resolve(process.argv[4] ?? './_asar-out')
const needle = process.argv[5] ?? ''

const fd = readFileSync(archive)
const headerSize = fd.readUInt32LE(12)
const header = JSON.parse(fd.subarray(16, 16 + headerSize).toString('utf8'))
// NOTE: the data region begins right after the header JSON block, i.e. at
// 16 + headerSize — NOT 8 + headerSize. Using 8 prepends the previous entry's
// last 8 bytes to every extracted file.
const dataStart = 16 + headerSize

let count = 0
let bytes = 0
const walk = (node, path) => {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = path === '' ? name : `${path}/${name}`
    if (entry.files !== undefined) {
      walk(entry, p)
      continue
    }
    if (prefix !== '' && !(p === prefix || p.startsWith(prefix + '/'))) continue
    if (needle !== '' && !p.includes(needle)) continue
    const rel = prefix === '' ? p : p.slice(prefix.length + 1)
    const dest = join(outDir, rel)
    const offset = Number(entry.offset)
    const size = Number(entry.size)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, fd.subarray(dataStart + offset, dataStart + offset + size))
    count += 1
    bytes += size
  }
}

walk(header, '')
console.log(`extracted ${count} file(s), ${bytes} bytes -> ${outDir}`)
