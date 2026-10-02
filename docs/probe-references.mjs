// Contract probe for lib/references.js: which tokens count as file references.
// Run: node docs/probe-references.mjs
import { checkReferences, findReferences, summarizeReferences } from '../lib/references.js'

const text = [
  '---',
  'name: pdf',
  'description: Work with PDFs.',
  '---',
  '',
  '# PDF',
  '',
  'Read `references/schema.md` first, then run `scripts/fill.py --in-place`.',
  '',
  'See [the checklist](references/checklist.md) and [the raw spec](https://example.com/spec.md).',
  '',
  'Details live in `references/` and the notes are in `notes/private/plan.md`.',
  '',
  'Use `--verbose` or `and/or` freely; globs like `scripts/*.py` are not paths.',
  'Templates such as `{name}` and `<path>` are placeholders.',
  'Absolute `/etc/hosts` and `~/secrets` are out of scope.',
  'Escaping is blocked: `../../etc/passwd` must not be requested.',
  'Read [the intro](#pdf) and [email](mailto:x@y.z) for nothing.',
  '',
  '`Makefile` has no extension, so it is not claimed either way.',
  '',
  '![diagram](assets/flow.png)',
  '',
].join('\n')

const all = findReferences(text)
const byPath = new Map(all.map((entry) => [entry.path, entry]))

const expectFound = [
  'references/schema.md',
  'references/checklist.md',
  'references/',
  'notes/private/plan.md',
  'assets/flow.png',
]
const expectAbsent = [
  'https://example.com/spec.md',
  '#pdf',
  'mailto:x@y.z',
  '--verbose',
  'and/or',
  'scripts/*.py',
  '{name}',
  '<path>',
  '/etc/hosts',
  '~/secrets',
  '../../etc/passwd',
  'Makefile',
  'scripts/fill.py --in-place',
]

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

for (const path of expectFound) check(`detects ${path}`, byPath.has(path))
for (const token of expectAbsent) check(`ignores ${token}`, !byPath.has(token))
check('every detected reference has a line number', all.every((entry) => Number.isInteger(entry.line) && entry.line > 0))
check('the frontmatter name is not mistaken for a path', !byPath.has('pdf'))

// The diff half: a file that is in the tree is present, one that is not is missing.
const files = [
  { path: 'SKILL.md' },
  { path: 'references/schema.md' },
  { path: 'references/checklist.md' },
  { path: 'assets/flow.png' },
]
const report = checkReferences({ skillText: text, files })
const missing = report.missing.map((entry) => entry.path)
check('present reference is not reported missing', !missing.includes('references/schema.md'))
check('directory reference is satisfied by its children', !missing.includes('references/'))
check('absent file is reported missing', missing.includes('notes/private/plan.md'), missing.join(', '))
check('case-insensitive match counts as present',
  checkReferences({ skillText: 'Read `References/Schema.md`.', files }).missing.length === 0)

const summary = summarizeReferences(report)
check('summary carries a count and the spelled-out list', summary.missingCount === summary.missing.length && summary.referenced > 0,
  JSON.stringify(summary))

// A document that references nothing must not manufacture references.
const quiet = checkReferences({ skillText: '# Title\n\nJust prose, no paths at all.\n', files: [] })
check('a document with no references reports none', quiet.references.length === 0 && quiet.missing.length === 0)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exitCode = failures === 0 ? 0 : 1
