/**
 * How often each installed skill has actually been invoked.
 *
 * "I have forty skills and no idea which ones I use" is the question an
 * installed list cannot answer by itself, and it is answerable: every skill
 * invocation is a `skill` tool call with `{"name": ...}` for arguments, and
 * every tool call is in the session logs.
 *
 * The logs are `~/.dsh/sessions/<project>/<session>/session.v4.jsonl.zstd`,
 * which is a concatenation of independent zstd frames -- one per appended
 * batch. Both `zstdDecompressSync` and the stream decoder stop after the FIRST
 * frame, so reading one naively turns a 121 KB log into 284 bytes and still
 * looks like a successful decode. The frames have to be split on their magic
 * number and decoded one at a time, which is also what keeps peak memory to a
 * single frame instead of the whole archive.
 *
 * @module dsh-skill-center/usage
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import zlib from 'node:zlib'

/** zstd frame magic, little-endian `28 B5 2F FD`. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** The tool a skill invocation travels under, and how its name is spelled. */
const SKILL_TOOL = 'skill'
const SKILL_ARG = 'name'

/** Cache key for the per-file tally, under the plugin's existing cache dir. */
export const USAGE_CACHE_KEY = 'skill-usage'

/**
 * Whether this Node can decompress zstd at all.
 *
 * `zlib.zstdDecompressSync` landed in Node 22.15 and the plugin's floor is 20,
 * so this is a real branch and not a formality. When it is missing the feature
 * reports itself unavailable rather than reporting zero uses -- "no data" and
 * "never used" are different answers and the UI must not merge them.
 * @returns true when the runtime can decode the logs.
 */
export function usageSupported() {
  return typeof zlib.zstdDecompressSync === 'function'
}

/**
 * Split a multi-frame zstd buffer and decode one frame at a time.
 *
 * A generator rather than an array: the archive is tens of megabytes compressed
 * and hundreds uncompressed, and a caller that only ever wants one frame's
 * worth of records at once should not pay for the rest.
 * @param bytes - the whole file.
 * @yields the UTF-8 text of one frame.
 */
function* decodeFrames(bytes) {
  const offsets = []
  for (let at = bytes.indexOf(ZSTD_MAGIC); at !== -1; at = bytes.indexOf(ZSTD_MAGIC, at + 1)) offsets.push(at)
  for (let i = 0; i < offsets.length; i += 1) {
    const slice = bytes.subarray(offsets[i], offsets[i + 1] ?? bytes.length)
    try {
      yield zlib.zstdDecompressSync(slice).toString('utf8')
    } catch {
      // A truncated tail frame is the normal state of a log being written right
      // now, and a file that is not zstd at all lands here too. Either way the
      // rest of the frames are still worth reading.
    }
  }
}

/**
 * Count skill invocations in one decoded session log.
 *
 * The `time` field is on the record itself, so "last used" costs nothing extra.
 * @param text - decoded frames, concatenated in any order.
 * @param into - tally to accumulate into.
 */
function countInText(text, into) {
  for (const line of text.split('\n')) {
    // Cheap pre-filter before `JSON.parse`. The line is `{"type":"tool/call",...}`
    // and parsing hundreds of megabytes of records to discard almost all of them
    // is the difference between a scan that finishes and one that does not.
    if (!line.includes(`"${SKILL_TOOL}"`)) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.type !== 'tool/call' || record.data?.name !== SKILL_TOOL) continue
    const args = record.data.arguments
    // `arguments` is a JSON string on some records and an object on others;
    // accept both rather than silently counting half the invocations.
    let parsed = args
    if (typeof args === 'string') {
      try {
        parsed = JSON.parse(args)
      } catch {
        continue
      }
    }
    const name = parsed?.[SKILL_ARG]
    if (typeof name !== 'string' || name === '') continue
    const calls = (into.calls[name] ?? 0) + 1
    into.calls[name] = calls
    const when = Number(record.time)
    if (Number.isFinite(when) && when > (into.last[name] ?? 0)) into.last[name] = when
  }
}

/**
 * Every session log under a harness home.
 * @param sessionsDir - `<dshHome>/sessions`.
 * @returns absolute paths, unsorted.
 */
