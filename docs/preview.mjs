/**
 * Headless design preview.
 *
 * Renders the plugin's real browser bundle — same code path as the app — into
 * standalone HTML documents, one per scenario and theme, then shells out to
 * Chrome to screenshot them. This is how the panel gets eyes on it without
 * restarting the harness.
 *
 *   node docs/preview.mjs            # write previews + screenshots
 *   node docs/preview.mjs --no-shot  # HTML only
 *
 * Output: docs/preview/*.html and docs/preview/*.png
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { React, mount, renderHtml, find, textOf } from './mini-react.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'preview')
const shotDir = join(here, 'screenshots')
const bundleSource = readFileSync(join(here, '..', 'client', 'client.js'), 'utf8')
const themeCss = readFileSync(join(here, 'theme.css'), 'utf8')

// Set SKILL_CENTER_CHROME to point at a browser this list does not know about.
const CHROME = [
  process.env.SKILL_CENTER_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate))

/* ------------------------------------------------------------------ fixtures */

const SKILLS = [
  {
    key: 'claudeskills|docx-toolkit', source: 'claudeskills', kind: 'skill',
    name: 'docx-toolkit', title: 'docx-toolkit',
    description: '创建、读取、编辑与校验 Word 文档，支持表格、批注与格式清理。',
    category: 'documentation', stars: 18400, author: 'anthropics', repo: 'anthropics/skills',
    dir: 'document-skills/docx', url: 'https://github.com/anthropics/skills',
    installs: 31200, updatedAt: '2026-09-14', installable: true,
  },
  {
    key: 'claudeskills|pdf', source: 'claudeskills', kind: 'skill',
    name: 'pdf', title: 'pdf',
    description: 'Extract text and tables from PDFs, fill forms, merge and split documents, and OCR scanned pages.',
    category: 'pdf', stars: 39200, author: 'anthropics', repo: 'anthropics/skills',
    dir: 'document-skills/pdf', url: 'https://github.com/anthropics/skills',
    installs: 51800, updatedAt: '2026-09-02', installable: true,
  },
  {
    key: 'repos|obra/superpowers@brainstorming', source: 'repos', kind: 'skill',
    name: 'brainstorming', title: 'brainstorming',
    description: '把一个模糊的想法逐步追问成可执行的设计文档，先分类再动手。',
    category: 'workflow', stars: 8321, author: 'obra', repo: 'obra/superpowers',
    dir: 'skills/brainstorming', url: 'https://github.com/obra/superpowers',
    installs: 9400, updatedAt: '2026-08-21', installable: true,
  },
  {
    key: 'anthropic|pptx', source: 'anthropic', kind: 'skill',
    name: 'pptx', title: 'pptx',
    description: 'Build and edit PowerPoint decks: slide text, tables, images and charts.',
    category: 'presentation', stars: 21400, author: 'anthropics', repo: 'anthropics/skills',
    dir: 'document-skills/pptx', url: 'https://github.com/anthropics/skills',
    installs: 27600, updatedAt: '2026-09-11', installable: true,
  },
  {
    key: 'claudeskills|nature-figure', source: 'claudeskills', kind: 'skill',
    name: 'nature-figure', title: 'nature-figure',
    description: 'Create, revise and export manuscript scientific figures in Python or R — 论文配图、多面板图。',
    category: 'research', stars: 1284, author: 'nature-skills', repo: 'nature-skills/skills',
    dir: 'nature-figure', url: 'https://github.com/nature-skills/skills',
    installs: 4120, updatedAt: '2026-09-28', installable: true,
  },
  {
    key: 'repos|wshobson/agents@code-review', source: 'repos', kind: 'skill',
    name: 'code-review', title: 'code-review',
    description: '对改动做一次结构化代码审查：正确性、边界条件、可读性与测试覆盖。',
    category: 'code-quality', stars: 15600, author: 'wshobson', repo: 'wshobson/agents',
    dir: 'plugins/code-review', url: 'https://github.com/wshobson/agents',
    installs: 20100, updatedAt: '2026-07-30', installable: true,
  },
  {
    key: 'repos|someone/git-helpers@git-commit-helper', source: 'repos', kind: 'skill',
    name: 'git-commit-helper', title: 'git-commit-helper',
    description: '帮你写符合 Conventional Commits 的提交信息。',
    category: 'git', stars: 640, author: 'someone', repo: 'someone/git-helpers',
    dir: 'skills/git-commit-helper', url: 'https://github.com/someone/git-helpers',
    installs: 1200, updatedAt: '2026-06-04', installable: true,
  },
]

