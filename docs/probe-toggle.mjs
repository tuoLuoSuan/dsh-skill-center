#!/usr/bin/env node
/**
 * Does the invocation switch do what it says, and nothing else?
 *
 * The switch is the only feature in this plugin that rewrites a file the user
 * owns. Two things can go wrong and both are quiet: the harness rejects a
 * frontmatter it does not recognise, so a wrong key does not disable a skill
 * -- it removes it from the catalog; and a rewrite that re-serialises the
 * document damages a file the user may have written by hand or committed.
 *
 * So this probe asks three questions rather than one:
 *   - does a flip produce the exact bytes the harness reads as "off"?
 *   - does flipping back produce the *original* bytes, byte for byte?
 *   - does a document the switch cannot safely edit get refused instead of
 *     half-written?
 *
 * Exit codes: 0 all checks passed, 1 an assertion failed, 2 could not test.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INVOCATION_KEYS, parseSkillDocument, readInvocation, setFrontmatterFlag } from '../lib/frontmatter.js'
import { findWritableSkill, setSkillInvocation } from '../lib/skills-dir.js'

let passed = 0
const failures = []

/**
 * Record one assertion.
 * @param label - what was being checked.
 * @param ok - whether it held.
 * @param detail - what was seen instead, when it did not.
 */
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`ok    ${label}`)
  } else {
    failures.push(label)
    console.log(`FAIL  ${label}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

/** Assert one string equals another, printing both when they differ. */
function same(label, actual, expected) {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`)
}

/** The frontmatter a normal installed skill has. */
const PLAIN = [
  '---',
  'name: pdf',
  'description: Extract text and tables from PDFs. Use when: reading a PDF.',
  'license: MIT',
  '---',
  '',
  '# pdf',
  '',
  'Body text stays.',
  '',
].join('\n')

/** Frontmatter that already carries other people's comments and ordering. */
const COMMENTED = [
  '---',
  '# written by hand, do not reflow',
  'name: code-review',
  'description: Review a diff.',
  'allowed-tools: Read, Grep',
  'metadata:',
  '  disable-model-invocation: true',
  '---',
  '',
  'Body.',
  '',
].join('\n')

/* ------------------------------------------------------------------ *
 * 1. The line edit itself
 * ------------------------------------------------------------------ */

console.log('\n-- the frontmatter edit')

const off = setFrontmatterFlag(PLAIN, INVOCATION_KEYS.model, true)
same('disabling writes the key the harness reads', off.text.split('\n')[1], 'disable-model-invocation: true')
check('disabling leaves the body alone', off.text.endsWith('\n# pdf\n\nBody text stays.\n'))
check('the other fields survive', off.text.includes('license: MIT') && off.text.includes('description: Extract text'))

const back = setFrontmatterFlag(off.text, INVOCATION_KEYS.model, false)
same('enabling again restores the original bytes', back.text, PLAIN)

const twice = setFrontmatterFlag(off.text, INVOCATION_KEYS.model, true)
check('disabling twice is a no-op', twice.changed === false && twice.text === off.text)

const alreadyOn = setFrontmatterFlag(PLAIN, INVOCATION_KEYS.model, false)
check('enabling an enabled skill is a no-op', alreadyOn.changed === false && alreadyOn.text === PLAIN)

// A `false` value is the same state as an absent key, but the line is still
// ours to replace -- leaving `false` behind would grow the file by a line on
// every flip and never shrink back.
const explicitFalse = PLAIN.replace('name: pdf\n', 'name: pdf\ndisable-model-invocation: false\n')
const replaced = setFrontmatterFlag(explicitFalse, INVOCATION_KEYS.model, true)
check('an explicit false is replaced, not duplicated',
  (replaced.text.match(/disable-model-invocation/g) ?? []).length === 1, replaced.text)
check('replacing preserves the rest', replaced.text.includes('license: MIT') && replaced.text.includes('# pdf'))

// Nested keys are a different field that happens to share a name. The harness
// reads only the top level, so writing to the nested one would be a no-op that
// reports success.
check('indented keys are not touched', setFrontmatterFlag(COMMENTED, INVOCATION_KEYS.model, false).text === COMMENTED)
const nestedOn = setFrontmatterFlag(COMMENTED, INVOCATION_KEYS.model, true)
same('a top-level key is inserted above a nested one of the same name', nestedOn.text.split('\n')[1], 'disable-model-invocation: true')
check('the nested key is still there', nestedOn.text.includes('\n  disable-model-invocation: true\n'))

