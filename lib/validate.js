/**
 * Pre-install inspection for a remote skill document.
 *
 * The harness loads a skill by parsing its `SKILL.md` and *silently skipping*
 * anything whose frontmatter it cannot use — a missing `name`, a `name` that
 * fails its grammar, or a document that does not open with `---`. Nothing is
 * logged to the UI and nothing appears in the catalog, so from the user's side
 * a successful install simply did not happen.
 *
 * The skill center downloads from the open internet, where a good share of
 * published skills are written for other harnesses with looser rules
 * (Title Case names, `Name_With_Underscores`, a `README.md` renamed by hand).
 * That makes this check the difference between "installed" and "installed and
 * actually loadable", which is why it runs before anything is written and why
 * the fix for the common case is offered rather than merely reported.
 *
 * @module dsh-skill-center/validate
 */
import { parseSkillDocument, splitFrontmatter, stringField } from './frontmatter.js'

/** The harness's public skill-name grammar, duplicated deliberately. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Longest name the harness accepts. */
const NAME_MAX = 64

/** Below this, the catalog line an agent reads is too thin to trigger on. */
const DESCRIPTION_MIN = 12

/**
 * Coerce a display name into the harness's skill-name grammar.
 * @param value - arbitrary display name.
 * @returns a lowercase, hyphen-separated candidate (possibly empty).
 */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/g, '')
}

/**
 * Inspect a skill document the way the harness will.
 * @param raw - the `SKILL.md` text as downloaded.
 * @param options - the name the skill would be installed under.
 * @returns the parsed facts, the problems found, and a repairable document.
 */
export async function inspectSkillDocument(raw, options = {}) {
  const installName = typeof options.installName === 'string' ? options.installName.trim() : ''
  const text = typeof raw === 'string' ? raw : ''
  const problems = []
  const add = (level, code, message) => problems.push({ level, code, message })

  if (text.trim() === '') {
    add('error', 'empty-document', 'SKILL.md 是空的。')
    return finish({ raw: text, problems, installName, data: undefined, body: '' })
  }

  const split = splitFrontmatter(text)
  if (split === undefined) {
    // The harness requires the very first line to be exactly `---`; a leading
    // blank line or a BOM is enough to lose the whole frontmatter.
    const first = text.split(/\r?\n/, 1)[0]
    add(
      'error',
      'no-frontmatter',
      first.trim() === '---'
        ? '首行 `---` 前面有多余字符（空行或 BOM），DSH 会因此忽略整个技能。'
        : '没有 YAML frontmatter，DSH 无法识别这个目录是技能。',
    )
    return finish({ raw: text, problems, installName, data: undefined, body: text })
  }

  const parsed = await parseSkillDocument(text)
  const data = parsed?.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    add('error', 'frontmatter-not-mapping', 'frontmatter 不是一个键值映射，DSH 解析不出 name/description。')
    return finish({ raw: text, problems, installName, data: undefined, body: split.body })
  }

  const declaredName = stringField(data, 'name')
  const description = stringField(data, 'description')
  const body = typeof parsed?.body === 'string' ? parsed.body : split.body

  if (declaredName === undefined) {
    add('error', 'missing-name', 'frontmatter 缺少 `name`，DSH 会静默跳过这个技能。')
  } else if (declaredName.length > NAME_MAX) {
    add('error', 'name-too-long', `\`name\` 有 ${declaredName.length} 个字符，超过 DSH 的 ${NAME_MAX} 上限。`)
  } else if (!SKILL_NAME.test(declaredName)) {
    add(
      'error',
      'name-grammar',
      `\`name: ${declaredName}\` 不符合 DSH 的命名规则（只能是小写字母、数字和单个连字符），这个技能会被静默忽略。`,
    )
  }

  if (description === undefined) {
    add('error', 'missing-description', 'frontmatter 缺少 `description`，DSH 会静默跳过这个技能。')
  } else if (description.length < DESCRIPTION_MIN) {
    add('warn', 'description-thin', `\`description\` 只有 ${description.length} 个字符，模型很难判断什么时候该用它。`)
  }

  if (body.trim() === '') {
    add('warn', 'empty-body', 'frontmatter 之后没有正文，技能被调用时不会给模型任何指示。')
  }

  // The declared name is what the harness keys on, so a directory that
  // disagrees with it is a real (if quieter) source of confusion: the catalog
  // says one thing and the folder says another.
  if (installName !== '' && declaredName !== undefined && declaredName !== installName) {
    add('warn', 'name-mismatch', `\`name: ${declaredName}\` 与安装目录名 \`${installName}\` 不一致。`)
  }

  return finish({ raw: text, problems, installName, data, body, declaredName, description })
}

