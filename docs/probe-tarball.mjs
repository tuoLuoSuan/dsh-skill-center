/**
 * Does the tarball reader actually read tarballs?
 *
 * Two halves. The first synthesises archives that exercise the parts of the
 * format real repositories hit only occasionally — long names in all three
 * spellings, a `prefix` field, directories, symlinks, binary content — because
 * a parser that only ever sees well-behaved input is a parser that only works
 * on well-behaved input. The second downloads a real repository from codeload
 * and checks that the result matches what the repository actually contains.
 *
 * Usage: node docs/probe-tarball.mjs
 */
import { gzipSync } from 'node:zlib'
import { extractTarGz, decodeText } from '../lib/tarball.js'

let passed = 0
let failed = 0

/** @param label - what is being asserted. @param ok - the verdict. @param detail - shown on failure. */
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ok   ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/* ------------------------------------------------------------------ a tar writer */

const BLOCK = 512

/**
 * Build one 512-byte tar header.
 * @param input - name, size, typeflag, prefix and magic for the entry.
 * @returns the header block.
 */
function header({ name, size = 0, type = '0', prefix = '', magic = 'ustar\0' }) {
  const block = Buffer.alloc(BLOCK)
  block.write(name, 0, 100, 'utf8')
  block.write('0000644\0', 100, 8, 'utf8')
  block.write('0000000\0', 108, 8, 'utf8')
  block.write('0000000\0', 116, 8, 'utf8')
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8')
  block.write('00000000000\0', 136, 12, 'utf8')
  block.write('        ', 148, 8, 'utf8')
  block.write(type, 156, 1, 'utf8')
  block.write(magic, 257, magic.length, 'utf8')
  block.write('00', 263, 2, 'utf8')
  if (prefix !== '') block.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8')
  return block
}

/**
 * @param entries - `{name, data, type, prefix, magic, pax, longName}` records.
 * @returns a gzipped tarball.
 */
function tarGz(entries) {
  const parts = []
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8')
    if (entry.pax !== undefined) {
      const body = Buffer.from(Object.entries(entry.pax).map(([k, v]) => {
        const text = `${k}=${v}\n`
        // The length prefix counts itself, so it is found by iteration.
        let length = text.length + 2
        while (`${length}`.length + 1 + text.length !== length) length = `${length}`.length + 1 + text.length
        return `${length} ${text}`
      }).join(''), 'utf8')
      parts.push(header({ name: 'PaxHeaders/x', size: body.length, type: 'x' }), body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK))
    }
    if (entry.longName !== undefined) {
      const body = Buffer.from(`${entry.longName}\0`, 'utf8')
      parts.push(header({ name: '././@LongLink', size: body.length, type: 'L' }), body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK))
    }
    const payload = entry.type === '5' || entry.type === '2' ? Buffer.alloc(0) : data
    parts.push(header({ name: entry.name, size: payload.length, type: entry.type ?? '0', prefix: entry.prefix ?? '', magic: entry.magic ?? 'ustar\0' }))
    if (payload.length > 0) {
      parts.push(payload, Buffer.alloc((BLOCK - (payload.length % BLOCK)) % BLOCK))
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2))
  return gzipSync(Buffer.concat(parts))
}

/* ------------------------------------------------------------------ synthetic */

console.log('synthetic archives')

{
  const tar = tarGz([
    { name: 'repo-abc123/', type: '5' },
    { name: 'repo-abc123/SKILL.md', data: '# hello\n' },
    { name: 'repo-abc123/scripts/run.py', data: 'print(1)\n' },
  ])
  const { files } = extractTarGz(tar)
  const paths = files.map((file) => file.path).sort()
  check('strips the top-level directory', JSON.stringify(paths) === JSON.stringify(['SKILL.md', 'scripts/run.py']), JSON.stringify(paths))
  check('keeps file bytes intact', files.find((f) => f.path === 'SKILL.md').bytes.toString('utf8') === '# hello\n')
  check('skips directory entries', !paths.includes('') && !paths.some((p) => p.endsWith('/')))
}

{
  const long = `repo-abc123/${'d'.repeat(120)}/note.md`
  const tar = tarGz([
    { name: 'repo-abc123/SKILL.md', data: 'x' },
    { name: '././@LongLink', longName: long, data: `${long}\0` },
    { name: 'truncated-placeholder', data: 'long name body\n' },
  ])
  const { files } = extractTarGz(tar)
  check('GNU LongLink overrides the header name', files.some((f) => f.path === `${'d'.repeat(120)}/note.md`), JSON.stringify(files.map((f) => f.path)))
  check('the LongLink entry itself is consumed', files.length === 2, `${files.length} files`)
}

