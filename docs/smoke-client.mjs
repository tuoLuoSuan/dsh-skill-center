/**
 * Headless smoke test for the browser half.
 *
 * The bundle is a classic script that talks to `window.__ModuleLoader__`, so
 * this harness stands in for the loader: it captures the registration, calls
 * the factory with a stub `react`, then runs `apply()` against a stub cordis
 * context and renders the registered components through a miniature React
 * (createElement + hooks) to prove they do not throw and reach the host API.
 *
 * It is a structural renderer, not React: it cannot catch a bad `key`, but it
 * does catch undefined references, broken prop plumbing and wrong fetch URLs.
 *
 * Usage: node docs/smoke-client.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  React,
  mount,
  find,
  textOf,
  findButton,
  buttonWithClass,
  runCleanups,
} from './mini-react.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'client', 'client.js')
const source = readFileSync(bundlePath, 'utf8')

let failures = 0
const check = (label, condition, detail) => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail === undefined ? '' : ` · ${detail}`}`)
  if (!condition) failures += 1
}

// The React stand-in, serializers and query helpers live in mini-react.mjs so
// the design preview in docs/preview.mjs exercises the exact same stub.

// ------------------------------------------------------------- browser stubs
const requests = []
const styles = []

const jsonResponse = (payload) => ({
  // The host answers failures with `{ ok: false, error }`, so honour it here
  // rather than forcing every fixture to be a happy one.
  ok: payload?.ok !== false,
  status: payload?.ok === false ? 404 : 200,
  json: async () => payload,
})

const routeTable = {
  '/dsh-skill-center/api/sources': {
    sources: [
      { id: 'claudeskills', label: '公开注册表', kind: 'registry', installable: true, needsQuery: false },
      { id: 'anthropic', label: 'Anthropic 官方', kind: 'repo', installable: true, needsQuery: false },
      { id: 'skillsmp', label: 'SkillsMP', kind: 'registry', installable: true, needsQuery: true },
    ],
    taxonomy: {
      // The upstream meta endpoint reports categories as bare strings, which is
      // exactly how the panel's category <select> consumes them.
      categories: ['pdf', 'writing'],
      counts: { skill: 42824, plugin: 6364 },
      totalItems: 51916,
      uniqueRepos: 10771,
    },
    quota: undefined,
    installed: { counts: 1, roots: [{ path: 'C:\\Users\\you\\.dsh\\skills', label: '用户技能', count: 1 }] },
    home: 'C:\\Users\\you\\.dsh',
    userRoot: 'C:\\Users\\you\\.dsh\\skills',
  },
  '/dsh-skill-center/api/installed': {
    skills: [
      {
        name: 'nature-figure',
        description: '写论文配图',
        valid: true,
        source: 'user-dsh',
        root: 'C:\\Users\\you\\.dsh\\skills',
        path: 'C:\\Users\\you\\.dsh\\skills\\nature-figure',
        fileCount: 3,
        bytes: 4096,
        writable: true,
        // The update badge is only rendered for skills this plugin installed,
        // so the fixture carries a receipt for one row and none for the other.
        provenance: {
          source: 'anthropic',
          origin: 'remote',
          installedAt: '2026-10-01T10:00:00.000Z',
          update: { status: 'update', checkedAt: '2026-10-02T03:00:00.000Z' },
        },
      },
      {
        name: 'stale-skill',
        description: '这个技能的上游已经删掉了',
        valid: true,
        source: 'user-dsh',
        root: 'C:\\Users\\you\\.dsh\\skills',
        path: 'C:\\Users\\you\\.dsh\\skills\\stale-skill',
        fileCount: 2,
        bytes: 900,
        writable: true,
        provenance: {
          source: 'claudeskills',
          origin: 'local',
          from: 'C:\\Users\\you\\.claude\\skills\\stale-skill',
          update: { status: 'missing', checkedAt: '2026-10-02T03:00:00.000Z' },
        },
      },
      {
        // Hand-written, or installed before this plugin existed: no receipt, so
        // no update badge and nothing for the checker to compare.
        name: 'handwritten-skill',
        description: '自己写的技能，没有来路记录',
        valid: true,
        source: 'user-dsh',
        root: 'C:\\Users\\you\\.dsh\\skills',
        path: 'C:\\Users\\you\\.dsh\\skills\\handwritten-skill',
        fileCount: 1,
        bytes: 300,
        writable: true,
      },
    ],
    roots: [{ path: 'C:\\Users\\you\\.dsh\\skills', label: '用户技能', count: 3 }],
    trash: 1,
    managed: 2,
  },
  '/dsh-skill-center/api/trash': {
    // The host answers with `items`, not the name of the collection.
    items: [
      {
        bucket: 'pdf-2026-10-02_03-37-26',
        name: 'pdf',
        trashedAt: '2026-10-02T03:37:26.606Z',
        source: 'anthropic',
        bytes: 47100,
        managed: true,
      },
    ],
  },
  '/dsh-skill-center/api/restore': { ok: true, name: 'pdf', directory: 'C:\\Users\\you\\.dsh\\skills\\pdf' },
  '/dsh-skill-center/api/purge': { ok: true, removed: 1 },
  '/dsh-skill-center/api/updates': {
    results: { 'nature-figure': { status: 'current', checkedAt: '2026-10-02T03:00:00.000Z' } },
    // Top-level, not per-result: the footer renders it, and a missing one
    // prints "Invalid Date".
    checkedAt: '2026-10-02T03:41:00.000Z',
    tally: { total: 2, current: 1, update: 1, missing: 0, unknown: 0, unmanaged: 0 },
  },
  '/dsh-skill-center/api/update': { ok: true, name: 'nature-figure', updated: true },
  '/dsh-skill-center/api/agents': {
    groups: [
      {
        id: 'claude',
        label: 'Claude Code（用户级）',
        path: 'C:\\Users\\you\\.claude\\skills',
        visible: false,
        exists: true,
        // Three shapes the importer has to tell apart: fine, repairable, hopeless.
        skills: [
          { name: 'tidy-helper', description: '干净的一个', path: 'C:\\Users\\you\\.claude\\skills\\tidy-helper', valid: true, repairable: false, collision: false, installed: false },
          { name: 'Badly_Named', description: '名字不合法但能修', path: 'C:\\Users\\you\\.claude\\skills\\Badly_Named', valid: false, repairable: true, suggestedName: 'badly-named', collision: false, installed: false, problems: [{ level: 'error', code: 'name-grammar', message: 'name 只能用小写字母、数字和连字符' }] },
          { name: 'no-frontmatter', description: '', path: 'C:\\Users\\you\\.claude\\skills\\no-frontmatter', valid: false, repairable: false, collision: true, installed: true, duplicateOf: 'claude', problems: [{ level: 'error', code: 'no-frontmatter', message: '没有 YAML frontmatter，DSH 无法识别这个目录是技能' }] },
        ],
      },
      { id: 'gemini', label: 'Gemini', path: 'C:\\Users\\you\\.gemini\\skills', visible: false, exists: false, skills: [] },
    ],
    hidden: 2,
  },
  '/dsh-skill-center/api/import-local': { ok: true, name: 'tidy-helper', repaired: false, directory: 'C:\\Users\\you\\.dsh\\skills\\tidy-helper' },
  '/dsh-skill-center/api/list': {
    items: [
      {
        key: 'anthropic|pdf',
        source: 'anthropic',
        kind: 'skill',
        name: 'pdf',
        title: 'pdf',
        description: 'Use this skill whenever the user wants to do anything with PDF files.',
        category: 'pdf',
        stars: 0,
        author: 'anthropics',
        repo: 'anthropics/skills',
        dir: 'document-skills/pdf',
        url: 'https://github.com/anthropics/skills/tree/main/document-skills/pdf',
        installable: true,
      },
    ],
    total: 19,
    exactTotal: true,
    note: '',
  },
  '/dsh-skill-center/api/preview': {
    suggestedName: 'pdf',
    description: 'Use this skill whenever the user wants to do anything with PDF files.',
    license: 'Complete terms in LICENSE.txt',
    totalBytes: 12345,
    // What the harness will make of this document, decided before anything is
    // written to disk.
    inspection: {
      blocked: true,
      repairable: true,
      declaredName: 'PDF-Processing',
      suggestedName: 'pdf-processing',
      installName: 'pdf',
      problems: [
        { level: 'error', code: 'name-grammar', message: 'name 只能用小写字母、数字和连字符' },
        { level: 'warn', code: 'name-mismatch', message: 'frontmatter 里的 name 和目录名不一致' },
      ],
    },
    // A half-fetched tree and a SKILL.md pointing at files nobody shipped: both
    // install cleanly and both fail later, so both are said here.
    completeness: {
      complete: false,
      fileCount: 2,
      byteCount: 8235,
      skippedCount: 4,
      reasons: [{ reason: 'file-budget', message: '达到文件数上限，其余文件没有取回', count: 4 }],
      skipped: [],
    },
    references: {
      referenced: 3,
      present: 1,
      missingCount: 2,
      missing: [
        { path: 'references/schema.md', kind: 'code', line: 12 },
        { path: 'scripts/fill.py', kind: 'link', line: 30 },
      ],
    },
    conflict: { exists: true, name: 'pdf', sameSource: false, existingSource: 'claudeskills', existingTitle: 'pdf', renameTo: 'pdf-2' },
    // The pane has to name the revision it read, or the guarantee that an
    // install cannot drift under the user is invisible.
    revision: { commit: '8ca22dba9a94f28898bbce59f2537ff4d87c747d', committedAt: '2026-09-25T18:06:27Z', fetchedVia: 'tarball', pinned: true },
    files: [
      { path: 'SKILL.md', bytes: 8035, preview: '---\nname: pdf\n---\n', truncated: false },
      { path: 'forms.md', bytes: 200, preview: '# forms', truncated: false },
    ],
  },
  '/dsh-skill-center/api/install': {
    ok: true,
    name: 'pdf',
    directory: 'C:\\Users\\you\\.dsh\\skills\\pdf',
    files: ['SKILL.md', 'forms.md'],
  },
  '/dsh-skill-center/api/remove': {
    ok: true,
    name: 'nature-figure',
    directory: 'C:\\Users\\you\\.dsh\\skills\\nature-figure',
  },
}

const fetchStub = async (url, options = {}) => {
  const parsed = new URL(url, 'http://127.0.0.1:19387/')
  requests.push({ path: parsed.pathname, search: parsed.search, method: options.method ?? 'GET', body: options.body })
  const payload = routeTable[parsed.pathname]
  if (payload === undefined) throw new Error(`no stub for ${parsed.pathname}`)
  return jsonResponse(payload)
}

const listeners = new Map()
const styleElements = []

globalThis.window = {
  confirm: () => true,
  addEventListener: (type, handler) => listeners.set(type, handler),
  removeEventListener: (type) => listeners.delete(type),
  location: { href: 'http://127.0.0.1:19387/' },
}
globalThis.document = {
  baseURI: 'http://127.0.0.1:19387/',
  head: {
    appendChild: (node) => styleElements.push(node),
  },
  documentElement: { appendChild: () => {} },
  createElement: (tag) => {
    const node = {
      tag,
      attributes: {},
      textContent: '',
      setAttribute(name, value) {
        node.attributes[name] = String(value)
      },
      remove() {
        const index = styleElements.indexOf(node)
        if (index !== -1) styleElements.splice(index, 1)
      },
    }
    if (tag === 'style') styles.push(node)
    return node
  },
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.fetch = fetchStub

let registration
globalThis.window.__ModuleLoader__ = {
  load: (value) => {
    registration = value
  },
}

// ------------------------------------------------------------------ evaluate
const runBundle = new Function('window', 'document', 'fetch', 'console', source)
runBundle(globalThis.window, globalThis.document, fetchStub, {
  info: () => {},
  warn: () => {},
  error: () => {},
})

console.log('[bundle registration]')
check('registered through __ModuleLoader__.load', registration !== undefined)
check('registration id is the package name', registration?.id === 'dsh-skill-center', registration?.id)
check('factory is a function', typeof registration?.factory === 'function')

const exportsObject = registration.factory((spec) => {
  if (spec === 'react') return React
  throw new Error(`the bundle required "${spec}", which is not a platform seed`)
})

console.log('\n[exports contract]')
check('exports.name is the locale namespace', exportsObject.name === 'dsh-skill-center', exportsObject.name)
check('exports.inject is a string array', Array.isArray(exportsObject.inject) && exportsObject.inject.every((item) => typeof item === 'string'),
  JSON.stringify(exportsObject.inject))
check('exports.apply is a function', typeof exportsObject.apply === 'function')

// ------------------------------------------------------------------ apply()
const slotRegistrations = []
const localeRegistrations = []
/** Disposers returned by the stub `ctx.effect`, replayed at the end. */
const cleanups = []

