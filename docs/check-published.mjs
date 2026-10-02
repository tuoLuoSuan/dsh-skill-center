/* Pre-flight for handing this repository to somebody else.
 *
 * Everything here answers a question a stranger would ask in their first five
 * minutes, and every answer is read back from GitHub rather than from the
 * working tree -- the point is to check what is published, not what is on the
 * author's disk.
 *
 * Usage: node docs/check-published.mjs [owner/repo]
 */

const REPO = process.argv[2] ?? 'tuoLuoSuan/dsh-skill-center'
const BRANCH = 'main'

let failed = 0
const check = (label, ok, detail) => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : ` — ${detail}`}`)
}

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-skill-center-check' },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

console.log(`checking what a stranger sees at https://github.com/${REPO}\n`)

const repo = await api('')
check('the repository is public', repo.private === false, `private=${repo.private}`)
check('the repository has a description', (repo.description ?? '').length > 20)
check('the default branch is main', repo.default_branch === BRANCH, repo.default_branch)
check('the repository is not archived', repo.archived === false)
check('the repository has a license GitHub recognises', repo.license?.spdx_id === 'MIT', repo.license?.spdx_id)

const topics = await api('/topics')
check('the repository has topics, so it can be found', (topics.names ?? []).length >= 3, (topics.names ?? []).join(' '))

const root = await api(`/contents?ref=${BRANCH}`)
const names = root.map((entry) => entry.name)
for (const required of ['README.md', 'LICENSE', '.gitignore', 'package.json', 'lib', 'client', 'locale', 'icon.svg']) {
  check(`the clone contains ${required}`, names.includes(required))
}
check('no lockfile is published', !names.includes('package-lock.json') && !names.includes('pnpm-lock.yaml'))
check('no generated theme is published', !names.includes('theme.css'))

// The README is the only thing most people will read, so its images have to
// load from GitHub's own raw host rather than from a path that only resolves
// on a case-insensitive filesystem.
const readme = await (await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/README.md`)).text()
check('the README is served as UTF-8 Chinese', readme.includes('技能中心'))
check('the README says what DSH version this targets', readme.includes('0.2.0-rc.2'))

const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1])
check('the README references screenshots', images.length >= 4, `${images.length} images`)
for (const image of images) {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${image.replace(/^\.\//, '')}`
  const response = await fetch(url, { method: 'HEAD' })
  check(`  ${image} loads`, response.ok, `HTTP ${response.status}`)
}

const commits = await api(`/commits?sha=${BRANCH}&per_page=5`)
check('the history is small and readable', commits.length <= 5, `${commits.length} recent`)

console.log(
  failed === 0
    ? '\nAll checks passed. This is safe to hand to somebody.'
    : `\n${failed} check(s) failed.`,
)
process.exit(failed === 0 ? 0 : 1)
