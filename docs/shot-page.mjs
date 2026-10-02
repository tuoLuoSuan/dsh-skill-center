/* Screenshot the public GitHub page, so there is something to look at rather
 * than a list of assertions that the page is fine.
 *
 * Usage: node docs/shot-page.mjs [url] [output.png]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.argv[2] ?? 'https://github.com/tuoLuoSuan/dsh-skill-center'
const out = process.argv[3] ?? join(here, 'page.png')

const CHROME = [
  process.env.SKILL_CENTER_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate))

if (CHROME === undefined) {
  console.log('no Chrome or Edge found; set SKILL_CENTER_CHROME and retry')
  process.exitCode = 2
} else {
  const profile = mkdtempSync(join(tmpdir(), 'shot-page-'))
  const result = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--window-size=1280,2400',
      '--virtual-time-budget=15000',
      `--screenshot=${out}`,
      url,
    ],
    { stdio: 'inherit' },
  )
  rmSync(profile, { recursive: true, force: true })
  console.log(result.status === 0 && existsSync(out) ? `wrote ${out}` : `screenshot failed (exit ${result.status})`)
  process.exitCode = result.status === 0 && existsSync(out) ? 0 : 1
}
