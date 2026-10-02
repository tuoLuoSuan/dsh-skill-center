import { discoverAgentSkills, markCollisions } from '../lib/agents.js'
import { resolveDshHome, scanInstalled } from '../lib/skills-dir.js'

const home = resolveDshHome()
const { skills } = await scanInstalled(home)
const groups = markCollisions(await discoverAgentSkills({ cwd: process.cwd() }), skills.map(s => s.name))
let hidden = 0, dupes = 0, broken = 0
for (const g of groups) {
  if (!g.exists) { console.log(`${g.id.padEnd(17)} ${g.label}  — 不存在`); continue }
  const h = g.skills.filter(s => !g.visible)
  hidden += h.length
  dupes += g.skills.filter(s => s.collision).length
  broken += g.skills.filter(s => !s.valid).length
  console.log(`${g.id.padEnd(17)} ${g.label.padEnd(28)} ${String(g.skills.length).padStart(3)} 个  visible=${g.visible}  未装=${g.skills.filter(s=>!s.installed).length}  重名=${g.skills.filter(s=>s.collision).length}  不合规=${g.skills.filter(s=>!s.valid).length}`)
}
console.log(`\n合计：DSH 看不见的 ${hidden} 个；重名冲突 ${dupes} 个；按现状会被 DSH 忽略的 ${broken} 个`)
console.log('\n会出问题的：')
for (const g of groups) for (const s of g.skills) if (!s.valid) console.log(`  ${g.id}/${s.name} → ${s.problems.map(p=>p.code).join(',')}  suggested=${s.suggestedName}`)
