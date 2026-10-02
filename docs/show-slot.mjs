// Print one or more slots from a catalog produced by extract-slot-catalog.mjs.
//
//   node docs/extract-slot-catalog.mjs <.../dsh-cordis-client-runner/lib/client.js>
//   node docs/show-slot.mjs                      # every slot
//   node docs/show-slot.mjs sidebar.footer.action # just the ones you name
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const catalog = join(here, process.env.SKILL_CENTER_SLOT_CATALOG ?? 'slot-catalog.json')
if (!existsSync(catalog)) {
  console.error(`${catalog} not found.`)
  console.error('Generate it first: node docs/extract-slot-catalog.mjs <path to dsh-cordis-client-runner/lib/client.js>')
  process.exit(2)
}
const slots = JSON.parse(readFileSync(catalog, 'utf8'))
const want = process.argv.slice(2)
for (const s of slots) {
  if (want.length && !want.includes(s.key)) continue
  console.log('='.repeat(100))
  console.log(`KEY: ${s.key}   kind=${s.kind}  scope=${s.scope}  replaceRisk=${s.replaceRisk}`)
  console.log(`declaredBy: ${s.declaredBy}`)
  console.log(`source: ${s.source}`)
  console.log(`summary: ${s.summary}`)
  if (s.doc && s.doc !== s.summary) console.log(`doc: ${s.doc}`)
  console.log(`registerOptions: ${JSON.stringify(s.registerOptions)}`)
  if (s.keyDomain) console.log(`keyDomain: ${s.keyDomain}`)
  if (s.hookContext) console.log(`hookContext: ${s.hookContext}`)
  if (s.slotInject) console.log(`slotInject: ${s.slotInject}`)
  console.log(`ownerProps: ${JSON.stringify(s.ownerProps)}`)
  if ((s.ownerPropsReferences || []).length) console.log(`ownerPropsReferences: ${JSON.stringify(s.ownerPropsReferences)}`)
  console.log(`standardProps: ${JSON.stringify(s.standardProps)}`)
  console.log(`occupants: ${JSON.stringify(s.occupants)}`)
  console.log(`example:\n${s.example}`)
}
