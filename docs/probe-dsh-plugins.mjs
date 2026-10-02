// Probe the DSH plugin registry for anything that already does skill browsing.
// The registry is a single 4.8MB JSON document; filter it locally instead of
// guessing at search endpoints. `description` is an i18n map, not a string.
import { writeFileSync } from 'node:fs'

const REGISTRY = 'https://awesome-dsh-plugin.com/plugins.json'

const out = []
const log = (line = '') => { out.push(line); process.stdout.write(`${line}\n`) }

const response = await fetch(REGISTRY, { headers: { 'user-agent': 'dsh-skill-center-probe' } })
if (!response.ok) {
  console.error(`fetch failed: ${response.status}`)
  process.exit(1)
}
const payload = await response.json()
const entries = payload.plugins ?? []
log(`total entries: ${entries.length}`)

const text = (value) => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return Object.values(value).filter((v) => typeof v === 'string').join(' / ')
  return ''
}

// Anything whose *purpose* is browsing/managing a skill collection — as opposed
// to a plugin that merely ships skills as content.
const BROWSER = /skill[-_ ]?(picker|hub|browser|gallery|manager|radar|port|center|centre|market|store|explore|organiz|deck|board|cheat)/i
const matches = entries.filter((entry) => BROWSER.test(`${entry.name} ${entry.npm ?? ''}`))

log(`\n=== ${matches.length} skill-browsing / skill-managing plugins ===`)
for (const entry of matches) {
  log(`\n## ${entry.name}   [${entry.category}]  ↓${entry.downloads ?? '-'}  ★${entry.stars ?? '-'}`)
  log(`   repo: ${entry.url ?? '-'}`)
  log(`   npm:  ${entry.npm ?? '-'}  v${entry.version ?? '-'}`)
  log(`   page: ${entry.page ?? '-'}`)
  log(`   ${text(entry.description).replace(/\s+/g, ' ').slice(0, 420)}`)
  if (entry.capabilities) log(`   capabilities: ${text(entry.capabilities).replace(/\s+/g, ' ').slice(0, 200)}`)
}

// How much of the ecosystem is skill-flavoured at all.
const byCategory = new Map()
for (const entry of entries) {
  const key = entry.category ?? '(none)'
  byCategory.set(key, (byCategory.get(key) ?? 0) + 1)
}
log('\n=== categories ===')
for (const [key, count] of [...byCategory].sort((a, b) => b[1] - a[1])) {
  log(`${String(count).padStart(5)}  ${key}`)
}

writeFileSync(new URL('./probe-dsh-plugins.txt', import.meta.url), out.join('\n'), 'utf8')
