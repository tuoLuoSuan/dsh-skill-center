/**
 * Where each installed skill came from.
 *
 * Installing a skill throws away the only thing that made it findable: the
 * catalog entry, the repository, the ref it was read at. Without that, a skill
 * can be installed but never updated, and a skill imported from another
 * agent's directory can never be re-synced. This module keeps the receipt.
 *
 * The registry is a single dot-file in the user skill root rather than a
 * sidecar inside each skill directory, because a sidecar would show up in the
 * skill's own file tree — and, for a skill with `scripts/`, would be shipped
 * wherever the skill is copied next.
 *
 * @module dsh-skill-center/provenance
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Registry file name, dot-prefixed so the harness's scanner never sees it. */
export const PROVENANCE_FILE = '.skill-center.json'

/** Schema version, so a future shape change can migrate instead of guess. */
const VERSION = 1

/**
 * Serialize read-modify-write cycles per registry path.
 *
 * Two installs racing each other would otherwise both read the old registry
 * and the second write would drop the first skill's receipt.
 */
const queues = new Map()

/**
 * Run a function with exclusive access to one registry file.
 * @param path - absolute registry path.
 * @param task - the critical section.
 * @returns whatever the task returned.
 */
function withLock(path, task) {
  const previous = queues.get(path) ?? Promise.resolve()
  const next = previous.then(task, task)
  // Keep the chain alive but never let a rejection poison the next waiter.
  queues.set(path, next.then(() => undefined, () => undefined))
  return next
}

/**
 * Hash the part of a skill that carries its meaning.
 *
 * Only `SKILL.md` is hashed: it is what every adapter can re-fetch cheaply, and
 * it is the file whose frontmatter decides whether the skill works at all.
 * {@link hashTree} is the thorough counterpart, used when the whole file set is
 * already in hand.
 * @param files - the installed file set.
 * @returns a hex sha256 of the SKILL.md content, or `''` when there is none.
 */
export function hashSkillFiles(files) {
  const skill = files.find((file) => file.path === 'SKILL.md')
  if (skill === undefined) return ''
  return createHash('sha256').update(String(skill.content ?? ''), 'utf8').digest('hex')
}

/**
 * Hash an entire file set, under the bytes each file will be written as.
 *
 * This is what makes an update check able to notice that `scripts/build.py`
 * changed while `SKILL.md` did not. Hashing the *decoded* bytes rather than the
 * text matters: a base64-decoded PNG and a UTF-8 markdown file must each hash
 * to what a re-download of the same commit would produce, and to nothing else.
 * @param files - the file set, as `{path, content, encoding}` or with a `bytes` buffer.
 * @returns a hex sha256 over the paths and contents, or `''` for an empty set.
 */
export function hashTree(files) {
  if (files.length === 0) return ''
  const digest = createHash('sha256')
  // Sorted so that the order two different fetches happened to return files in
  // cannot change the answer.
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  for (const file of sorted) {
    const bytes = Buffer.isBuffer(file.bytes)
      ? file.bytes
      : Buffer.from(String(file.content ?? ''), file.encoding === 'base64' ? 'base64' : 'utf8')
    // The path and the length go in too, so that renaming a file or splicing
    // one file's tail onto another's head cannot collide with the real thing.
    digest.update(`${file.path}\0${bytes.length}\0`)
    digest.update(bytes)
  }
  return digest.digest('hex')
}

/**
 * Read the whole registry.
 * @param root - absolute user skill root.
 * @returns the parsed registry, or an empty one when absent or corrupt.
 */
export async function readProvenance(root) {
  try {
    const raw = await readFile(join(root, PROVENANCE_FILE), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.skills !== 'object' || parsed.skills === null) {
      return { version: VERSION, skills: {} }
    }
    return { version: VERSION, skills: parsed.skills }
  } catch {
    // A missing registry is the normal first-run case; a corrupt one is not
    // worth failing an install over.
    return { version: VERSION, skills: {} }
  }
}

/**
 * Replace the registry, atomically.
 * @param root - absolute user skill root.
 * @param data - the registry to persist.
 */
export async function writeProvenance(root, data) {
  const path = join(root, PROVENANCE_FILE)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({ version: VERSION, skills: data.skills ?? {} }, null, 2)}\n`, 'utf8')
  // Rename is atomic on the same filesystem, so a crash mid-write leaves the
  // previous registry intact rather than a truncated one.
  await rename(temporary, path)
}

/**
 * Read one skill's receipt.
 * @param root - absolute user skill root.
 * @param name - skill name.
 * @returns the record, or `undefined` when the skill was not installed by us.
 */
export async function getProvenance(root, name) {
  const data = await readProvenance(root)
  return data.skills[name]
}

/**
 * Record, replace, or (with `undefined`) forget one skill's receipt.
 * @param root - absolute user skill root.
 * @param name - skill name.
 * @param record - the record, or `undefined` to delete.
 * @returns the record that is now stored.
 */
export async function setProvenance(root, name, record) {
  return withLock(join(root, PROVENANCE_FILE), async () => {
    const data = await readProvenance(root)
    if (record === undefined) delete data.skills[name]
    else data.skills[name] = { ...record, name, updatedAt: new Date().toISOString() }
    await writeProvenance(root, data)
    return data.skills[name]
  })
}

/**
 * Batch-record several receipts in one write.
 * @param root - absolute user skill root.
 * @param records - name-to-record entries; a `undefined` value deletes.
 * @returns how many entries the registry holds afterwards.
 */
export async function mergeProvenance(root, records) {
  return withLock(join(root, PROVENANCE_FILE), async () => {
    const data = await readProvenance(root)
    for (const [name, record] of Object.entries(records)) {
      if (record === undefined) delete data.skills[name]
      else data.skills[name] = { ...record, name, updatedAt: new Date().toISOString() }
    }
    await writeProvenance(root, data)
    return Object.keys(data.skills).length
  })
}

/**
 * Carry a receipt across a rename, so a repaired skill keeps its history.
 * @param root - absolute user skill root.
 * @param from - the previous name.
 * @param to - the new name.
 * @returns the moved record, or `undefined` when there was nothing to move.
 */
export async function moveProvenance(root, from, to) {
  if (from === to) return getProvenance(root, from)
  return withLock(join(root, PROVENANCE_FILE), async () => {
    const data = await readProvenance(root)
    const record = data.skills[from]
    if (record === undefined) return undefined
    delete data.skills[from]
    data.skills[to] = { ...record, name: to, updatedAt: new Date().toISOString() }
    await writeProvenance(root, data)
    return data.skills[to]
  })
}

/**
 * Annotate installed skills with their provenance, in place.
 * @param root - absolute user skill root.
 * @param skills - the scanned skill records.
 * @returns the same records, each with a `provenance` field.
 */
export async function attachProvenance(root, skills) {
  const data = await readProvenance(root)
  return skills.map((skill) => ({ ...skill, provenance: data.skills[skill.name] }))
}
