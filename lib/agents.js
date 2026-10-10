/**
 * Skills that already exist on this machine, in another agent's directory.
 *
 * DSH reads its own skill roots and none of them is `~/.claude/skills` or
 * `~/.codex/skills`, so a machine that has been using Claude Code or Codex for
 * a while is carrying a shelf of skills DSH cannot see. Copying them in is a
 * better first experience than downloading a stranger's skill, because the
 * user already chose them once.
 *
 * The copy is deliberately a *copy*: registering these directories in place
 * would mean uninstalling this plugin silently removes the user's Claude Code
 * setup too, and editing a skill in DSH would edit it for every other agent.
 *
 * @module dsh-skill-center/agents
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { completenessOf } from './completeness.js'
import { readSkillTree } from './skills-dir.js'
import { inspectSkillDocument } from './validate.js'

/**
 * Roots DSH itself already reads, so the UI can say "already visible" instead
 * of offering to import something that is not actually hidden.
 */
const DSH_VISIBLE_SUFFIXES = [join('.dsh', 'skills'), join('.agents', 'skills')]

/**
 * Every other agent's *user-level* skill directory, as `<base>/skills`.
 *
 * The list is deliberately dull: one row per agent, the path each one actually
 * documents, and nothing guessed by analogy. An entry that is wrong costs one
 * failed `readdir` and an entry that is missing costs a user their skills, so
 * when a tool's location was not confirmed it is simply not here.
 *
 * `env` names an environment variable that overrides the base directory for
 * people whose tools live somewhere else. The names match the ones
 * `@michengai/dsh-skills-manager` uses for the same directories, so a machine
 * already configured for that plugin needs no second round of settings.
 */
const USER_ROOTS = [
  { id: 'claude', label: 'Claude Code（用户级）', base: '.claude', env: 'DSH_CLAUDE_HOME' },
  { id: 'codex', label: 'Codex（用户级）', base: '.codex', env: 'DSH_CODEX_HOME' },
  { id: 'agents', label: 'Agents 共享目录（DSH 已可见）', base: '.agents', env: 'DSH_AGENTS_HOME' },
  { id: 'gemini', label: 'Gemini CLI', base: '.gemini', env: 'DSH_GEMINI_HOME' },
  { id: 'antigravity', label: 'Antigravity', base: join('.gemini', 'antigravity') },
  { id: 'opencode', label: 'OpenCode', base: join('.config', 'opencode'), env: 'DSH_OPENCODE_HOME' },
  { id: 'cursor', label: 'Cursor', base: '.cursor', env: 'DSH_CURSOR_HOME' },
  { id: 'copilot', label: 'Copilot', base: '.copilot', env: 'DSH_COPILOT_HOME' },
  { id: 'windsurf', label: 'Windsurf', base: join('.codeium', 'windsurf'), env: 'DSH_WINDSURF_HOME' },
  { id: 'windsurf-user', label: 'Windsurf（主目录）', base: '.windsurf', env: 'DSH_WINDSURF_USER_HOME' },
  { id: 'trae', label: 'Trae', base: '.trae', env: 'DSH_TRAE_HOME' },
  { id: 'trae-cn', label: 'Trae 国内版', base: '.trae-cn', env: 'DSH_TRAE_CN_HOME' },
  { id: 'qoder', label: 'Qoder', base: '.qoder', env: 'DSH_QODER_HOME' },
  { id: 'qoder-cn', label: 'Qoder CN CLI', base: '.qoder-cn', env: 'DSH_QODER_CN_HOME' },
  { id: 'lingma', label: 'Qoder CN（Lingma）', base: '.lingma', env: 'DSH_LINGMA_HOME' },
  { id: 'openclaw', label: 'OpenClaw', base: '.openclaw', env: 'DSH_OPENCLAW_HOME' },
  { id: 'clawdbot', label: 'OpenClaw（旧目录）', base: '.clawdbot', env: 'DSH_CLAWDBOT_HOME' },
  { id: 'ccswitch', label: 'CC Switch', base: '.cc-switch' },
  { id: 'roo', label: 'Roo', base: '.roo', env: 'DSH_ROO_HOME' },
  { id: 'codebuddy', label: 'CodeBuddy', base: '.codebuddy', env: 'DSH_CODEBUDDY_HOME' },
  { id: 'workbuddy', label: 'WorkBuddy', base: '.workbuddy', env: 'DSH_WORKBUDDY_HOME' },
]