const ctx = {
  effect(callback) {
    const cleanup = callback()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
    return typeof cleanup === 'function' ? cleanup : () => {}
  },
  on() {
    return () => {}
  },
  locale: {
    register: (namespace, ...rest) => {
      localeRegistrations.push({ namespace, rest })
      return () => {}
    },
    bind: (namespace) => {
      const dictionaries = localeRegistrations[0]?.rest?.[0] ?? {}
      return (key, params) => {
        const template = dictionaries.zh?.[key] ?? key
        return params === undefined ? template : template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
      }
    },
  },
  slots: {
    inject: (name, callback) => {
      callback()
    },
    register: (meta, component) => {
      slotRegistrations.push({ meta, component })
      return () => {}
    },
  },
}

let applyError
try {
  exportsObject.apply(ctx)
} catch (error) {
  applyError = error
}
check('apply() does not throw', applyError === undefined, applyError?.message)

console.log('\n[locale]')
check('dictionaries registered under the namespace', localeRegistrations[0]?.namespace === 'dsh-skill-center', localeRegistrations[0]?.namespace)
const zh = localeRegistrations[0]?.rest?.[0]?.zh ?? {}
const en = localeRegistrations[0]?.rest?.[0]?.en ?? {}
check('both zh and en dictionaries present', Object.keys(zh).length > 20 && Object.keys(en).length > 20,
  `${Object.keys(zh).length} zh / ${Object.keys(en).length} en keys`)
