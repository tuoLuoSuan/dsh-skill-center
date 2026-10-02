/**
 * Install this package into a throwaway dsh profile exactly the way a stranger
 * would, then answer the one question that matters about a published plugin:
 * did the host get a plugin, or did it get a second copy of itself?
 *
 * A `peerDependencies` entry on `@deepseek-ai/dsh` is a version gate the host
 * reads (`dsh-app-boot/lib/index.js:286`). It is also a dependency pnpm may try
 * to satisfy. Those are different consequences of one field, and the package is
 * only safe to publish if the gate fires and the install does not.
 *
 * Usage: node docs/probe-npm-install.mjs [<spec>]   (default: the packed tarball)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

const PROFILE = '__npm_probe__'
const HOME = process.env.USERPROFILE ?? process.env.HOME
const PACKAGE = 'dsh-skill-center'

const spec = process.argv[2] ?? resolve('dsh-skill-center-0.1.0.tgz')
const profileDir = join(HOME, '.dsh', 'profiles', PROFILE)

/*
 * Where the desktop build keeps its CLI. It is not on PATH, so guess the usual
 * install roots and let `SKILL_CENTER_DSH_CLI` settle it — the same shape as the
 * Chrome lookup in `preview.mjs`, and for the same reason: a path that is right
 * on one machine is a wrong absolute path in the repository.
 */
const CLI_NAMES = process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe'] : ['dsh']
const CLI_CANDIDATES = [
  process.env.SKILL_CENTER_DSH_CLI,
  ...(process.env.PATH ?? '').split(delimiter).flatMap((dir) => CLI_NAMES.map((name) => join(dir, name))),
  ...['LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']
    .map((key) => process.env[key])
    .filter(Boolean)
    .flatMap((root) => CLI_NAMES.map((name) => join(root, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', name))),
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh',
  '/usr/local/bin/dsh',
  '/usr/bin/dsh',
].filter(Boolean)

const cli = CLI_CANDIDATES.find((candidate) => existsSync(candidate))

if (cli === undefined) {
  console.error('could not find the dsh CLI. Looked at:')
  for (const candidate of CLI_CANDIDATES) console.error(`  ${candidate}`)
  console.error('\nset SKILL_CENTER_DSH_CLI to the dsh.cmd / dsh you want to test with.')
  process.exit(2)
}

/*
 * `dsh.cmd` is a two-line shim around an Electron binary running a JS entry:
 *
 *   ELECTRON_RUN_AS_NODE=1 "<root>/DeepSeek Harness.exe" --expose-internals
 *     "<root>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js" %*
 *
 * Node refuses to spawn a `.cmd` without a shell (EINVAL), and going through a
 * shell means quoting a path with a space in it. Calling the binary directly is
 * both simpler and closer to what the shim does, so do that and keep the shim
 * only as a fallback.
 *
 * The entry lives inside `app.asar`, which plain Node cannot see — `existsSync`
 * on it is false even when it is right there. Only the binary is checked; the
 * asar is Electron's problem, and Electron is what runs it.
 */
const binDir = dirname(cli)
const exe = resolve(binDir, '..', '..', '..', '..', 'DeepSeek Harness.exe')
const entry = resolve(binDir, '..', '..', '..', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')

function run(args) {
  const options = { stdio: 'pipe', encoding: 'utf8' }
  if (existsSync(exe)) {
    return execFileSync(exe, ['--expose-internals', entry, ...args], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  }
  return execFileSync('cmd.exe', ['/d', '/s', '/c', `"${cli}" ${args.map((a) => `"${a}"`).join(' ')}`], options)
}

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

/** Every directory a package's name maps to, so a nested copy cannot hide. */
function findInstalled(root, packageName) {
  const found = []
  const walk = (directory, depth) => {
    if (depth > 6) return
    const modules = join(directory, 'node_modules')
    if (!existsSync(modules)) return
    for (const entry of readdirSync(modules)) {
      if (entry.startsWith('.')) continue
      const full = join(modules, entry)
      if (entry === packageName) found.push(full)
      if (entry.startsWith('@')) {
        for (const scoped of readdirSync(full)) {
          if (`${entry}/${scoped}` === packageName) found.push(join(full, scoped))
        }
      }
      let isDirectory = false
      try { isDirectory = statSync(full).isDirectory() } catch { continue }
      if (isDirectory) walk(full, depth + 1)
    }
  }
  walk(root, 0)
  return found
}

console.log(`spec:    ${spec}`)
console.log(`cli:     ${cli}`)
console.log(`profile: ${profileDir}`)
console.log('')

rmSync(profileDir, { recursive: true, force: true })

let installed = false
try {
  const output = run(['plugin', '--profile', PROFILE, 'add', spec])
  installed = true
  const added = output.split('\n').filter((line) => /^\s*[+~-]|Done in|initialized profile/.test(line))
  console.log(added.map((line) => `     ${line.trim()}`).join('\n'))
} catch (error) {
  const text = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`
  check('dsh plugin add succeeds', false, text.trim().split('\n').slice(-5).join(' | '))
}

if (installed) {
  check('dsh plugin add succeeds', true)

  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles ?? []
  check('the host registered the bundle', bundles.includes(PACKAGE), JSON.stringify(bundles))

  const entries = findInstalled(profileDir, PACKAGE)
  check('the plugin landed in the profile', entries.length > 0, entries.join(', '))

  // The whole point of running this probe: one field, two consequences.
  const duplicates = findInstalled(profileDir, '@deepseek-ai/dsh')
  check('no second copy of the host was pulled in', duplicates.length === 0, duplicates.join(', '))

  const peers = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).peerDependencies ?? {}
  check('the manifest still carries the version gate', typeof peers['@deepseek-ai/dsh'] === 'string', JSON.stringify(peers))

  const entry = entries[0]
  if (entry !== undefined) {
    for (const relative of ['lib/index.js', 'client/client.js', 'locale/zh.json', 'cordis.patch.yml', 'icon.svg']) {
      check(`tarball ships ${relative}`, existsSync(join(entry, relative)))
    }
    const locale = JSON.parse(readFileSync(join(entry, 'locale', 'zh.json'), 'utf8'))
    check('the locale file decodes as Chinese', locale?.meta?.title === '技能中心', JSON.stringify(locale?.meta?.title))
  }
}

console.log('')
rmSync(profileDir, { recursive: true, force: true })
console.log(existsSync(profileDir) ? `FAIL cleanup left ${profileDir}` : 'cleaned up')

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
  process.exitCode = 1
} else {
  console.log('\nAll checks passed. A stranger can install this.')
}
