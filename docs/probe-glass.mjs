/* Does the panel survive a glass theme?
 *
 * A wallpaper plugin turns the harness translucent by rewriting the
 * --dsw-alias-bg-layer-* aliases to color-mix(..., transparent) -- the panel in
 * the wallpaper engine rewrites all of them. Any surface that paints itself
 * with those aliases then lets the wallpaper through, which is fine for a
 * chat bubble and wrong for a list of file trees.
 *
 * This check does not need that plugin installed, because it does not test the
 * plugin. It tests the contract: if some theme rewrites the layer aliases to
 * something translucent, does this panel stay opaque anyway? So it applies the
 * shape of the rewrite and then asks the browser four questions:
 *
 *   - did the rewrite actually reach the alias (otherwise the test is vacuous)
 *   - is the panel's own background still fully opaque
 *   - was the declaration it used to carry really translucent (the control)
 *   - with no glass theme, is the plate the same colour as the theme it sits in
 *   - and the mirror image of all that: in the settings page, where the surface
 *     belongs to the host and not to this panel, does the panel paint nothing?
 *     It painted a white rectangle once, square-cornered enough to poke out past
 *     the settings dialog's own rounded corner.
 *
 * The numbers come back through the DOM: the measuring script writes a JSON
 * report into a <pre>, and Chrome is asked to dump the DOM. Rendering a
 * picture proves nothing on its own, and a picture nobody measured is how the
 * translucency got in.
 *
 * Usage: node docs/preview.mjs && node docs/probe-glass.mjs
 * Output: docs/preview/glass-<theme>.html and .png, plus the checks below.
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

/* ---------------------------------------------------------------------------
 * The wallpaper's recipe, reproduced in shape. The exact weights are the
 * wallpaper engine's 0.9 / 1.0 / 1.1 ladder over a readability floor; what
 * matters here is only that every alias resolves to something less than fully
 * opaque, and that the app keeps no background of its own to hide behind.
 */
const GLASS_CSS = `
body.glass {
  --glass-tint: #ffffff;
  --glass-alpha: 50%;
  --glass-floor: 12%;
  --dsw-alias-bg-base: transparent;
  --dsw-specific-sidebar-fill: color-mix(in srgb, var(--glass-tint) 22%, transparent);
  --dsw-alias-bg-layer-1: color-mix(in srgb, var(--glass-tint) var(--glass-floor), color-mix(in srgb, var(--glass-tint) calc(var(--glass-alpha) * 0.9), transparent) calc(100% - var(--glass-floor)));
  --dsw-alias-bg-layer-2: color-mix(in srgb, var(--glass-tint) var(--glass-floor), color-mix(in srgb, var(--glass-tint) var(--glass-alpha), transparent) calc(100% - var(--glass-floor)));
  --dsw-alias-bg-layer-3: color-mix(in srgb, var(--glass-tint) var(--glass-floor), color-mix(in srgb, var(--glass-tint) calc(var(--glass-alpha) * 1.1), transparent) calc(100% - var(--glass-floor)));
  background-image: repeating-linear-gradient(45deg, #d81b60 0 40px, #1e88e5 40px 80px, #fdd835 80px 120px, #43a047 120px 160px);
  background-attachment: fixed;
}
body.glass[data-ds-dark-theme] { --glass-tint: #0d1524; }
#report { display: none; }
`

/* The declaration the panel used to carry. Applied on top of the glass theme it
 * is what the panel looked like before -- and it is the control the measuring
 * script forces back on to confirm that declaration was really the problem. */
const OLD_RULE = '.sc-drawer, .sc-root, .sc-detailbar, .sc-tab.sc-on { background: var(--dsw-alias-bg-layer-1, #fff) !important; }'

/* Runs inside the page. Reads the panel's own colour with the glass rewrite on
 * and off, then forces the declaration the panel used to carry back on top to
 * confirm that declaration was the problem. */
const MEASURE_JS = `
try {
  const scope = document.querySelector('.sc-scope')
  const surface = document.querySelector('.sc-drawer') || document.querySelector('.sc-root')
  const body = document.body

  // Let the browser canonicalise whatever spelling of a colour shows up, so
  // '#fff' and 'rgb(255, 255, 255)' compare equal.
  const toRgb = (value) => {
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.appendChild(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  }
  const readAlias = () => toRgb(getComputedStyle(scope).getPropertyValue('--dsw-alias-bg-layer-1').trim())
  const readColor = () => getComputedStyle(surface).backgroundColor.trim()

  body.classList.remove('glass')
  const plain = { alias: readAlias(), color: readColor() }
  body.classList.add('glass')
  const glass = { alias: readAlias(), color: readColor() }

  const undo = document.createElement('style')
  undo.textContent = ${JSON.stringify(OLD_RULE)}
  document.head.appendChild(undo)
  const before = { color: readColor() }
  undo.remove()

  const pre = document.createElement('pre')
  pre.id = 'report'
  pre.textContent = JSON.stringify({ surface: surface.className, plain: plain, glass: glass, before: before })
  document.body.appendChild(pre)
} catch (error) {
  const pre = document.createElement('pre')
  pre.id = 'report'
  pre.textContent = JSON.stringify({ error: String(error) })
  document.body.appendChild(pre)
}
`

/* The mirror question, asked of the settings page. Here the panel is a guest:
 * the dialog is the host's surface, so the panel must paint nothing at all.
 * `transparent` reads back as rgba(0, 0, 0, 0), which alphaOf scores as 0. */
const INLINE_JS = `
try {
  const root = document.querySelector('.sc-root')
  const pre = document.createElement('pre')
  pre.id = 'report'
  pre.textContent = JSON.stringify({ className: root.className, color: getComputedStyle(root).backgroundColor.trim() })
  document.body.appendChild(pre)
} catch (error) {
  const pre = document.createElement('pre')
  pre.id = 'report'
  pre.textContent = JSON.stringify({ error: String(error) })
  document.body.appendChild(pre)
}
`

