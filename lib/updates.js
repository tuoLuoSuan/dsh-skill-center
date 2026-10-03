/**
 * Is an installed skill still what upstream says it is?
 *
 * An installed skill is a snapshot taken at one moment. Upstream fixes a typo
 * in a `description` and the catalog learns a better trigger phrase, but the
 * copy on disk keeps the old one forever — and nothing in the UI admits that
 * the skill has an origin at all.
 *
 * The check is ordered by what it costs:
 *
 * 1. **A pinned commit.** A receipt written since commit-pinning landed records
 *    the exact revision it installed. Asking GitHub which commit the branch
 *    points at now is one small request, and if the answer is the same commit
 *    then nothing can have changed — a commit id names a fixed tree, so there
 *    is no need to look at a single file. This is the common case and it costs
 *    no download at all.
 * 2. **The tree at the new commit.** Only when the branch has moved. The whole
 *    repository arrives in one request at that pinned revision and is hashed
 *    file by file, which is what lets a change to `scripts/build.py` be noticed
 *    at all — a `SKILL.md`-only comparison cannot see one.
 * 3. **A bare `SKILL.md` fetch.** The fallback for receipts written before
 *    commit-pinning, and for when the API's sixty-an-hour anonymous budget is
 *    spent. Cheap, and honest about being shallow: it answers "did the
 *    frontmatter change", not "did the skill change".
 *
 * @module dsh-skill-center/updates
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fetchRawFile, fetchSkillAt, resolveCommit } from './github.js'
import { hashTree } from './provenance.js'
import { joinPath } from './sources.js'

/** Possible answers from {@link checkUpdate}. */
export const UPDATE_STATUS = {
  /** Our copy matches upstream. */
  current: 'current',
  /** Upstream differs from our copy. */
  update: 'update',
  /** Upstream no longer has the file; the skill was deleted or moved. */
  missing: 'missing',
  /** The check could not run (offline, rate limited, source needs a key). */
  unknown: 'unknown',
  /** The skill was not installed by this plugin, so there is nothing to compare. */
  unmanaged: 'unmanaged',
}

/**
 * How much of the skill the comparison actually covered.
 *
 * A shallow answer is still an answer, but the two must not be presented as if
 * they were the same claim.
 */
export const UPDATE_DEPTH = {
  /** Compared against the whole file set at a pinned revision. */
  full: 'full',
  /** Compared only `SKILL.md`, at whatever revision the branch served. */
  document: 'document',
}

/**
 * Hash one document the same way provenance records it.
 * @param text - the `SKILL.md` content.
 * @returns a hex sha256.
 */
function hashText(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
}

/**
 * Run `task` over `items`, at most `limit` at a time.
 * @param items - the work list.
 * @param limit - maximum concurrent tasks.
 * @param task - the async work, called with `(item, index)`.
 * @returns results in the original order.
 */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Compare one installed skill against its origin.
 * @param input - the sources registry, the skill's provenance record, and an optional cache.
 * @returns a status, how deeply it was checked, and the upstream revision.
 */