// CRLF is what a Windows editor writes, and a round trip that silently
// normalises it would show up as a whole-file diff in the user's git status.
const crlf = PLAIN.replace(/\n/g, '\r\n')
const crlfOff = setFrontmatterFlag(crlf, INVOCATION_KEYS.model, true)
check('CRLF is preserved on the way out', crlfOff.text.includes('\r\ndisable-model-invocation: true\r\n'))
same('CRLF round-trips exactly', setFrontmatterFlag(crlfOff.text, INVOCATION_KEYS.model, false).text, crlf)

check('a document with no frontmatter is refused', setFrontmatterFlag('# just a body\n', INVOCATION_KEYS.model, true).error !== undefined)
check('an unterminated frontmatter is refused', setFrontmatterFlag('---\nname: x\n', INVOCATION_KEYS.model, true).error !== undefined)
const emptyBlock = setFrontmatterFlag('---\n---\n\nBody.\n', INVOCATION_KEYS.model, true)
same('an empty frontmatter still gets a valid line',
  emptyBlock.text, '---\ndisable-model-invocation: true\n---\n\nBody.\n')

/* ------------------------------------------------------------------ *
 * 2. Reading the state the way the harness reads it
 * ------------------------------------------------------------------ */

console.log('\n-- the harness rules')

const absent = readInvocation({ name: 'x' })
check('an absent key means the model may invoke it', absent.modelInvocable === true && absent.userInvocable === true)
check('no problems on a clean document', absent.problems.length === 0)

const spelled = ['true', 'yes', 'on', '1', 1, true]
check('every spelling the harness accepts reads as disabled',
  spelled.every((value) => readInvocation({ 'disable-model-invocation': value }).modelInvocable === false))
check('a value the harness rejects is reported, not rounded down',
  readInvocation({ 'disable-model-invocation': 'maybe' }).problems.length === 1)
check('the legacy camelCase spelling is reported',
  readInvocation({ disableModelInvocation: true }).problems.length === 1)
// The legacy key reads as *enabled*, because it is not the field the harness
// consults -- which is precisely why it has to be reported. The document says
// "disabled"; the harness says "no such skill".
check('...and it does not move the flag the harness reads',
  readInvocation({ disableModelInvocation: true }).modelInvocable === true)
check('user-invocable false hides it from the user only',
  readInvocation({ 'user-invocable': false }).userInvocable === false)
check('...and does not touch the model flag',
  readInvocation({ 'user-invocable': false }).modelInvocable === true)

/* ------------------------------------------------------------------ *
 * 3. The whole way through: disk, host parse, refusal
 * ------------------------------------------------------------------ */

console.log('\n-- end to end, on a real file')

const root = await mkdtemp(join(tmpdir(), 'sc-toggle-'))
const home = join(root, 'home')
const cwd = join(root, 'ws')
await mkdir(join(home, 'skills', 'pdf'), { recursive: true })
await mkdir(join(cwd, '.dsh', 'skills', 'local-one'), { recursive: true })
await writeFile(join(home, 'skills', 'pdf', 'SKILL.md'), PLAIN, 'utf8')
await writeFile(join(cwd, '.dsh', 'skills', 'local-one', 'SKILL.md'), PLAIN.replace(/pdf/g, 'local-one'), 'utf8')

const flippedOff = await setSkillInvocation(home, cwd, 'pdf', false)
check('the user root is writable', flippedOff.error === undefined, flippedOff.error ?? '')
check('...and reports the change', flippedOff.changed === true)
const onDisk = await readFile(join(home, 'skills', 'pdf', 'SKILL.md'), 'utf8')
const diskFlags = readInvocation((await parseSkillDocument(onDisk))?.data)
check('the harness would now see it as withdrawn', diskFlags.modelInvocable === false && diskFlags.problems.length === 0)
check('the body is untouched on disk', onDisk.endsWith('\n# pdf\n\nBody text stays.\n'))

const flippedOn = await setSkillInvocation(home, cwd, 'pdf', true)
check('flipping back reports a change', flippedOn.changed === true)
same('...and the file is byte-identical to before', await readFile(join(home, 'skills', 'pdf', 'SKILL.md'), 'utf8'), PLAIN)

