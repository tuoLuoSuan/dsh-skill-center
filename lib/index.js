/**
 * Host half of the skill center.
 *
 * The plugin does four things on this side of the wire:
 *
 * 1. It aggregates remote skill registries behind one small JSON API, so the
 *    browser half never talks to a third party directly (no CORS, no leaked
 *    tokens, and one cache shared by every tab).
 * 2. It installs a skill into the harness's own user skill root
 *    (`<dshHome>/skills/<name>/SKILL.md`), which the skill filesystem provider
 *    watches — so a freshly installed skill is live without a restart.
 * 3. It copies skills out of other agents' directories, which DSH does not
 *    read, and remembers where each installed skill came from so it can be
 *    checked against upstream later.
 * 4. It never destroys anything: a deleted skill goes to `.trash` inside the
 *    user root, which the harness's scanner ignores.
 *
 * Every mutating route passes the same origin fence DSH itself uses; plugin
 * routes are matched by the bare web server, ahead of the built-in `/api`
 * fence, so nothing else defends them.
 *
 * @module dsh-skill-center
 */
import { join } from 'node:path'
import { JsonCache } from './net.js'
import { createSources } from './sources.js'
import { createLogger, readJsonBody, sameOrigin, sendError, sendJson } from './http.js'
import {
  backupSkill,
  emptyTrash,
  installSkill,
  isSkillName,
  listTrash,
  nextFreeSkillName,
  removeSkill,
  resolveDshHome,
  restoreSkill,
  scanRoot,
  skillExists,
  trashSkill,
  userSkillRoots,
} from './skills-dir.js'
import { discoverAgentSkills, markCollisions, readLocalSkill } from './agents.js'
import { hashSkillFiles, hashTree, mergeProvenance, readProvenance, setProvenance } from './provenance.js'
import { parseSkillDocument, stringField } from './frontmatter.js'
import { parseGitHubUrl } from './github.js'
import { checkAllUpdates, UPDATE_STATUS } from './updates.js'
import { checkReferences, summarizeReferences } from './references.js'
import { summarizeCompleteness } from './completeness.js'
import { inspectSkillDocument, renameInDocument, slugify, summarizeInspection } from './validate.js'

/** Cordis plugin name; matches the package name so the client bundle id agrees. */
export const name = 'dsh-skill-center'

/** Everything this half needs from the harness. */
export const inject = ['webServer']

/** Route prefix owned by this plugin. Keep it in sync with the client's `api()`. */
const API_PREFIX = '/dsh-skill-center/api'

/** The routes that answer a plain query string. */
const GET_ROUTES = ['/sources', '/installed', '/list', '/agents', '/trash', '/updates']

/** The routes that accept a JSON body; everything else here is a read. */
const POST_ROUTES = ['/item', '/preview', '/install', '/remove', '/read', '/import-local', '/restore', '/purge', '/update']

/**
 * Blend the harness's own frontmatter parser with the installed-skill scan.
 *
 * The scan already reports `description`, but a file written by an older
 * version of this plugin (or by hand) may carry `whenToUse`/`license` that the
 * flat scan does not surface; re-reading the document keeps the UI honest.
 * @param home - resolved harness home.
 * @param cwd - project root, for the project-scoped roots.
 * @returns installed skills plus the roots that were searched.
 */
async function readInstalled(home, cwd) {
  const roots = [
    ...userSkillRoots(home).map((root) => ({ ...root, label: '用户技能（可安装/删除）' })),
    { path: join(cwd, '.dsh', 'skills'), source: 'project-dsh', label: '项目技能（只读）' },
    { path: join(cwd, '.agents', 'skills'), source: 'project-agents', label: '项目 Agents 技能（只读）' },
  ]
  const skills = []
  const report = []
  for (const root of roots) {
    const found = await scanRoot(root, root.source)
    report.push({ path: root.path, source: root.source, label: root.label, count: found.length, writable: root.source === 'user-dsh' })
    skills.push(...found.map((skill) => ({ ...skill, rootLabel: root.label })))
  }
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return { skills, roots: report }
}

