/* Does every source chip fit on screen?
 *
 * The source rail used to be one row that scrolled sideways, with the right
 * edge masked so a half-clipped chip would read as "there is more". That is not
 * an affordance. A chip can sit entirely past the edge, and the only way to
 * learn it exists is to scroll a strip that draws no scrollbar -- the report
 * that prompted this was a user who found "DSH skill packs" by accidentally
 * pressing an arrow key.
 *
 * So the rail wraps now. This probe asks the browser the only question that
 * matters and that a screenshot cannot answer: is every chip inside its
 * container? It asks it twice -- once as the code stands, and once with the old
 * declarations forced back on top, because a check that cannot fail is not a
 * check. The old rail really did push the last chip out of the box; if that
 * stops being true the test has gone vacuous and should say so.
 *
 * Usage: node docs/preview.mjs && node docs/probe-rail.mjs
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'preview')

// Set SKILL_CENTER_CHROME to point at a browser this list does not know about.
const CHROME = [
  process.env.SKILL_CENTER_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate))

/* The rail as it was: no wrapping anywhere, the row scrolls, and the right edge
 * fades out so the clipped chip looks intentional. Forced back on top of the
 * current rules it is the control -- it has to overflow, or this probe is
 * measuring a page where the bug never existed and would pass no matter what. */
const OLD_RAIL_RULE = `
.sc-tabs { flex-wrap: nowrap; }
.sc-sources {
  flex: 1; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none; padding-right: 26px;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent);
}
`

/* Runs inside the page. Measures the rail and every chip in it, then does it
 * again with the old declarations in place. Geometry, not pixels: a chip that
 * is clipped still looks like a chip. */
const MEASURE_JS = `
try {
  const rail = document.querySelector('.sc-sources')
  if (rail === null) throw new Error('this page has no source rail')

  const measure = () => {
    const box = rail.getBoundingClientRect()
    return {
      rail: {
        left: Math.round(box.left),
        right: Math.round(box.right),
        clientWidth: rail.clientWidth,
        scrollWidth: rail.scrollWidth,
      },
      chips: [...rail.querySelectorAll('.sc-src')].map((chip) => {
        const r = chip.getBoundingClientRect()
        return {
          label: (chip.textContent || '').trim(),
          left: Math.round(r.left),
          right: Math.round(r.right),
          top: Math.round(r.top),
          width: Math.round(r.width),
        }
      }),
    }
  }

  const after = measure()

  const undo = document.createElement('style')
  undo.textContent = ${JSON.stringify(OLD_RAIL_RULE)}
  document.head.appendChild(undo)
  const before = measure()
  undo.remove()

  const pre = document.createElement('pre')
  pre.id = 'report'
  pre.textContent = JSON.stringify({ after: after, before: before })
  document.body.appendChild(pre)
} catch (error) {
  const pre = document.createElement('pre')
  pre.id = 'report'
  pre.textContent = JSON.stringify({ error: String(error) })
  document.body.appendChild(pre)
}
`

/* ------------------------------------------------------------------- helpers */

/* One place builds the URL, so nothing can disagree about which page it opened. */
const fileUrlOf = (htmlPath) => `file:///${htmlPath.replace(/\\/g, '/')}`

const readReport = (dumped) => {
  const match = /<pre id="report">([\s\S]*?)<\/pre>/.exec(dumped)
  if (match === null) return { error: 'the page did not report anything' }
  const text = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
  try {
    return JSON.parse(text)
  } catch (error) {
    return { error: String(error) }
  }
}

