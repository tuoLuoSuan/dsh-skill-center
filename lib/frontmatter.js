/**
 * SKILL.md frontmatter reading for the skill center.
 *
 * The harness validates installed skills with a real YAML parser, but this
 * plugin only ever needs to *read* a handful of scalar fields to render a
 * catalog. It therefore tries the host's `js-yaml` when that happens to be
 * resolvable and otherwise falls back to a small purpose-built reader that
 * covers every shape the public `SKILL.md` corpus actually uses: plain and
 * quoted scalars, `>`/`|` block scalars with chomping indicators, inline
 * lists, and one level of nested mapping for `metadata:`.
 *
 * @module dsh-skill-center/frontmatter
 */

/** Lazily resolved `js-yaml` module, or `null` once we know it is unavailable. */
let yamlModule
let yamlProbed = false

/**
 * Try to load the host's `js-yaml` without making it a hard dependency.
 * @returns the module, or `undefined` when it is not installed.
 */
async function optionalYaml() {
  if (yamlProbed) return yamlModule ?? undefined
  yamlProbed = true
  try {
    yamlModule = await import('js-yaml')
    return yamlModule
  } catch {
    yamlModule = null
    return undefined
  }
}

/**
 * Split a Markdown document into its frontmatter mapping and body.
 * Mirrors the harness rule that the opening fence must be the very first
 * line and the closing fence is the next line that is exactly `---`.
 * @param raw - full file text.
 * @returns the parsed mapping and body, or `undefined` when there is no frontmatter.
 */
export function splitFrontmatter(raw) {
  if (typeof raw !== 'string') return undefined
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  const start = firstLineEnd + 1
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      const bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1
      return { yaml: raw.slice(start, lineStart), body: raw.slice(bodyStart) }
    }
    if (nextNewline < 0) break
    lineStart = nextNewline + 1
  }
  return undefined
}

/**
 * Parse a `SKILL.md` document's frontmatter.
 * @param raw - full file text.
 * @returns the mapping plus the Markdown body; fields are best-effort strings.
 */
export async function parseSkillDocument(raw) {
  const split = splitFrontmatter(raw)
  if (split === undefined) return undefined
  const yaml = await optionalYaml()
  if (yaml !== undefined) {
    try {
      const data = yaml.load(split.yaml)
      if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
        return { data, body: split.body, parser: 'js-yaml' }
      }
    } catch {
      // Fall through to the built-in reader.
    }
  }
  return { data: parseSimpleYaml(split.yaml), body: split.body, parser: 'builtin' }
}

/**
 * Parse the subset of YAML that `SKILL.md` frontmatter uses.
 * @param source - the frontmatter text, fences already removed.
 * @returns a flat mapping, with nested mappings for indented children.
 */
export function parseSimpleYaml(source) {
  /** @type {Record<string, unknown>} */
  const result = {}
  const lines = source.split(/\r?\n/)
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    index += 1
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1]
    const inline = match[2]
    const block = /^([>|])([+-]?)(\d*)\s*$/.exec(inline)
    if (block !== null) {
      const collected = []
      while (index < lines.length && (lines[index].trim() === '' || /^\s/.test(lines[index]))) {
        collected.push(lines[index])
        index += 1
      }
      result[key] = renderBlock(collected, block[1] === '|', block[2])
      continue
    }
    if (inline === '') {
      // A mapping or list continued on the following indented lines.
      const collected = []
      while (index < lines.length && (/^\s+\S/.test(lines[index]) || (lines[index].trim() === '' && index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])))) {
        collected.push(lines[index])
        index += 1
      }
      result[key] = parseNested(collected)
      continue
    }
    result[key] = parseScalar(inline)
  }
  return result
}

/**
 * Collapse the body lines of a `>`/`|` block scalar.
 * @param lines - raw indented lines including their common indentation.
 * @param literal - `true` for `|` (keep newlines), `false` for `>` (fold).
 * @param chomp - `-` strips the trailing newline, `+` keeps it, otherwise clip.
 * @returns the scalar text.
 */
function renderBlock(lines, literal, chomp) {
  const indents = lines.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length)
  const base = indents.length > 0 ? Math.min(...indents) : 0
  const stripped = lines.map((l) => l.slice(base))
  let text
  if (literal) {
    text = stripped.join('\n')
  } else {
    const paragraphs = []
    let current = []
    for (const line of stripped) {
      if (line.trim() === '') {
        if (current.length > 0) paragraphs.push(current.join(' '))
        current = []
      } else {
        current.push(line.trim())
      }
    }
    if (current.length > 0) paragraphs.push(current.join(' '))
    text = paragraphs.join('\n')
  }
  if (chomp === '-') return text.replace(/\n+$/, '')
  if (chomp === '+') return `${text}\n`
  return `${text.replace(/\n+$/, '')}\n`
}

/**
 * Interpret the indented lines that follow a bare `key:`.
 * @param lines - indented continuation lines.
 * @returns a mapping, a list, or the joined text when neither applies.
 */
function parseNested(lines) {
  const meaningful = lines.filter((l) => l.trim() !== '')
  if (meaningful.length === 0) return ''
  const isList = meaningful.every((l) => /^\s*-\s/.test(l))
  if (isList) {
    return meaningful.map((l) => parseScalar(l.replace(/^\s*-\s*/, '').trim()))
  }
  const pairs = meaningful.filter((l) => /^\s*[A-Za-z0-9_.-]+\s*:/.test(l))
  if (pairs.length === meaningful.length) {
    const nested = {}
    for (const line of pairs) {
      const match = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
      if (match !== null) nested[match[1]] = match[2] === '' ? '' : parseScalar(match[2])
    }
    return nested
  }
  return meaningful.map((l) => l.trim()).join('\n')
}

/**
 * Coerce one inline YAML scalar into a JavaScript value.
 * @param raw - the text after the colon.
 * @returns a string, number, boolean, or inline list.
 */
function parseScalar(raw) {
  const text = raw.trim().replace(/\s+#.*$/, '')
  if (text === '') return ''
  if (/^".*"$/.test(text) || /^'.*'$/.test(text)) return text.slice(1, -1).replace(/''/g, "'")
  if (/^\[.*\]$/.test(text)) {
    const inner = text.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((part) => parseScalar(part))
  }
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10)
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text)
  return text
}

/**
 * Read a frontmatter field as a trimmed string.
 * @param data - parsed frontmatter mapping.
 * @param key - field name.
 * @returns the trimmed value, or `undefined` when absent or not a scalar.
 */
export function stringField(data, key) {
  if (data === null || typeof data !== 'object') return undefined
  const value = data[key]
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}
