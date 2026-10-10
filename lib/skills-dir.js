/**
 * Local skill directory management for the skill center.
 *
 * The harness discovers skills by reading `<root>/<name>/SKILL.md` (or a flat
 * `<root>/<name>.md`) under a fixed set of roots, one of which is the user
 * root `<dsh home>/skills`. This module is the plugin's own view of exactly
 * that root, so installing and removing through the UI lands where the
 * harness's filesystem provider is already watching and the skill becomes
 * live without a restart.
 *
 * @module dsh-skill-center/skills-dir
 */
import { lstat, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { completenessOf, SKIP_REASON } from './completeness.js'
import { INVOCATION_KEYS, parseSkillDocument, readInvocation, setFrontmatterFlag, stringField } from './frontmatter.js'

/** The harness's public skill-name grammar, duplicated deliberately. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Deletions move here instead of disappearing.
 *
 * Dot-prefixed on purpose: the harness discovers a skill by looking for a
 * directory that *directly* contains `SKILL.md`, so a `.trash` directory is
 * invisible to it even while full of perfectly valid skills.
 */
export const TRASH_DIR = '.trash'

/** Sidecar written inside each trashed directory so a restore keeps its story. */
export const TRASH_META = '.skill-center-trash.json'

/**
 * What a replaced skill is moved aside to.
 *
 * Overwriting is offered, but never as a plain `rm -r` of something the user
 * cannot get back — "replace" has to mean "replace, and the old one is still
 * here if it turns out to have been the good one".
 */
export const BACKUP_DIR = '.backup'

/** How many `<name>-N` variants to try before giving up on finding a free one. */
const RENAME_ATTEMPTS = 50

/**
 * Resolve the harness home the same way the host does.
 * @param configured - explicit override from plugin config.
 * @param env - environment mapping used to read `DSH_HOME`.
 * @returns an absolute harness home path.
 */
export function resolveDshHome(configured, env = process.env) {
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured.trim())
  const fromEnv = env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(fromEnv.trim())
  return join(homedir(), '.dsh')
}

/**
 * Resolve every skill root the plugin reads.
 *
 * Only the two *user* roots are listed: project roots depend on a workspace
 * the host knows about and not this plugin, and bundled roots are read-only.
 * @param home - resolved harness home.
 * @returns the user skill roots in harness precedence order.
 */
export function userSkillRoots(home) {
  return [
    { path: join(home, 'skills'), source: 'user-dsh', label: 'DSH 用户技能' },
  ]
}

/**
 * The roots whose `SKILL.md` files this plugin is willing to rewrite.
 *
 * Installing only ever writes to the user root, but a toggle is a different
 * kind of act: it answers "is this skill offered to the model", and that
 * question is just as real for a skill the user put in their workspace. What
 * is *not* on this list is the wider set of roots the machine tab reads --
 * `~/.claude/skills` and friends belong to other tools, and flipping a switch
 * there would be editing somebody else's configuration.
 * @param home - resolved harness home.
 * @param cwd - the session's working directory.
 * @returns the writable roots, in the order a name should be looked up.
 */
export function writableSkillRoots(home, cwd) {
  return [
    { path: join(home, 'skills'), source: 'user-dsh', label: 'DSH 用户技能' },
    { path: join(cwd, '.dsh', 'skills'), source: 'project-dsh', label: '项目技能' },
    { path: join(cwd, '.agents', 'skills'), source: 'project-agents', label: '项目 Agents 技能' },
  ]
}

/**
 * Locate the file a toggle would edit.
 * @param home - resolved harness home.
 * @param cwd - the session's working directory.
 * @param name - the skill's directory name.
 * @returns the file path and its root, or `undefined` when no writable root holds it.
 */