async function sessionFiles(sessionsDir) {
  const found = []
  const projects = await readdir(sessionsDir, { withFileTypes: true }).catch(() => [])
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const inside = await readdir(join(sessionsDir, project.name), { withFileTypes: true }).catch(() => [])
    for (const session of inside) {
      if (!session.isDirectory()) continue
      found.push(join(sessionsDir, project.name, session.name, 'session.v4.jsonl.zstd'))
    }
  }
  return found
}

/**
 * Read one file's tally, reusing the previous answer when nothing changed.
 *
 * The validity key is `size` plus `mtimeMs`. A session log only ever grows, so
 * size alone would mostly work -- but a rewrite that happens to land on the same
 * length would then be missed, and mtime costs one stat either way.
 * @param path - the session log.
 * @param previous - the stored tally for this path, if any.
 * @returns the tally and whether it was recomputed.
 */
async function tallyFile(path, previous) {
  let info
  try {
    info = await stat(path)
  } catch {
    return undefined
  }
  if (
    previous !== undefined &&
    previous.size === info.size &&
    previous.mtimeMs === info.mtimeMs &&
    previous.calls !== undefined
  ) {
    return { entry: previous, decoded: false }
  }
  let bytes
  try {
    bytes = await readFile(path)
  } catch {
    return undefined
  }
  const into = { calls: {}, last: {} }
  for (const frame of decodeFrames(bytes)) countInText(frame, into)
  return { entry: { size: info.size, mtimeMs: info.mtimeMs, calls: into.calls, last: into.last }, decoded: true }
}

/**
 * Tally every skill invocation this machine has ever recorded.
 *
 * Incremental by construction: one entry per session log, keyed by the log's own
 * size and mtime, so the second call stats N files instead of decompressing
 * them. `force` exists for the probe, which has to be able to prove the cache is
 * not what is producing the numbers.
 * @param options - session directory, cache, and whether to ignore the cache.
 * @returns per-skill counts, plus what the scan cost so the UI can be honest
 *   about how fresh the numbers are.
 */
export async function collectSkillUsage(options = {}) {
  const sessionsDir = options.sessionsDir
  const cache = options.cache
  const force = options.force === true
  const empty = { available: false, reason: 'unsupported', byName: {}, sessions: 0, bytes: 0, scannedAt: Date.now(), ms: 0 }
  if (!usageSupported()) return empty
  if (typeof sessionsDir !== 'string' || sessionsDir === '') return { ...empty, reason: 'no-sessions-dir' }

  const started = Date.now()
  const stored = force ? undefined : await cache?.read(USAGE_CACHE_KEY)
  const previous = stored?.value?.files ?? {}
  const files = await sessionFiles(sessionsDir)
  // An unreadable directory and a directory with nothing in it are the same
  // answer to the user's question, and neither one is "zero": a tally of nobody
  // says nothing about which skills run. Saying "unavailable" keeps the two
  // apart all the way to the screen, where the distinction is the difference
  // between an empty column and a broken one.
  if (files.length === 0) return { ...empty, reason: 'no-sessions-dir' }
  const next = {}
  const merged = { calls: {}, last: {} }
  let bytes = 0
  let recomputed = 0

  for (const path of files) {
    const result = await tallyFile(path, previous[path])
    if (result === undefined) continue
    next[path] = result.entry
    if (result.decoded) {
      recomputed += 1
      bytes += result.entry.size
    }
    for (const [name, count] of Object.entries(result.entry.calls ?? {})) {
      merged.calls[name] = (merged.calls[name] ?? 0) + count
    }
    for (const [name, when] of Object.entries(result.entry.last ?? {})) {
      if (when > (merged.last[name] ?? 0)) merged.last[name] = when
    }
  }

  // Only write when the picture actually moved. A read-only scan of an unchanged
  // archive should not touch the disk at all.
  const changed = force || recomputed > 0 || Object.keys(previous).length !== Object.keys(next).length
  if (changed && cache !== undefined) {
    await cache.write(USAGE_CACHE_KEY, { files: next }, 0).catch(() => {})
  }

  const byName = {}
  for (const [name, calls] of Object.entries(merged.calls)) {
    byName[name] = { calls, lastUsedAt: merged.last[name] ?? 0 }
  }
  return {
    available: true,
    byName,
    sessions: files.length,
    bytes,
    recomputed,
    scannedAt: Date.now(),
    ms: Date.now() - started,
  }
}