check('dictionary keys agree across locales', Object.keys(zh).every((key) => key in en))
check('nav label is translated', zh.nav === '技能中心', zh.nav)

console.log('\n[styles]')
const styleNode = styleElements[0]
check('a <style> element was injected', styleNode !== undefined && styleNode.attributes['data-dsh-skill-center'] !== undefined,
  JSON.stringify(styleNode?.attributes))
check('css uses the harness theme tokens', typeof styleNode?.textContent === 'string' && styleNode.textContent.includes('--dsw-alias-bg-layer-2'),
  `${styleNode?.textContent?.length ?? 0} chars`)

console.log('\n[slots]')
const byName = (name) => slotRegistrations.filter((entry) => entry.meta.name === name)
check('three slots registered', slotRegistrations.length === 3, slotRegistrations.map((entry) => entry.meta.name).join(', '))
check('sidebar footer action registered', byName('sidebar.footer.action').length === 1)
check('shell overlay registered', byName('shell.overlay').length === 1)
check('settings section registered', byName('settings.section').length === 1)
check('every registration carries the plugin id', slotRegistrations.every((entry) => entry.meta.id === 'dsh-skill-center'))
check('labels are thunks returning the nav string', slotRegistrations.every((entry) => typeof entry.meta.label === 'function' && entry.meta.label() === '技能中心'))
check('inject() returns a plain object', slotRegistrations.every((entry) => {
  const value = entry.meta.inject()
  return value !== null && typeof value === 'object'
}))
check('components are functions', slotRegistrations.every((entry) => typeof entry.component === 'function'))

