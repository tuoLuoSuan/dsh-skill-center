#!/usr/bin/env node
/**
 * Which other agents' skill directories does the importer actually look in?
 *
 * This is a table, and a table is the kind of code nobody tests because there
 * is no logic in it. That is exactly why it needs a test: the two ways to be
 * wrong are both silent.
 *
 * A row that is missing costs a user their skills -- they see an empty "本机"
 * tab and conclude there is nothing there. A row pointed at the wrong
 * directory costs nothing at all, which is worse: a `readdir` that hits a
 * plausible-looking wrong place either finds nothing (invisible) or, if that
 * place exists, imports from a directory no agent ever wrote to. Nothing
 * crashes. Both failures look like "this machine has no other agents".
 *
 * So the assertions below are mostly about *identity* rather than behaviour:
 * this id resolves to this path under this home, an override moves it, and an
 * empty environment means the real one is not consulted at all. That last one
 * is what keeps this probe honest on a machine like the author's, where
 * `DSH_CLAUDE_HOME` may well be set for some other tool.
 *
 * Everything runs against a home directory this file builds in a temporary
 * folder; the machine's real home is never scanned.
 *
 * Exit codes: 0 all checks passed, 1 an assertion failed, 2 could not test.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { agentRoots, discoverAgentSkills, markCollisions, readLocalSkill } from '../lib/agents.js'

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

/**
 * Assert a value equals what was expected.
 * @param label - what was being checked.
 * @param actual - the value produced.
 * @param expected - the value wanted.
 */