/**
 * Read one skill document for the preview pane.
 * @param home - resolved harness home.
 * @param skillName - installed skill name.
 * @returns the raw document and its parsed frontmatter, or `undefined`.
 */
async function readInstalledDocument(home, skillName) {
  if (!isSkillName(skillName)) return undefined
  const root = userSkillRoots(home)[0].path
  const { readFile } = await import('node:fs/promises')
  for (const candidate of [join(root, skillName, 'SKILL.md'), join(root, `${skillName}.md`)]) {
    try {
      const raw = await readFile(candidate, 'utf8')
      const parsed = await parseSkillDocument(raw)
      return {
        path: candidate,
        raw,
        frontmatter: parsed?.data ?? undefined,
        declaredName: stringField(parsed?.data, 'name'),
      }
    } catch {
      // try the next layout
    }
  }
  return undefined
}

/**
 * Mount the plugin.
 * @param ctx - host plugin context.
 * @param config - optional `{ skillsmpApiKey, cacheDir, dshHome, trustedHosts, extraSkillPaths }`.
 */
export function apply(ctx, config = {}) {
  const log = createLogger(ctx.logger, 'dsh-skill-center')
  const home = resolveDshHome(config.dshHome)
  const trustedHosts = Array.isArray(config.trustedHosts) ? config.trustedHosts : []
  const extraSkillPaths = Array.isArray(config.extraSkillPaths) ? config.extraSkillPaths : []
  const cache = new JsonCache(config.cacheDir ?? join(home, 'skill-center', 'cache'))
  const sources = createSources({ cache, config })
  const cwd = process.cwd()
  // The other agents' directories hang off the real OS home, not the harness
  // home; the override exists so a smoke test can point at a fixture tree.
  const agentHome = typeof config.agentHome === 'string' && config.agentHome.trim() !== '' ? config.agentHome : undefined
  const context = { sources, home, cwd, extraSkillPaths, agentHome, log, cache }

  log.info(`skill center ready — user skill root ${userSkillRoots(home)[0].path}`)

  ctx.inject(['webServer'], (hostCtx) => {
    const dispose = hostCtx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const route = url.pathname.slice(API_PREFIX.length) || '/'
        const method = request.method ?? 'GET'
        // Reads are still fenced: the fence is cheap and a leaked read API is
        // how a rebinding attack learns the shape of everything else.
        const rejection = sameOrigin(request, trustedHosts)
        if (rejection !== null) {
          sendError(response, 403, rejection)
          return
        }
        try {
          await dispatch({ route, method, url, request, response, ...context })
        } catch (error) {
          log.warn(`${method} ${route} failed: ${error instanceof Error ? error.message : String(error)}`)
          if (!response.headersSent) {
            sendError(response, 500, error instanceof Error ? error.message : String(error))
          } else {
            response.end()
          }
        }
      },
    })
    hostCtx.effect(() => dispose, 'dsh-skill-center: http routes')
  })
}

/**
 * Route one API call.
 * @param input - the request, its parsed URL, and the plugin's services.
 */