export async function findWritableSkill(home, cwd, name) {
  if (!isSkillName(name)) return undefined
  for (const root of writableSkillRoots(home, cwd)) {
    // Containment is checked on the *entry*, because a bundle's `SKILL.md` sits
    // one level below the root and `containedChild` deliberately refuses that.
    // The extra segment is safe because `isSkillName` admits no separator.
    const bundle = containedChild(root.path, join(root.path, name))
    if (bundle !== undefined && (await isFile(join(bundle, 'SKILL.md')))) {
      return { path: join(bundle, 'SKILL.md'), root, layout: 'bundle' }
    }
    const flat = join(root.path, `${name}.md`)
    if (containedChild(root.path, flat) !== undefined && (await isFile(flat))) {
      return { path: flat, root, layout: 'flat' }
    }
  }
  return undefined
}

/**
 * Whether a path names a readable file.
 * @param path - absolute candidate.
 * @returns true when `stat` says file.
 */
async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Offer a skill to the model, or stop offering it.
 *
 * Enforced by `disable-model-invocation` in the skill's own frontmatter -- the
 * field the harness reads -- rather than by renaming or moving files. That
 * choice buys three things: the skill stays exactly where it is, so the list
 * can still show it and the user can still read it; turning it back on is the
 * removal of one line, so the document returns to its original bytes; and it
 * works on a skill the plugin did not install, including one inside a git
 * repository where a rename would show up as a deletion.
 *
 * The write is checked before it happens: the edited text is parsed back and
 * the flags re-read, so a document this module misunderstands is refused
 * instead of saved into a state nobody intended.
 * @param home - resolved harness home.
 * @param cwd - the session's working directory.
 * @param name - the skill's directory name.
 * @param enabled - `true` to let the model invoke it, `false` to withdraw it.
 * @returns the outcome, or `{ error }` with the reason it was refused.
 */