export async function checkUpdate({ sources, record, cache }) {
  const checkedAt = new Date().toISOString()
  if (record === undefined || typeof record !== 'object') {
    return { status: UPDATE_STATUS.unmanaged, checkedAt }
  }

  // A locally imported skill is checked against the directory it came from —
  // the other agent's copy is the upstream, and it can be edited there.
  if (record.origin === 'local') {
    if (typeof record.from !== 'string' || record.from === '') {
      return { status: UPDATE_STATUS.unknown, checkedAt, message: '这条记录没有记住来源目录。' }
    }
    try {
      const text = await readFile(record.from, 'utf8')
      const remoteHash = hashText(text)
      return {
        status: remoteHash === record.sha256 ? UPDATE_STATUS.current : UPDATE_STATUS.update,
        checkedAt,
        remoteHash,
        depth: UPDATE_DEPTH.document,
      }
    } catch {
      return { status: UPDATE_STATUS.missing, checkedAt, message: '来源目录已经不在了。' }
    }
  }

  const adapter = sources.get(record.source)
  if (adapter === undefined) {
    return { status: UPDATE_STATUS.unknown, checkedAt, message: `未知来源：${record.source}` }
  }

  const coordinates = record.coordinates
  const usable = coordinates !== undefined && coordinates !== null && typeof coordinates.owner === 'string'

  // Step 1: a pinned commit, and the branch's current commit. Equal means
  // nothing upstream can have changed, and this is the only request needed.
  if (usable && typeof record.commit === 'string' && record.commit !== '') {
    const head = await resolveCommit(coordinates)
    if (head !== undefined) {
      if (head.sha === record.commit) {
        return {
          status: UPDATE_STATUS.current,
          checkedAt,
          depth: UPDATE_DEPTH.full,
          remoteCommit: head.sha,
          remoteCommittedAt: head.committedAt,
        }
      }
      // Step 2: the branch moved, so find out whether *this skill* moved with
      // it. Repositories are moved by changes to other directories all the
      // time, and reporting those as an available update would be a lie the
      // user cannot check.
      try {
        // Same commit, same tree, so this reuses whatever the install already
        // read out of this revision instead of downloading it a second time.
        const key = `skill-center/tree/${coordinates.owner}/${coordinates.repo}/${head.sha}/${coordinates.path ?? ''}`
        const { files } =
          cache === undefined
            ? await fetchSkillAt({
                owner: coordinates.owner,
                repo: coordinates.repo,
                ref: head.sha,
                path: coordinates.path ?? '',
              })
            : (
                await cache.through(
                  key,
                  Number.POSITIVE_INFINITY,
                  () =>
                    fetchSkillAt({
                      owner: coordinates.owner,
                      repo: coordinates.repo,
                      ref: head.sha,
                      path: coordinates.path ?? '',
                    }),
                  { allowStaleOnError: false },
                )
              ).value
        const remoteHash = hashTree(files)
        if (typeof record.treeHash === 'string' && remoteHash === record.treeHash) {
          // Identical content at a newer commit: still current, and the receipt
          // may as well move forward so the next check is one cheap request
          // again rather than another whole-tree download.
          return {
            status: UPDATE_STATUS.current,
            checkedAt,
            depth: UPDATE_DEPTH.full,
            remoteHash,
            remoteCommit: head.sha,
            remoteCommittedAt: head.committedAt,
            restamp: true,
          }
        }
        return {
          status: UPDATE_STATUS.update,
          checkedAt,
          depth: UPDATE_DEPTH.full,
          remoteHash,
          remoteCommit: head.sha,
          remoteCommittedAt: head.committedAt,
        }
      } catch (error) {
        const message = String(error?.message ?? error)
        if (message.startsWith('SKILL.md not found')) {
          return { status: UPDATE_STATUS.missing, checkedAt, message: '上游已经没有这个技能了。', remoteCommit: head.sha }
        }
        return { status: UPDATE_STATUS.unknown, checkedAt, message }
      }
    }
  }

  if (!usable) {
    // No coordinates: fall back to re-listing the tree through the adapter.
    // This is the expensive path, so it only runs for records written by hand.
    if (record.entry !== undefined && record.entry !== null && typeof adapter.files === 'function') {
      try {
        const { files, commit } = await adapter.files(record.entry)
        const skill = files.find((file) => file.path === 'SKILL.md')
        if (skill === undefined) return { status: UPDATE_STATUS.missing, checkedAt }
        const remoteHash = hashText(skill.content)
        return {
          status: remoteHash === record.sha256 ? UPDATE_STATUS.current : UPDATE_STATUS.update,
          checkedAt,
          remoteHash,
          remoteCommit: commit,
          depth: UPDATE_DEPTH.document,
        }
      } catch (error) {
        return { status: UPDATE_STATUS.unknown, checkedAt, message: error instanceof Error ? error.message : String(error) }
      }
    }
    return { status: UPDATE_STATUS.unknown, checkedAt, message: '这条记录没有可用的上游地址。' }
  }

  // Step 3: no pinned commit, or the API would not answer. The direct raw fetch
  // is the fast path and covers every source whose entry carried a GitHub URL.
  try {
    const text = await fetchRawFile({ ...coordinates, path: joinPath(coordinates.path ?? '', 'SKILL.md') }, { retries: 0 })
    if (text === undefined) {
      return { status: UPDATE_STATUS.missing, checkedAt, message: '上游已经没有这个文件了。' }
    }
    const remoteHash = hashText(text)
    return {
      status: remoteHash === record.sha256 ? UPDATE_STATUS.current : UPDATE_STATUS.update,
      checkedAt,
      remoteHash,
      depth: UPDATE_DEPTH.document,
    }
  } catch (error) {
    return { status: UPDATE_STATUS.unknown, checkedAt, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Check every skill that has a receipt.
 * @param input - the sources registry, the name-to-record map, and an optional cache.
 * @returns a name-to-result map, plus a tally for the UI.
 */
export async function checkAllUpdates({ sources, records, cache, limit = 4 }) {
  const names = Object.keys(records)
  const results = await mapLimit(names, limit, async (name) => [name, await checkUpdate({ sources, record: records[name], cache })])
  const map = Object.fromEntries(results)
  const tally = { total: names.length, current: 0, update: 0, missing: 0, unknown: 0, unmanaged: 0 }
  for (const result of Object.values(map)) tally[result.status] += 1
  return { results: map, tally }
}