// ------------------------------------------------------------------- render
const footer = byName('sidebar.footer.action')[0]
const overlayEntry = byName('shell.overlay')[0]
const section = byName('settings.section')[0]
const renderPanel = () => mount(section?.component({ close: () => {} }) ?? null)
const renderFooter = () => mount(footer?.component({ wide: true }) ?? null)
/** Toasts ride the overlay occupant, so this is where their text lives. */
const renderOverlay = () => mount(overlayEntry?.component({}) ?? null)

console.log('\n[render: sidebar footer action]')
let footerError
let footerTree
try {
  footerTree = renderFooter()
} catch (error) {
  footerError = error
}
check('wide rail renders', footerError === undefined, footerError?.message)
check('shows the localized label', footerTree?.html.includes('技能中心'))
check('renders as a button', footerTree?.html.includes('<button'))
let narrowHtml = ''
let narrowError
try {
  narrowHtml = footer === undefined ? '' : mount(footer.component({ wide: false })).html
} catch (error) {
  narrowError = error
}
check('collapsed rail renders', narrowError === undefined && narrowHtml.length > 0, narrowError?.message ?? `${narrowHtml.length} chars`)

console.log('\n[render: shell overlay]')
let overlayError
let overlayTree
try {
  overlayTree = mount(overlayEntry?.component({}) ?? null)
} catch (error) {
  overlayError = error
}
check('overlay renders while closed', overlayError === undefined, overlayError?.message)
check('closed overlay stays empty', (overlayTree?.html ?? '') === '', `${(overlayTree?.html ?? '').length} chars`)