export async function setSkillInvocation(home, cwd, name, enabled) {
  if (!isSkillName(name)) return { error: `"${name}" is not a legal skill name, so it cannot be a directory here` }
  const found = await findWritableSkill(home, cwd, name)
  if (found === undefined) {
    return { error: `no writable skill named "${name}"; only the DSH user root and this workspace's skill roots can be changed` }
  }
  let raw
  try {
    raw = await readFile(found.path, 'utf8')
  } catch (error) {
    return { error: `could not read ${found.path}: ${error instanceof Error ? error.message : String(error)}` }
  }
  // A document the harness rejects is a document whose switch controls nothing:
  // the skill is already absent from the catalog, so writing a flag into it
  // would report a change that no one can observe. Refusing is the only honest
  // answer, and the reason names the field that has to be fixed first.
  const current = readInvocation((await parseSkillDocument(raw))?.data)
  if (current.problems.length > 0) {
    return { error: `${found.path} cannot be switched: ${current.problems.join('; ')}. The harness drops the whole file while that is there, so a switch would change nothing you could see.` }
  }
  const edited = setFrontmatterFlag(raw, INVOCATION_KEYS.model, !enabled)
  if (edited.error !== undefined) return { error: `${found.path}: ${edited.error}` }

  const after = await parseSkillDocument(edited.text)
  const flags = readInvocation(after?.data)
  if (flags.modelInvocable !== enabled) {
    // Reaching here means the line edit and the parser disagree -- the one
    // failure that would leave a skill in a state neither of them chose.
    return { error: `refusing to write ${found.path}: the edit did not produce the state it claimed` }
  }
  if (edited.changed) {
    try {
      await writeFile(found.path, edited.text, 'utf8')
    } catch (error) {
      return { error: `could not write ${found.path}: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  return { changed: edited.changed, name, path: found.path, root: found.root.source, modelInvocable: flags.modelInvocable }
}

/**
 * Validate a skill name against the harness grammar.
 * @param name - candidate name.
 * @returns whether the name is safe to use as a directory segment.
 */
export function isSkillName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 64 && SKILL_NAME.test(name)
}

/**
 * Enumerate the skills installed under one root.
 * @param root - absolute root path.
 * @param source - harness source bucket for skills found here.
 * @returns a summary per discovered skill; unreadable entries are skipped.
 */
export async function scanRoot(root, source) {
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    // Dot entries are bookkeeping, not skills — `.trash` and the provenance
    // registry both live in the skill root.
    if (entry.name.startsWith('.')) continue
    const isDirectory = entry.isDirectory()
    const isFlat = entry.isFile() && entry.name.endsWith('.md')
    if (!isDirectory && !isFlat) continue
    const skillFile = isDirectory ? join(root.path, entry.name, 'SKILL.md') : join(root.path, entry.name)
    const record = await readSkill(skillFile, { root, source, directory: isDirectory ? join(root.path, entry.name) : root.path, entryName: entry.name })
    if (record !== undefined) found.push(record)
  }
  found.sort((a, b) => a.name.localeCompare(b.name))
  return found
}

/**
 * Read and describe one skill file.
 * @param skillFile - absolute path of the `SKILL.md` (or flat `.md`) file.
 * @param context - root, source bucket, containing directory, and entry name.
 * @returns the parsed record, or `undefined` when the file is not a valid skill.
 */
async function readSkill(skillFile, context) {
  let raw
  let info
  let files
  try {
    const [text, stats, listing] = await Promise.all([
      readFile(skillFile, 'utf8'),
      stat(skillFile),
      context.directory === undefined ? Promise.resolve([]) : listFiles(context.directory).catch(() => []),
    ])
    raw = text
    info = stats
    files = listing
  } catch {
    return undefined
  }
  const parsed = await parseSkillDocument(raw)
  const data = parsed?.data
  const name = stringField(data, 'name')
  const description = stringField(data, 'description')
  if (name === undefined || description === undefined) return undefined
  const invocation = readInvocation(data)
  return {
    name,
    directory: context.entryName,
    description,
    whenToUse: stringField(data, 'whenToUse') ?? stringField(data, 'when-to-use'),
    license: stringField(data, 'license'),
    version: stringField(data, 'version'),
    compatibility: stringField(data, 'compatibility'),
    allowedTools: stringField(data, 'allowed-tools') ?? stringField(data, 'allowedTools'),
    metadata: data?.metadata !== null && typeof data?.metadata === 'object' ? data.metadata : undefined,
    valid: isSkillName(name),
    modelInvocable: invocation.modelInvocable,
    userInvocable: invocation.userInvocable,
    invocationProblems: invocation.problems,
    source: context.source,
    root: context.root.path,
    rootLabel: context.root.label,
    path: skillFile,
    directoryPath: context.directory,
    bytes: info.size,
    modifiedAt: info.mtimeMs,
    fileCount: files.length,
    files,
  }
}

/**
 * List every file inside a skill directory, relative to it.
 * @param directory - absolute skill directory.
 * @param prefix - internal recursion accumulator.
 * @param depth - internal recursion guard.
 * @returns relative file paths using forward slashes.
 */
async function listFiles(directory, prefix = '', depth = 0) {
  if (depth > 6) return []
  const entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' })
  const result = []
  for (const entry of entries) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      result.push(...(await listFiles(join(directory, entry.name), relativePath, depth + 1)))
    } else if (entry.isFile()) {
      result.push(relativePath)
    }
  }
  return result
}

/**
 * Read a whole skill directory into the same `{ path, content }` shape the
 * remote adapters produce, so a locally imported skill travels the exact same
 * containment and name checks as a downloaded one.
 *
 * `SKILL.md` is always included even if the directory is oversized; everything
 * else is dropped once the caps are hit, which keeps a runaway directory from
 * turning into a multi-megabyte copy.
 * @param directory - absolute skill directory.
 * @param options - size caps.
 * @returns the file set, plus the files that were skipped.
 */
export async function readSkillTree(directory, options = {}) {
  const maxBytes = options.maxBytes ?? 4_000_000
  const maxFiles = options.maxFiles ?? 80
  // A flat `<name>.md` skill is a single file by construction, so there is no
  // tree to be incomplete about.
  const flat = options.flat === true
  const relativePaths = await listFiles(directory)
  const files = []
  const skipped = []
  let total = 0
  // SKILL.md first: it is the one file whose absence makes the import pointless.
  relativePaths.sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)))
  for (const relativePath of relativePaths) {
    if (files.length >= maxFiles && relativePath !== 'SKILL.md') {
      skipped.push({ path: relativePath, reason: SKIP_REASON.fileBudget })
      continue
    }
    let content
    try {
      const buffer = await readFile(join(directory, relativePath))
      if (total + buffer.byteLength > maxBytes && relativePath !== 'SKILL.md') {
        skipped.push({ path: relativePath, reason: SKIP_REASON.byteBudget })
        continue
      }
      total += buffer.byteLength
      content = buffer.toString('utf8')
    } catch {
      skipped.push({ path: relativePath, reason: SKIP_REASON.unreadable })
      continue
    }
    files.push({ path: relativePath, content })
  }
  const completeness = completenessOf({
    limits: { files: maxFiles, bytes: maxBytes, depth: 6 },
    skipped: flat ? [] : skipped,
    fileCount: files.length,
    byteCount: total,
  })
  return { files, skipped: skipped.map((entry) => entry.path), completeness, totalBytes: total }
}

/**
 * Scan every user skill root.
 * @param home - resolved harness home.
 * @returns flat list of installed skill records and the roots that were read.
 */
export async function scanInstalled(home) {
  const roots = userSkillRoots(home)
  const rootsReport = []
  const skills = []
  for (const root of roots) {
    const found = await scanRoot(root, root.source)
    let readable = true
    try {
      await readdir(root.path)
    } catch {
      readable = false
    }
    rootsReport.push({ ...root, exists: readable, count: found.length })
    skills.push(...found)
  }
  return { skills, roots: rootsReport }
}

/**
 * Prove that a target stays inside a root before any destructive action.
 * @param root - absolute root path.
 * @param target - absolute candidate path.
 * @returns the resolved target when it is a direct child, otherwise `undefined`.
 */
export function containedChild(root, target) {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined
  if (rel.includes(sep)) return undefined
  return resolvedTarget
}

/**
 * Write one installed skill to disk.
 *
 * The caller supplies the already-validated file set; this function only
 * enforces containment, the name grammar, and the requirement that a
 * `SKILL.md` exists at the top level.
 * @param home - resolved harness home.
 * @param input - skill name plus the files to write.
 * @returns where the skill was written and how many files landed.
 * @throws when the name, the file set, or a path is unacceptable.
 */
/**
 * Is this name already taken under the user skill root?
 *
 * Both shapes count: a directory skill and a flat `<name>.md`. Answering this
 * from disk rather than from the plugin's own records is deliberate — a skill
 * the user wrote by hand blocks a name exactly as much as one we installed.
 * @param home - resolved harness home.
 * @param name - validated skill name.
 */
export async function skillExists(home, name) {
  const root = userSkillRoots(home)[0].path
  for (const candidate of [join(root, name), join(root, `${name}.md`)]) {
    if (containedChild(root, candidate) === undefined) continue
    try {
      await lstat(candidate)
      return true
    } catch {
      // Not there; try the next shape.
    }
  }
  return false
}

/**
 * The first free `<name>`, `<name>-2`, `<name>-3` … under the user root.
 *
 * The suffix form is chosen over a timestamp or a random tail because the
 * result has to stay a legal skill name the user can still type.
 * @param home - resolved harness home.
 * @param name - the name that is taken.
 * @returns a free name, or undefined when 50 candidates are all taken.
 */
export async function nextFreeSkillName(home, name) {
  for (let index = 2; index <= RENAME_ATTEMPTS; index += 1) {
    const candidate = `${name}-${index}`
    if (!isSkillName(candidate)) break
    if (!(await skillExists(home, candidate))) return candidate
  }
  return undefined
}

/**
 * Move the current occupant of a name into `<root>/.backup/`, so an overwrite
 * stays reversible.
 *
 * Like the trash, the dot prefix keeps it out of the harness's discovery, and
 * like the trash it is never cleaned up automatically — a backup the user
 * cannot find is not a backup.
 * @param home - resolved harness home.
 * @param name - validated skill name.
 * @param meta - extra fields recorded in the sidecar.
 * @returns the backup bucket name and its absolute path.
 */
export async function backupSkill(home, name, meta = {}) {
  if (!isSkillName(name)) throw new Error(`invalid skill name: ${JSON.stringify(name)}`)
  const root = userSkillRoots(home)[0].path
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const bucket = `${name}-${stamp}`
  // Guarded against the dot-directory rather than the skill root: the bucket is
  // deliberately one level deeper, and `containedChild` only accepts direct
  // children.
  const backupRoot = join(root, BACKUP_DIR)
  const target = containedChild(backupRoot, join(backupRoot, bucket))
  if (target === undefined) throw new Error(`refusing to write outside the skill root: ${name}`)
  const flat = join(root, `${name}.md`)
  const directory = join(root, name)
  const hasDirectory = await lstat(directory).then(() => true, () => false)
  const hasFlat = await lstat(flat).then(() => true, () => false)
  if (!hasDirectory && !hasFlat) throw new Error(`no such skill: ${name}`)
  // The bucket is a directory that holds the displaced skill, so both the
  // directory and the flat-file shapes land in it under the same layout.
  await mkdir(target, { recursive: true })
  if (hasDirectory) {
    await rename(directory, join(target, name))
  } else {
    await rename(flat, join(target, `${name}.md`))
  }
  await writeFile(
    join(target, TRASH_META),
    `${JSON.stringify({ name, backedUpAt: new Date().toISOString(), flat: !hasDirectory, ...meta }, null, 2)}\n`,
    'utf8',
  )
  return { bucket, path: target }
}

/**
 * Install a file set, replacing whatever is there.
 * @param home - resolved harness home.
 * @param input - `{ name, files, replace }`.
 * @returns the absolute directory written and the relative paths that landed.
 */
export async function installSkill(home, input) {
  const { name, files, replace = true } = input
  if (!isSkillName(name)) throw new Error(`invalid skill name: ${JSON.stringify(name)}`)
  if (!Array.isArray(files) || files.length === 0) throw new Error('no files to install')
  const root = userSkillRoots(home)[0].path
  const directory = containedChild(root, join(root, name))
  if (directory === undefined) throw new Error(`refusing to write outside the skill root: ${name}`)

  // Installing a new version over an old one must not leave the previous
  // version's files behind — a stale `scripts/old.py` is invisible in the UI
  // and still real on disk.
  if (replace) await clearSkillDirectory(root, name)

  const written = []
  for (const file of files) {
    const relativePath = normalizeRelative(file.path)
    if (relativePath === undefined) throw new Error(`unsafe file path: ${file.path}`)
    const target = resolve(directory, relativePath)
    if (!target.startsWith(directory + sep)) throw new Error(`unsafe file path: ${file.path}`)
    await mkdir(resolve(target, '..'), { recursive: true })
    const content = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8')
    await writeFile(target, content)
    written.push(relativePath)
  }
  if (!written.includes('SKILL.md')) throw new Error('the installed file set has no SKILL.md')
  return { directory, files: written }
}

/**
 * Remove whatever currently occupies a skill name, link-safely.
 *
 * A symlinked skill is unlinked rather than followed: `rm -r` on the link is
 * already safe, but the distinction has to be deliberate or a future caller
 * will reach through it.
 * @param root - absolute user skill root.
 * @param name - validated skill name.
 */
async function clearSkillDirectory(root, name) {
  for (const candidate of [join(root, name), join(root, `${name}.md`)]) {
    if (containedChild(root, candidate) === undefined) continue
    let info
    try {
      info = await lstat(candidate)
    } catch {
      continue
    }
    if (info.isSymbolicLink()) await unlink(candidate)
    else await rm(candidate, { recursive: true, force: true })
  }
}

/**
 * Reject absolute paths and parent traversal in an incoming relative path.
 * @param path - candidate relative path.
 * @returns a normalized forward-slash path, or `undefined` when unsafe.
 */
function normalizeRelative(path) {
  if (typeof path !== 'string' || path.trim() === '') return undefined
  const cleaned = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned)) return undefined
  const segments = cleaned.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0) return undefined
  if (segments.some((segment) => segment === '..' || segment.includes('\0'))) return undefined
  return segments.join('/')
}

/**
 * Move one installed skill into the root's trash directory.
 *
 * Deleting a skill is one keystroke away from being a mistake, and the skill
 * may be the only copy of something the user wrote. Nothing here is ever
 * unrecoverable except through {@link emptyTrash}.
 * @param home - resolved harness home.
 * @param name - skill name.
 * @param meta - provenance to keep with the corpse, so a restore can reattach it.
 * @returns the trash directory now holding the skill.
 * @throws when the name is invalid, escapes the root, or nothing was there.
 */
export async function trashSkill(home, name, meta = {}) {
  if (!isSkillName(name)) throw new Error(`invalid skill name: ${JSON.stringify(name)}`)
  const root = userSkillRoots(home)[0].path
  const directory = containedChild(root, join(root, name))
  if (directory === undefined) throw new Error(`refusing to delete outside the skill root: ${name}`)

  const flat = join(root, `${name}.md`)
  const hasFlat = containedChild(root, flat) !== undefined
  let info
  let flatInfo
  try {
    info = await lstat(directory)
  } catch {
    info = undefined
  }
  try {
    flatInfo = hasFlat ? await lstat(flat) : undefined
  } catch {
    flatInfo = undefined
  }
  if (info === undefined && flatInfo === undefined) throw new Error(`no such skill: ${name}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const trashRoot = join(root, TRASH_DIR)
  await mkdir(trashRoot, { recursive: true })
  const bucket = join(trashRoot, `${name}-${stamp}`)

  if (info !== undefined) {
    // A symlink is not the skill, it is a pointer at one; move the pointer.
    if (info.isSymbolicLink()) {
      await mkdir(bucket, { recursive: true })
      await rename(directory, join(bucket, `${name}.link`))
    } else {
      await rename(directory, bucket)
    }
  } else {
    await mkdir(bucket, { recursive: true })
    await rename(flat, join(bucket, 'SKILL.md'))
  }

  await writeFile(
    join(bucket, TRASH_META),
    `${JSON.stringify({ name, trashedAt: new Date().toISOString(), linked: info?.isSymbolicLink() === true, ...meta }, null, 2)}\n`,
    'utf8',
  )
  return bucket
}

/**
 * List what is currently recoverable.
 * @param home - resolved harness home.
 * @returns one entry per trashed skill, newest first.
 */
export async function listTrash(home) {
  const root = userSkillRoots(home)[0].path
  const trashRoot = join(root, TRASH_DIR)
  let entries
  try {
    entries = await readdir(trashRoot, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
  const result = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const bucket = join(trashRoot, entry.name)
    let meta = {}
    try {
      meta = JSON.parse(await readFile(join(bucket, TRASH_META), 'utf8'))
    } catch {
      // A hand-made bucket still restores; it just loses its provenance.
      meta = {}
    }
    let info
    try {
      info = await stat(bucket)
    } catch {
      continue
    }
    result.push({
      bucket: entry.name,
      name: typeof meta.name === 'string' && meta.name !== '' ? meta.name : entry.name.replace(/-\d{4}-\d{2}-\d{2}_.*$/, ''),
      trashedAt: typeof meta.trashedAt === 'string' ? meta.trashedAt : undefined,
      source: meta.source,
      from: meta.from,
      linked: meta.linked === true,
      // The receipt itself stays out of the list payload (it carries the whole
      // upstream entry); the flag is all the UI needs to promise a clean restore.
      managed: meta.record !== undefined && meta.record !== null,
      bytes: await directorySize(bucket),
      modifiedAt: info.mtimeMs,
    })
  }
  result.sort((a, b) => String(b.bucket).localeCompare(String(a.bucket)))
  return result
}

/**
 * Put a trashed skill back under its original name.
 * @param home - resolved harness home.
 * @param bucket - trash directory name, as returned by {@link listTrash}.
 * @param name - override for the restored name (used when the original is taken).
 * @returns the restored skill name and its directory.
 * @throws when the bucket is missing, unsafe, or the destination is occupied.
 */
export async function restoreSkill(home, bucket, name) {
  const root = userSkillRoots(home)[0].path
  const trashRoot = join(root, TRASH_DIR)
  const source = containedChild(trashRoot, join(trashRoot, String(bucket)))
  if (source === undefined) throw new Error(`refusing to read outside the trash: ${bucket}`)

  let meta = {}
  try {
    meta = JSON.parse(await readFile(join(source, TRASH_META), 'utf8'))
  } catch {
    meta = {}
  }
  const target = name ?? (typeof meta.name === 'string' && meta.name !== '' ? meta.name : undefined)
  if (!isSkillName(target)) throw new Error(`cannot determine a valid skill name to restore as: ${JSON.stringify(target)}`)

  const destination = containedChild(root, join(root, target))
  if (destination === undefined) throw new Error(`refusing to write outside the skill root: ${target}`)
  try {
    await lstat(destination)
    throw new Error(`a skill named ${JSON.stringify(target)} already exists`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) throw error
  }

  const link = join(source, `${target}.link`)
  let hasLink = false
  try {
    hasLink = (await lstat(link)).isSymbolicLink()
  } catch {
    hasLink = false
  }
  if (hasLink) {
    // The original was a symlink; restore the pointer, not a copy of its target.
    const { readlink, symlink } = await import('node:fs/promises')
    const pointed = await readlink(link)
    await symlink(pointed, destination)
    await rm(source, { recursive: true, force: true })
  } else {
    await rename(source, destination)
    await rm(join(destination, TRASH_META), { force: true })
  }
  return { name: target, directory: destination, source: meta.source, record: meta.record }
}

/**
 * Delete a trashed skill for good.
 * @param home - resolved harness home.
 * @param bucket - trash directory name; omit to empty the whole trash.
 * @returns how many buckets were removed.
 */
export async function emptyTrash(home, bucket) {
  const root = userSkillRoots(home)[0].path
  const trashRoot = join(root, TRASH_DIR)
  if (bucket === undefined || bucket === '') {
    const before = await listTrash(home)
    await rm(trashRoot, { recursive: true, force: true })
    return before.length
  }
  const target = containedChild(trashRoot, join(trashRoot, String(bucket)))
  if (target === undefined) throw new Error(`refusing to delete outside the trash: ${bucket}`)
  await rm(target, { recursive: true, force: true })
  return 1
}

/**
 * Sum the bytes under a directory, for display only.
 * @param directory - absolute directory.
 * @returns total size in bytes; unreadable entries count as zero.
 */
async function directorySize(directory) {
  let total = 0
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(directory, entry.name)
    if (entry.isDirectory()) total += await directorySize(child)
    else {
      try {
        total += (await stat(child)).size
      } catch {
        // A file that vanished mid-walk contributes nothing.
      }
    }
  }
  return total
}

/**
 * Delete one installed skill directory outright, bypassing the trash.
 *
 * Kept for callers that have already decided the skill is disposable; the UI
 * route uses {@link trashSkill} instead.
 * @param home - resolved harness home.
 * @param name - skill name.
 * @returns the directory that was removed.
 * @throws when the name is invalid or escapes the root.
 */
export async function removeSkill(home, name) {
  if (!isSkillName(name)) throw new Error(`invalid skill name: ${JSON.stringify(name)}`)
  const root = userSkillRoots(home)[0].path
  const directory = containedChild(root, join(root, name))
  if (directory === undefined) throw new Error(`refusing to delete outside the skill root: ${name}`)
  const flat = containedChild(root, join(root, `${name}.md`))
  await clearSkillDirectory(root, name)
  if (flat !== undefined) await rm(flat, { force: true })
  return directory
}
