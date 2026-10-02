// Probe every candidate skill source from THIS machine, through the same
// global fetch the plugin will use. Prints status + shape for each.
const UA = 'dsh-skill-center-probe/0.1 (+https://github.com/)'

async function probe(label, url, opts = {}) {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: opts.accept ?? 'application/json,text/plain,*/*' },
      signal: AbortSignal.timeout(opts.timeout ?? 15000),
    })
    const text = await res.text()
    const ms = Date.now() - started
    let head = text.slice(0, opts.preview ?? 320).replace(/\s+/g, ' ')
    console.log(`[${res.status}] ${label} (${ms}ms, ${text.length}B)`)
    console.log(`      ${head}`)
    return { ok: res.ok, status: res.status, text }
  } catch (err) {
    console.log(`[ERR] ${label} :: ${err.name}: ${err.message}`)
    return { ok: false, error: String(err) }
  }
}

const targets = [
  ['claudeskills meta', 'https://claudeskills.info/api/v1/meta'],
  ['claudeskills search', 'https://claudeskills.info/api/v1/search?type=skill&limit=2&sort=stars'],
  ['skillsmp search', 'https://skillsmp.com/api/v1/skills/search?q=pdf&limit=2'],
  ['awesome-claude-skills README', 'https://raw.githubusercontent.com/Chat2AnyLLM/awesome-claude-skills/main/README.md', { accept: 'text/plain', preview: 200 }],
  ['anthropics/skills pdf SKILL.md', 'https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md', { accept: 'text/plain', preview: 200 }],
  ['anthropics/skills README', 'https://raw.githubusercontent.com/anthropics/skills/main/README.md', { accept: 'text/plain', preview: 200 }],
  ['agentskills README', 'https://raw.githubusercontent.com/agentskills/agentskills/main/README.md', { accept: 'text/plain', preview: 160 }],
  ['awesome-dsh-plugin plugins.json', 'https://awesome-dsh-plugin.com/plugins.json', { preview: 200 }],
  ['github api rate_limit', 'https://api.github.com/rate_limit'],
  ['github tree anthropics/skills', 'https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1', { preview: 200 }],
  ['github html tree page', 'https://github.com/anthropics/skills/tree/main/skills', { accept: 'text/html', preview: 200 }],
  ['skills.sh homepage', 'https://www.skills.sh', { accept: 'text/html', preview: 200 }],
  ['agentskills.io spec', 'https://agentskills.io/specification', { accept: 'text/html', preview: 160 }],
]

for (const [label, url, opts] of targets) {
  await probe(label, url, opts)
  console.log('')
}