{
  const long = `repo-abc123/${'p'.repeat(130)}/deep.md`
  const tar = tarGz([
    { name: 'repo-abc123/SKILL.md', data: 'x' },
    { name: 'ignored', pax: { path: long }, data: '' },
    { name: 'truncated-placeholder', data: 'pax body\n' },
  ])
  const { files } = extractTarGz(tar)
  check('PAX path overrides the header name', files.some((f) => f.path === `${'p'.repeat(130)}/deep.md`), JSON.stringify(files.map((f) => f.path)))
}

{
  const tar = tarGz([
    { name: 'inner/SKILL.md', prefix: 'repo-abc123', data: 'prefix form\n' },
  ])
  const { files } = extractTarGz(tar)
  // `prefix` supplies the first segment, which `stripTopLevel` then removes —
  // so the surviving path is the name field, not the joined form.
  check('joins the ustar prefix field', files.length === 1 && files[0].path === 'inner/SKILL.md', JSON.stringify(files.map((f) => f.path)))
  const kept = extractTarGz(tar, { stripTopLevel: false })
  check('the joined path is prefix + name', kept.files[0].path === 'repo-abc123/inner/SKILL.md', kept.files[0]?.path)
}

{
  const tar = tarGz([
    { name: 'repo-abc123/SKILL.md', data: 'x' },
    { name: 'repo-abc123/link.md', type: '2' },
    { name: 'repo-abc123/emptydir/', type: '5' },
  ])
  const { files, skipped } = extractTarGz(tar)
  check('skips symlinks', !files.some((f) => f.path === 'link.md'))
  check('records what it skipped', skipped.length === 2, JSON.stringify(skipped))
}

{
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe])
  const tar = tarGz([{ name: 'repo-abc123/logo.png', data: png }])
  const { files } = extractTarGz(tar)
  const decoded = decodeText(files[0].bytes)
  check('binary content survives byte-for-byte', files[0].bytes.equals(png))
  check('binary is decoded as base64, not mangled', decoded.encoding === 'base64' && Buffer.from(decoded.content, 'base64').equals(png))
  const text = decodeText(Buffer.from('中文 and English\n', 'utf8'))
  check('text is still decoded as utf8', text.encoding === 'utf8' && text.content === '中文 and English\n')
}

{
  const tar = tarGz([{ name: 'repo-abc123/big.txt', data: 'z'.repeat(600) }])
  const { files } = extractTarGz(tar)
  check('multi-block files are read whole', files[0].bytes.length === 600)
}

{
  const tar = tarGz(Array.from({ length: 5 }, (_, i) => ({ name: `repo-abc123/f${i}.txt`, data: `${i}` })))
  let threw = false
  try {
    extractTarGz(tar, { maxEntries: 3 })
  } catch {
    threw = true
  }
  check('an entry cap is enforced', threw)
}

{
  const tar = tarGz([{ name: 'repo-abc123/big.txt', data: 'z'.repeat(2048) }])
  let threw = false
  try {
    extractTarGz(tar, { maxBytes: 100 })
  } catch {
    threw = true
  }
  check('a byte cap is enforced', threw)
}

/* ------------------------------------------------------------------ a real one */

console.log('\na real repository (obra/superpowers @ main)')

// The checks above are self-contained; this section is not. A transport
// failure here means the network is down, not that the parser is wrong, and
// reporting it as a failed check makes the probe untrustworthy as a
// regression guard — you cannot tell "the reader broke" from "we are offline".
// A parse failure on bytes that did arrive still fails loudly, below.
let archive
try {
  const response = await fetch('https://codeload.github.com/obra/superpowers/tar.gz/refs/heads/main', {
    headers: { 'user-agent': 'dsh-skill-center-probe/0.1' },
    signal: AbortSignal.timeout(45000),
  })
  check('codeload answers', response.ok, `HTTP ${response.status}`)
  if (response.ok) archive = Buffer.from(await response.arrayBuffer())
} catch (error) {
  console.log(`  skip  codeload unreachable — ${error?.message ?? error}`)
  console.log('  skip  the real-archive checks need the network; the synthetic ones above did not')
}

if (archive !== undefined) {
  const { files, entries } = extractTarGz(archive)
  check('entries were parsed', entries > 0, `${entries} entries`)
  check('files were extracted', files.length > 0, `${files.length} files`)
  check('every path is repository-relative', files.every((f) => !f.path.startsWith('obra-superpowers-')), files[0]?.path)
  const skills = files.filter((f) => f.path.endsWith('SKILL.md'))
  check('SKILL.md files are present', skills.length > 0, `${skills.length} found`)
  const git = files.filter((f) => f.path.startsWith('.git/'))
  check('a .git directory was not invented', git.length === 0)
  const sample = skills[0]
  check('the first SKILL.md decodes as text', decodeText(sample.bytes).encoding === 'utf8', sample?.path)
}

/* ------------------------------------------------------------------ verdict */

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
