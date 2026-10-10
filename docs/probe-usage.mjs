#!/usr/bin/env node
/**
 * Does the usage tally count what actually ran, and does it stay cheap?
 *
 * Two things make this feature easy to get wrong in ways no screenshot shows.
 *
 * The first is the file format. A session log is a *concatenation of independent
 * zstd frames*, one per appended batch -- and `zlib.zstdDecompressSync` returns
 * after the first frame without complaining. So the obvious implementation
 * decodes a 121 KB log into 284 bytes, gets valid JSON, and reports a machine
 * where nothing has ever run. This probe therefore decodes one file the naive
 * way on purpose and asserts that the naive answer is *wrong*, so a future
 * change that "simplifies" the frame walk fails here instead of in the field.
 *
 * The second is the cache. It is keyed on each log's size and mtime, so it can
 * be wrong in both directions: too eager and it never notices a new session,
 * too sticky and deleting a log leaves its counts behind forever.
 *
 * Everything here runs against logs this file writes itself, in a temporary
 * directory. The machine's real session archive is never read, so the numbers
 * are known and the probe is fast.
 *
 * Exit codes: 0 all checks passed, 1 an assertion failed, 2 could not test.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { JsonCache } from '../lib/net.js'
import { collectSkillUsage, usageSupported } from '../lib/usage.js'

let passed = 0
const failures = []

/**
 * Record one assertion.
 *
 * Both sides of `ok` are booleans on purpose. `check` compares with `===`, so a
 * call passing the string `'false'` can never pass -- an assertion that is
 * permanently red is at least loud, but one written the other way round is
 * permanently green and silent.
 * @param label - what was being checked.
 * @param ok - whether it held.
 * @param detail - what was seen instead, when it did not.
 */
function check(label, ok, detail = '') {
  if (ok === true) {
    passed += 1
    console.log(`ok    ${label}`)
  } else {
    failures.push(label)
    console.log(`FAIL  ${label}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

/** Assert one value equals another, printing both when they differ. */
function same(label, actual, expected) {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`)
}

/* ------------------------------------------------------------------ *
 * A session log, written the way the harness writes one
 * ------------------------------------------------------------------ */

/** One `tool/call` record for the skill tool. */
function skillCall(time, name, options = {}) {
  const args = options.raw === true ? 'not json at all' : options.asObject === true ? { name } : JSON.stringify({ name })
  return JSON.stringify({ type: 'tool/call', seq: options.seq ?? 1, time, data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: args } })
}

/** One `tool/call` record for some other tool, which must not be counted. */
function otherCall(time) {
  return JSON.stringify({ type: 'tool/call', seq: 2, time, data: { turn: 1, step: 1, callId: 'c2', name: 'read', arguments: '{"file_path":"x"}' } })
}

/** One frame: a batch of lines, compressed on its own. */
function frame(lines) {
  return zlib.zstdCompressSync(Buffer.from(`${lines.join('\n')}\n`, 'utf8'))
}

/** A whole log file, built from frames the way the harness appends them. */
function log(...frames) {
  return Buffer.concat(frames)
}

const EARLY = Date.parse('2026-09-01T10:00:00Z')
const LATE = Date.parse('2026-10-05T18:30:00Z')

/* ------------------------------------------------------------------ *
 * 0. Can this runtime do it at all
 * ------------------------------------------------------------------ */

console.log('\n-- the runtime')