const SOURCES = {
  sources: [
    { id: 'claudeskills', label: 'claudeskills.info', kind: 'browse', note: '全站索引 · 按仓库去重', kinds: [{ id: 'skill', label: '技能' }, { id: 'plugin', label: '插件' }], sorts: ['stars', 'newest'] },
    { id: 'repos', label: 'GitHub 聚合仓库', kind: 'browse', note: '6,369 个仓库坐标', kinds: [{ id: 'skill', label: '技能' }], sorts: ['stars', 'newest'] },
    { id: 'anthropic', label: 'anthropics/skills', kind: 'browse', note: 'Anthropic 官方 19 个技能', kinds: [{ id: 'skill', label: '技能' }], sorts: ['newest'] },
    { id: 'skillsmp', label: 'skillsmp.com', kind: 'search', note: '仅搜索 · 匿名每日 50 次', kinds: [{ id: 'skill', label: '技能' }], sorts: ['stars'] },
    { id: 'dsh', label: '已装 DSH 插件', kind: 'local', note: '随插件发布的技能', kinds: [{ id: 'skill', label: '技能' }], sorts: ['newest'] },
  ],
  taxonomy: {
    categories: ['ai-engineering', 'code-quality', 'documentation', 'pdf', 'presentation', 'research', 'workflow'],
    kinds: [{ id: 'skill', label: '技能' }, { id: 'plugin', label: '插件' }],
  },
  quota: { source: 'skillsmp', remaining: 47, limit: 50, label: '今日剩余 47 / 50' },
  installed: {
    home: 'C:\\Users\\you\\.dsh',
    counts: 3,
    roots: [
      { path: 'C:\\Users\\you\\.dsh\\skills', source: 'user-dsh', label: '用户技能（可安装/删除）', writable: true },
      { path: 'C:\\Users\\you\\project\\.dsh\\skills', source: 'project-dsh', label: '项目技能（可启用/禁用）', writable: false },
      { path: 'C:\\Users\\you\\project\\.agents\\skills', source: 'project-agents', label: '项目 Agents 技能（可启用/禁用）', writable: false },
    ],
    skills: [
      { name: 'nature-figure', description: 'Create, revise and export manuscript scientific figures.', source: 'user-dsh', rootLabel: '用户技能（可安装/删除）', valid: true, writable: true, togglable: true, modelInvocable: true, userInvocable: true, invocationProblems: [], bytes: 18422, fileCount: 7, modifiedAt: '2026-10-01',
        provenance: { source: 'claudeskills', origin: 'remote', installedAt: '2026-10-01T09:12:00.000Z', update: { status: 'update', checkedAt: '2026-10-02T03:00:00.000Z' } } },
      { name: 'humanizer-zh', description: '去除文本中的 AI 生成痕迹。', source: 'user-dsh', rootLabel: '用户技能（可安装/删除）', valid: true, writable: true, togglable: true, modelInvocable: true, userInvocable: true, invocationProblems: [], bytes: 9120, fileCount: 3, modifiedAt: '2026-09-27',
        provenance: { source: 'repos', origin: 'remote', installedAt: '2026-09-27T14:02:00.000Z', commit: '8ca22dba9a94f28898bbce59f2537ff4d87c747d', update: { status: 'current', checkedAt: '2026-10-02T03:00:00.000Z' } } },
      { name: 'pptx', description: 'Build and edit PowerPoint decks. 装上了但暂时不想让它自己冒出来。', source: 'user-dsh', rootLabel: '用户技能（可安装/删除）', valid: true, writable: true, togglable: true, modelInvocable: false, userInvocable: true, invocationProblems: [], bytes: 12680, fileCount: 9, modifiedAt: '2026-09-24',
        provenance: { source: 'anthropic', origin: 'remote', installedAt: '2026-09-24T08:00:00.000Z', update: { status: 'current', checkedAt: '2026-10-02T03:00:00.000Z' } } },
      { name: 'pdf', description: 'Extract text and tables from PDFs.', source: 'project-dsh', rootLabel: '项目技能（可启用/禁用）', valid: true, writable: false, togglable: true, modelInvocable: true, userInvocable: true, invocationProblems: [], bytes: 8035, fileCount: 12, modifiedAt: '2026-09-30' },
      { name: 'gone-upstream', description: '这个技能的上游仓库已经删掉了。', source: 'project-agents', rootLabel: '项目 Agents 技能（可启用/禁用）', valid: true, writable: false, togglable: true, modelInvocable: true, userInvocable: true, invocationProblems: [], bytes: 4210, fileCount: 2, modifiedAt: '2026-09-11',
        provenance: { source: 'repos', origin: 'local', from: 'C:\\Users\\you\\.claude\\skills\\gone-upstream', update: { status: 'missing', checkedAt: '2026-10-02T03:00:00.000Z' } } },
      { name: 'legacy-key', description: '手写的时候用了旧字段名，宿主会整份丢掉它。', source: 'project-dsh', rootLabel: '项目技能（可启用/禁用）', valid: true, writable: false, togglable: true, modelInvocable: true, userInvocable: true,
        invocationProblems: ['frontmatter field "disableModelInvocation" is unsupported; use "disable-model-invocation"'], bytes: 3020, fileCount: 2, modifiedAt: '2026-09-19' },
    ],
    trash: [
      { bucket: 'brainstorming-2026-10-02_03-37-26', name: 'brainstorming', source: 'repos', trashedAt: '2026-10-02T03:37:26.606Z', bytes: 21440, managed: true },
    ],
    managed: 3,
  },
  list: {
    items: SKILLS,
    total: 1679,
    exactTotal: 1679,
    page: 0,
    limit: 24,
    note: '按 star 排序 · 已按仓库去重',
  },
}