async function dispatch({ route, method, url, request, response, sources, home, cwd, extraSkillPaths, agentHome, log, cache }) {
  // An unknown route is a 404 no matter the method; a known route reached with
  // the wrong method is a 405. Deciding this up front keeps router additions
  // from quietly changing the status of a typo.
  if (!GET_ROUTES.includes(route) && !POST_ROUTES.includes(route)) {
    sendError(response, 404, `no such route: ${route}`)
    return
  }

  if (route === '/sources' && method === 'GET') {
    const taxonomy = await sources.taxonomy().catch(() => ({ categories: [], counts: {}, totalItems: 0, uniqueRepos: 0 }))
    const installed = await readInstalled(home, cwd)
    sendJson(response, 200, {
      sources: sources.list(),
      taxonomy,
      quota: sources.quota(),
      installed: { counts: installed.roots.reduce((total, root) => total + root.count, 0), roots: installed.roots },
      home,
      userRoot: userSkillRoots(home)[0].path,
    })
    return
  }

  if (route === '/installed' && method === 'GET') {
    const installed = await readInstalled(home, cwd)
    const receipts = await readProvenance(userSkillRoots(home)[0].path)
    const skills = installed.skills.map((skill) => ({ ...skill, provenance: receipts.skills[skill.name] }))
    // The last known update verdict is cached on the receipt itself, so the
    // list can show a badge without eight network checks on every open.
    sendJson(response, 200, { ...installed, skills, trash: (await listTrash(home)).length, managed: Object.keys(receipts.skills).length })
    return
  }

  if (route === '/list' && method === 'GET') {
    const query = url.searchParams
    const sourceId = query.get('source') ?? 'claudeskills'
    const adapter = sources.get(sourceId)
    if (adapter === undefined) {
      sendError(response, 400, `unknown source: ${sourceId}`)
      return
    }
    const page = Math.max(0, Number(query.get('page')) || 0)
    const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 24))
    const result = await adapter.browse({
      q: query.get('q') ?? '',
      kind: query.get('kind') ?? '',
      category: query.get('category') ?? '',
      sort: query.get('sort') ?? '',
      page,
      limit,
    })
    sendJson(response, 200, { ...result, source: sourceId, page, limit, quota: sources.quota() })
    return
  }

  if (route === '/agents' && method === 'GET') {
    const installed = await readInstalled(home, cwd)
    const groups = markCollisions(
      await discoverAgentSkills({ home: agentHome, cwd, extraPaths: extraSkillPaths }),
      installed.skills.filter((skill) => skill.source === 'user-dsh').map((skill) => skill.name),
    )
    const hidden = groups.filter((group) => !group.visible).reduce((total, group) => total + group.skills.length, 0)
    sendJson(response, 200, { groups, hidden })
    return
  }

  if (route === '/trash' && method === 'GET') {
    sendJson(response, 200, { items: await listTrash(home) })
    return
  }

  if (route === '/updates' && method === 'GET') {
    const root = userSkillRoots(home)[0].path
    const receipts = await readProvenance(root)
    const { results, tally } = await checkAllUpdates({ sources, records: receipts.skills, cache })
    // Persist the verdict so a later `/installed` can render badges without
    // repeating the network round trips.
    await mergeProvenance(
      root,
      Object.fromEntries(
        Object.entries(receipts.skills).map(([skillName, record]) => {
          const verdict = results[skillName]
          if (verdict === undefined) return [skillName, record]
          // A `restamp` verdict means the files are provably identical at a
          // commit we had not recorded. Moving the receipt forward costs
          // nothing and turns the next check back into a single API call
          // instead of another whole-repository download.
          const advanced = verdict.restamp === true && typeof verdict.remoteCommit === 'string'
          return [
            skillName,
            {
              ...record,
              ...(advanced ? { commit: verdict.remoteCommit, committedAt: verdict.remoteCommittedAt } : {}),
              update: verdict,
            },
          ]
        }),
      ),
    )
    sendJson(response, 200, { results, tally, checkedAt: new Date().toISOString() })
    return
  }

  // Past this point the route is known, so a non-POST method is a 405.
  if (GET_ROUTES.includes(route) || method !== 'POST') {
    sendError(response, 405, `method ${method} is not allowed on ${route}`)
    return
  }

  if (route === '/item') {
    const body = await readJsonBody(request)
    const entry = body?.entry
    const adapter = sources.get(entry?.source)
    if (adapter === undefined) {
      sendError(response, 400, 'unknown source')
      return
    }
    const detail = await adapter.read(entry)
    sendJson(response, 200, detail)
    return
  }

  if (route === '/preview') {
    const body = await readJsonBody(request)
    const entry = body?.entry
    const adapter = sources.get(entry?.source)
    if (adapter === undefined) {
      sendError(response, 400, 'unknown source')
      return
    }
    const { files, completeness, commit, committedAt, source: fetchedVia } = await adapter.files(entry)
    const raw = files.find((file) => file.path === 'SKILL.md')?.content ?? ''
    const declared = await parseSkillDocument(raw)
    const requested = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : undefined
    const inspection = await inspectSkillDocument(raw, { installName: requested ?? entry.name })
    const totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0)
    sendJson(response, 200, {
      suggestedName: inspection.installName,
      declaredName: stringField(declared?.data, 'name') ?? entry.name,
      description: stringField(declared?.data, 'description') ?? entry.description,
      license: stringField(declared?.data, 'license'),
      totalBytes,
      inspection: summarizeInspection(inspection),
      completeness: summarizeCompleteness(completeness),
      // Which revision these bytes came from, and how they were fetched. Both
      // are facts about the preview rather than about the skill, but they are
      // the difference between "this looks fine" and "this is what is upstream
      // right now".
      revision: {
        commit,
        committedAt,
        fetchedVia,
        // Pinned means the files were read *from* that commit, whichever route
        // carried them. The crawl route honours this too: given a commit it
        // reads that commit, not the branch. It is unpinned only when nothing
        // could be resolved and the branch's current content was all there was.
        pinned: commit !== undefined,
      },
      // Checked against the name this install would actually use, so the
      // reference report and the conflict answer describe the same skill.
      references: summarizeReferences(checkReferences({ skillText: raw, files })),
      conflict: await describeConflict({ home, name: inspection.installName, entry }),
      files: files.map((file) => ({
        path: file.path,
        bytes: Buffer.byteLength(file.content, 'utf8'),
        // Ship only a head of each file: enough to judge, small enough that a
        // 60-file skill does not turn into a multi-megabyte response.
        preview: file.content.length > 4000 ? `${file.content.slice(0, 4000)}\n…` : file.content,
        truncated: file.content.length > 4000,
      })),
    })
    return
  }

  if (route === '/install') {
    const body = await readJsonBody(request)
    const entry = body?.entry
    const adapter = sources.get(entry?.source)
    if (adapter === undefined) {
      sendError(response, 400, 'unknown source')
      return
    }
    const { files, commit, committedAt, source: fetchedVia } = await adapter.files(entry)
    const raw = files.find((file) => file.path === 'SKILL.md')?.content ?? ''
    const declared = await parseSkillDocument(raw)
    const declaredName = stringField(declared?.data, 'name')
    const requested = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : undefined
    const proposed = resolveDirectoryName({ requested, declaredName, fallback: entry.name })
    if (proposed === '') {
      sendError(response, 400, `无法从这个技能推导出合法的名字：${JSON.stringify(requested ?? declaredName ?? entry.name)}`)
      return
    }
    // Resolved before inspection so the repair rewrites the frontmatter to the
    // name the skill is actually about to live under.
    const settled = await applyConflict({
      home,
      name: proposed,
      choice: typeof body?.conflict === 'string' ? body.conflict : 'fail',
      meta: { source: entry.source, key: entry.key, title: entry.title },
    })
    if (settled.outcome === 'conflict') {
      sendError(response, 409, `「${settled.name}」已经装过了。`, { conflict: await describeConflict({ home, name: settled.name, entry }) })
      return
    }
    if (settled.outcome === 'skip') {
      sendJson(response, 200, { ok: true, skipped: true, name: settled.name, reason: 'exists' })
      return
    }
    if (settled.outcome === 'error') {
      sendError(response, 400, settled.message)
      return
    }
    const directoryName = settled.name
    const inspection = await inspectSkillDocument(raw, { installName: directoryName })
    const repair = body?.repair !== false
    const delivered = applyRepair(files, inspection, repair, directoryName)
    if (delivered.rejection !== undefined) {
      sendError(response, 400, delivered.rejection, { inspection: summarizeInspection(inspection) })
      return
    }

    let written
    try {
      written = await installSkill(home, { name: directoryName, files: delivered.files })
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : String(error))
      return
    }

    // Provenance hashes the *upstream* document, not the installed one: an
    // intentional repair would otherwise make every future update check report
    // a difference that is our own doing.
    await setProvenance(userSkillRoots(home)[0].path, directoryName, {
      source: entry.source,
      key: entry.key,
      title: entry.title,
      repo: entry.repo,
      dir: entry.dir,
      url: entry.url,
      coordinates: parseGitHubUrl(entry.url),
      entry,
      origin: 'remote',
      sha256: hashSkillFiles(files),
      // The whole-file checksum, which is what lets a later check notice a
      // change to `scripts/` and not just to `SKILL.md`.
      treeHash: hashTree(files),
      // The exact revision, so the next check can answer "is anything new?"
      // from one API call and no downloads at all.
      commit,
      committedAt,
      fetchedVia,
      bytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0),
      installedAt: new Date().toISOString(),
      repaired: delivered.repaired,
      inspection: summarizeInspection(inspection),
      update: { status: UPDATE_STATUS.current, checkedAt: new Date().toISOString() },
    })
    log.info(`installed skill "${directoryName}" from ${entry.source} (${written.files.length} files${delivered.repaired ? ', name repaired' : ''}${settled.outcome === 'replaced' ? ', replaced' : ''})`)
    sendJson(response, 200, {
      ok: true,
      name: directoryName,
      renamedFrom: settled.from,
      replaced: settled.outcome === 'replaced',
      backup: settled.backup?.bucket,
      directory: written.directory,
      files: written.files,
      repaired: delivered.repaired,
      inspection: summarizeInspection(inspection),
      // Short form: this is for a toast, and nobody reads forty hex digits.
      commit: commit?.slice(0, 7),
      committedAt,
      pinned: commit !== undefined,
    })
    return
  }

  if (route === '/import-local') {
    const body = await readJsonBody(request)
    const sourcePath = typeof body?.path === 'string' ? body.path : ''
    const groupId = typeof body?.group === 'string' ? body.group : ''
    if (sourcePath === '') {
      sendError(response, 400, '缺少 path')
      return
    }
    // Re-discover rather than trusting the client's description of the skill:
    // the path has to be one this plugin actually found, or the route becomes
    // an arbitrary-file-read primitive.
    const groups = await discoverAgentSkills({ home: agentHome, cwd, extraPaths: extraSkillPaths })
    const group = groups.find((candidate) => candidate.id === groupId && candidate.skills.some((skill) => skill.path === sourcePath))
    const source = group?.skills.find((skill) => skill.path === sourcePath)
    if (source === undefined) {
      sendError(response, 400, '这个路径不在本机其他 Agent 的技能目录里')
      return
    }
    const requested = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : undefined
    const localRaw = await readLocalDocument(source)
    const localDeclared = stringField((await parseSkillDocument(localRaw))?.data, 'name')
    const proposed = resolveDirectoryName({ requested, declaredName: localDeclared, fallback: source.name })
    if (proposed === '') {
      sendError(response, 400, `无法从这个技能推导出合法的名字：${JSON.stringify(requested ?? localDeclared ?? source.name)}`)
      return
    }
    const settled = await applyConflict({
      home,
      name: proposed,
      choice: typeof body?.conflict === 'string' ? body.conflict : 'fail',
      meta: { source: 'local', from: source.skillFile },
    })
    if (settled.outcome === 'conflict') {
      sendError(response, 409, `「${settled.name}」已经装过了。`, {
        conflict: await describeConflict({ home, name: settled.name, entry: { key: `local:${source.skillFile}` } }),
      })
      return
    }
    if (settled.outcome === 'skip') {
      sendJson(response, 200, { ok: true, skipped: true, name: settled.name, reason: 'exists' })
      return
    }
    if (settled.outcome === 'error') {
      sendError(response, 400, settled.message)
      return
    }
    const directoryName = settled.name
    const inspection = await inspectSkillDocument(localRaw, { installName: directoryName })
    const tree = await readLocalSkill(source)
    const repair = body?.repair !== false
    const delivered = applyRepair(tree.files, inspection, repair, directoryName)
    if (delivered.rejection !== undefined) {
      sendError(response, 400, delivered.rejection, { inspection: summarizeInspection(inspection) })
      return
    }
    let written
    try {
      written = await installSkill(home, { name: directoryName, files: delivered.files })
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : String(error))
      return
    }
    await setProvenance(userSkillRoots(home)[0].path, directoryName, {
      source: 'local',
      origin: 'local',
      from: source.skillFile,
      fromRoot: group.path,
      fromLabel: group.label,
      title: directoryName,
      sha256: hashSkillFiles(tree.files),
      treeHash: hashTree(tree.files),
      bytes: tree.totalBytes,
      skipped: tree.skipped,
      completeness: summarizeCompleteness(tree.completeness),
      installedAt: new Date().toISOString(),
      repaired: delivered.repaired,
      inspection: summarizeInspection(inspection),
      update: { status: UPDATE_STATUS.current, checkedAt: new Date().toISOString() },
    })
    log.info(`imported skill "${directoryName}" from ${source.skillFile} (${written.files.length} files)`)
    sendJson(response, 200, {
      ok: true,
      name: directoryName,
      renamedFrom: settled.from,
      replaced: settled.outcome === 'replaced',
      backup: settled.backup?.bucket,
      directory: written.directory,
      files: written.files,
      skipped: tree.skipped,
      repaired: delivered.repaired,
      inspection: summarizeInspection(inspection),
    })
    return
  }

  if (route === '/update') {
    const body = await readJsonBody(request)
    const root = userSkillRoots(home)[0].path
    const receipts = await readProvenance(root)
    const requested = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : undefined
    const names = requested === undefined ? Object.keys(receipts.skills) : [requested]
    const results = {}
    for (const skillName of names) {
      const record = receipts.skills[skillName]
      if (record === undefined) {
        results[skillName] = { ok: false, message: '没有这个技能的来源记录' }
        continue
      }
      results[skillName] = await reinstall({ sources, home, name: skillName, record })
    }
    sendJson(response, 200, { results })
    return
  }

  if (route === '/remove') {
    const body = await readJsonBody(request)
    const skillName = typeof body?.name === 'string' ? body.name.trim() : ''
    const root = userSkillRoots(home)[0].path
    const permanent = body?.permanent === true
    try {
      const record = (await readProvenance(root)).skills[skillName]
      // The receipt rides along inside the trash bucket, so restoring the skill
      // restores its origin too — otherwise a delete/undo cycle would quietly
      // turn a managed skill into an unmanaged one.
      const directory = permanent
        ? await removeSkill(home, skillName)
        : await trashSkill(home, skillName, { source: record?.source, from: record?.from, record })
      if (!permanent) await setProvenance(root, skillName, undefined)
      log.info(`${permanent ? 'deleted' : 'trashed'} skill "${skillName}"`)
      sendJson(response, 200, { ok: true, name: skillName, directory, permanent })
    } catch (error) {
      // A rejected name or a missing directory is the caller's mistake, not a
      // server fault, so it answers 400 instead of surfacing as a 500.
      sendError(response, 400, error instanceof Error ? error.message : String(error))
    }
    return
  }

  if (route === '/restore') {
    const body = await readJsonBody(request)
    const bucket = typeof body?.bucket === 'string' ? body.bucket : ''
    const override = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : undefined
    try {
      const restored = await restoreSkill(home, bucket, override)
      // Reattach the receipt the bucket was carrying, so a restored skill is
      // still tracked against upstream and still updatable.
      if (restored.record !== undefined && restored.record !== null) {
        await setProvenance(userSkillRoots(home)[0].path, restored.name, restored.record)
      }
      log.info(`restored skill "${restored.name}" from ${bucket}`)
      sendJson(response, 200, { ok: true, ...restored, record: undefined })
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : String(error))
    }
    return
  }

  if (route === '/purge') {
    const body = await readJsonBody(request)
    const bucket = typeof body?.bucket === 'string' && body.bucket !== '' ? body.bucket : undefined
    try {
      const removed = await emptyTrash(home, bucket)
      log.info(`emptied ${removed} trash ${removed === 1 ? 'bucket' : 'buckets'}`)
      sendJson(response, 200, { ok: true, removed })
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : String(error))
    }
    return
  }

  if (route === '/read') {
    const body = await readJsonBody(request)
    const document = await readInstalledDocument(home, typeof body?.name === 'string' ? body.name.trim() : '')
    if (document === undefined) {
      sendError(response, 404, 'skill document not found')
      return
    }
    sendJson(response, 200, document)
    return
  }
}

