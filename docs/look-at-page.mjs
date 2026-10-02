/* What does the page actually look like to somebody opening it?
 *
 * check-published.mjs reads the API, which tells you the repository is
 * correct. This one reads the rendered HTML, which tells you the page is
 * readable -- a README can be perfectly valid markdown and still render as a
 * wall of broken tables, and the only way to notice is to look at the output.
 *
 * Usage: node docs/look-at-page.mjs [owner/repo]
 */

const REPO = process.argv[2] ?? 'tuoLuoSuan/dsh-skill-center'
const url = `https://github.com/${REPO}`

let failed = 0
const check = (label, ok, detail) => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : ` — ${detail}`}`)
}

console.log(`fetching ${url}\n`)

const response = await fetch(url, {
  headers: {
    // Without a browser UA GitHub serves a different, poorer page.
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    accept: 'text/html',
  },
})
const html = await response.text()

check('the page is served', response.ok, `HTTP ${response.status}`)

// GitHub renders markdown into a container with this class. If it is missing,
// the README did not render at all.
check('the README rendered into the page', html.includes('markdown-body'))
check('the repository name is in the title', html.includes(REPO.split('/')[1]))

// The screenshots are the first thing anybody looks at, so they have to be
// real <img> tags pointing at camo/GitHub's image proxy, not broken links.
const imageSources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1])
const screenshotSources = imageSources.filter((src) => src.includes('screenshots') || src.includes('camo'))
check('the rendered page contains image tags', screenshotSources.length >= 1, `${screenshotSources.length} image(s)`)

// Chinese must survive the round trip; a mojibake README looks like a broken
// repository even when every byte is correct.
check('Chinese text survives into the HTML', html.includes('技能中心'))
check('no replacement characters are on the page', !html.includes('\uFFFD'))

const topics = ['dsh', 'dsh-plugin', 'agent-skills']
for (const topic of topics) {
  check(`  topic "${topic}" is on the page`, html.toLowerCase().includes(`topic=${topic}`) || html.includes(`>${topic}<`))
}

console.log(
  failed === 0
    ? '\nThe page looks right.'
    : `\n${failed} check(s) failed.`,
)
// Set exitCode rather than calling process.exit: fetch keeps libuv handles
// open while it tears down, and exiting underneath them trips an assertion in
// uv's async close on Windows -- a scary crash message on a run that passed.
process.exitCode = failed === 0 ? 0 : 1