/* `/item` returns exactly what the adapter's `read()` produced:
   claudeskills → { entry, skillText }, repos → { entry, repoDetail }. */
const DETAIL = {
  entry: SKILLS[1],
  skillText: [
    '---',
    'name: pdf',
    'description: Use this skill whenever the user wants to do anything with PDF files.',
    '---',
    '',
    '# PDF processing',
    '',
    '## Overview',
    'This skill covers the full lifecycle of a PDF: extracting text and tables,',
    'filling AcroForm fields, merging and splitting documents, and OCR for scans.',
    '',
    '## Quick start',
    '```bash',
    'python scripts/extract.py --input report.pdf --out report.md',
    '```',
    '',
    '## Filling forms',
    'AcroForm fields are addressed by name; see `forms.md` for the field map.',
  ].join('\n'),
}

const PREVIEW = {
  suggestedName: 'pdf',
  description: 'Use this skill whenever the user wants to do anything with PDF files.',
  license: 'MIT',
  totalBytes: 48213,
  completeness: { complete: true, fileCount: 4, byteCount: 48213, reasons: [], skippedCount: 0, skipped: [] },
  references: { referenced: 3, present: 3, missingCount: 0, missing: [] },
  conflict: { exists: false, name: 'pdf' },
  revision: { commit: '8ca22dba9a94f28898bbce59f2537ff4d87c747d', committedAt: '2026-09-25T18:06:27Z', fetchedVia: 'tarball', pinned: true },
  files: [
    { path: 'SKILL.md', bytes: 8035, preview: '---\nname: pdf\ndescription: Use this skill…', truncated: true },
    { path: 'forms.md', bytes: 6102, preview: '# Filling forms\n\nAcroForm fields are addressed by…', truncated: true },
    { path: 'scripts/check_fillable_fields.py', bytes: 2210, preview: 'import sys\n\n\ndef main() -> int:\n    …', truncated: true },
    { path: 'reference.md', bytes: 15488, preview: '# Reference\n\n## Common failure modes…', truncated: true },
  ],
}

/* A name that is already on disk, taken by a different upstream. The three-way
   answer is the point of this scenario: no silent overwrite, no silent `-2`. */
const PREVIEW_CONFLICT = {
  ...PREVIEW,
  suggestedName: 'brainstorming',
  conflict: { exists: true, name: 'brainstorming', sameSource: false, existingSource: 'repos', existingTitle: 'brainstorming', renameTo: 'brainstorming-2' },
  references: {
    referenced: 4,
    present: 2,
    missingCount: 2,
    missing: [
      { path: 'references/checklist.md', kind: 'code', line: 14 },
      { path: 'scripts/interview.py', kind: 'link', line: 31 },
    ],
  },
  completeness: {
    complete: false,
    fileCount: 4,
    byteCount: 5960,
    skippedCount: 3,
    reasons: [
      { reason: 'file-budget', message: '达到文件数上限，其余文件没有取回', count: 2 },
      { reason: 'listing-unavailable', message: '仓库目录列表读取失败，这一层被跳过', count: 1 },
    ],
    skipped: [],
  },
}

/* A skill whose frontmatter `name:` the harness would reject: it is skipped
   silently at load time, so the preview has to say so before anything is
   written. The verdict comes from `lib/validate.js`. */