const withProfile = (run) => {
  const profile = mkdtempSync(join(tmpdir(), 'probe-rail-'))
  try {
    return run(profile)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
}

/** How far a chip sticks out of the rail, in CSS pixels. 0 means it fits. */
const overflowOf = (state) => {
  const worst = Math.max(
    0,
    ...state.chips.map((chip) => Math.max(chip.right - state.rail.right, state.rail.left - chip.left)),
  )
  const scroll = Math.max(0, state.rail.scrollWidth - state.rail.clientWidth)
  return Math.max(worst, scroll)
}

const labels = (state) => state.chips.map((chip) => chip.label).join(' / ')

/* ---------------------------------------------------------------------- main */

async function main() {
  const missing = ['drawer', 'browse']
    .flatMap((page) => ['light', 'dark'].map((theme) => `${page}-${theme}`))
    .filter((name) => !existsSync(join(outDir, `${name}.html`)))
  if (missing.length > 0) {
    console.log(`no preview to measure (${missing.join(', ')}) -- run: node docs/preview.mjs`)
    process.exitCode = 2
    return
  }
  if (CHROME === undefined) {
    console.log('no Chrome or Edge found; set SKILL_CENTER_CHROME and retry')
    process.exitCode = 2
    return
  }

  let failed = 0
  const check = (label, ok, detail) => {
    if (!ok) failed += 1
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : ` — ${detail}`}`)
  }

  const dumpDom = (fileUrl) =>
    withProfile((profile) =>
      execFileSync(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        // The drawer is min(800px, 94vw); this window makes it the full 800,
        // which is the tightest the rail ever gets in the real app.
        '--window-size=1240,860',
        '--virtual-time-budget=5000',
        '--dump-dom',
        fileUrl,
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    )

  for (const theme of ['light', 'dark']) {
    const source = readFileSync(join(outDir, `drawer-${theme}.html`), 'utf8')
    const page = join(outDir, `rail-${theme}.html`)
    writeFileSync(page, source.replace('</body>', `<script>${MEASURE_JS}</script></body>`), 'utf8')

    const report = readReport(dumpDom(fileUrlOf(page)))
    if (report.error !== undefined) {
      check(`[${theme}] the page reported what it measured`, false, report.error)
      continue
    }

    const { after, before } = report
    console.log(`\n${theme} — the source rail`)
    console.log(`  rail       ${after.rail.clientWidth}px wide, ${after.rail.scrollWidth}px of content`)
    console.log(`  chips      ${labels(after)}`)
    console.log(`  overflow   now ${overflowOf(after)}px, with the old rule ${overflowOf(before)}px`)

    /* Vacuous if there is nothing to check, or if the old rule no longer
     * reproduces the thing being fixed. */
    check(`[${theme}] the rail has sources in it`, after.chips.length >= 2, `${after.chips.length} chip(s)`)
    check(
      `[${theme}] the old rule really did push a chip out of the box`,
      overflowOf(before) > 0,
      `${overflowOf(before)}px`,
    )
    check(
      `[${theme}] nothing sticks out of the rail now`,
      overflowOf(after) === 0,
      `${overflowOf(after)}px past the edge`,
    )
    check(
      `[${theme}] the rail does not scroll sideways at all`,
      after.rail.scrollWidth <= after.rail.clientWidth + 1,
      `${after.rail.scrollWidth} > ${after.rail.clientWidth}`,
    )
    check(
      `[${theme}] every chip has a box you can hit`,
      after.chips.every((chip) => chip.width > 0),
      after.chips.filter((chip) => chip.width <= 0).map((chip) => chip.label).join(', '),
    )
    console.log(`  wrote preview/rail-${theme}.html`)

    /* The settings page is wider, so it never clipped. It is checked anyway:
     * the fix must not break the layout that already worked. */
    const inlineSource = readFileSync(join(outDir, `browse-${theme}.html`), 'utf8')
    const inlinePage = join(outDir, `rail-inline-${theme}.html`)
    writeFileSync(inlinePage, inlineSource.replace('</body>', `<script>${MEASURE_JS}</script></body>`), 'utf8')

    const inline = readReport(dumpDom(fileUrlOf(inlinePage)))
    if (inline.error !== undefined) {
      check(`[${theme}] the settings page reported what it measured`, false, inline.error)
      continue
    }
    console.log(`  settings   ${inline.after.rail.clientWidth}px wide, overflow ${overflowOf(inline.after)}px`)
    check(
      `[${theme}] the settings page still fits its sources too`,
      overflowOf(inline.after) === 0,
      `${overflowOf(inline.after)}px past the edge`,
    )
  }

  console.log(failed === 0 ? '\nEvery source chip is on screen.' : `\n${failed} check(s) failed.`)
  process.exitCode = failed === 0 ? 0 : 1
}

await main()