console.log('\n[render: settings section]')
let panelError
let panelTree
try {
  panelTree = renderPanel()
} catch (error) {
  panelError = error
}
check('inline panel renders', panelError === undefined, panelError?.message)
check('renders the title', panelTree?.html.includes('技能中心'))
check('renders the search placeholder', panelTree?.html.includes('搜索技能'))

// ------------------------------------------------------------ effect + fetch
await new Promise((resolve) => setTimeout(resolve, 60))

console.log('\n[host calls]')
const paths = requests.map((request) => request.path)
check('asked the host for the source list', paths.includes('/dsh-skill-center/api/sources'), paths.join(', '))
check('asked the host for the first page', paths.includes('/dsh-skill-center/api/list'))
const firstList = requests.find((request) => request.path === '/dsh-skill-center/api/list')
check('first page targets a real source', (firstList?.search ?? '').includes('source='), firstList?.search)
check('first page carries the query parameters', (firstList?.search ?? '').includes('limit='), firstList?.search)
check('requests are same-origin paths', requests.every((request) => request.path.startsWith('/dsh-skill-center/api/')))

// The first paint happens before the host answers, so re-render now that the
// store has settled: this is what the user actually ends up looking at.
panelTree = renderPanel()
check('a skill card was rendered', (panelTree?.html ?? '').includes('pdf'), `${(panelTree?.html ?? '').length} chars`)
check('the result count is shown', (panelTree?.html ?? '').includes('19'), 'total 19')

console.log('\n[interaction: search]')
const inputOf = (tree) => find(tree, (node) => node.type === 'input' && String(node.props.className ?? '').includes('sc-input'))
const input = inputOf(panelTree)
check('search input is present', input !== undefined, input?.props?.placeholder)
if (input !== undefined) {
  input.props.onChange({ target: { value: 'pdf' } })
  const echoedInput = inputOf(renderPanel())
  check('typed value round-trips through the store', echoedInput?.props.value === 'pdf', JSON.stringify(echoedInput?.props.value))
  echoedInput?.props.onKeyDown({ key: 'Enter', preventDefault: () => {} })
  await new Promise((resolve) => setTimeout(resolve, 40))
  const searched = requests.filter((request) => request.search.includes('q=pdf'))
  check('enter issues a keyword query', searched.length > 0, searched[0]?.search)
}