const PREVIEW_BLOCKED = {
  ...PREVIEW,
  suggestedName: 'git-commit-helper',
  license: undefined,
  // No resolvable revision, so this scenario also shows what the pane says when
  // it read the branch: the guarantee is missing and the line admits it.
  revision: { fetchedVia: 'crawl', pinned: false },
  inspection: {
    blocked: true,
    repairable: true,
    declaredName: 'Git_Commit_Helper',
    suggestedName: 'git-commit-helper',
    installName: 'git-commit-helper',
    problems: [
      { level: 'error', code: 'name-grammar', message: 'name 只能用小写字母、数字和连字符，例如 my-skill' },
      { level: 'warn', code: 'name-mismatch', message: 'frontmatter 里的 name 与目录名不一致，DSH 会以 frontmatter 为准' },
      { level: 'warn', code: 'description-thin', message: 'description 太短，模型很难判断什么时候该用它' },
    ],
  },
  files: [
    { path: 'SKILL.md', bytes: 2140, preview: '---\nname: Git_Commit_Helper\ndescription: 帮你写提交信息\n---\n\n# Git commit helper', truncated: true },
    { path: 'references/conventions.md', bytes: 3820, preview: '# Conventions\n\nConventional Commits…', truncated: true },
  ],
  totalBytes: 5960,
}

/* The other agents' skill directories, as `lib/agents.js` discovers them. */
const AGENTS = {
  groups: [
    {
      id: 'claude', label: 'Claude Code（用户级）', path: 'C:\\Users\\you\\.claude\\skills', visible: false, exists: true,
      skills: [
        { name: 'tidy-helper', description: '保持代码整洁的小工具，检查格式与命名。', path: 'C:\\Users\\you\\.claude\\skills\\tidy-helper', skillFile: 'SKILL.md', flat: false, bytes: 3120, valid: true, repairable: false, collision: false, installed: false, problems: [] },
        { name: 'Badly_Named', description: '名字不合法，但名字本身是可以机械修好的。', path: 'C:\\Users\\you\\.claude\\skills\\Badly_Named', skillFile: 'SKILL.md', flat: false, bytes: 5240, valid: false, repairable: true, suggestedName: 'badly-named', collision: false, installed: false,
          problems: [{ level: 'error', code: 'name-grammar', message: 'name 只能用小写字母、数字和连字符，例如 my-skill' }] },
        { name: 'playwright', description: '浏览器自动化与端到端测试。', path: 'C:\\Users\\you\\.claude\\skills\\playwright', skillFile: 'SKILL.md', flat: false, bytes: 9640, valid: true, repairable: false, collision: false, installed: false, problems: [] },
        { name: 'nature-figure', description: 'Create, revise and export manuscript figures.', path: 'C:\\Users\\you\\.claude\\skills\\nature-figure', skillFile: 'SKILL.md', flat: false, bytes: 18422, valid: true, repairable: false, collision: true, installed: true, problems: [] },
      ],
    },
    {
      id: 'codex', label: 'Codex（用户级）', path: 'C:\\Users\\you\\.codex\\skills', visible: false, exists: true,
      skills: [
        { name: 'brainstorming', description: '把一个模糊的想法逐步追问成可执行的设计文档。', path: 'C:\\Users\\you\\.codex\\skills\\brainstorming', skillFile: 'SKILL.md', flat: false, bytes: 4180, valid: true, repairable: false, collision: true, installed: true, duplicateOf: 'codex', problems: [] },
        { name: 'broken-one', description: '', path: 'C:\\Users\\you\\.codex\\skills\\broken-one', skillFile: 'SKILL.md', flat: false, bytes: 1220, valid: false, repairable: false, collision: false, installed: false,
          problems: [{ level: 'error', code: 'no-frontmatter', message: '没有 YAML frontmatter，DSH 无法识别这个目录是技能' }] },
        { name: 'pdf', description: 'Extract text and tables from PDFs.', path: 'C:\\Users\\you\\.codex\\skills\\pdf', skillFile: 'SKILL.md', flat: false, bytes: 8035, valid: true, repairable: false, collision: true, installed: true, problems: [] },
      ],
    },
    {
      id: 'agents', label: 'Agents 共享目录', path: 'C:\\Users\\you\\.agents\\skills', visible: true, exists: true,
      skills: [
        { name: 'deepseek-delegate', description: '把任务委派给子代理并汇总结果。', path: 'C:\\Users\\you\\.agents\\skills\\deepseek-delegate', skillFile: 'SKILL.md', flat: false, bytes: 5410, valid: true, repairable: false, collision: false, installed: false, problems: [] },
      ],
    },
    { id: 'gemini', label: 'Gemini', path: 'C:\\Users\\you\\.gemini\\skills', visible: false, exists: false, skills: [] },
    { id: 'antigravity', label: 'Antigravity', path: 'C:\\Users\\you\\.gemini\\antigravity\\skills', visible: false, exists: false, skills: [] },
  ],
  hidden: 6,
  scannedAt: '2026-10-02T03:40:00.000Z',
}