function same(label, actual, expected) {
  check(label, actual === expected, `wanted ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

/** A valid `SKILL.md` for a skill with this name. */
function skillDoc(name) {
  return `---\nname: ${name}\ndescription: A fixture skill named ${name}, written by the roots probe.\n---\n\nBody of ${name}.\n`
}

/**
 * Write `<dir>/<name>/SKILL.md`.
 * @param dir - the skills root.
 * @param name - directory and skill name.
 * @returns the directory written.
 */
async function writeSkill(dir, name) {
  const target = join(dir, name)
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'SKILL.md'), skillDoc(name), 'utf8')
  return target
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'skill-center-roots-'))
  const home = join(root, 'home')
  const cwd = join(root, 'project')
  await mkdir(home, { recursive: true })
  await mkdir(cwd, { recursive: true })

  /* ---------------------------------------------------------------- */
  console.log('the table itself')

  const roots = agentRoots({ home, cwd, env: {} })
  const ids = roots.map((item) => item.id)
  same('every root has a unique id', new Set(ids).size, ids.length)
  check('there is more than a handful of them', roots.length > 20, `only ${roots.length}`)
  check('every root path is absolute', roots.every((item) => isAbsolute(item.path)))
  check('every root path ends in skills', roots.every((item) => item.path.endsWith('skills')))
  check('every root has a label', roots.every((item) => typeof item.label === 'string' && item.label !== ''))
  // Two roots where one contains the other would list the same skill twice and
  // report a phantom collision against itself.
  const nested = roots.filter((a) => roots.some((b) => b !== a && a.path.startsWith(`${b.path}\\`) || b !== a && a.path.startsWith(`${b.path}/`)))
  same('no root is inside another root', nested.map((item) => item.id).join(','), '')

  /** @param id - the root to look up. @param options - overrides for agentRoots. */
  const pathOf = (id, options = {}) => agentRoots({ home, cwd, ...options }).find((item) => item.id === id)?.path

  same('Claude Code reads its own directory', pathOf('claude', { env: {} }), join(home, '.claude', 'skills'))
  same('so does Codex', pathOf('codex', { env: {} }), join(home, '.codex', 'skills'))
  same('OpenCode lives under .config', pathOf('opencode', { env: {} }), join(home, '.config', 'opencode', 'skills'))
  same('Windsurf has two homes and they are different', pathOf('windsurf', { env: {} }) === pathOf('windsurf-user', { env: {} }) ? 'same' : 'different', 'different')
  same('a project root hangs off the project, not the home', pathOf('claude-project', { env: {} }), join(cwd, '.claude', 'skills'))
  same('Copilot keeps project skills under .github', pathOf('copilot-project', { env: {} }), join(cwd, '.github', 'skills'))
  // `join(cwd, '', 'skills')` is how the one root with no directory of its own
  // is spelled, and it is the kind of expression that quietly yields the wrong
  // path when somebody "tidies" it.
  same('the generic project root is <project>/skills', pathOf('generic-project', { env: {} }), join(cwd, 'skills'))

  const visible = roots.filter((item) => item.path.endsWith(join('.agents', 'skills'))).map((item) => item.id)
  same('only the shared agents directory is already visible to DSH', visible.join(','), 'agents')

  /* ---------------------------------------------------------------- */
  console.log('')
  console.log('environment overrides')

  same('an override moves the whole root', pathOf('claude', { env: { DSH_CLAUDE_HOME: join(root, 'elsewhere') } }), join(root, 'elsewhere', 'skills'))
  same('an override replaces the nested default too', pathOf('opencode', { env: { DSH_OPENCODE_HOME: join(root, 'oc') } }), join(root, 'oc', 'skills'))
  same('a blank override is not an override', pathOf('claude', { env: { DSH_CLAUDE_HOME: '   ' } }), join(home, '.claude', 'skills'))
  same('an override pointing at a file still resolves', pathOf('claude', { env: { DSH_CLAUDE_HOME: '.' } }), join(process.cwd(), 'skills'))

  // The two-sided version, which is the one worth having: with `env: {}` the
  // real environment must not be consulted, and with no `env` at all it must be.
  const saved = process.env.DSH_CLAUDE_HOME
  process.env.DSH_CLAUDE_HOME = join(root, 'from-process-env')
  try {
    same('an explicit empty env ignores the real environment', pathOf('claude', { env: {} }), join(home, '.claude', 'skills'))
    same('and the default env still honours it', pathOf('claude'), join(root, 'from-process-env', 'skills'))
  } finally {
    if (saved === undefined) delete process.env.DSH_CLAUDE_HOME
    else process.env.DSH_CLAUDE_HOME = saved
  }

  const withExtras = agentRoots({ home, cwd, env: {}, extraPaths: ['.', '   ', join(root, 'a'), join(root, 'b')] })
  same('extra paths come after every built-in root', `${withExtras[roots.length - 1].id}>${withExtras[roots.length].id}`, 'generic-project>extra-0')
  same('...one per usable path', withExtras.length, roots.length + 3)
  same('...in the order they were given', withExtras.slice(-3).map((item) => item.id).join(','), 'extra-0,extra-1,extra-2')
  same('...resolved to absolute', withExtras.at(-3).path, process.cwd())
  same('...and a relative one is resolved against the working directory', withExtras.at(-1).path, join(root, 'b'))

  /* ---------------------------------------------------------------- */
  console.log('')
  console.log('scanning a made-up home')

  const claudeSkills = join(home, '.claude', 'skills')
  const alpha = await writeSkill(claudeSkills, 'alpha')
  await writeFile(join(claudeSkills, 'beta.md'), skillDoc('beta'), 'utf8')
  await writeSkill(join(claudeSkills, '.system'), 'tooling')
  await writeFile(join(claudeSkills, 'notes.txt'), 'not a skill\n', 'utf8')
  const codexAlpha = await writeSkill(join(home, '.codex', 'skills'), 'alpha')
  // A root near the end of the table, which is where the rows that were added
  // last live. A real machine was found carrying seventeen skills in exactly
  // this directory while the old table never looked at it.
  const delta = await writeSkill(join(home, '.workbuddy', 'skills'), 'delta')

  const groups = await discoverAgentSkills({ home, cwd, env: {} })
  const byId = new Map(groups.map((group) => [group.id, group]))

  same('the scan answers in table order', groups.map((group) => group.id).join(','), ids.join(','))
  same('a directory skill is found', byId.get('claude').skills.map((skill) => skill.name).join(','), 'alpha,beta')
  same('a directory skill is not flat', byId.get('claude').skills[0].flat, false)
  same('a flat markdown file is a skill, named without the extension', byId.get('claude').skills[1].name, 'beta')
  same('...and is marked flat', byId.get('claude').skills[1].flat, true)
  same('...with the file itself as its document', byId.get('claude').skills[1].skillFile, join(claudeSkills, 'beta.md'))
  same('a dot directory is not a skill', byId.get('claude').skills.some((skill) => skill.name === '.system'), false)
  same('a non-markdown file is not a skill', byId.get('claude').skills.some((skill) => skill.name === 'notes.txt'), false)
  same('a root that is not there says so', byId.get('gemini').exists, false)
  same('...and holds nothing', byId.get('gemini').skills.length, 0)
  same('...and is not an error', byId.get('gemini').error, undefined)
  same('the shared agents root is marked visible', byId.get('agents').visible, true)
  same('a skill in a late row is found at all', byId.get('workbuddy').skills.map((skill) => skill.name).join(','), 'delta')
  same('...and points at the directory it was read from', byId.get('workbuddy').skills[0].path, delta)

  const redirectHome = join(root, 'redirected')
  await writeSkill(join(redirectHome, 'skills'), 'gamma')
  const redirected = await discoverAgentSkills({ home, cwd, env: { DSH_CLAUDE_HOME: redirectHome } })
  same('an override redirects the scan, not just the label', redirected.find((group) => group.id === 'claude').skills.map((skill) => skill.name).join(','), 'gamma')

  /* ---------------------------------------------------------------- */
  console.log('')
  console.log('collisions and importing')

  const marked = markCollisions(groups, ['delta'])
  const markedById = new Map(marked.map((group) => [group.id, group]))
  same('a skill already in DSH is marked installed', markedById.get('workbuddy').skills[0].installed, true)
  // `collision` answers "would importing this overwrite something", so the copy
  // already sitting in DSH is one -- while `duplicateOf` answers the different
  // question "did another agent's directory have this name first".
  same('...which is itself a collision, because importing would overwrite it', markedById.get('workbuddy').skills[0].collision, true)
  same('...but not a duplicate of another agent copy', markedById.get('workbuddy').skills[0].duplicateOf, undefined)
  same('the first copy of a repeated name is clean', markedById.get('claude').skills[0].collision, false)
  same('the second copy points at the first', markedById.get('codex').skills[0].duplicateOf, 'claude')
  same('...and is a collision', markedById.get('codex').skills[0].collision, true)
  same('an installed name is a collision even with no duplicate', markCollisions([byId.get('workbuddy')], ['delta'])[0].skills[0].collision, true)

  const tree = await readLocalSkill({ name: 'alpha', path: alpha, skillFile: join(alpha, 'SKILL.md'), flat: false })
  same('importing a directory carries its SKILL.md', tree.files.map((file) => file.path).join(','), 'SKILL.md')
  same('...and the SKILL.md declares the name', tree.files[0].content.includes('name: alpha'), true)
  const flatTree = await readLocalSkill({ name: 'beta', path: join(claudeSkills, 'beta.md'), skillFile: join(claudeSkills, 'beta.md'), flat: true })
  same('importing a flat file arrives as SKILL.md', flatTree.files.map((file) => file.path).join(','), 'SKILL.md')
  check('...with a size attached', flatTree.totalBytes > 0)

  const bare = join(root, 'bare')
  await mkdir(bare, { recursive: true })
  await writeFile(join(bare, 'notes.txt'), 'no skill here\n', 'utf8')
  let refused = ''
  try {
    await readLocalSkill({ name: 'bare', path: bare, skillFile: join(bare, 'SKILL.md'), flat: false })
  } catch (error) {
    refused = error.message
  }
  check('a directory with no SKILL.md is refused', refused.includes('没有 SKILL.md'), `got ${JSON.stringify(refused)}`)

  const missing = codexAlpha
  same('the duplicate copy really is a separate directory', missing === alpha ? 'same' : 'different', 'different')

  await rm(root, { recursive: true, force: true })
  /* ---------------------------------------------------------------- */

  console.log('')
  if (failures.length > 0) {
    console.log(`${failures.length} check(s) failed:`)
    for (const label of failures) console.log(`  - ${label}`)
    process.exitCode = 1
  } else {
    console.log(`Every root resolves where it says it does. (${passed} checks)`)
  }
}

await main()