const project = await setSkillInvocation(home, cwd, 'local-one', false)
check('a workspace skill can be switched too', project.error === undefined, project.error ?? '')
check('...and lands in the workspace, not the user root',
  project.path === join(cwd, '.dsh', 'skills', 'local-one', 'SKILL.md'), project.path ?? '')

const missing = await setSkillInvocation(home, cwd, 'not-installed', false)
check('a skill that is not there is refused with a reason', typeof missing.error === 'string' && missing.error !== '')
const traversal = await setSkillInvocation(home, cwd, '../../etc', false)
check('a name with a path separator is refused', typeof traversal.error === 'string')
const nested = await setSkillInvocation(home, cwd, 'a/b', false)
check('a nested name is refused', typeof nested.error === 'string')
check('nothing was created by the refusals', !existsSync(join(cwd, '.dsh', 'skills', 'a')))

// The older flat layout is still something the harness loads, so it has to be
// switchable too -- and the switch has to edit the file it found, not a bundle
// that is not there.
await writeFile(join(home, 'skills', 'flat-one.md'), PLAIN.replace(/pdf/g, 'flat-one'), 'utf8')
const flatFound = await findWritableSkill(home, cwd, 'flat-one')
check('a flat <name>.md is found', flatFound?.layout === 'flat', JSON.stringify(flatFound ?? null))
const flatFlipped = await setSkillInvocation(home, cwd, 'flat-one', false)
check('...and can be switched', flatFlipped.error === undefined, flatFlipped.error ?? '')
check('...in place', readInvocation((await parseSkillDocument(await readFile(join(home, 'skills', 'flat-one.md'), 'utf8')))?.data).modelInvocable === false)

// A skill under another agent's directory is readable but not ours to edit.
await mkdir(join(home, '.claude', 'skills', 'someone-elses'), { recursive: true })
await writeFile(join(home, '.claude', 'skills', 'someone-elses', 'SKILL.md'), PLAIN.replace(/pdf/g, 'someone-elses'), 'utf8')
check('another agent\u2019s skill is not found as writable', (await findWritableSkill(home, cwd, 'someone-elses')) === undefined)
check('...and the file is untouched',
  readInvocation((await parseSkillDocument(await readFile(join(home, '.claude', 'skills', 'someone-elses', 'SKILL.md'), 'utf8')))?.data).problems.length === 0)

// A file the harness would reject must be refused before it is written, or the
// toggle would be the thing that hides the skill.
await writeFile(join(home, 'skills', 'no-frontmatter.md'), 'Just a body.\n', 'utf8')
const noFm = await setSkillInvocation(home, cwd, 'no-frontmatter', false)
check('a document with no frontmatter is refused', typeof noFm.error === 'string' && noFm.error !== '')
same('...and is left exactly as it was', await readFile(join(home, 'skills', 'no-frontmatter.md'), 'utf8'), 'Just a body.\n')

// A document the harness drops whole is a document whose switch controls
// nothing. Writing a flag into it would report success for a change no one can
// see, so the switch has to refuse and name the field that is in the way.
await writeFile(join(home, 'skills', 'legacy-key.md'),
  PLAIN.replace(/pdf/g, 'legacy-key').replace('name: legacy-key\n', 'name: legacy-key\ndisableModelInvocation: true\n'), 'utf8')
const legacyBefore = await readFile(join(home, 'skills', 'legacy-key.md'), 'utf8')
const legacyFlip = await setSkillInvocation(home, cwd, 'legacy-key', false)
check('a document the harness rejects cannot be switched', typeof legacyFlip.error === 'string')
check('...and the reason names the offending field', /disableModelInvocation/.test(legacyFlip.error ?? ''), legacyFlip.error ?? '')
same('...and the file is left exactly as it was', await readFile(join(home, 'skills', 'legacy-key.md'), 'utf8'), legacyBefore)

await rm(root, { recursive: true, force: true })
/* ------------------------------------------------------------------ */

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed:`)
  for (const label of failures) console.log(`  - ${label}`)
  process.exitCode = 1
} else {
  console.log(`The switch flips both ways and leaves everything else alone. (${passed} checks)`)
}