/**
 * Decide the directory a skill will be installed under.
 *
 * An explicit request always wins: the user asking for a particular name is
 * the whole point of the rename control. Otherwise the document's own name is
 * used when it is already legal, and a slug of it when it is not.
 * @param input - the requested name, the declared name, and a last-resort fallback.
 * @returns a grammar-valid directory name, or `''` when none can be derived.
 */
function resolveDirectoryName({ requested, declaredName, fallback }) {
  const candidates = [requested, declaredName, fallback]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue
    if (isSkillName(candidate)) return candidate
    const slugged = slugify(candidate)
    if (isSkillName(slugged)) return slugged
  }
  return ''
}

/**
 * Read a locally discovered skill's `SKILL.md`, for inspection before import.
 * @param source - one record from {@link discoverAgentSkills}.
 * @returns the document text.
 */
async function readLocalDocument(source) {
  const { readFile } = await import('node:fs/promises')
  return await readFile(source.skillFile, 'utf8')
}

/**
 * Decide what to write, given an inspection and the user's repair preference.
 *
 * The one thing this refuses to do is install a skill the harness will ignore
 * without saying so. A download that produces nothing visible is worse than a
 * refusal, because the user cannot tell it apart from a broken plugin.
 * @param files - the downloaded file set.
 * @param inspection - the validator's report.
 * @param repair - whether the user allowed rewriting the `name:` line.
 * @param directoryName - the name the skill will be installed under.
 * @returns the file set to write, or a rejection message.
 */
