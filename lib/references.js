/**
 * Missing-file check for a skill's own documentation.
 *
 * SKILL.md routinely tells the model to run `scripts/build.py` or to read
 * `references/schema.md`. Nothing in the format requires those files to exist,
 * and a skill installed without them still looks fine in a list — it fails the
 * first time it is actually used, in the middle of someone's task. This module
 * extracts the relative paths a document refers to and diffs them against the
 * files that were actually fetched.
 *
 * The bias is deliberate: a false "missing" is worse than a missed reference,
 * because it teaches the user to ignore the warning. So a reference is only
 * reported when it unambiguously names a file — it has a recognised extension
 * or an explicit trailing slash — and never when it could be prose, a glob, a
 * template placeholder, or an absolute/remote location.
 */

/** Anything with a scheme, a protocol-relative prefix, or a bare anchor. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

/** Extensions worth treating an extension-less reference as a real file for. */
const KNOWN_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'rst', 'adoc',
  'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'csv', 'tsv', 'xml', 'html', 'htm', 'css', 'scss', 'sql', 'r', 'jl', 'ipynb',
  'tex', 'bib', 'pdf', 'docx', 'xlsx', 'pptx',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp',
  'zip', 'gz', 'tgz', 'tar', 'whl', 'lock', 'patch', 'diff',
])

/**
 * Decide whether a token names a file rather than merely looking like one.
 *
 * `scripts/build.py` and `references/` qualify; `and/or`, `--verbose`, `{name}`
 * and `*.py` do not. Extension-less single segments (`Makefile`, `Dockerfile`)
 * are intentionally not matched: they cannot be told apart from prose.
 * @param value - a normalised relative path.
 */
function looksLikePath(value) {
  if (value.endsWith('/')) return true
  const slash = value.lastIndexOf('/')
  const dot = value.lastIndexOf('.')
  if (dot <= slash + 1 || dot === value.length - 1) return false
  return KNOWN_EXTENSIONS.has(value.slice(dot + 1).toLowerCase())
}

/**
 * Reduce one candidate token to a skill-relative path, or reject it.
 *
 * Rejecting is the common case and that is the point: a reference checker that
 * fires on prose is worse than no checker.
 * @param raw - the token as written in the document.
 * @returns the relative path, or undefined when the token is not one.
 */
function normalizeReference(raw) {
  let value = String(raw ?? '').trim()
  // Markdown allows <path with spaces>; the brackets are not part of the path.
  value = value.replace(/^<|>$/g, '').trim()
  if (value === '' || EXTERNAL.test(value)) return undefined
  if (value.startsWith('/') || value.startsWith('~')) return undefined
  value = value.split('#')[0].split('?')[0]
  if (value === '') return undefined
  value = value.replace(/\\/g, '/').replace(/^\.\//, '')
  // Whitespace, placeholders, globs and shell metacharacters all mean the token
  // is a pattern or an example, not a path we can go looking for.
  if (/\s/.test(value)) return undefined
  if (/[<>{}*?$|]/.test(value)) return undefined
  if (value.split('/').some((segment) => segment === '..')) return undefined
  return looksLikePath(value) ? value : undefined
}

/**
 * Every relative file path a document points at.
 * @param text - the SKILL.md body, frontmatter included.
 * @returns de-duplicated references, case-insensitively unique, with line numbers.
 */
export function findReferences(text) {
  const found = new Map()
  const add = (raw, kind, line) => {
    const path = normalizeReference(raw)
    if (path === undefined) return
    const key = path.toLowerCase()
    if (found.has(key)) return
    found.set(key, { path, kind, line })
  }
  const lines = String(text ?? '').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const number = index + 1
    // Markdown links and images: the target is deliberate, so trust it.
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) add(match[1], 'link', number)
    // Inline code: only trusted when the token itself looks like a file, since
    // backticks are used for flags, values and prose just as often.
    for (const match of line.matchAll(/`([^`\n]+)`/g)) add(match[1], 'code', number)
  }
  return [...found.values()]
}

/**
 * Diff a document's references against the files that were fetched.
 * @param options - `skillText` and the `files` returned by an adapter or reader.
 * @returns the references, split into those present and those missing.
 */
export function checkReferences({ skillText, files } = {}) {
  const references = findReferences(skillText)
  const present = new Set()
  const directories = new Set()
  for (const file of files ?? []) {
    const path = String(file?.path ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
    if (path === '') continue
    present.add(path.toLowerCase())
    // Every ancestor of a real file therefore exists as a directory — this is
    // what keeps a bare `references/` mention from being reported as missing.
    const segments = path.split('/')
    for (let i = 1; i < segments.length; i += 1) directories.add(segments.slice(0, i).join('/').toLowerCase())
  }
  const missing = []
  const found = []
  for (const reference of references) {
    if (reference.path.endsWith('/')) {
      const key = reference.path.replace(/\/+$/, '').toLowerCase()
      ;(directories.has(key) || present.has(key) ? found : missing).push(reference)
      continue
    }
    ;(present.has(reference.path.toLowerCase()) ? found : missing).push(reference)
  }
  return { references, found, missing }
}

/**
 * Trim a reference report for the wire.
 * @param report - the result of `checkReferences`.
 * @param limit - how many missing entries to spell out.
 */
export function summarizeReferences(report, limit = 12) {
  if (report === undefined || report === null) return undefined
  const missing = report.missing ?? []
  return {
    referenced: (report.references ?? []).length,
    present: (report.found ?? []).length,
    missingCount: missing.length,
    missing: missing.slice(0, limit).map((entry) => ({ path: entry.path, kind: entry.kind, line: entry.line })),
  }
}
