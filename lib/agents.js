/**
 * Skills that already exist on this machine, in another agent's directory.
 *
 * DSH reads six skill roots and none of them is `~/.claude/skills` or
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
 * Every other agent's skill directory worth looking in.
 * @param options - home directories and extra paths.
 * @returns the candidate roots, in the order they should be presented.
 */
export function agentRoots(options = {}) {
  const home = options.home ?? homedir()
  const cwd = options.cwd ?? process.cwd()
  const extra = Array.isArray(options.extraPaths) ? options.extraPaths.filter((path) => typeof path === 'string' && path.trim() !== '') : []
  return [
    { id: 'claude', label: 'Claude Code（用户级）', path: join(home, '.claude', 'skills') },
    { id: 'claude-project', label: 'Claude Code（项目级）', path: join(cwd, '.claude', 'skills') },
    { id: 'codex', label: 'Codex（用户级）', path: join(home, '.codex', 'skills') },
    { id: 'agents', label: 'Agents 共享目录（DSH 已可见）', path: join(home, '.agents', 'skills') },
    { id: 'gemini', label: 'Gemini CLI', path: join(home, '.gemini', 'skills') },
    { id: 'antigravity', label: 'Antigravity', path: join(home, '.gemini', 'antigravity', 'skills') },
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
 * Walk every other agent's skill root.
 * @param options - home, project root, and extra paths.
 * @returns one group per root, with the skills it holds.
 */
export async function discoverAgentSkills(options = {}) {
  const roots = agentRoots(options)
  const groups = []
  for (const root of roots) {
    const group = { ...root, visible: isDshVisible(root.path), exists: false, skills: [], error: undefined }
    let entries
    try {
      entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
      group.exists = true
    } catch {
      groups.push(group)
      continue
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
    groups.push(group)
  }
  return groups
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