function applyRepair(files, inspection, repair, directoryName) {
  if (!inspection.blocked) {
    // Not blocked, but the directory may still disagree with the document. If
    // the user allowed a repair, align them so the list and the catalog agree.
    if (repair && inspection.declaredName !== undefined && inspection.declaredName !== directoryName) {
      return { files: rewriteSkillName(files, directoryName), repaired: true }
    }
    return { files, repaired: false }
  }
  if (!inspection.repairable) {
    return { files, repaired: false, rejection: `这个技能的 SKILL.md 不能被 DSH 加载，而且无法自动修好：${inspection.problems.filter((problem) => problem.level === 'error').map((problem) => problem.message).join(' ')}` }
  }
  if (!repair) {
    return { files, repaired: false, rejection: '这个技能的 name 不符合 DSH 的命名规则，不修的话装上去会被静默忽略。' }
  }
  return { files: rewriteSkillName(files, directoryName), repaired: true }
}

/**
 * Replace `SKILL.md` with a copy whose `name:` line matches the directory.
 * @param files - the file set.
 * @param directoryName - the name to write.
 * @returns a new file set.
 */
function rewriteSkillName(files, directoryName) {
  return files.map((file) =>
    file.path === 'SKILL.md' ? { ...file, content: renameInDocument(file.content, directoryName) } : file,
  )
}