/* ------------------------------------------------------------------- helpers */

const alphaOf = (value) => {
  const text = String(value).trim()
  const legacy = /^rgba?\(([^)]+)\)$/.exec(text)
  if (legacy !== null) {
    const parts = legacy[1].split(/[,\s/]+/).filter(Boolean)
    return parts.length < 4 ? 1 : Number(parts[3])
  }
  const modern = /^color\((.+)\)$/.exec(text)
  if (modern !== null) {
    const slash = modern[1].split('/')
    if (slash.length < 2) return 1
    const raw = slash[1].trim()
    return raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw)
  }
  return undefined
}

/* One place builds the URL, so a screenshot and a dump cannot disagree about
 * which page they are looking at. */
const fileUrlOf = (htmlPath) => `file:///${htmlPath.replace(/\\/g, '/')}`

/** The measuring script's report, or `{ error }` if the page did not produce one. */
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
  const profile = mkdtempSync(join(tmpdir(), 'probe-glass-'))
  try {
    return run(profile)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
}

/* ---------------------------------------------------------------------- main */

async function main() {
  const missing = ['drawer', 'browse'].flatMap((page) =>
    ['light', 'dark']
      .filter((theme) => !existsSync(join(outDir, `${page}-${theme}.html`)))
      .map((theme) => `${page}-${theme}`),
  )
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

  /* The file URL goes last on every command. Leave it off the screenshot and
   * Chrome happily photographs its own start page instead -- exit code 0, a
   * valid PNG, the wrong picture. One variable, so the two cannot drift. */
  const shoot = (htmlPath, pngPath) => {
    const fileUrl = fileUrlOf(htmlPath)
    withProfile((profile) => {
      execFileSync(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        '--window-size=1280,900',
        '--virtual-time-budget=5000',
        `--screenshot=${pngPath}`,
        fileUrl,
      ], { stdio: 'ignore' })
    })
    return fileUrl
  }

  const dumpDom = (fileUrl) =>
    withProfile((profile) =>
      execFileSync(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        '--virtual-time-budget=5000',
        '--dump-dom',
        fileUrl,
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    )

  for (const theme of ['light', 'dark']) {
    const source = readFileSync(join(outDir, `drawer-${theme}.html`), 'utf8')
    const build = (extraCss) =>
      source
        .replace('<body', '<body class="glass"')
        .replace('</head>', `<style>${GLASS_CSS}${extraCss}</style></head>`)
        .replace('</body>', `<script>${MEASURE_JS}</script></body>`)

    // Two pages: the panel as it is, and the panel with its old declaration
    // back on top. The first is the fix; the second is what the user saw.
    const afterPath = join(outDir, `glass-${theme}.html`)
    const beforePath = join(outDir, `glass-${theme}-before.html`)
    writeFileSync(afterPath, build(''), 'utf8')
    writeFileSync(beforePath, build(`\n${OLD_RULE}\n`), 'utf8')

    const afterUrl = shoot(afterPath, join(outDir, `glass-${theme}.png`))
    shoot(beforePath, join(outDir, `glass-${theme}-before.png`))

    const report = readReport(dumpDom(afterUrl))
    if (report.error !== undefined) {
      check(`[${theme}] the page reported what it measured`, false, report.error)
      continue
    }

    console.log(`\n${theme} — measuring .${report.surface}`)
    console.log(`  alias, no glass   ${report.plain.alias}`)
    console.log(`  alias, glass      ${report.glass.alias}`)
    console.log(`  panel, no glass   ${report.plain.color}`)
    console.log(`  panel, glass      ${report.glass.color}`)
    console.log(`  panel, old rule   ${report.before.color}`)

    check(`[${theme}] the glass rewrite reached the layer alias`, report.glass.alias !== report.plain.alias, `${report.plain.alias} -> ${report.glass.alias}`)
    check(`[${theme}] the panel is fully opaque under glass`, alphaOf(report.glass.color) === 1, report.glass.color)
    check(`[${theme}] the declaration it used to carry was translucent`, (alphaOf(report.before.color) ?? 1) < 1, report.before.color)
    check(`[${theme}] with no glass theme the plate is the theme's own colour`, report.plain.color === report.plain.alias, `${report.plain.color} vs ${report.plain.alias}`)
    check(`[${theme}] the plate does not move when glass arrives`, report.glass.color === report.plain.color, `${report.plain.color} -> ${report.glass.color}`)
    console.log(`  wrote preview/glass-${theme}.html and .png`)

    /* The same panel rendered inline into the settings dialog the host owns.
     * There the panel is a guest, and a guest that paints draws a rectangle. */
    const inlinePath = join(outDir, `glass-inline-${theme}.html`)
    const inlineSource = readFileSync(join(outDir, `browse-${theme}.html`), 'utf8')
    writeFileSync(inlinePath, inlineSource.replace('</body>', `<script>${INLINE_JS}</script></body>`), 'utf8')

    const inline = readReport(dumpDom(fileUrlOf(inlinePath)))
    if (inline.error !== undefined) {
      check(`[${theme}] the settings page reported what it measured`, false, inline.error)
      continue
    }

    console.log(`  settings root     ${inline.color}`)
    check(
      `[${theme}] the settings page owns its surface, so the panel paints none`,
      alphaOf(inline.color) === 0,
      `${inline.className} -> ${inline.color}`,
    )
  }

  console.log(failed === 0 ? '\nThe panel stays solid under a glass theme.' : `\n${failed} check(s) failed.`)
  process.exitCode = failed === 0 ? 0 : 1
}

await main()
