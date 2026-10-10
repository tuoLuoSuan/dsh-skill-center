/**
 * Headless smoke test for the host half.
 *
 * Boots `apply()` against a stub cordis context, wires the captured route
 * handler into a real node:http server on a loopback port, then drives the
 * whole API the way the browser half does. Writes into a throwaway harness
 * home, so a run never touches the real `~/.dsh/skills`.
 *
 * Usage: node docs/smoke-host.mjs
 */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const home = await mkdtemp(join(tmpdir(), 'skill-center-home-'))
// A stand-in for `~/.claude`, so the importer is tested against fixtures
// instead of whatever happens to be on the machine running this.
const agentHome = await mkdtemp(join(tmpdir(), 'skill-center-agents-'))
const foreignSkills = join(home, 'foreign-skills')
let handler
let registered

// Three shapes the importer has to tell apart: already legal, fixable by
// rewriting `name:`, and unfixable because there is no frontmatter at all.
await mkdir(join(foreignSkills, 'tidy-helper'), { recursive: true })
await writeFile(join(foreignSkills, 'tidy-helper', 'SKILL.md'), '---\nname: tidy-helper\ndescription: Tidy up a directory listing before showing it.\n---\n\n# Tidy helper\n\nSort and group files.\n')
await mkdir(join(foreignSkills, 'Badly_Named'), { recursive: true })
await writeFile(join(foreignSkills, 'Badly_Named', 'SKILL.md'), '---\nname: Badly_Named\ndescription: A skill whose name the harness would reject.\n---\n\n# Badly named\n')
await mkdir(join(foreignSkills, 'no-frontmatter'), { recursive: true })
await writeFile(join(foreignSkills, 'no-frontmatter', 'SKILL.md'), '# Not a skill\n\nThis is a README that happens to be called SKILL.md.\n')

const hostCtx = {
  webServer: {
    register(route) {
      registered = route
      handler = route.handler
      return () => {
        handler = undefined
      }
    },
  },
  effect(callback) {
    return callback()
  },
}

const ctx = {
  logger: { info: (m) => console.log(`  info  ${m}`), warn: (m) => console.log(`  warn  ${m}`) },
  inject(names, callback) {
    callback(hostCtx)
  },
}

apply(ctx, { dshHome: home, agentHome, extraSkillPaths: [foreignSkills] })

if (handler === undefined) throw new Error('the plugin registered no route')
console.log(`route: ${registered.kind} ${registered.path}`)