/**
 * What is already sitting under this name, and what the choices would be.
 *
 * Read-only: `/preview` calls it so the user picks with the facts in front of
 * them instead of discovering the collision from an error after confirming.
 * @param options - `home`, the candidate `name`, and the `entry` being installed.
 */
async function describeConflict({ home, name, entry }) {
  if (name === '' || !(await skillExists(home, name))) return { exists: false, name }
  const records = await readProvenance(userSkillRoots(home)[0].path)
  const existing = records.skills?.[name]
  return {
    exists: true,
    name,
    // A receipt whose key matches means this is the same skill from the same
    // place, i.e. a reinstall — which is a different decision from a genuine
    // clash with an unrelated skill that happens to share a name.
    sameSource: existing !== undefined && entry?.key !== undefined && existing.key === entry.key,
    existingSource: existing?.source,
    existingTitle: existing?.title,
    // Offered up front so "rename" is a concrete outcome, not a promise that
    // the name might change to something later.
    renameTo: await nextFreeSkillName(home, name),
  }
}

/**
 * Apply the user's answer to a name collision.
 *
 * `fail` is the default and the only choice that changes nothing: a route that
 * silently overwrote a directory the user may have hand-written would be the
 * worst possible default, so overwriting only ever happens when it was asked
 * for by name — and even then the previous version is moved aside first.
 * @param options - `home`, the resolved `name`, the `choice`, and backup `meta`.
 * @returns the name to install under, or why nothing should be installed.
 */
