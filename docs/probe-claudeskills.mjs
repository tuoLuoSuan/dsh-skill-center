const UA = 'dsh-skill-center-probe/0.1'
const J = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) })
  const t = await r.text()
  try { return { s: r.status, j: JSON.parse(t) } } catch { return { s: r.status, t: t.slice(0, 400) } }
}

console.log('--- meta full ---')
const meta = await J('https://claudeskills.info/api/v1/meta')
console.log(JSON.stringify(meta.j, null, 1).slice(0, 2600))

console.log('\n--- browse without q, type=skill, limit=5 ---')
const b = await J('https://claudeskills.info/api/v1/search?type=skill&limit=5&sort=stars')
console.log('total=', b.j.total, 'returned=', b.j.results.length)

console.log('\n--- offset probe (deep pagination) ---')
for (const off of [0, 1000, 5000, 10000, 40000]) {
  const r = await J(`https://claudeskills.info/api/v1/search?type=skill&limit=100&offset=${off}&sort=stars`)
  console.log(` offset=${String(off).padStart(6)} status=${r.s} total=${r.j?.total} returned=${r.j?.results?.length} first=${r.j?.results?.[0]?.slug ?? '-'}`)
}

console.log('\n--- limit clamp probe ---')
for (const lim of [100, 200, 1000]) {
  const r = await J(`https://claudeskills.info/api/v1/search?type=skill&limit=${lim}&offset=0`)
  console.log(` limit=${String(lim).padStart(5)} -> returned=${r.j?.results?.length} (total=${r.j?.total})`)
}

console.log('\n--- component types (non-skill) enumeration ---')
for (const ty of ['plugin', 'subagent', 'command', 'hook']) {
  const r = await J(`https://claudeskills.info/api/v1/search?type=${ty}&limit=3`)
  console.log(` ${ty.padEnd(10)} total=${r.j?.total} sample=${JSON.stringify(r.j?.results?.[0])?.slice(0, 240)}`)
}

console.log('\n--- item detail ---')
const d = await J('https://claudeskills.info/api/v1/items/clawdis-summarize')
console.log('status', d.s, JSON.stringify(d.j).slice(0, 900))

console.log('\n--- query probe ---')
for (const q of ['pdf', 'data', 'review', '论文']) {
  const r = await J(`https://claudeskills.info/api/v1/search?q=${encodeURIComponent(q)}&limit=3`)
  console.log(` q=${q.padEnd(8)} total=${r.j?.total} first=${r.j?.results?.[0]?.name}`)
}