if (!usageSupported()) {
  console.log('This Node cannot decompress zstd, so the collector has nothing to read.')
  console.log('That is a fact about the Node in use, not about the code -- install Node 22.15 or newer.')
  process.exitCode = 2
} else {
  check('this Node can decompress zstd', typeof zlib.zstdDecompressSync === 'function')

  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-center-usage-'))
  const sessions = join(root, 'sessions')
  const cacheDir = join(root, 'cache')
  const cache = new JsonCache(cacheDir)
  const sessionLog = join(sessions, '-tmp-proj-', 's1', 'session.v4.jsonl.zstd')
  await mkdir(join(sessions, '-tmp-proj-', 's1'), { recursive: true })

  /* ---------------------------------------------------------------- *
   * 1. The multi-frame trap
   * ---------------------------------------------------------------- */

  console.log('\n-- the multi-frame log')

  // Two frames, and the first one is deliberately NOT the interesting one.
  const twoFrames = log(
    frame([skillCall(EARLY, 'pdf')]),
    frame([skillCall(LATE, 'brainstorming'), otherCall(LATE)]),
  )
  await writeFile(sessionLog, twoFrames)

  const naive = JSON.parse(zlib.zstdDecompressSync(twoFrames).toString('utf8').trim().split('\n')[0])
  same('the naive decode really does stop at the first frame', naive.data.arguments, '{"name":"pdf"}')
  check(
    '...so it misses the second frame entirely',
    zlib.zstdDecompressSync(twoFrames).toString('utf8').includes('brainstorming') === false,
  )

  const cold = await collectSkillUsage({ sessionsDir: sessions, cache, force: true })
  check('the collector reads the whole file', cold.available === true, JSON.stringify(cold))
  same('...and counts the call in the first frame', cold.byName.pdf?.calls, 1)
  same('...and the call in the second frame', cold.byName.brainstorming?.calls, 1)
  same('...and ignores a call to another tool', cold.byName.read, undefined)
  same('...over exactly one session log', cold.sessions, 1)

  /* ---------------------------------------------------------------- *
   * 2. What counts as a skill invocation
   * ---------------------------------------------------------------- */

  console.log('\n-- what counts')

  await writeFile(
    sessionLog,
    log(
      frame([
        // `arguments` is a JSON string on some records and an object on others.
        skillCall(EARLY, 'code-review', { asObject: true }),
        // A call whose arguments will not parse cannot be attributed to a skill,
        // and guessing would be worse than skipping it.
        skillCall(EARLY, 'ignored', { raw: true }),
        // Not JSON at all, and not a record. A log being written right now ends
        // like this, and it must not take the whole scan down.
        '{"type":"tool/call","seq":3,"time":' + EARLY,
        '',
      ]),
    ),
  )

  const shapes = await collectSkillUsage({ sessionsDir: sessions, cache, force: true })
  same('object-form arguments are counted', shapes.byName['code-review']?.calls, 1)
  same('unparseable arguments are skipped, not guessed', shapes.byName.ignored, undefined)
  check('a truncated line does not abort the scan', shapes.available === true)
  same('a skill that never ran is absent, not zero', shapes.byName.pdf, undefined)

  /* ---------------------------------------------------------------- *
   * 3. Last used
   * ---------------------------------------------------------------- */

  console.log('\n-- the last time it ran')

  await writeFile(
    sessionLog,
    log(
      frame([skillCall(LATE, 'pdf')]),
      frame([skillCall(EARLY, 'pdf')]),
    ),
  )
  const ordered = await collectSkillUsage({ sessionsDir: sessions, cache, force: true })
  same('two runs add up', ordered.byName.pdf?.calls, 2)
  same('...and the latest one wins regardless of frame order', ordered.byName.pdf?.lastUsedAt, LATE)

  /* ---------------------------------------------------------------- *
   * 4. The cache
   * ---------------------------------------------------------------- */

  console.log('\n-- the cache')

  const first = await collectSkillUsage({ sessionsDir: sessions, cache })
  const second = await collectSkillUsage({ sessionsDir: sessions, cache })
  check('a first scan decodes the log', first.available === true)
  same('...and the second one does not', second.recomputed, 0)
  same('...while reporting the same counts', second.byName.pdf?.calls, first.byName.pdf?.calls)

  // A new session is an appended frame, which is exactly what the size+mtime key
  // exists to notice.
  await writeFile(sessionLog, log(frame([skillCall(LATE, 'pdf')]), frame([skillCall(LATE, 'pdf')]), frame([skillCall(LATE, 'pdf')])))
  const grown = await collectSkillUsage({ sessionsDir: sessions, cache })
  same('a log that grew is re-read', grown.recomputed, 1)
  same('...and the new call shows up', grown.byName.pdf?.calls, 3)

  const forced = await collectSkillUsage({ sessionsDir: sessions, cache, force: true })
  same('forcing ignores the cache', forced.recomputed, 1)
  same('...and still agrees', forced.byName.pdf?.calls, 3)

  // A second session log, in another project, has to be found and merged.
  const otherLog = join(sessions, '-other-proj-', 's2', 'session.v4.jsonl.zstd')
  await mkdir(join(sessions, '-other-proj-', 's2'), { recursive: true })
  await writeFile(otherLog, log(frame([skillCall(LATE, 'pdf'), skillCall(LATE, 'nature-figure')])))
  const merged = await collectSkillUsage({ sessionsDir: sessions, cache })
  same('a second project is scanned too', merged.sessions, 2)
  same('...and its counts are merged in', merged.byName.pdf?.calls, 4)
  same('...and its own skills appear', merged.byName['nature-figure']?.calls, 1)

  // Deleting a session must not leave its counts behind. This is the failure the
  // cache would produce if it were merged in rather than rebuilt from the files
  // that are actually on disk.
  await rm(join(sessions, '-other-proj-'), { recursive: true, force: true })
  const pruned = await collectSkillUsage({ sessionsDir: sessions, cache })
  same('a deleted session is dropped', pruned.sessions, 1)
  same('...and so are its counts', pruned.byName.pdf?.calls, 3)
  same('...including skills only it had', pruned.byName['nature-figure'], undefined)

  /* ---------------------------------------------------------------- *
   * 5. Saying "I do not know"
   * ---------------------------------------------------------------- */

  console.log('\n-- no data is not zero')

  const nowhere = await collectSkillUsage({ sessionsDir: join(root, 'no-such-place'), cache })
  check('a machine with no logs reports itself unavailable', nowhere.available === false)
  same('...with a reason the UI can act on', nowhere.reason, 'no-sessions-dir')
  same('...and no counts at all', Object.keys(nowhere.byName).length, 0)

  const nameless = await collectSkillUsage({ sessionsDir: '', cache })
  same('an empty session path is refused the same way', nameless.reason, 'no-sessions-dir')

  // A directory that exists and holds nothing is the same answer, and it is the
  // one a fresh install gives. `readdir` swallowing ENOENT is what makes this
  // easy to get wrong: without the check above, both cases report a confident
  // tally of zero.
  const bareSessions = join(root, 'bare-sessions')
  await mkdir(bareSessions, { recursive: true })
  const bare = await collectSkillUsage({ sessionsDir: bareSessions, cache })
  check('an existing but empty log directory is unavailable too', bare.available === false)
  same('...with the same reason', bare.reason, 'no-sessions-dir')

  const noCache = await collectSkillUsage({ sessionsDir: sessions })
  check('a scan without a cache still answers', noCache.available === true)
  same('...correctly', noCache.byName.pdf?.calls, 3)

  await rm(root, { recursive: true, force: true })
  /* ---------------------------------------------------------------- */

  console.log('')
  if (failures.length > 0) {
    console.log(`${failures.length} check(s) failed:`)
    for (const label of failures) console.log(`  - ${label}`)
    process.exitCode = 1
  } else {
    console.log(`Every frame is read, nothing is invented, and the cache keeps up. (${passed} checks)`)
  }
}