console.log('\n[interaction: tabs and remove]')
const installedTab = findButton(renderPanel(), '已安装')
check('installed tab button is present', installedTab !== undefined, installedTab && textOf(installedTab.props.children))
if (installedTab !== undefined) {
  installedTab.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 40))
  const refreshed = requests.find((request) => request.path === '/dsh-skill-center/api/installed')
  check('switching to the installed tab refreshes the inventory', refreshed !== undefined)
  const afterTab = renderPanel()
  check('installed pane lists the local skill', afterTab.html.includes('nature-figure'))
  const removeButton = find(afterTab, (node) => node.type === 'button' && String(node.props.className ?? '').includes('sc-danger'))
  check('writable skill offers a remove button', removeButton !== undefined)
  if (removeButton !== undefined) {
    removeButton.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 40))
    const removed = requests.find((request) => request.path === '/dsh-skill-center/api/remove')
    check('remove posts the skill name', removed !== undefined && String(removed.body).includes('nature-figure'), removed?.body)
  }
}

console.log('\n[interaction: install flow]')
const browseTab = findButton(renderPanel(), '发现')
check('browse tab button is present', browseTab !== undefined)
browseTab?.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 40))
const browseTree = renderPanel()
// A card is not installable directly: it opens the detail drawer, which is where
// the install button (and therefore the preview confirmation) lives.
const card = find(browseTree, (node) => String(node.props.className ?? '') === 'sc-card')
check('skill card is clickable', card !== undefined)
if (card !== undefined) {
  card.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 60))
  const detail = requests.find((request) => request.path === '/dsh-skill-center/api/item')
  check('opening a card loads its SKILL.md', detail !== undefined, detail?.body?.slice(0, 120))
  const detailTree = renderPanel()
  const installButton = findButton(detailTree, '安装到本地')
  check('detail pane offers an install button', installButton !== undefined, installButton && textOf(installButton.props.children))
  if (installButton !== undefined) {
    installButton.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 60))
    const preview = requests.find((request) => request.path === '/dsh-skill-center/api/preview')
    check('install opens a preview first', preview !== undefined, preview?.body?.slice(0, 100))
    const previewTree = renderPanel()
    // A taken name turns the primary button into the outcome it will produce,
    // so the button itself is the assertion that the choice was understood.
    const confirm = findButton(previewTree, '安装为 pdf-2')
    check('a taken name relabels the confirm button', confirm !== undefined, confirm && textOf(confirm.props.children))
    // The whole point of the pre-install check: a name the harness would
    // silently skip is said out loud, before anything is written.
    check('preview says the document would be skipped', previewTree.html.includes('DSH 会直接忽略它'), previewTree.html.slice(0, 160))
    check('preview lists the validator message', previewTree.html.includes('name 只能用小写字母'), undefined)
    const repairBox = find(previewTree, (node) => node.type === 'input' && node.props.type === 'checkbox')
    check('a repairable name offers the fix checkbox', repairBox !== undefined)
    // Never overwrite and never silently suffix: both are facts the user only
    // discovers afterwards, so all three answers are on screen at once.
    const choices = previewTree.nodes.filter((node) => node.type === 'input' && node.props.type === 'radio')
    check('all three conflict answers are offered', choices.length === 3, `found ${choices.length}`)
    check('the conflicting name is explained, not just reported', previewTree.html.includes('这个名字已经被占用了'))
    // The receipt stores a source id; the rail is where its human name lives,
    // so the panel has to look it up rather than print "claudeskills".
    check('the occupant is named in human words', previewTree.html.includes('公开注册表'), undefined)
    const picked = choices.find((node) => node.props.checked === true)
    check('the default answer leaves the existing skill alone', picked?.props.value === 'rename', picked?.props.value)
    // Truncation is the one failure a user cannot see afterwards.
    check('preview reports the partial fetch', previewTree.html.includes('预览不完整'))
    check('the partial count is the skipped count', previewTree.html.includes('还有 4 个文件没有检查'), undefined)
    check('preview names the reason fetching stopped', previewTree.html.includes('达到文件数上限'))
    check('preview shows the integrity stat', previewTree.html.includes('部分'))
    check('preview lists files the SKILL.md points at but nobody shipped', previewTree.html.includes('references/schema.md') && previewTree.html.includes('scripts/fill.py'))
    // Which revision is on screen is part of what is being previewed: without
    // it, two people reading the same skill page cannot tell they are looking
    // at different code.
    check('preview names the upstream revision', previewTree.html.includes('上游版本') && previewTree.html.includes('8ca22db'), undefined)
    check('preview dates that revision', previewTree.html.includes('2026-09-25'), undefined)
    if (confirm !== undefined) {
      confirm.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 60))
      const install = requests.find((request) => request.path === '/dsh-skill-center/api/install')
      check('confirm posts the install', install !== undefined, install?.body?.slice(0, 140))
      check('the install carries the repair decision', String(install?.body ?? '').includes('"repair"'), install?.body?.slice(0, 160))
      check('the install carries the conflict decision', String(install?.body ?? '').includes('"conflict":"rename"'), install?.body?.slice(0, 160))
    }
  }
}