/**
 * Assemble the report, including the name we would install under and a
 * repaired document when a repair is possible.
 */
function finish({ raw, problems, installName, data, body, declaredName, description }) {
  const hasError = problems.some((problem) => problem.level === 'error')
  // Order matters: a slug of the author's own name is the most faithful
  // repair, because it is still *their* name — only spelled legally. The
  // caller's suggestion is a fallback for when the document declares none.
  const candidates = [declaredName, slugify(declaredName), installName, slugify(installName)]
  const suggestedName = candidates.find((candidate) => typeof candidate === 'string' && candidate !== '' && candidate.length <= NAME_MAX && SKILL_NAME.test(candidate)) ?? ''

  const blockers = problems.filter((problem) => problem.level === 'error')
  // Only a bad `name` is mechanically repairable: the grammar fix is exactly
  // the rename. Anything else (missing description, no frontmatter at all) is
  // the author's to fix, and inventing content would be worse than refusing.
  const repairable = blockers.length > 0 && blockers.every((problem) => ['name-grammar', 'name-too-long', 'missing-name', 'name-mismatch'].includes(problem.code))

  return {
    /** Every problem found, worst first. */
    problems,
    /** True when at least one problem would make the harness skip the skill. */
    blocked: hasError,
    /** The `name:` the document declares, if any. */
    declaredName,
    /** The description the document declares, if any. */
    description,
    /** A name that would pass the grammar, or `''` when none can be derived. */
    suggestedName,
    /** True when rewriting `name:` would clear every error. */
    repairable,
    /** Whether the document parsed at all (used to decide on a body preview). */
    parsed: data !== undefined,
    /** The body after the frontmatter, for a fallback description. */
    body: typeof body === 'string' ? body : '',
    /** The document with `name:` rewritten, when a repair is possible. */
    repaired: repairable && suggestedName !== '' ? renameInDocument(raw, suggestedName) : undefined,
    /** The name this document should be installed under. */
    installName: suggestedName !== '' ? suggestedName : installName,
  }
}

/**
 * Rewrite only the `name:` line, leaving every other byte of the document
 * intact.
 *
 * A downloaded skill may carry comments, quoting styles, or a key order the
 * author chose; re-serializing the YAML would silently discard all of it.
 * @param raw - the original document.
 * @param name - the replacement skill name.
 * @returns the document with its `name:` line replaced or inserted.
 */
export function renameInDocument(raw, name) {
  const split = splitFrontmatter(raw)
  if (split === undefined) {
    // No frontmatter to edit: synthesize the minimum the harness needs. The
    // caller is responsible for having a description to put here.
    return `---\nname: ${name}\n---\n\n${raw.replace(/^\s+/, '')}`
  }
  const lines = split.yaml.split(/\r?\n/)
  const index = lines.findIndex((line) => /^\s*name\s*:/.test(line))
  const yaml = index === -1 ? `name: ${name}\n${split.yaml.replace(/^\n+/, '')}` : `${lines.with(index, `name: ${name}`).join('\n').replace(/^\n+/, '').replace(/\n*$/, '')}\n`
  // Normalize to exactly one blank line between the fence and the body, which
  // is what every SKILL.md in the wild looks like.
  return `---\n${yaml}---\n\n${split.body.replace(/^\n+/, '')}`
}

/**
 * Fold an inspection into the payload the preview pane shows.
 * @param report - the result of {@link inspectSkillDocument}.
 * @returns a compact, serializable summary.
 */
export function summarizeInspection(report) {
  return {
    blocked: report.blocked,
    repairable: report.repairable,
    declaredName: report.declaredName,
    suggestedName: report.suggestedName,
    installName: report.installName,
    problems: report.problems,
  }
}
