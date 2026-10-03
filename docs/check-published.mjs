/* Pre-flight for handing this repository to somebody else.
 *
 * Everything here answers a question a stranger would ask in their first five
 * minutes, and every answer is read back from GitHub rather than from the
 * working tree -- the point is to check what is published, not what is on the
 * author's disk.
 *
 * Usage: node docs/check-published.mjs [owner/repo]
 *        GITHUB_TOKEN=<token> node docs/check-published.mjs   (raises the rate limit)
 */

const REPO = process.argv[2] ?? 'tuoLuoSuan/dsh-skill-center'
const BRANCH = 'main'

let failed = 0
let unchecked = 0
const check = (label, ok, detail) => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : ` — ${detail}`}`)
}
/*
 * For the things this script cannot find out. A transport error says nothing
 * about the repository -- raw.githubusercontent.com is a CDN on the far side of
 * whatever network this runs on, and it resets connections often enough that
 * calling that a missing screenshot would make this fail for reasons the
 * repository cannot control.
 */
const unknown = (label, detail) => {
  unchecked += 1
  console.log(`??    ${label} — ${detail}`)
}

/*
 * A 403 from the API is almost always the anonymous rate limit (60 per hour),
 * not a problem with the repository. Reporting that as a failed check would make
 * this script report the weather: the one time it matters -- right before handing
 * the repo to somebody -- is also the time it has just been run most. Stop
 * instead, with a distinct exit code, so "could not check" never reads as
 * "checked and broken".
 */
class RateLimited extends Error {}

async function api(path) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-skill-center-check',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  const body = await response.text()
  if (response.status === 403 && /rate limit/i.test(body)) {
    const left = response.headers.get('x-ratelimit-remaining') ?? '0'
    const limit = response.headers.get('x-ratelimit-limit') ?? '60'
    throw new RateLimited(
      `the GitHub API would not answer (${left} left of ${limit} per hour). This says nothing about the ` +
        'repository -- set GITHUB_TOKEN to raise the limit, or try again later.',
    )
  }
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

async function run() {
  console.log(`checking what a stranger sees at https://github.com/${REPO}\n`)

  const repo = await api('')
  check('the repository is public', repo.private === false, `private=${repo.private}`)
  check('the repository has a description', (repo.description ?? '').length > 20)
  check('the default branch is main', repo.default_branch === BRANCH, repo.default_branch)
  check('the repository is not archived', repo.archived === false)
  check('the repository has a license GitHub recognises', repo.license?.spdx_id === 'MIT', repo.license?.spdx_id)

  const topics = await api('/topics')
  check(
    'the repository has topics, so it can be found',
    (topics.names ?? []).length >= 3,
    (topics.names ?? []).join(' '),
  )

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
  //
  // Read through the contents API rather than raw.githubusercontent.com: raw is
  // served through a CDN that keeps serving the previous revision for a few
  // minutes after a push, so a check run right after one would grade the commit
  // before last.
  const readmeEntry = await api(`/contents/README.md?ref=${BRANCH}`)
  const readme = Buffer.from(readmeEntry.content, 'base64').toString('utf8')
  check('the README is served as UTF-8 Chinese', readme.includes('技能中心'))
  check('the README says what DSH version this targets', readme.includes('0.2.0-rc.2'))

  const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1])
  check('the README references screenshots', images.length >= 4, `${images.length} images`)
  for (const image of images) {
    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${image.replace(/^\.\//, '')}`
    try {
      const response = await fetch(url, { method: 'HEAD' })
      check(`  ${image} loads`, response.ok, `HTTP ${response.status}`)
    } catch (error) {
      unknown(`  ${image} loads`, `could not reach raw.githubusercontent.com (${error.cause?.code ?? error.message})`)
    }
  }

  const commits = await api(`/commits?sha=${BRANCH}&per_page=5`)
  check('the history is small and readable', commits.length <= 5, `${commits.length} recent`)

  // A run that could not find something out must not end on the same note as a
  // run that found everything fine. Exit 2 is "this did not run", so a caller
  // (or a person) can tell it apart from both outcomes.
  if (unchecked > 0) {
    console.log(
      `\n${unchecked} check(s) could not run, ${failed} failed. Everything else passed, ` +
        'but this is not a clean bill of health.',
    )
    process.exitCode = 2
  } else {
    console.log(
      failed === 0
        ? '\nAll checks passed. This is safe to hand to somebody.'
        : `\n${failed} check(s) failed.`,
    )
    // Set exitCode rather than calling process.exit: fetch keeps libuv handles
    // open while it tears down, and exiting underneath them trips an assertion in
    // uv's async close on Windows -- a scary crash message on a run that passed.
    process.exitCode = failed === 0 ? 0 : 1
  }
}

try {
  await run()
} catch (error) {
  if (error instanceof RateLimited) {
    console.error(`\ncould not check: ${error.message}`)
    process.exitCode = 2
  } else {
    throw error
  }
}