const server = createServer((request, response) => {
  void handler(request, response)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}/dsh-skill-center/api`

const get = async (route) => {
  const response = await fetch(`${base}${route}`, { cache: 'no-store' })
  const body = await response.json().catch(() => undefined)
  return { status: response.status, body }
}
const post = async (route, payload) => {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify(payload ?? {}),
  })
  const body = await response.json().catch(() => undefined)
  return { status: response.status, body }
}

let failures = 0
const check = (label, condition, detail) => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!condition) failures += 1
}

try {
  console.log('\n[sources]')
  const sources = await get('/sources')
  check('GET /sources → 200', sources.status === 200, `status ${sources.status}`)
  check('five source descriptors', (sources.body?.sources ?? []).length === 5, (sources.body?.sources ?? []).map((s) => s.id).join(','))
  const categories = sources.body?.taxonomy?.categories ?? []
  // An empty taxonomy means the registry did not answer inside the source's own
  // 15s window, which says nothing about this plugin. Ask the same endpoint
  // directly before blaming the code: if that fails too, it is the network, and
  // failing the run would make this suite report on the weather.
  if (categories.length > 10) {
    check('taxonomy carries categories', true, `${categories.length} categories`)
  } else {
    let reachable = false
    try {
      const direct = await fetch('https://claudeskills.info/api/v1/meta', { signal: AbortSignal.timeout(30000) })
      reachable = direct.ok && ((await direct.json())?.categories ?? []).length > 10
    } catch { reachable = false }
    if (reachable) {
      check('taxonomy carries categories', false, `${categories.length} categories, though the endpoint answers — the source failed to read it`)
    } else {
      console.log('  skip  taxonomy carries categories — the registry did not answer at all')
    }
  }
  check('user root is under the temp home', String(sources.body?.userRoot ?? '').startsWith(home), sources.body?.userRoot)

  console.log('\n[list: primary registry]')
  const list = await get('/list?source=claudeskills&limit=5')
  check('GET /list → 200', list.status === 200, `status ${list.status}`)
  check('items returned', (list.body?.items ?? []).length > 0, `${(list.body?.items ?? []).length} items, total ${list.body?.total}`)
  const first = list.body?.items?.[0]
  check('item shape', typeof first?.key === 'string' && typeof first?.name === 'string' && typeof first?.source === 'string',
    first === undefined ? 'none' : `${first.source} | ${first.name} | ${first.url ?? 'no url'}`)

  console.log('\n[list: official + community + dsh]')
  // Each of these reads a different upstream, so an empty page means either the
  // adapter broke or that upstream is having a bad day. Those are different
  // verdicts and only one of them is about this plugin, so ask the upstream
  // directly before failing the run.
  const UPSTREAM = {
    anthropic: 'https://github.com/anthropics/skills/tree/main/skills',
    repos: 'https://raw.githubusercontent.com/Chat2AnyLLM/awesome-claude-skills/main/README.md',
    dsh: 'https://awesome-dsh-plugin.com/plugins.json',
  }
  for (const [sourceId, min] of [['anthropic', 1], ['repos', 1], ['dsh', 1]]) {
    const page = await get(`/list?source=${sourceId}&limit=3`)
    const got = (page.body?.items ?? []).length
    if (got >= min) {
      check(`${sourceId} → items`, true, `total ${page.body?.total}, status ${page.status}`)
      continue
    }
    let reachable = false
    try {
      const direct = await fetch(UPSTREAM[sourceId], { signal: AbortSignal.timeout(30000) })
      reachable = direct.ok
    } catch { reachable = false }
    if (reachable) {
      check(`${sourceId} → items`, false, `total ${page.body?.total}, status ${page.status}, though ${UPSTREAM[sourceId]} answers`)
    } else {
      console.log(`  skip  ${sourceId} → items — ${UPSTREAM[sourceId]} did not answer`)
    }
  }

  console.log('\n[list: search]')
  const search = await get(`/list?source=claudeskills&q=${encodeURIComponent('pdf')}&limit=3`)
  check('keyword search', (search.body?.items ?? []).length > 0, `total ${search.body?.total}`)
  const chinese = await get(`/list?source=claudeskills&q=${encodeURIComponent('论文')}&limit=3`)
  check('chinese keyword search', chinese.status === 200, `total ${chinese.body?.total}`)

  console.log('\n[detail + preview + install]')
  const official = await get('/list?source=anthropic&limit=25')
  const target = (official.body?.items ?? []).find((item) => item.name === 'pdf') ?? (official.body?.items ?? [])[0]
  check('found an installable official skill', target !== undefined, target?.name)
  if (target !== undefined) {
    const detail = await post('/item', { entry: target })
    check('POST /item → 200', detail.status === 200, `status ${detail.status}`)
    check('SKILL.md text retrieved', typeof detail.body?.skillText === 'string' && detail.body.skillText.length > 100, `${detail.body?.skillText?.length ?? 0} chars`)

    const preview = await post('/preview', { entry: target })
    check('POST /preview → 200', preview.status === 200, `status ${preview.status}`)
    check('preview lists SKILL.md', (preview.body?.files ?? []).some((file) => file.path === 'SKILL.md'),
      (preview.body?.files ?? []).map((file) => file.path).slice(0, 6).join(', '))
    check('preview suggests a valid name', /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(preview.body?.suggestedName ?? '')), preview.body?.suggestedName ?? '(none)')

    // A truncated fetch is the one failure the user cannot see: the skill
    // installs cleanly and is missing the script its own SKILL.md refers to.
    const shape = preview.body?.completeness
    check('preview reports whether the fetch was complete', shape?.complete === true,
      `complete=${shape?.complete} files=${shape?.fileCount} skipped=${shape?.skippedCount ?? 0} ${(shape?.reasons ?? []).map((reason) => reason.reason).join(',')}`)
    const refs = preview.body?.references
    // Prose mentions such as "see REFERENCE.md" are deliberately not counted —
    // only markdown links and inline code, or this would fire on every skill.
    check('preview accounts for every reference it parsed',
      typeof refs?.referenced === 'number' && refs.present + refs.missingCount === refs.referenced,
      `${refs?.referenced} referenced, ${refs?.present} present, ${refs?.missingCount} missing`)
    check('preview reports no conflict before the first install', preview.body?.conflict?.exists === false,
      JSON.stringify(preview.body?.conflict))

    // Reading a skill at a commit rather than at a branch is the difference
    // between "this is what upstream had when I looked" and "this is what
    // upstream has whenever the CDN last refreshed". The revision API can be
    // unavailable though, and an install must still work then — so what is
    // asserted is that the answer is *consistent*, whichever way it went.
    const revision = preview.body?.revision
    check('preview reports which revision route it took', revision?.fetchedVia === 'tarball' || revision?.fetchedVia === 'crawl',
      `via ${revision?.fetchedVia}`)
    // Pinned means one thing: the files were read from the commit that is named.
    // Both routes can honour that — the crawl route reads a commit too when it
    // has one — so it is a property of the answer, not of the transport.
    check('a preview is pinned exactly when it names a commit',
      (revision?.pinned === true) === (typeof revision?.commit === 'string' && revision.commit !== ''),
      JSON.stringify(revision))
    if (revision?.pinned === true) {
      check('a pinned preview names a 40-hex commit', /^[0-9a-f]{40}$/.test(String(revision.commit ?? '')), revision.commit)
      check('a pinned preview carries the commit date', typeof revision.committedAt === 'string' && revision.committedAt !== '', revision.committedAt)
    } else {
      // The honest half: when the revision could not be resolved, nothing may
      // claim to be pinned, and the pane has something to say about it.
      check('an unpinned preview claims no commit', revision?.commit === undefined || revision?.commit === null, JSON.stringify(revision))
      check('an unpinned preview admits the branch was read', revision?.fetchedVia === 'crawl', revision?.fetchedVia)
    }

    const install = await post('/install', { entry: target })
    check('POST /install → 200', install.status === 200, install.body?.error ?? install.body?.directory)
    check('installed name is grammar-valid', /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(install.body?.name ?? '')), install.body?.name)
    // The revision API can answer for one of these two calls and not the other:
    // `resolveCommit` is deliberately uncached, gives the API 15s and no
    // retries, and swallows any failure into `undefined`. So the preview and the
    // install are two independent readings of a moving target, and only one
    // combination is a real contradiction -- two different commits. Silence on
    // either side is that call's honest report of what it could find out, in
    // both directions: the install knowing more than the preview is the API
    // coming back, and knowing less is the API going away. Neither is a lie, and
    // treating either as one makes this probe report the weather.
    const previewCommit = typeof revision?.commit === 'string' && revision.commit !== '' ? revision.commit : undefined
    check('the install never disagrees with the preview about the commit',
      previewCommit === undefined || install.body?.commit === undefined || install.body.commit === previewCommit.slice(0, 7),
      `install ${install.body?.commit ?? '(none)'} vs preview ${revision?.commit ?? '(none)'}`)
    check('the install is pinned exactly when it names a commit',
      (install.body?.pinned === true) === (typeof install.body?.commit === 'string' && install.body.commit !== ''),
      `pinned ${install.body?.pinned} commit ${install.body?.commit}`)

    const conflict = await post('/preview', { entry: target })
    check('preview now reports the name is taken', conflict.body?.conflict?.exists === true, JSON.stringify(conflict.body?.conflict))
    check('the occupant is recognised as the same upstream entry', conflict.body?.conflict?.sameSource === true,
      `existing source ${conflict.body?.conflict?.existingSource}`)
    check('a free alternative name is offered', String(conflict.body?.conflict?.renameTo ?? '').startsWith(`${install.body?.name}-`),
      conflict.body?.conflict?.renameTo)

    const overwrite = await post('/install', { entry: target })
    check('installing over it is refused by default', overwrite.status === 409 && overwrite.body?.conflict?.exists === true,
      `status ${overwrite.status} — ${overwrite.body?.error}`)
    const skip = await post('/install', { entry: target, conflict: 'skip' })
    check('conflict=skip installs nothing', skip.status === 200 && skip.body?.skipped === true, `status ${skip.status} skipped=${skip.body?.skipped}`)
    const renamed = await post('/install', { entry: target, conflict: 'rename' })
    check('conflict=rename lands under the offered name', renamed.status === 200 && renamed.body?.name === conflict.body?.conflict?.renameTo,
      `${renamed.body?.name} (from ${renamed.body?.renamedFrom})`)
    const replaced = await post('/install', { entry: target, conflict: 'replace' })
    check('conflict=replace keeps a backup of what it displaced',
      replaced.status === 200 && typeof replaced.body?.backup === 'string' && replaced.body.backup !== '',
      `status ${replaced.status} — ${replaced.body?.error ?? ''} backup ${replaced.body?.backup}`)
    const visible = ((await get('/installed')).body?.skills ?? []).map((skill) => skill.name)
    check('neither the backup nor the trash shows up as a skill',
      visible.filter((name) => name.startsWith('.')).length === 0 && visible.includes(install.body?.name) && visible.includes(renamed.body?.name),
      visible.join(', '))
    // Leave the fixture as the later blocks expect it: one copy of the target.
    await post('/remove', { name: renamed.body?.name, permanent: true })

    const installed = await get('/installed')
    const names = (installed.body?.skills ?? []).map((skill) => skill.name)
    check('skill appears in /installed', names.includes(install.body?.name), names.join(', '))
    const record = (installed.body?.skills ?? []).find((skill) => skill.name === install.body?.name)
    check('installed record is valid with a description', record?.valid === true && (record?.description ?? '').length > 0,
      `${record?.fileCount ?? 0} files · ${(record?.description ?? '').slice(0, 60)}…`)

    const document = await post('/read', { name: install.body?.name })
    check('POST /read → document', document.status === 200 && typeof document.body?.raw === 'string', `status ${document.status}`)

    const remove = await post('/remove', { name: install.body?.name })
    check('POST /remove → 200', remove.status === 200, remove.body?.error ?? remove.body?.directory)
    const after = await get('/installed')
    check('skill gone after remove', !(after.body?.skills ?? []).some((skill) => skill.name === install.body?.name))

    console.log('\n[trash: a delete is recoverable]')
    check('the removal landed in the trash', (after.body?.trash ?? 0) >= 1, `trash count ${after.body?.trash}`)
    const trash = await get('/trash')
    const bucket = (trash.body?.items ?? []).find((item) => item.name === install.body?.name)
    check('GET /trash lists it', bucket !== undefined, (trash.body?.items ?? []).map((item) => item.name).join(', '))
    check('the trash entry kept its provenance', bucket?.source === target.source, `${bucket?.source} / ${bucket?.trashedAt}`)
    const restore = await post('/restore', { bucket: bucket?.bucket })
    check('POST /restore → 200', restore.status === 200, restore.body?.error ?? restore.body?.directory)
    const restored = await get('/installed')
    check('the skill is back after restore', (restored.body?.skills ?? []).some((skill) => skill.name === install.body?.name))
    check('the restore did not leave a second copy in the trash', (restored.body?.trash ?? 0) === 0, `trash count ${restored.body?.trash}`)

    console.log('\n[provenance + update check]')
    const managed = (restored.body?.skills ?? []).find((skill) => skill.name === install.body?.name)
    check('the restored skill still has a receipt', managed?.provenance?.source === target.source, JSON.stringify(managed?.provenance?.source))
    check('the receipt remembers the upstream hash', typeof managed?.provenance?.sha256 === 'string' && managed.provenance.sha256.length === 64, managed?.provenance?.sha256?.slice(0, 12))
    // The document hash only covers SKILL.md, so a change to any other file in
    // the skill used to be invisible. The whole-tree hash is what closes that.
    check('the receipt remembers the whole tree', typeof managed?.provenance?.treeHash === 'string' && managed.provenance.treeHash.length === 64,
      managed?.provenance?.treeHash?.slice(0, 12))
    // Whether it could be pinned depends on the revision API answering; what
    // must hold either way is that the receipt describes what actually
    // happened, so a later check compares against the right thing.
    check('the receipt describes the route the files took',
      managed?.provenance?.fetchedVia === 'tarball' || managed?.provenance?.fetchedVia === 'crawl',
      managed?.provenance?.fetchedVia)
    check('a receipt is pinned only when it names a commit it read',
      (typeof managed?.provenance?.commit === 'string' && managed.provenance.commit !== '')
        === /^[0-9a-f]{40}$/.test(String(managed?.provenance?.commit ?? '')),
      `commit ${managed?.provenance?.commit} via ${managed?.provenance?.fetchedVia}`)
    const updates = await get('/updates')
    check('GET /updates → 200', updates.status === 200, `status ${updates.status}`)
    check('the freshly installed skill reads as current', updates.body?.results?.[install.body?.name]?.status === 'current',
      `${install.body?.name} → ${updates.body?.results?.[install.body?.name]?.status} ${updates.body?.results?.[install.body?.name]?.message ?? ''}`)
    // "Current" has to mean the whole skill when we can see the whole skill,
    // and has to say so when all we could compare was the document.
    const verdict = updates.body?.results?.[install.body?.name]
    check('the verdict states how much of the skill it compared',
      verdict?.depth === 'full' || verdict?.depth === 'document', verdict?.depth)
    // A full-depth answer is possible exactly when the receipt names a commit:
    // that is what lets the check resolve the branch and compare whole trees.
    // Without one it can only re-read SKILL.md, and it has to say so.
    check('and the depth matches what the receipt could support',
      verdict?.depth === (managed?.provenance?.commit ? 'full' : 'document'),
      `${verdict?.depth} for commit ${managed?.provenance?.commit ?? '(none)'}`)
    const persisted = await get('/installed')
    const cached = (persisted.body?.skills ?? []).find((skill) => skill.name === install.body?.name)
    check('the verdict is cached on the receipt', cached?.provenance?.update?.status === 'current', cached?.provenance?.update?.status)

    console.log('\n[agents: importing from another agent directory]')
    const agents = await get('/agents')
    check('GET /agents → 200', agents.status === 200, `status ${agents.status}`)
    const fixtureGroup = (agents.body?.groups ?? []).find((group) => group.path === foreignSkills)
    check('the fixture root was discovered', fixtureGroup !== undefined, (agents.body?.groups ?? []).map((group) => group.id).join(', '))
    check('all three fixtures were listed', (fixtureGroup?.skills ?? []).length === 3, (fixtureGroup?.skills ?? []).map((skill) => skill.name).join(', '))
    const tidy = fixtureGroup?.skills.find((skill) => skill.name === 'tidy-helper')
    const broken = fixtureGroup?.skills.find((skill) => skill.name === 'Badly_Named')
    const hopeless = fixtureGroup?.skills.find((skill) => skill.name === 'no-frontmatter')
    check('a legal skill reads as valid', tidy?.valid === true, tidy?.problems?.map((problem) => problem.code).join(',') || 'no problems')
    check('an illegal name is caught and repairable', broken?.valid === false && broken?.repairable === true, `${broken?.problems?.map((problem) => problem.code).join(',')} → ${broken?.suggestedName}`)
    check('a missing frontmatter is caught and not repairable', hopeless?.valid === false && hopeless?.repairable === false, hopeless?.problems?.map((problem) => problem.code).join(','))

    const importTidy = await post('/import-local', { group: fixtureGroup?.id, path: tidy?.path })
    check('POST /import-local → 200', importTidy.status === 200, importTidy.body?.error ?? importTidy.body?.directory)
    check('the import kept the original name', importTidy.body?.name === 'tidy-helper', importTidy.body?.name)
    check('a complete local tree is reported as complete', importTidy.body?.name === 'tidy-helper' && importTidy.body?.skipped?.length === 0,
      `${(importTidy.body?.skipped ?? []).length} skipped`)
    const importAgain = await post('/import-local', { group: fixtureGroup?.id, path: tidy?.path })
    check('re-importing the same skill is refused by default', importAgain.status === 409, `status ${importAgain.status} — ${importAgain.body?.error}`)
    const importSkipped = await post('/import-local', { group: fixtureGroup?.id, path: tidy?.path, conflict: 'skip' })
    check('the local importer honours conflict=skip', importSkipped.status === 200 && importSkipped.body?.skipped === true, `status ${importSkipped.status}`)
    const importBroken = await post('/import-local', { group: fixtureGroup?.id, path: broken?.path })
    check('an illegal name installs only after a repair', importBroken.status === 200 && importBroken.body?.repaired === true,
      `${importBroken.body?.name} repaired=${importBroken.body?.repaired}`)
    check('the repair produced a grammar-valid name', /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(importBroken.body?.name ?? '')), importBroken.body?.name)
    const importRefused = await post('/import-local', { group: fixtureGroup?.id, path: hopeless?.path })
    check('an unfixable skill is refused, not silently installed', importRefused.status === 400, `status ${importRefused.status} — ${importRefused.body?.error?.slice(0, 70)}`)
    const importOutside = await post('/import-local', { group: fixtureGroup?.id, path: '/etc/passwd' })
    check('a path outside the discovered roots is refused', importOutside.status === 400, `status ${importOutside.status}`)
    const importedDoc = await post('/read', { name: importBroken.body?.name })
    check('the repaired document on disk declares the new name', String(importedDoc.body?.frontmatter?.name ?? '') === importBroken.body?.name,
      `frontmatter name: ${importedDoc.body?.frontmatter?.name}`)
    const localProvenance = (await get('/installed')).body?.skills?.find((skill) => skill.name === importBroken.body?.name)
    check('the imported skill records its origin directory', localProvenance?.provenance?.origin === 'local' && localProvenance.provenance.from === broken?.skillFile,
      localProvenance?.provenance?.from)
    const localUpdates = await get('/updates')
    check('a local import is checked against its source directory', localUpdates.body?.results?.[importBroken.body?.name]?.status === 'current',
      String(localUpdates.body?.results?.[importBroken.body?.name]?.status))

    console.log('\n[purge]')
    const purge = await post('/purge', {})
    check('POST /purge → 200', purge.status === 200, `removed ${purge.body?.removed}`)
    check('the trash is empty afterwards', ((await get('/trash')).body?.items ?? []).length === 0)
  }

  console.log('\n[security]')
  const traversal = await post('/remove', { name: '../../etc' })
  check('path traversal rejected', traversal.status >= 400, `status ${traversal.status} — ${traversal.body?.error}`)
  const badSource = await get('/list?source=nope')
  check('unknown source rejected', badSource.status === 400, `status ${badSource.status}`)
  const badRoute = await get('/nope')
  check('unknown route 404', badRoute.status === 404, `status ${badRoute.status}`)
  const crossSite = await fetch(`${base}/sources`, { headers: { 'sec-fetch-site': 'cross-site' } })
  check('cross-site rejected', crossSite.status === 403, `status ${crossSite.status}`)
  const badMethod = await fetch(`${base}/list`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  check('unexpected method 405', badMethod.status === 405, `status ${badMethod.status}`)
} finally {
  server.close()
  await rm(home, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