console.log('\n[installed: provenance, updates and the trash]')
const installedAgain = findButton(renderPanel(), '已安装')
installedAgain?.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 60))
const installedTree = renderPanel()
check('the inventory asks for the trash too', requests.some((request) => request.path === '/dsh-skill-center/api/trash'))
check('an updatable skill shows its badge', installedTree.html.includes('有更新'))
check('a skill whose upstream vanished says so', installedTree.html.includes('上游已删除'))
// A skill this plugin never installed has no receipt, so it must stay silent
// rather than claim to be current.
const receipts = (routeTable['/dsh-skill-center/api/installed'].skills ?? []).filter((skill) => skill.provenance !== undefined)
check('only skills with a receipt get a badge', receipts.length === 2)
check('the trash is rendered as a separate block', installedTree.html.includes('sc-trash'))
check('the trashed skill is listed by name', installedTree.html.includes('pdf-2026-10-02'))
check('a managed trash entry promises a clean restore', installedTree.html.includes('最新'))

const updateButton = findButton(installedTree, '检查更新')
check('the inventory offers an update check', updateButton !== undefined)
if (updateButton !== undefined) {
  updateButton.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 80))
  check('checking updates hits the updates route', requests.some((request) => request.path === '/dsh-skill-center/api/updates'))
  // Only skills this plugin installed carry a receipt, so the toast has to say
  // how much of the shelf it actually compared — "all current" over a checked
  // set of two out of four is true and misleading at once.
  const toastText = renderOverlay().html
  check('the update toast states its coverage', toastText.includes('有来路记录 2/3'), toastText.slice(-500))
  check('the footer stamps the check, not Invalid Date', !renderPanel().html.includes('Invalid Date'))
}

const restoreButton = findButton(renderPanel(), '恢复')
check('a trashed skill can be restored', restoreButton !== undefined)
if (restoreButton !== undefined) {
  restoreButton.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 60))
  const restore = requests.find((request) => request.path === '/dsh-skill-center/api/restore')
  check('restore posts the bucket', restore !== undefined && String(restore.body).includes('pdf-2026-10-02'), restore?.body)
}

console.log('\n[local: skills from other agents]')
const localTab = findButton(renderPanel(), '本机')
check('the local tab is present', localTab !== undefined)
if (localTab !== undefined) {
  localTab.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 80))
  check('opening the local tab scans the other agents', requests.some((request) => request.path === '/dsh-skill-center/api/agents'))
  const localTree = renderPanel()
  check('only existing agent directories are shown', localTree.html.includes('Claude Code') && !localTree.html.includes('Gemini'))
  check('a clean skill is offerable', localTree.html.includes('tidy-helper'))
  // "invalid" on its own gives the user nothing to act on, so the validator's
  // own wording has to reach the row.
  check('a broken skill shows the reason', localTree.html.includes('没有 YAML frontmatter'))
  check('a repairable skill says it can be fixed', localTree.html.includes('可自动修正'))
  check('a hopeless skill says it will be ignored', localTree.html.includes('会被忽略'))
  check('an already-installed duplicate is flagged', localTree.html.includes('同名已装') && localTree.html.includes('重复'))
  const importButton = findButton(localTree, '导入')
  check('an importable skill has an import button', importButton !== undefined)
  if (importButton !== undefined) {
    importButton.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 60))
    const imported = requests.find((request) => request.path === '/dsh-skill-center/api/import-local')
    check('import posts the discovered path', imported !== undefined && String(imported.body).includes('tidy-helper'), imported?.body)
  }
}

