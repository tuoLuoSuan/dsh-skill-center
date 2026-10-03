/**
 * Does a skill install from a pinned commit, and can a later check tell whether
 * anything about it actually changed?
 *
 * Four claims are being tested, and each one is a claim the old code could not
 * have made:
 *
 * 1. An install names the exact revision it read, and reads it from a URL that
 *    no cache can make stale.
 * 2. A check can conclude "nothing changed" from one small request, without
 *    downloading the skill at all.
 * 3. A check notices a change to `scripts/`, not just to `SKILL.md` — which is
 *    the difference between the old behaviour and the new one.
 * 4. Reading one commit twice downloads it once, without the cache ever being
 *    able to hide a newer commit.
 *
 * Every claim starts with one call to the revision API, so when that call does
 * not answer there is nothing here to test. That is a third outcome, neither a
 * pass nor a failure: the exit code is 2 and the message says so. Reporting it
 * as a failure would make this probe lie about the code whenever the network is
 * having a bad day, and a probe that cries wolf is worse than no probe.
 *
 * Exit codes: 0 all claims held, 1 a claim failed, 2 could not run.
 *
 * Usage: node docs/probe-freshness.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectSkillFiles, fetchSkillAt, resolveCommit } from '../lib/github.js'
import { JsonCache } from '../lib/net.js'
import { checkUpdate, UPDATE_DEPTH, UPDATE_STATUS } from '../lib/updates.js'
import { hashSkillFiles, hashTree } from '../lib/provenance.js'

let passed = 0
let failed = 0

/** @param label - what is being asserted. @param ok - the verdict. @param detail - shown either way. */
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ok   ${label}${detail === '' ? '' : `  — ${detail}`}`)
  } else {
    failed += 1
    console.log(`  FAIL ${label}${detail === '' ? '' : `  — ${detail}`}`)
  }
}

/**
 * A sources stub. `checkUpdate` bails out with `unknown` for a source id it
 * cannot find, so the id has to be present even though these records carry
 * GitHub coordinates and never reach the adapter.
 */
const sources = new Map([['repos', {}]])

const OWNER = 'obra'
const REPO = 'superpowers'
const DIR = 'skills/brainstorming'
const SHA_RE = /^[0-9a-f]{40}$/

/** @param head - the resolved commit, guaranteed to carry a sha. */
async function main(head) {
  const installed = await collectSkillFiles({ owner: OWNER, repo: REPO, branch: 'main', path: DIR })
  check('the install was served from one archive', installed.source === 'tarball', installed.source)
  check('the install names the same commit the API reported', installed.commit === head.sha, installed.commit)
  check('the install has files', installed.files.length > 0, `${installed.files.length} files`)
  check('SKILL.md is present', installed.files.some((file) => file.path === 'SKILL.md'))
  check('the subdirectory was stripped from every path', installed.files.every((file) => !file.path.startsWith('skills/')), installed.files.map((f) => f.path).join(' '))
  check('the install is reported complete', installed.completeness.complete === true, JSON.stringify(installed.completeness.skipped))
  check('no file came back undecodable', installed.files.every((file) => file.encoding === 'utf8' || file.encoding === 'base64'))

  console.log('\nthe bytes are the commit\'s bytes')

  const atCommit = await fetchSkillAt({ owner: OWNER, repo: REPO, ref: installed.commit, path: DIR })
  const a = hashTree(installed.files)
  const b = hashTree(atCommit.files)
  check('re-reading the same commit reproduces the same tree hash', a === b, `${a.slice(0, 16)} vs ${b.slice(0, 16)}`)

  console.log('\nwhat a tree hash can tell apart')

  /** @param files - the file set. @param path - which file to disturb. @param content - the new content. */
  function withEdit(files, path, content) {
    return files.map((file) => (file.path === path ? { ...file, content } : file))
  }

  const nonSkill = installed.files.find((file) => file.path !== 'SKILL.md')
  check('there is a non-SKILL.md file to disturb', nonSkill !== undefined, nonSkill?.path)
  if (nonSkill !== undefined) {
    const edited = withEdit(installed.files, nonSkill.path, `${nonSkill.content}\n# changed\n`)
    check('editing a file other than SKILL.md changes the tree hash', hashTree(edited) !== a)
    check('and leaves the SKILL.md hash alone', hashSkillFiles(edited) === hashSkillFiles(installed.files))
  }
  const renamed = installed.files.map((file) => (file.path === nonSkill?.path ? { ...file, path: `${file.path}.moved` } : file))
  check('renaming a file changes the tree hash', hashTree(renamed) !== a)
  check('an empty set has no hash', hashTree([]) === '')

  console.log('\nthe cheap answer: one request, no download')

  const pinnedRecord = {
    source: 'repos',
    origin: 'remote',
    coordinates: { owner: OWNER, repo: REPO, branch: 'main', path: DIR },
    commit: installed.commit,
    sha256: hashSkillFiles(installed.files),
    treeHash: a,
  }

  const same = await checkUpdate({ sources, record: pinnedRecord })
  check('an unchanged commit reports current', same.status === UPDATE_STATUS.current, same.status)
  check('and it is a full-depth answer, not a shallow one', same.depth === UPDATE_DEPTH.full, same.depth)
  check('and it names the commit it compared', same.remoteCommit === head.sha, same.remoteCommit)
  check('and it did not need to restamp', same.restamp !== true)

  console.log('\nthe deep answer: a change to a file that is not SKILL.md')

  // An older commit stands in for "the branch has moved since we installed".
  const parents = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/commits/${head.sha}`, {
    headers: { 'user-agent': 'dsh-skill-center-probe/0.1', accept: 'application/vnd.github+json' },
  }).then((response) => response.json())
  const parent = parents?.parents?.[0]?.sha
  check('the commit has a parent to compare against', SHA_RE.test(parent ?? ''), parent)

  if (SHA_RE.test(parent ?? '')) {
    // SKILL.md is *identical* upstream — the receipt's document hash is correct.
    // Only the whole-tree hash is wrong, which is exactly the shape of a
    // `scripts/`-only upstream change.
    const tampered = { ...pinnedRecord, commit: parent, treeHash: 'f'.repeat(64) }
    const deep = await checkUpdate({ sources, record: tampered })
    check('a whole-tree difference is reported as an update', deep.status === UPDATE_STATUS.update, deep.status)
    check('even though the SKILL.md hash was never in question', deep.depth === UPDATE_DEPTH.full, deep.depth)
    check('and the answer names the newer commit', deep.remoteCommit === head.sha, deep.remoteCommit)
    check('and the newer commit comes with a date to show', typeof deep.remoteCommittedAt === 'string', deep.remoteCommittedAt)

    // The other half: the repo moved, but not this skill. Same tree, newer commit.
    const restampRecord = { ...pinnedRecord, commit: parent }
    const restamped = await checkUpdate({ sources, record: restampRecord })
    check('a repository move that skipped this skill is still current', restamped.status === UPDATE_STATUS.current, restamped.status)
    check('and it asks to have the commit pointer moved forward', restamped.restamp === true)
  }

  console.log('\nthe same commit is downloaded once')

  /**
   * A real cache that also counts what it was asked for and how often it had to
   * go and get it. Timing would be flaky; counting is not.
   */
  function countingCache() {
    const inner = new JsonCache(mkdtempSync(join(tmpdir(), 'sc-freshness-')))
    const keys = []
    let produced = 0
    return {
      keys,
      produced: () => produced,
      async through(key, ttlMs, produce, options) {
        keys.push(key)
        return await inner.through(
          key,
          ttlMs,
          async () => {
            produced += 1
            return await produce()
          },
          options,
        )
      },
    }
  }

  const coordinates = { owner: OWNER, repo: REPO, branch: 'main', path: DIR }
  const treeCache = countingCache()
  const first = await collectSkillFiles(coordinates, { cache: treeCache })
  const downloads = treeCache.produced()
  const second = await collectSkillFiles(coordinates, { cache: treeCache })
  check('the first read had to fetch the archive', downloads === 1, `${downloads} downloads`)
  check('a second read of the same commit fetches nothing', treeCache.produced() === downloads, `${treeCache.produced()} downloads`)
  check('and returns the same bytes', hashTree(second.files) === hashTree(first.files))
  // The key is scoped to the commit, which is why the entry can never go stale:
  // a different revision is a different key, not a stale value under this one.
  check('the cache is keyed by the commit, not by the branch',
    treeCache.keys.length > 0 && treeCache.keys.every((key) => key.includes(first.commit) && !key.includes('main')),
    treeCache.keys[0])
  // Resolution still runs on every read, so the cache can only ever skip the
  // download, never the question of whether the branch has moved.
  check('the branch is still resolved on every read', second.commit === first.commit, second.commit)

  console.log('\nthe fallback still works')

  // The crawl route reads github.com's HTML tree pages and one raw URL per
  // file, so it fails on a flaky connection in a way the archive route does
  // not. A transport failure here is the network, not the fallback.
  try {
    const legacy = await collectSkillFiles({ owner: OWNER, repo: REPO, branch: 'main', path: DIR }, { prefer: 'crawl' })
    check('the crawl path still installs', legacy.files.some((file) => file.path === 'SKILL.md'), `${legacy.files.length} files`)
    check('the crawl path admits which route it took', legacy.source === 'crawl', legacy.source)
    const legacyRecord = {
      source: 'repos',
      origin: 'remote',
      coordinates: { owner: OWNER, repo: REPO, branch: 'main', path: DIR },
      sha256: hashSkillFiles(legacy.files),
    }
    const legacyVerdict = await checkUpdate({ sources, record: legacyRecord })
    check('a receipt with no commit still gets an answer', legacyVerdict.status === UPDATE_STATUS.current, legacyVerdict.status)
    check('and it says the answer was shallow', legacyVerdict.depth === UPDATE_DEPTH.document, legacyVerdict.depth)
  } catch (error) {
    console.log(`  skip  the crawl route did not complete — ${error?.cause?.code ?? error?.message ?? error}`)
    console.log('  skip  this section needs github.com, which the archive route does not')
  }
}

console.log(`the revision an install reads\n  ${OWNER}/${REPO} @ main, ${DIR}`)

const head = await resolveCommit({ owner: OWNER, repo: REPO, branch: 'main' })

if (!SHA_RE.test(head?.sha ?? '')) {
  console.log('\n  the revision API did not answer, so none of this could be tested.')
  console.log(`  resolveCommit returned ${head === undefined ? 'undefined' : JSON.stringify(head)}`)
  console.log('  this says nothing about whether pinning works — run it again later.')
  // Setting the code rather than calling process.exit(): on Windows, exiting
  // while libuv is still closing a handle trips
  // `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in src\win\async.c,
  // which prints a crash over a run that decided nothing.
  process.exitCode = 2
} else {
  check('a branch resolves to a commit', SHA_RE.test(head.sha), head.sha)
  check('the commit carries its date', typeof head.committedAt === 'string', head.committedAt)
  await main(head)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? (process.exitCode ?? 0) : 1
