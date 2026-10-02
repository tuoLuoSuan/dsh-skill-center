const UA = 'dsh-skill-center-probe/0.1'
const get = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) })
  return { status: r.status, text: await r.text() }
}

// ---------- 1. awesome-claude-skills markdown table ----------
const md = await get('https://raw.githubusercontent.com/Chat2AnyLLM/awesome-claude-skills/main/README.md')
const lines = md.text.split('\n')
const rows = lines.filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
console.log('== awesome-claude-skills ==')
console.log('total pipe-lines:', rows.length)
console.log('header:', rows[0]?.trim())
for (const r of rows.slice(1, 4)) console.log('row:', r.trim().slice(0, 200))
const parsed = rows.slice(1).map((l) => l.split('|').map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === '')))
const withPath = parsed.filter((c) => c.length >= 5)
console.log('parsed rows:', parsed.length, 'cols histogram:', JSON.stringify(parsed.reduce((a, c) => ((a[c.length] = (a[c.length] || 0) + 1), a), {})))
console.log('rows with >=5 cols:', withPath.length, 'sample:', JSON.stringify(withPath[0]))
// how many mention SKILL/status healthy
console.log('status words:', JSON.stringify(withPath.reduce((a, c) => { const k = c[4] || '?'; a[k] = (a[k] || 0) + 1; return a }, {})))

// ---------- 2. anthropics/skills enumeration via HTML tree ----------
console.log('\n== anthropics/skills HTML tree ==')
const html = await get('https://github.com/anthropics/skills/tree/main/skills')
console.log('status', html.status, 'bytes', html.text.length)
const embedded = html.text.match(/<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/)
if (embedded) {
  try {
    const data = JSON.parse(embedded[1])
    const items = data?.payload?.tree?.items
    console.log('embeddedData OK; tree items:', Array.isArray(items) ? items.length : 'none')
    if (Array.isArray(items)) console.log('names:', items.slice(0, 30).map((i) => `${i.name}(${i.contentType})`).join(', '))
  } catch (e) { console.log('embeddedData JSON parse failed:', e.message) }
} else {
  console.log('no embeddedData script found')
}
const hrefs = [...html.text.matchAll(/href="\/anthropics\/skills\/tree\/main\/skills\/([^"?#]+)"/g)].map((m) => decodeURIComponent(m[1]))
console.log('href matches:', hrefs.length, 'unique:', [...new Set(hrefs)].length)
console.log('sample:', [...new Set(hrefs)].slice(0, 25).join(', '))

// ---------- 3. anthropics/skills README skill listing ----------
console.log('\n== anthropics/skills README ==')
const rm = await get('https://raw.githubusercontent.com/anthropics/skills/main/README.md')
const rmLinks = [...rm.text.matchAll(/skills\/([a-z0-9-]+)\//g)].map((m) => m[1])
console.log('skill links in README:', [...new Set(rmLinks)].join(', '))
