/**
 * Verify that every source's declared sort keys actually order the list.
 *
 * This is a regression guard: three adapters (repos / anthropic / dsh) used to
 * declare `sorts` without ever reading the parameter, so the UI's sort dropdown
 * silently did nothing and the DSH pack list fell back to upstream JSON order.
 *
 *   node docs/check-sorts.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSources } from '../lib/sources.js'
import { JsonCache } from '../lib/net.js'

const dir = mkdtempSync(join(tmpdir(), 'skill-center-sorts-'))
const sources = createSources({ cache: new JsonCache(dir), config: {} })

/** Walk `browse` pages until the source stops returning rows. */
async function collect(id, sort, { pages = 6, limit = 100 } = {}) {
  const rows = []
  for (let page = 0; page < pages; page += 1) {
    const result = await sources.get(id).browse({ q: '', sort, page, limit })
    rows.push(...result.items)
    if (result.items.length < limit) break
  }
  // A cold cache can hand back an empty first page while the upstream document
  // is still being fetched; one retry is enough to tell that apart from a
  // genuinely empty source.
  if (rows.length === 0) {
    const retry = await sources.get(id).browse({ q: '', sort, page: 0, limit })
    rows.push(...retry.items)
  }
  return rows
}

// Strings compare the way `applySort` compares them (`localeCompare`), not by
// code unit — otherwise "0xfauzi" vs "0xMassi" looks like a broken sort.
const compare = (a, b) => (typeof a === 'string' || typeof b === 'string'
  ? String(a).localeCompare(String(b))
  : a - b)
const descending = (values) => values.every((value, index) => index === 0 || compare(values[index - 1], value) >= 0)
const ascending = (values) => values.every((value, index) => index === 0 || compare(values[index - 1], value) <= 0)

const cases = [
  { id: 'dsh', sort: 'stars', pick: (row) => row.stars, order: 'desc' },
  { id: 'dsh', sort: 'downloads', pick: (row) => row.installs, order: 'desc' },
  { id: 'repos', sort: 'skills', pick: (row) => row.extra?.skills, order: 'desc' },
  { id: 'repos', sort: 'name', pick: (row) => row.repo, order: 'asc' },
  { id: 'anthropic', sort: 'name', pick: (row) => row.name, order: 'asc' },
]

let failures = 0
for (const test of cases) {
  let rows
  try {
    rows = await collect(test.id, test.sort)
  } catch (error) {
    console.log(`  FAIL ${test.id}/${test.sort} — ${error.message}`)
    failures += 1
    continue
  }
  const values = rows.map(test.pick).filter((value) => value !== undefined)
  const ordered = test.order === 'desc' ? descending(values) : ascending(values)
  const sample = values.slice(0, 6).join(', ')
  if (ordered) {
    console.log(`  ok   ${test.id}/${test.sort} — ${values.length} rows, first: ${sample}`)
  } else {
    console.log(`  FAIL ${test.id}/${test.sort} — not ${test.order}: ${values.slice(0, 12).join(', ')}`)
    failures += 1
  }
}

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? 'All checks passed.' : `${failures} problem(s).`)
process.exit(failures === 0 ? 0 : 1)