console.log('\n[local: a host that predates this client]')
{
  // The client half hot-reloads and the host half only changes on restart, so
  // this skew is a state users will really hit — and it must not read as a bug.
  const healthy = routeTable['/dsh-skill-center/api/agents']
  routeTable['/dsh-skill-center/api/agents'] = { ok: false, error: 'no such route: /agents' }
  // The tab click is a no-op once groups are loaded, so force the rescan.
  findButton(renderPanel(), '重新扫描')?.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 60))
  const staleTree = renderPanel()
  check('an older host is named as such, not shown as an error', staleTree.html.includes('宿主代码还是旧版本'), staleTree.html.slice(0, 160))
  check('the skew message says what to do about it', staleTree.html.includes('重启 DeepSeek Harness'))
  routeTable['/dsh-skill-center/api/agents'] = healthy
}

console.log('\n[overlay opens from the footer]')
const footerButton = findButton(renderFooter())
check('footer action is clickable', footerButton !== undefined)
footerButton?.props.onClick()
let openError
let openTree
try {
  openTree = mount(overlayEntry?.component({}) ?? null)
} catch (error) {
  openError = error
}
check('overlay renders while open', openError === undefined, openError?.message)
check('drawer markup appears', (openTree?.html ?? '').includes('sc-drawer'), `${(openTree?.html ?? '').length} chars`)

console.log('\n[escape unwinds one layer at a time]')
const onKeyDown = listeners.get('keydown')
check('the plugin listens for keydown', typeof onKeyDown === 'function')
if (typeof onKeyDown === 'function') {
  const press = (key) => onKeyDown({ key, preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40))
  // Assert on the overlay, not the inline panel: the overlay mount is the one
  // that tracks the store turn for turn, and it renders the same Panel.
  const drawerHtml = () => mount(overlayEntry?.component({}) ?? null)?.html ?? ''
  const drawerOpen = () => drawerHtml().includes('sc-drawer')
  const html = () => drawerHtml()

  // Start from a known baseline.
  for (let i = 0; i < 5 && (drawerOpen() || html().includes('sc-detailbar')); i += 1) {
    press('Escape')
    await settle()
  }

  // Phase 1 — the safety case the desktop app needs: an empty drawer closes.
  findButton(renderFooter())?.props.onClick()
  await settle()
  check('baseline: the drawer opens', drawerOpen())
  press('Escape')
  await settle()
  check('escape closes an open drawer', !drawerOpen())

  // Phase 2 — with a skill detail open, escape backs out of the detail only.
  // Get back to the browse tab first: an earlier block left the panel on the
  // local tab, where no cards exist to open.
  findButton(renderPanel(), '发现')?.props.onClick()
  await settle()
  findButton(renderFooter())?.props.onClick()
  await settle()
  find(renderPanel(), (node) => String(node.props.className ?? '') === 'sc-card')?.props.onClick()
  await settle()
  check('baseline: the skill detail is open', html().includes('sc-detailbar'))
  press('Escape')
  await settle()
  check('escape leaves the skill detail', !html().includes('sc-detailbar'))
  check('the drawer survives backing out of the detail', drawerOpen())
  find(renderPanel(), (node) => String(node.props.className ?? '') === 'sc-card')?.props.onClick()
  await settle()
  findButton(renderPanel(), '安装到本地')?.props.onClick()
  await settle()
  // The preview is identified structurally, not by its button label: that label
  // now changes with the situation (确认安装 / 安装为 pdf-2 / 覆盖安装).
  check('baseline: the install preview is open', html().includes('sc-stats'))
  press('Escape')
  await settle()
  check('escape closes the install preview', !html().includes('sc-stats'))
  check('the skill detail survives closing the preview', html().includes('sc-detailbar'))
  press('Escape')
  press('Escape')
  await settle()
  check('escape on a closed drawer is harmless', !drawerOpen())
}

for (const cleanup of cleanups.splice(0, cleanups.length)) {
  try {
    cleanup()
  } catch (error) {
    check('cleanup runs without throwing', false, error.message)
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