async function applyConflict({ home, name, choice, meta }) {
  if (!(await skillExists(home, name))) return { outcome: 'free', name }
  if (choice === 'skip') return { outcome: 'skip', name }
  if (choice === 'replace') {
    try {
      const backup = await backupSkill(home, name, meta)
      return { outcome: 'replaced', name, backup }
    } catch (error) {
      return { outcome: 'error', name, message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (choice === 'rename') {
    const free = await nextFreeSkillName(home, name)
    if (free === undefined) return { outcome: 'error', name, message: `「${name}」及其后缀名都被占用了，请先改一个别的名字。` }
    return { outcome: 'renamed', name: free, from: name }
  }
  return { outcome: 'conflict', name }
}

/**
 * Re-download and re-install one managed skill from its recorded origin.
 * @param input - the sources registry, the skill name, and its receipt.
 * @returns a result describing what happened.
 */
async function reinstall({ sources, home, name: skillName, record }) {
  try {
    if (record.origin === 'local') {
      const groups = await discoverAgentSkills({ home: agentHome, cwd: process.cwd() })
      const source = groups.flatMap((group) => group.skills).find((skill) => skill.skillFile === record.from)
      if (source === undefined) return { ok: false, message: '来源目录已经不在了。' }
      const tree = await readLocalSkill(source)
      const inspection = await inspectSkillDocument(await readLocalDocument(source), { installName: skillName })
      const delivered = applyRepair(tree.files, inspection, true, skillName)
      if (delivered.rejection !== undefined) return { ok: false, message: delivered.rejection }
      const written = await installSkill(home, { name: skillName, files: delivered.files })
      await setProvenance(userSkillRoots(home)[0].path, skillName, {
        ...record,
        sha256: hashSkillFiles(tree.files),
        installedAt: new Date().toISOString(),
        update: { status: UPDATE_STATUS.current, checkedAt: new Date().toISOString() },
      })
      return { ok: true, name: skillName, files: written.files.length }
    }

    const adapter = sources.get(record.source)
    if (adapter === undefined) return { ok: false, message: `未知来源：${record.source}` }
    if (record.entry === undefined || record.entry === null) return { ok: false, message: '这条记录没有记住上游条目。' }
    const { files, commit, committedAt, source: fetchedVia } = await adapter.files(record.entry)
    const raw = files.find((file) => file.path === 'SKILL.md')?.content ?? ''
    const declaredName = stringField((await parseSkillDocument(raw))?.data, 'name')
    // An update keeps its existing directory: renaming a skill behind the
    // user's back would move the thing they just clicked on.
    const directoryName = isSkillName(skillName) ? skillName : resolveDirectoryName({ declaredName, fallback: skillName })
    if (directoryName === '') return { ok: false, message: '无法推导出合法的名字。' }
    const inspection = await inspectSkillDocument(raw, { installName: directoryName })
    const delivered = applyRepair(files, inspection, true, directoryName)
    if (delivered.rejection !== undefined) return { ok: false, message: delivered.rejection }
    const written = await installSkill(home, { name: directoryName, files: delivered.files })
    await setProvenance(userSkillRoots(home)[0].path, directoryName, {
      ...record,
      sha256: hashSkillFiles(files),
      // Re-pinned, not inherited: the receipt must name the revision that is
      // now on disk, or the next check compares against a commit we replaced.
      treeHash: hashTree(files),
      commit,
      committedAt,
      fetchedVia,
      installedAt: new Date().toISOString(),
      repaired: delivered.repaired,
      inspection: summarizeInspection(inspection),
      update: { status: UPDATE_STATUS.current, checkedAt: new Date().toISOString() },
    })
    return { ok: true, name: skillName, files: written.files.length, commit: commit?.slice(0, 7) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