/**
 * The same idea for skills kept inside a project rather than in the home
 * directory. `base` is relative to the project root.
 */
const PROJECT_ROOTS = [
  { id: 'claude-project', label: 'Claude Code（项目级）', base: '.claude' },
  { id: 'codex-project', label: 'Codex（项目级）', base: '.codex' },
  { id: 'gemini-project', label: 'Gemini CLI（项目级）', base: '.gemini' },
  { id: 'cursor-project', label: 'Cursor（项目级）', base: '.cursor' },
  { id: 'copilot-project', label: 'Copilot（项目级）', base: '.github' },
  { id: 'opencode-project', label: 'OpenCode（项目级）', base: '.opencode' },
  { id: 'windsurf-project', label: 'Windsurf（项目级）', base: '.windsurf' },
  { id: 'trae-project', label: 'Trae（项目级）', base: '.trae' },
  { id: 'trae-cn-project', label: 'Trae 国内版（项目级）', base: '.trae-cn' },
  // Qoder CN CLI writes its project skills into `.qoder` as well, so the two
  // share one root rather than getting a row each.
  { id: 'qoder-project', label: 'Qoder（项目级）', base: '.qoder' },
  { id: 'roo-project', label: 'Roo（项目级）', base: '.roo' },
  { id: 'codebuddy-project', label: 'CodeBuddy（项目级）', base: '.codebuddy' },
  { id: 'workbuddy-project', label: 'WorkBuddy（项目级）', base: '.workbuddy' },
  // No agent owns `<project>/skills`; it is the convention tools fall back to.
  // Listed last because it is the one most likely to be some other kind of
  // `skills` folder -- nothing is imported unless the user picks it.
  { id: 'generic-project', label: '通用（项目级 skills）', base: '' },
]

/**
 * Resolve one root's base directory, honouring an environment override.
 * @param spec - a row from {@link USER_ROOTS}.
 * @param home - the home directory to fall back on.
 * @param env - the environment to read.
 * @returns the absolute base directory.
 */
function baseDirectory(spec, home, env) {
  const override = spec.env === undefined ? undefined : env[spec.env]
  if (typeof override === 'string' && override.trim() !== '') return resolve(override.trim())
  return join(home, spec.base)
}

/**
 * Every other agent's skill directory worth looking in.
 * @param options - home directories, project root, environment, extra paths.
 * @returns the candidate roots, in the order they should be presented.
 */
export function agentRoots(options = {}) {
  const home = options.home ?? homedir()
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const extra = Array.isArray(options.extraPaths) ? options.extraPaths.filter((path) => typeof path === 'string' && path.trim() !== '') : []
  return [
    ...USER_ROOTS.map((spec) => ({ id: spec.id, label: spec.label, path: join(baseDirectory(spec, home, env), 'skills') })),
    ...PROJECT_ROOTS.map((spec) => ({ id: spec.id, label: spec.label, path: join(cwd, spec.base, 'skills') })),
    ...extra.map((path, index) => ({ id: `extra-${index}`, label: `自定义目录`, path: resolve(path) })),
  ]
}

/**
 * Whether a root is one DSH's own filesystem provider already scans.
 * @param path - absolute root path.
 * @returns true when the skills inside are already loaded by DSH.
 */
function isDshVisible(path) {
  return DSH_VISIBLE_SUFFIXES.some((suffix) => path.endsWith(suffix))
}

/**
 * Describe one skill found under another agent's root.
 * @param candidate - the directory (or flat file) and the root it came from.
 * @returns the record, or `undefined` when it is not readable.
 */
async function describeCandidate(candidate) {
  let raw
  let info
  try {
    const [text, stats] = await Promise.all([readFile(candidate.skillFile, 'utf8'), stat(candidate.skillFile)])
    raw = text
    info = stats
  } catch {
    return undefined
  }
  const report = await inspectSkillDocument(raw, { installName: candidate.entryName })
  return {
    name: candidate.entryName,
    declaredName: report.declaredName,
    description: report.description ?? '',
    path: candidate.directory,
    skillFile: candidate.skillFile,
    flat: candidate.flat,
    bytes: info.size,
    modifiedAt: info.mtimeMs,
    /** False when DSH would ignore this skill as written. */
    valid: !report.blocked,
    repairable: report.repairable,
    suggestedName: report.suggestedName,
    problems: report.problems,
  }
}