const INSTALLED = {
  name: 'pdf', source: 'user-dsh', path: 'C:\\Users\\you\\.dsh\\skills\\pdf',
  fileCount: 5, bytes: 48213,
}

/* Built from the requested entry rather than hardcoded, so the tree always
   belongs to the card that was actually clicked. */
const repoDetailFor = (entry) => ({
  entry,
  repoDetail: {
    owner: entry.repo.split('/')[0], repo: entry.repo.split('/')[1], branch: 'main', path: entry.dir,
    status: '✅ ok', healthy: true,
    directories: ['scripts', 'references'],
    files: entry.name === 'brainstorming'
      ? ['SKILL.md', 'scripts/interview.py', 'scripts/summarize.py', 'references/prompts.md', 'references/checklist.md']
      : ['SKILL.md', 'references/conventions.md'],
  },
})

const responses = {
  '/dsh-skill-center/api/sources': SOURCES,
  '/dsh-skill-center/api/installed': SOURCES.installed,
  '/dsh-skill-center/api/list': SOURCES.list,
  '/dsh-skill-center/api/item': (body) => (body?.entry?.source === 'repos' ? repoDetailFor(body.entry) : DETAIL),
  '/dsh-skill-center/api/preview': (body) => {
    if (body?.entry?.name === 'git-commit-helper') return PREVIEW_BLOCKED
    if (body?.entry?.name === 'brainstorming') return PREVIEW_CONFLICT
    return PREVIEW
  },
  '/dsh-skill-center/api/install': INSTALLED,
  '/dsh-skill-center/api/remove': { removed: 'pdf' },
  '/dsh-skill-center/api/trash': { items: SOURCES.installed.trash },
  '/dsh-skill-center/api/restore': { ok: true, name: 'brainstorming' },
  '/dsh-skill-center/api/purge': { ok: true, removed: 1 },
  '/dsh-skill-center/api/agents': AGENTS,
  '/dsh-skill-center/api/import-local': { ok: true, name: 'tidy-helper', repaired: false },
  '/dsh-skill-center/api/updates': (() => {
    const results = {}
    for (const skill of SOURCES.installed.skills) {
      if (skill.provenance) results[skill.name] = { status: 'current', checkedAt: '2026-10-02T03:41:00.000Z' }
    }
    // `checkedAt` is top-level, not per-result: the footer renders it, and a
    // missing one prints "Invalid Date".
    return { results, checkedAt: '2026-10-02T03:41:00.000Z', tally: { total: 3, current: 3, update: 0, missing: 0, unknown: 0, unmanaged: 1 } }
  })(),
}

/* -------------------------------------------------------------- browser stubs */

function makeStubs() {
  const requests = []
  const styleElements = []
  const listeners = new Map()

  const makeNode = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      dataset: {},
      style: {},
      attributes: {},
      children: [],
      textContent: '',
      setAttribute(name, value) {
        this.attributes[name] = value
      },
      appendChild(child) {
        this.children.push(child)
        return child
      },
      remove() {
        const index = styleElements.indexOf(node)
        if (index !== -1) styleElements.splice(index, 1)
      },
      querySelector() {
        return null
      },
    }
    return node
  }

  const document = {
    baseURI: 'http://127.0.0.1:19387/',
    head: makeNode('head'),
    body: makeNode('body'),
    createElement: makeNode,
    querySelector() {
      return null
    },
  }
  // `attachStyles` appends to document.head; keep a handle on style nodes.
  document.head.appendChild = function appendChild(child) {
    styleElements.push(child)
    return child
  }

  const window = {
    confirm: () => true,
    location: { href: 'http://127.0.0.1:19387/' },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) ?? []
      const at = list.indexOf(fn)
      if (at !== -1) list.splice(at, 1)
    },
    __ModuleLoader__: {
      load(registration) {
        window.__registration = registration
      },
    },
  }

  const fetchStub = async (url, options = {}) => {
    const parsed = new URL(String(url), 'http://127.0.0.1:19387/')
    requests.push({
      path: parsed.pathname,
      search: parsed.search,
      method: options.method ?? 'GET',
      body: options.body ? JSON.parse(options.body) : undefined,
    })
    const body = options.body ? JSON.parse(options.body) : undefined
    const entry = responses[parsed.pathname]
    // A fixture may be a static payload or a function of the request body, so
    // `/item` can answer with the shape the matching adapter really produces.
    const payload = typeof entry === 'function' ? entry(body, parsed) : entry
    if (payload === undefined) return { ok: false, status: 404, async json() { return { error: 'not found' } } }
    return { ok: true, status: 200, async json() { return payload } }
  }

  return { window, document, fetchStub, requests, styleElements, listeners }
}

