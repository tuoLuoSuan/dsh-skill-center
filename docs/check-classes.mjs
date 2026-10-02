/**
 * Guard against stylesheet drift.
 *
 * Collects every `sc-` class the bundle defines, every one it actually renders
 * into `docs/preview/*.html`, and every `sc-` string that appears anywhere in
 * the source. A class that is written but never defined is a silent no-op in
 * the browser, which is exactly the kind of regression screenshots miss.
 *
 *   node docs/check-classes.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client', 'client.js'), 'utf8')

const cssStart = source.indexOf('const CSS = ')
const cssEnd = source.indexOf('\n`\n', cssStart)
const css = source.slice(cssStart, cssEnd === -1 ? undefined : cssEnd)

const defined = new Set([...css.matchAll(/\.(sc-[A-Za-z0-9_-]+)/g)].map((m) => m[1]))
const referenced = new Set([...source.matchAll(/'(sc-[A-Za-z0-9_-]+)'/g)].map((m) => m[1]))

const previewDir = join(here, 'preview')
const rendered = new Set()
if (existsSync(previewDir)) {
  for (const file of readdirSync(previewDir)) {
    if (!file.endsWith('.html')) continue
    const page = readFileSync(join(previewDir, file), 'utf8')
    for (const match of page.matchAll(/class="([^"]*)"/g)) {
      for (const name of match[1].split(/\s+/)) if (name.startsWith('sc-')) rendered.add(name)
    }
  }
}

const report = (label, missing) => {
  if (missing.length === 0) {
    console.log(`  ok   ${label} — none`)
    return 0
  }
  console.log(`  FAIL ${label} — ${missing.join(', ')}`)
  return missing.length
}

let failures = 0
console.log(`[classes] ${defined.size} defined, ${referenced.size} referenced, ${rendered.size} rendered`)
failures += report('referenced but never defined', [...referenced].filter((c) => !defined.has(c)).sort())
failures += report('rendered but never defined', [...rendered].filter((c) => !defined.has(c)).sort())

const unused = [...defined].filter((c) => !referenced.has(c) && !rendered.has(c)).sort()
console.log(`  note unused in source and preview — ${unused.length === 0 ? 'none' : unused.join(', ')}`)

console.log(failures === 0 ? 'All checks passed.' : `${failures} problem(s).`)
process.exit(failures === 0 ? 0 : 1)
