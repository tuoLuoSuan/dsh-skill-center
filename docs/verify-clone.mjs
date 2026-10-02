/* Does a stranger's clone actually work?
 *
 * Clones the public repository into a scratch directory and runs the checks
 * that do not need the live harness, from a clean checkout with no generated
 * files present. The point is to catch the things that only work on the
 * author's machine: a generated file that was never committed, a path that
 * only exists here, a script that assumes a sibling directory.
 *
 * Steps run with `stdio: 'inherit'` on purpose. Capturing a child's output
 * through a pipe needs a named pipe, which the DSH sandbox refuses, and the
 * failure arrives as an EPERM on `result.error` with empty stdout — which
 * looks exactly like a command that ran and printed nothing. Letting the child
 * write straight to this process's stdout keeps the real output visible and
 * removes the pipe from the picture. The cost is that there is no captured
 * text to reformat, so each step prints its own output.
 *
 * Usage: node docs/verify-clone.mjs [repo-url]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = process.argv[2] ?? 'https://github.com/tuoLuoSuan/dsh-skill-center.git'
const scratch = mkdtempSync(join(tmpdir(), 'skill-center-clone-'))
const workdir = join(scratch, 'dsh-skill-center')

let failed = 0

function step(label, command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workdir,
    stdio: 'inherit',
    shell: false,
    ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
  })

  // `error` means the process never started. Saying so out loud matters: an
  // EPERM here otherwise reads as a command that ran and printed nothing.
  if (result.error !== undefined && result.error !== null) {
    failed += 1
    console.log(`FAIL  ${label} — could not run: ${result.error.code ?? ''} ${result.error.message}`)
    return false
  }

  const ok = options.expect === 'fail' ? result.status !== 0 : result.status === 0
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` (exit ${result.status})`}`)
  return ok
}

console.log(`cloning ${REPO}\n     into ${workdir}`)

// The clone runs from the scratch directory: `workdir` is what it is about to
// create, and spawn with a cwd that does not exist yet reports ENOENT, which
// reads as "git is not installed" rather than "the directory is not there".
if (!step('clone', 'git', ['clone', '--depth', '1', REPO, workdir], { cwd: scratch })) {
  console.log(`\nclone failed; nothing else can run.`)
  process.exit(1)
}

// The generated files are deliberately not in the repository, so the first
// thing a stranger hits is their absence. Each one should say how to make it.
console.log('\n-- generated files are absent, and say how to make themselves --')
step('show-slot explains itself without the catalog', 'node', ['docs/show-slot.mjs', 'main'], { expect: 'fail' })
// An empty USERPROFILE is the only way to reach the not-found branch on a
// machine that does have DSH installed, which is exactly the machine this
// script runs on.
step('theme-tokens lists where it looked when there is no theme', 'node', ['docs/theme-tokens.mjs'], {
  expect: 'fail',
  env: { USERPROFILE: join(scratch, 'empty-home') },
})

console.log('\n-- checks that must pass on a bare clone --')
step('audit-publish', 'node', ['docs/audit-publish.mjs'])
step('smoke-host', 'node', ['docs/smoke-host.mjs'])
step('smoke-client', 'node', ['docs/smoke-client.mjs'])
step('check-classes', 'node', ['docs/check-classes.mjs'])
step('probe-validate', 'node', ['docs/probe-validate.mjs'])
step('probe-references', 'node', ['docs/probe-references.mjs'])

console.log('\n-- the theme is generated, then the previews render --')
// This one legitimately needs a local DSH install to copy the theme out of, so
// it is reported rather than counted: a machine without one is not a defect.
const theme = step('theme-tokens regenerates the theme', 'node', ['docs/theme-tokens.mjs'])
if (!theme) {
  failed -= 1
  console.log('      (no local DSH install to read the theme from; skipping the preview)')
} else {
  step('preview renders from the regenerated theme', 'node', ['docs/preview.mjs'])
  const shotCount = ['browse-light.png', 'conflict-light.png', 'local-light.png', 'installed-light.png']
    .filter((name) => existsSync(join(workdir, 'docs', 'screenshots', name))).length
  const ok = shotCount === 4
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  committed screenshots are present in the clone (${shotCount}/4)`)
}

console.log(
  failed === 0
    ? `\nAll checks passed. A stranger's clone works.`
    : `\n${failed} check(s) failed.`,
)
console.log(`removing ${scratch}`)
rmSync(scratch, { recursive: true, force: true })
process.exit(failed === 0 ? 0 : 1)