/* -------------------------------------------------------------------- harness */

const stubs = makeStubs()
const runBundle = new Function('window', 'document', 'fetch', 'console', bundleSource)
runBundle(stubs.window, stubs.document, stubs.fetchStub, { info() {}, warn() {}, error() {} })

const registration = stubs.window.__registration
const exportsObject = registration.factory((spec) => {
  if (spec === 'react') return React
  throw new Error(`unexpected require("${spec}")`)
})

const slots = []
const locales = []
const ctx = {
  effect(callback) {
    const cleanup = callback()
    return typeof cleanup === 'function' ? cleanup : () => {}
  },
  on() {
    return () => {}
  },
  locale: {
    register(namespace, dictionaries) {
      locales.push({ namespace, dictionaries })
    },
    bind() {
      return (key) => locales[0]?.dictionaries?.zh?.[key] ?? key
    },
    subscribe() {
      return () => {}
    },
    getSnapshot() {
      return { active: 'zh' }
    },
  },
  provide() {},
  slots: {
    inject(name, register) {
      register(name)
    },
    register(meta, component) {
      slots.push({ meta, component })
      return () => {}
    },
  },
}

exportsObject.apply(ctx)

const css = stubs.styleElements.map((node) => node.textContent).join('\n')
const slotFor = (name) => slots.find((entry) => entry.meta.name === name)
if (!slotFor('shell.overlay')) throw new Error('overlay slot was never registered')

/* -------------------------------------------------------------- mock app shell */

/**
 * A deliberately plain stand-in for the DSH window, so the panel is judged in
 * context (contrast against the chrome, the drawer against the mask) rather
 * than floating on a blank page. Not part of the plugin.
 */
const CHAT_MAIN = `
    <div class="app-title">对话</div>
    <div class="app-bubble">帮我找几个处理 PDF 的技能</div>
    <div class="app-reply">正在检索技能中心…</div>`

const appFrame = (main, kind = 'chat') => `
<div class="app">
  <aside class="app-side">
    <div class="app-brand">DeepSeek Harness</div>
    <div class="app-nav">
      <div class="app-item">新会话</div>
      <div class="app-item${kind === 'settings' ? '' : ' app-on'}">技能中心</div>
      <div class="app-item">插件市场</div>
      <div class="app-item">记忆</div>
      <div class="app-item${kind === 'settings' ? ' app-on' : ''}">设置</div>
    </div>
    <div class="app-foot">
      <div class="app-item">技能中心</div>
    </div>
  </aside>
  <main class="app-main${kind === 'settings' ? ' app-settings' : ''}">${main}</main>
</div>`

const APP_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
/* Chrome screenshots the page the instant it loads, so any entrance animation
   would be captured mid-flight and show the app shell bleeding through a
   half-faded drawer. Freeze them for a deterministic frame. */
