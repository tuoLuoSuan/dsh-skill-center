// Compare @deepseek-ai package inventories between the extracted 0.2.0-rc.2 tree and the stale 0.1.5-rc.3 profile tree.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function scan(root) {
  const out = new Map()
  if (!existsSync(root)) return out
  for (const name of readdirSync(root)) {
    const pkg = join(root, name, 'package.json')
    if (!existsSync(pkg)) continue
    try {
      const json = JSON.parse(readFileSync(pkg, 'utf8'))
      out.set(name, { version: json.version ?? '?', json })
    } catch {
      out.set(name, { version: '<unparseable>', json: null })
    }
  }
  return out
}

const newRoot = process.argv[2]
const oldRoot = process.argv[3]
const a = scan(newRoot)
const b = scan(oldRoot)

console.log(`0.2.0-rc.2 packages: ${a.size}   stale-tree packages: ${b.size}`)
console.log('\n=== ONLY IN 0.2.0-rc.2 (new) ===')
for (const k of [...a.keys()].sort()) if (!b.has(k)) console.log(`  + ${k}@${a.get(k).version}`)
console.log('\n=== ONLY IN STALE TREE (removed/renamed) ===')
for (const k of [...b.keys()].sort()) if (!a.has(k)) console.log(`  - ${k}@${b.get(k).version}`)
console.log('\n=== IN BOTH, VERSION DIFFERS ===')
for (const k of [...a.keys()].sort()) {
  if (!b.has(k)) continue
  if (a.get(k).version !== b.get(k).version) console.log(`  ~ ${k}: ${b.get(k).version} -> ${a.get(k).version}`)
}
console.log('\n=== IN BOTH, SAME VERSION (count) ===')
let same = 0
for (const k of a.keys()) if (b.has(k) && a.get(k).version === b.get(k).version) same += 1
console.log(`  ${same}`)
