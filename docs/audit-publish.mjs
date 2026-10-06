/**
 * Publication pre-flight.
 *
 * Two things a public commit should never carry: the author's Windows account
 * name (fixture paths are rendered straight into screenshots) and absolute
 * paths that only resolve on one machine.
 *
 * Read-only. Exits non-zero if anything needs attention, so it can gate a
 * release. Run it before pushing.
 */
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', '.git', 'preview', 'screenshots'])
// Scratch files are never published (`.tmp*` is in .gitignore), so they must not
// be able to fail a release gate.
const SKIP_FILES = /^\.tmp/
const TEXT = /\.(?:mjs|js|json|md|yml|yaml|css|svg|txt)$/

// Fixture homes are fine as long as they are obviously nobody's real home.
const PLACEHOLDER_ACCOUNTS = new Set(['you', 'user', 'me', 'example', 'someone'])

// Paths that may legitimately be absolute:
//   - fixture homes, which are display-only strings nobody ever touches
//   - browser executables, which are inherently machine-specific and probed
const PLACEHOLDER_PREFIX = new RegExp(
  `^[A-Za-z]:[\\\\/]+Users[\\\\/]+(?:${[...PLACEHOLDER_ACCOUNTS].join('|')})[\\\\/]`,
  'i',
)
const ALLOWED_ABSOLUTE = [
  PLACEHOLDER_PREFIX,
  // `D:\path\to\thing` is the canonical "put your own path here" placeholder
  // and cannot name anybody's real directory.
  /^[A-Za-z]:[\\/]+path[\\/]+to[\\/]/i,
  /^\/path\/to\//i,
  // The scan stops at whitespace, so `C:\Program Files\...` arrives truncated.
  /^[A-Za-z]:[\\/]+Program/,
  /^[A-Za-z]:[\\/]+Program Files(?: \(x86\))?[\\/]/i,
  /^\/usr\/(?:bin|local)\//,
]

const NOTE = `This file names a real Windows account. Fixture paths must use one of:
  ${[...PLACEHOLDER_ACCOUNTS].join(', ')}`

async function walk(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.test(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...await walk(path))
    else if (TEXT.test(entry.name)) found.push(path)
  }
  return found
}

const files = await walk(ROOT)
const accounts = []
const absolutes = []

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const label = relative(ROOT, file).split(sep).join('/')

  for (const match of text.matchAll(/Users[\\/]+([A-Za-z0-9._-]+)/g)) {
    if (!PLACEHOLDER_ACCOUNTS.has(match[1].toLowerCase())) {
      accounts.push(`${label}: Users${match[0][5]}${match[1]}   — ${NOTE}`)
    }
  }

  // `https://x` starts with `s:` which looks like a drive letter; require a
  // backslash or a forward slash that is not part of a scheme.
  for (const match of text.matchAll(/(?<![A-Za-z])([A-Za-z]:[\\/][^'"`\s)]{3,})/g)) {
    if (ALLOWED_ABSOLUTE.some((allowed) => allowed.test(match[1]))) continue
    absolutes.push(`${label}: ${match[1]}`)
  }
}

console.log(`scanned ${files.length} text files under ${ROOT}`)
console.log(`\nreal account names in fixture paths: ${accounts.length}`)
for (const line of new Set(accounts)) console.log('  ' + line)
console.log(`\nabsolute paths: ${absolutes.length}`)
for (const line of new Set(absolutes)) console.log('  ' + line)

if (accounts.length > 0 || absolutes.length > 0) {
  console.log('\nreview the lines above before publishing.')
  process.exitCode = 1
} else {
  console.log('\nnothing machine-specific found.')
}