*, *::before, *::after { animation: none !important; transition: none !important; }
body {
  font: 13px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: var(--dsw-alias-label-primary, #111);
  background: var(--dsw-alias-bg-base, #fff);
}
.app { display: flex; height: 100vh; }
.app-side {
  width: 208px; flex: none; display: flex; flex-direction: column; gap: 6px;
  padding: 14px 10px; background: var(--dsw-specific-sidebar-fill, #f9fafb);
  border-right: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
}
.app-brand { font-weight: 600; padding: 4px 8px 10px; }
.app-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.app-foot { border-top: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); padding-top: 8px; }
.app-item {
  padding: 7px 10px; border-radius: 8px; color: var(--dsw-alias-label-secondary, #61666b);
}
.app-item.app-on { background: var(--dsw-specific-sidebar-nav-item-active, #ebeef2); color: var(--dsw-alias-label-primary, #0f1115); }
.app-main { flex: 1; min-width: 0; padding: 22px 28px; display: flex; flex-direction: column; gap: 14px; }
.app-settings { padding: 14px 18px; gap: 10px; }
.app-panel {
  flex: 1; min-height: 0; overflow: hidden; border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
}
.app-title { font-weight: 600; font-size: 15px; color: var(--dsw-alias-label-secondary, #61666b); }
.app-bubble {
  align-self: flex-end; max-width: 60%; padding: 10px 14px; border-radius: 14px;
  background: var(--dsw-specific-bubble, #edf3fe);
}
.app-reply { color: var(--dsw-alias-label-tertiary, #81858c); }
`

const page = (theme, markup, extraCss = '') => `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>skill-center preview</title>
<style>${themeCss}</style>
<style>${APP_CSS}${extraCss}</style>
<style>${css}</style>
</head>
<body${theme === 'dark' ? ' data-ds-dark-theme' : ''}>
<div id="stage">${markup}</div>
</body></html>`

/* ---------------------------------------------------------------- scenarios */

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(shotDir, { recursive: true })

/** Boot a fresh copy of the bundle so each scenario starts from a clean store. */
function freshHarness() {
  const local = makeStubs()
  const run = new Function('window', 'document', 'fetch', 'console', bundleSource)
  run(local.window, local.document, local.fetchStub, { info() {}, warn() {}, error() {} })
  const exp = local.window.__registration.factory((spec) => {
    if (spec === 'react') return React
    throw new Error(`unexpected require("${spec}")`)
  })
  const localSlots = []
  const localLocales = []
  exp.apply({
    effect(cb) {
      const cleanup = cb()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    on() {
      return () => {}
    },
    locale: {
      register(namespace, dictionaries) {
        localLocales.push({ namespace, dictionaries })
      },
      bind() {
        return (key) => localLocales[0]?.dictionaries?.zh?.[key] ?? key
      },
      subscribe() {
        return () => {}
      },
      getSnapshot() {
        return { active: 'zh' }
      },
    },
    provide() {},
    slots: {
      inject(name, register) {
        register(name)
      },
      register(meta, component) {
        localSlots.push({ meta, component })
        return () => {}
      },
    },
  })
  const slot = (name) => localSlots.find((entry) => entry.meta.name === name)
  return {
    slots: localSlots,
    requests: local.requests,
    slot,
    /** Render a slot to probe nodes so a test can invoke its handlers. */
    probe: (name, props) => mount(slot(name).component(props)).nodes,
    /** Render a slot to real HTML. */
    html: (name, props) => renderHtml(slot(name).component(props)),
    /** The real open path: the sidebar footer button flips the store open. */
    openDrawer() {
      const button = this.probe('sidebar.footer.action', { wide: true }).find((node) => node.type === 'button')
      button.props.onClick()
    },
    /** Click the drawer tab whose label contains `label`. */
    clickTab(label) {
      const tabs = this.probe('shell.overlay', {})
        .filter((node) => node.type === 'button' && String(node.props.className ?? '').includes('sc-tab'))
      const tab = tabs.find((node) => textOf(node.props.children).includes(label))
      if (tab === undefined) throw new Error(`no tab matching ${label}`)
      tab.props.onClick()
    },
    /** Click the result card whose title matches `name`. */
    clickCard(name) {
      const cards = this.probe('shell.overlay', {})
        .filter((node) => String(node.props.className ?? '') === 'sc-card')
      const card = cards.find((node) => textOf(node.props.children).includes(name))
      if (card === undefined) throw new Error(`no card matching ${name}`)
      card.props.onClick()
    },
    /** Click the source rail chip whose label contains `label`. */
    switchSource(label) {
      const chip = this.probe('shell.overlay', {})
        .filter((node) => node.type === 'button' && /(^|\s)sc-src(\s|$)/.test(String(node.props.className ?? '')))
        .find((node) => textOf(node.props.children).includes(label))
      if (chip === undefined) throw new Error(`no source matching ${label}`)
      chip.props.onClick()
    },
    /** Click the first button whose label contains `label`. */
    clickButton(label) {
      const button = this.probe('shell.overlay', {})
        .filter((node) => node.type === 'button')
        .find((node) => textOf(node.props.children).includes(label))
      if (button === undefined) throw new Error(`no button matching ${label}`)
      button.props.onClick()
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

const scenarios = [
  {
    id: 'browse',
    title: '设置页内联面板 · 发现',
    build: async (harness) => {
      await settle()
      return { shell: 'settings', markup: harness.html('settings.section', { close() {} }) }
    },
  },
  {
    id: 'drawer',
    title: '侧边栏抽屉 · 发现（覆盖在应用之上）',
    build: async (harness) => {
      await settle()
      harness.openDrawer()
      await settle()
      return { withShell: true, markup: harness.html('shell.overlay', {}) }
    },
  },
  {
    id: 'toast',
    title: '侧边栏抽屉 · 更新检查结果（提示条）',
    build: async (harness) => {
      await settle()
      harness.openDrawer()
      await settle()
      harness.clickTab('已安装')
      await settle()
      harness.clickButton('检查更新')
      await settle()
      // Toasts ride the same overlay occupant, so one capture holds both.
      return { withShell: true, markup: harness.html('shell.overlay', {}) }
    },
  },
  {
    id: 'installed',
    title: '侧边栏抽屉 · 已安装',
    build: async (harness) => {
      await settle()
      harness.openDrawer()
      await settle()
      harness.clickTab('已安装')
      await settle()
      return { withShell: true, markup: harness.html('shell.overlay', {}) }
    },
  },
  {
    id: 'detail',
    title: '侧边栏抽屉 · 技能详情（SKILL.md 正文）',
    build: async (harness) => {
      await settle()
      harness.openDrawer()
      await settle()
      harness.clickCard('pdf')
      await settle()
      return { markup: harness.html('shell.overlay', {}) }
    },
  },
  {
    id: 'tree',
    title: '侧边栏抽屉 · 仓库目录（repos 源）',
    build: async (harness) => {
      await settle()
      harness.openDrawer()
      await settle()
      harness.clickCard('brainstorming')
      await settle()
      return { markup: harness.html('shell.overlay', {}) }
    },
  },
  {
    id: 'preview',
    title: '侧边栏抽屉 · 安装确认',
    build: async (harness) => {
      await settle()
      harness.openDrawer()
      await settle()
      harness.clickCard('pdf')
      await settle()
      harness.clickButton('安装到本地')
      await settle()
      return { markup: harness.html('shell.overlay', {}) }
    },
  },
  {
    id: 'inspect',
    title: '侧边栏抽屉 · 安装前体检（名字不合法）',
    build: async (harness) => {
      await settle()
      harness.openDrawer()
      await settle()
      harness.clickCard('git-commit-helper')
      await settle()
      harness.clickButton('安装到本地')
      await settle()
      return { markup: harness.html('shell.overlay', {}) }
    },
  },
  {
    id: 'conflict',
    title: '侧边栏抽屉 · 同名冲突与残缺预览',
    build: async (harness) => {
      await settle()
      harness.openDrawer()
      await settle()
      harness.switchSource('GitHub 聚合仓库')
      await settle()
      harness.clickCard('brainstorming')
      await settle()
      harness.clickButton('安装到本地')
      await settle()
      return { markup: harness.html('shell.overlay', {}) }
    },
  },
  {
    id: 'local',
    title: '侧边栏抽屉 · 本机其他 Agent 的技能',
    build: async (harness) => {
      await settle()
      harness.openDrawer()
      await settle()
      harness.clickTab('本机')
      await settle()
      return { markup: harness.html('shell.overlay', {}) }
    },
  },
]

const written = []
for (const scenario of scenarios) {
  const product = await scenario.build(freshHarness())
  const shell = product.shell === 'settings'
    ? appFrame(`<div class="app-title">设置 · 技能中心</div><div class="app-panel">${product.markup}</div>`, 'settings')
    : appFrame(`${CHAT_MAIN}${product.markup}`)
  for (const theme of ['light', 'dark']) {
    const html = page(theme, shell, '#stage { height: 100vh; }')
    const name = `${scenario.id}-${theme}`
    writeFileSync(join(outDir, `${name}.html`), html, 'utf8')
    written.push({ name, title: scenario.title })
  }
}

console.log(`wrote ${written.length} preview page(s) to docs/preview/`)
for (const entry of written) console.log(`  ${entry.name}.html  — ${entry.title}`)

if (process.argv.includes('--no-shot')) process.exit(0)
if (CHROME === undefined) {
  console.error('no Chrome/Edge found — skipping screenshots')
  process.exit(0)
}

// The README shows a handful of these. `docs/preview/` is gitignored (20 PNGs
// of churn), so the ones worth committing are copied out to a stable name.
const HIGHLIGHTS = {
  browse: 'browse',
  conflict: 'conflict',
  local: 'local',
  installed: 'installed',
}

for (const entry of written) {
  const htmlPath = join(outDir, `${entry.name}.html`)
  const pngPath = join(outDir, `${entry.name}.png`)
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--window-size=1240,860',
    `--screenshot=${pngPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' })
  console.log(`  ${entry.name}.png`)

  const [id, theme] = [entry.name.slice(0, entry.name.lastIndexOf('-')), entry.name.slice(entry.name.lastIndexOf('-') + 1)]
  if (HIGHLIGHTS[id] !== undefined) {
    copyFileSync(pngPath, join(shotDir, `${HIGHLIGHTS[id]}-${theme}.png`))
  }
}
console.log(`done — README shots refreshed in docs/screenshots/`)
