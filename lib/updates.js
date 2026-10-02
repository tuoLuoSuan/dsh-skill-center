/**
 * Is an installed skill still what upstream says it is?
 *
 * An installed skill is a snapshot taken at one moment. Upstream fixes a typo
 * in a `description` and the catalog learns a better trigger phrase, but the
 * copy on disk keeps the old one forever — and nothing in the UI admits that
 * the skill has an origin at all.
 *
 * The check is deliberately cheap: it re-fetches only `SKILL.md`, not the
 * whole tree, because that is the file whose content decides whether the skill
 * behaves differently. A `scripts/*.py` change is invisible here, which is the
 * honest trade — re-listing every tree on every check would make the feature
 * too slow to use.
 *
 * @module dsh-skill-center/updates
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fetchRawFile } from './github.js'
import { joinPath } from './sources.js'

/** Possible answers from {@link checkUpdate}. */
export const UPDATE_STATUS = {
  /** Our copy matches upstream. */
  current: 'current',
  /** Upstream's `SKILL.md` differs from ours. */
  update: 'update',
  /** Upstream no longer has the file; the skill was deleted or moved. */
  missing: 'missing',
  /** The check could not run (offline, rate limited, source needs a key). */
  unknown: 'unknown',
  /** The skill was not installed by this plugin, so there is nothing to compare. */
  unmanaged: 'unmanaged',
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
 * @param input - the sources registry and the skill's provenance record.
 * @returns a status plus, when it differs, the upstream hash.
 */
export async function checkUpdate({ sources, record }) {
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
      return { status: remoteHash === record.sha256 ? UPDATE_STATUS.current : UPDATE_STATUS.update, checkedAt, remoteHash }
    } catch {
      return { status: UPDATE_STATUS.missing, checkedAt, message: '来源目录已经不在了。' }
    }
  }

  const adapter = sources.get(record.source)
  if (adapter === undefined) {
    return { status: UPDATE_STATUS.unknown, checkedAt, message: `未知来源：${record.source}` }
  }

  // The direct raw fetch is the fast path and covers every source whose entry
  // carried a GitHub URL, which is all of the installable ones.
  const coordinates = record.coordinates
  if (coordinates !== undefined && coordinates !== null && typeof coordinates.owner === 'string') {
    try {
      const text = await fetchRawFile({ ...coordinates, path: joinPath(coordinates.path ?? '', 'SKILL.md') }, { retries: 0 })
      if (text === undefined) {
        return { status: UPDATE_STATUS.missing, checkedAt, message: '上游已经没有这个文件了。' }
      }
      const remoteHash = hashText(text)
      return { status: remoteHash === record.sha256 ? UPDATE_STATUS.current : UPDATE_STATUS.update, checkedAt, remoteHash }
    } catch (error) {
      return { status: UPDATE_STATUS.unknown, checkedAt, message: error instanceof Error ? error.message : String(error) }
    }
  }

  // No coordinates: fall back to re-listing the tree through the adapter. This
  // is the expensive path, so it only runs for records written by hand.
  if (record.entry !== undefined && record.entry !== null && typeof adapter.files === 'function') {
    try {
      const { files } = await adapter.files(record.entry)
      const skill = files.find((file) => file.path === 'SKILL.md')
      if (skill === undefined) return { status: UPDATE_STATUS.missing, checkedAt }
      const remoteHash = hashText(skill.content)
      return { status: remoteHash === record.sha256 ? UPDATE_STATUS.current : UPDATE_STATUS.update, checkedAt, remoteHash }
    } catch (error) {
      return { status: UPDATE_STATUS.unknown, checkedAt, message: error instanceof Error ? error.message : String(error) }
    }
  }

  return { status: UPDATE_STATUS.unknown, checkedAt, message: '这条记录没有可用的上游地址。' }
}

/**
 * Check every skill that has a receipt.
 * @param input - the sources registry and the name-to-record map.
 * @returns a name-to-result map, plus a tally for the UI.
 */
export async function checkAllUpdates({ sources, records, limit = 4 }) {
  const names = Object.keys(records)
  const results = await mapLimit(names, limit, async (name) => [name, await checkUpdate({ sources, record: records[name] })])
  const map = Object.fromEntries(results)
  const tally = { total: names.length, current: 0, update: 0, missing: 0, unknown: 0, unmanaged: 0 }
  for (const result of Object.values(map)) tally[result.status] += 1
  return { results: map, tally }
}