/**
 * Walk one root and describe every skill inside it.
 *
 * A root that cannot be listed is not an error worth reporting: with this many
 * candidates, most of them are meant to be missing, and a machine that has
 * never seen Cursor should not be told that Cursor is broken.
 * @param root - one entry from {@link agentRoots}.
 * @returns the group, with `exists: false` when the directory is not there.
 */
async function scanRoot(root) {
  const group = { ...root, visible: isDshVisible(root.path), exists: false, skills: [], error: undefined }
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
    group.exists = true
  } catch {
    return group
  }
  for (const entry of entries) {
    // `.system` in a Codex install holds tooling, not skills, and any other
    // dot-directory is bookkeeping by the same argument.
    if (entry.name.startsWith('.')) continue
    const isDirectory = entry.isDirectory()
    const isFlat = entry.isFile() && entry.name.endsWith('.md')
    if (!isDirectory && !isFlat) continue
    const directory = join(root.path, entry.name)
    const record = await describeCandidate({
      directory,
      skillFile: isDirectory ? join(directory, 'SKILL.md') : directory,
      entryName: isDirectory ? entry.name : entry.name.replace(/\.md$/, ''),
      flat: !isDirectory,
    })
    if (record !== undefined) group.skills.push(record)
  }
  group.skills.sort((a, b) => a.name.localeCompare(b.name))
  return group
}

/**
 * Walk every other agent's skill root.
 *
 * The roots are scanned at once and the results are put back in the order
 * {@link agentRoots} returned them, which is the order the UI shows and the
 * order {@link markCollisions} treats as "who had the name first".
 * @param options - home, project root, environment, and extra paths.
 * @returns one group per root, with the skills it holds.
 */
export async function discoverAgentSkills(options = {}) {
  return Promise.all(agentRoots(options).map((root) => scanRoot(root)))
}

/**
 * Annotate discovered skills with what the user's own skill root already has.
 *
 * Half the value of the importer is the collision report: the same skill often
 * lives in two agent directories, and a chunk of these are already installed
 * in DSH under a slightly different name.
 * @param groups - the output of {@link discoverAgentSkills}.
 * @param installed - the names already present in the DSH user skill root.
 * @returns the same groups, each skill marked with its clash.
 */
export function markCollisions(groups, installed) {
  const taken = new Set(installed)
  const claimed = new Map()
  return groups.map((group) => ({
    ...group,
    skills: group.skills.map((skill) => {
      // A name claimed earlier in this same scan is the more useful signal for
      // the second copy, so record it before checking the DSH root.
      const firstSeenIn = claimed.get(skill.name)
      if (firstSeenIn === undefined) claimed.set(skill.name, group.id)
      return {
        ...skill,
        installed: taken.has(skill.name),
        duplicateOf: firstSeenIn,
        /** Importing this copy would overwrite the earlier one. */
        collision: taken.has(skill.name) || firstSeenIn !== undefined,
      }
    }),
  }))
}

/**
 * Copy one skill out of another agent's directory into the DSH user root.
 * @param source - the discovered skill record.
 * @returns the file set and where it came from, ready for `installSkill`.
 */
export async function readLocalSkill(source) {
  // A flat `<name>.md` has no directory of its own, so the file *is* the skill.
  let tree
  if (source.flat) {
    const content = await readFile(source.skillFile, 'utf8')
    const bytes = Buffer.byteLength(content, 'utf8')
    tree = {
      files: [{ path: 'SKILL.md', content }],
      skipped: [],
      // Nothing to truncate: a single file is either read or it is not.
      completeness: completenessOf({ fileCount: 1, byteCount: bytes }),
      totalBytes: bytes,
    }
  } else {
    tree = await readSkillTree(source.path)
  }
  if (!tree.files.some((file) => file.path === 'SKILL.md')) {
    throw new Error(`${source.name} 里没有 SKILL.md`)
  }
  return tree
}
