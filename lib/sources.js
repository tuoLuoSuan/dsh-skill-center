/**
 * Remote skill sources for the skill center.
 *
 * Every adapter exposes the same three operations — `browse`, `read`, and
 * `files` — over a normalized item shape, so the routes and the UI never need
 * to know which registry an entry came from:
 *
 * | source         | role                                                |
 * | -------------- | --------------------------------------------------- |
 * | `claudeskills` | primary enumerator: 51,916 indexed entries, 64 tags  |
 * | `skillsmp`     | deep full-text search over a ~3M-skill corpus        |
 * | `repos`        | 6,369 community repositories with branch and path    |
 * | `anthropic`    | Anthropic's official skills                          |
 * | `dsh`          | DSH plugin packages that ship skills                 |
 *
 * Only `skillsmp` is rate limited in a way the user can exhaust (50 anonymous
 * requests per day), so it is the one source that must be treated as
 * search-only and never polled.
 *
 * @module dsh-skill-center/sources
 */
import { fetchJson, fetchText } from './net.js'
import { collectSkillFiles, fetchRawFile, listDirectory, parseGitHubUrl } from './github.js'
import { parseSkillDocument, stringField } from './frontmatter.js'

/** Cache key namespace, kept short so the on-disk file names stay readable. */
const NS = 'src'

/**
 * Run an async mapper over items with a bounded number of concurrent calls.
 * @param items - input values.
 * @param limit - maximum concurrent invocations.
 * @param mapper - async function receiving one item and its index.
 * @returns results in input order, with failures dropped.
 */
async function mapLimit(items, limit, mapper) {
  const results = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = await mapper(items[index], index)
      } catch {
        results[index] = undefined
      }
    }
  })
  await Promise.all(workers)
  return results.filter((value) => value !== undefined)
}

/**
 * Order a locally-held list by one of an adapter's declared sort keys.
 *
 * Some sources sort server-side and just pass the key through (claudeskills,
 * skillsmp); the rest hold the whole list in the cache and have to sort it
 * themselves. Doing nothing here is not a neutral default — it silently leaves
 * the upstream JSON order in place, which reads as "the sort dropdown is
 * broken" and can look like an ascending sort.
 *
 * Every key is descending except `name`, which is ascending A→Z.
 *
 * @param list - rows to order, not mutated.
 * @param sort - the requested key, matched against `keys`.
 * @param keys - `{ [sortKey]: (row) => number|string }` accessors.
 * @param fallback - key to use when `sort` is unknown; the first is used if absent.
 * @returns a new, ordered array.
 */
function applySort(list, sort, keys, fallback) {
  const names = Object.keys(keys)
  const key = names.includes(sort) ? sort : (fallback ?? names[0])
  const value = keys[key]
  if (value === undefined) return [...list]
  const ascending = key === 'name'
  return [...list].sort((a, b) => {
    const left = value(a)
    const right = value(b)
    if (typeof left === 'string' || typeof right === 'string') {
      return ascending
        ? String(left ?? '').localeCompare(String(right ?? ''))
        : String(right ?? '').localeCompare(String(left ?? ''))
    }
    // Missing metrics sort last rather than jumping to the top as 0 would.
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0
    if (!Number.isFinite(right)) return -1
    return ascending ? left - right : right - left
  })
}

/**
 * Build the normalized item every adapter returns.
 * @param input - adapter-specific fields.
 * @returns a catalog entry safe to hand to the UI.
 */
function item(input) {
  const coordinates = input.url === undefined ? undefined : parseGitHubUrl(input.url)
  return {
    key: `${input.source}|${input.id}`,
    source: input.source,
    kind: input.kind ?? 'skill',
    name: input.name,
    title: input.title ?? input.name,
    description: input.description ?? '',
    category: input.category ?? '',
    stars: Number.isFinite(input.stars) ? input.stars : undefined,
    author: input.author ?? coordinates?.owner,
    repo: input.repo ?? (coordinates === undefined ? undefined : `${coordinates.owner}/${coordinates.repo}`),
    dir: input.dir ?? (coordinates === undefined ? undefined : coordinates.path),
    url: input.url,
    installs: input.installs,
    updatedAt: input.updatedAt,
    installable: input.installable ?? coordinates !== undefined,
    extra: input.extra,
  }
}

/**
 * Create the source registry.
 * @param options - cache instance plus optional tuning.
 * @returns the registry used by the HTTP routes.
 */
export function createSources({ cache, config = {} }) {
  const skillsmpKey = typeof config.skillsmpApiKey === 'string' ? config.skillsmpApiKey.trim() : ''
  /** Last observed skillsmp quota, surfaced in the UI so the user can see the budget. */
  let skillsmpQuota

  const descriptors = [
    {
      id: 'claudeskills',
      label: 'Claude Skills 目录',
      labelEn: 'ClaudeSkills Catalog',
      homepage: 'https://claudeskills.info',
      note: '无鉴权 · 51,916 条索引 · 中文可搜 · 唯一弱点：技能按仓库去重',
      supportsSearch: true,
      supportsBrowse: true,
      kinds: [
        { id: 'skill', label: '技能' },
        { id: 'plugin', label: '插件' },
        { id: 'subagent', label: '子代理' },
        { id: 'command', label: '命令' },
        { id: 'hook', label: '钩子' },
        { id: 'automation', label: '自动化' },
        { id: 'memory-tool', label: '记忆工具' },
      ],
      sorts: ['stars', 'newest'],
      async browse({ q, kind, category, sort, page, limit }) {
        const params = new URLSearchParams()
        if (q !== undefined && q !== '') params.set('q', q)
        params.set('type', kind === undefined || kind === '' ? 'skill' : kind)
        if (category !== undefined && category !== '') params.set('category', category)
        params.set('limit', String(Math.min(Number(limit) || 24, 100)))
        params.set('offset', String(Math.max(0, (Number(page) || 0) * (Number(limit) || 24))))
        params.set('sort', sort === 'newest' ? 'newest' : 'stars')
        const url = `https://claudeskills.info/api/v1/search?${params.toString()}`
        const payload = await fetchJson(url, { timeoutMs: 20000 })
        const results = Array.isArray(payload?.results) ? payload.results : []
        return {
          items: results.map((entry) =>
            item({
              source: 'claudeskills',
              id: String(entry.slug),
              kind: typeof entry.type === 'string' && entry.type !== '' ? entry.type : 'skill',
              name: String(entry.name ?? entry.slug),
              title: String(entry.name ?? entry.slug),
              description: String(entry.description ?? ''),
              category: String(entry.category ?? ''),
              stars: Number(entry.stars),
              author: entry.source?.repo?.split('/')?.[0],
              repo: entry.source?.repo,
              url: entry.source?.url,
              extra: { confidence: entry.confidence, origin: entry.origin },
            }),
          ),
          total: Number(payload?.total) || 0,
          exactTotal: true,
        }
      },
      async read(entry) {
        const slug = entry.key.slice(entry.key.indexOf('|') + 1)
        const coordinates = parseGitHubUrl(entry.url)
        const [detail, skillText] = await Promise.all([
          fetchJson(`https://claudeskills.info/api/v1/items/${encodeURIComponent(slug)}`, { timeoutMs: 15000, retries: 0 }).catch(() => undefined),
          coordinates === undefined
            ? Promise.resolve(undefined)
            : fetchRawFile({ ...coordinates, path: joinPath(coordinates.path, 'SKILL.md') }, { retries: 0 }).catch(() => undefined),
        ])
        return { entry, registry: detail, skillText }
      },
      async files(entry) {
        const coordinates = parseGitHubUrl(entry.url)
        if (coordinates === undefined) throw new Error('这条记录没有可下载的仓库地址')
        return await collectSkillFiles(coordinates, { cache })
      },
    },

    {
      id: 'skillsmp',
      label: 'SkillsMP 全量搜索',
      labelEn: 'SkillsMP Search',
      homepage: 'https://skillsmp.com',
      note: '约 300 万技能 · 只能搜索（不支持浏览）· 匿名每天 50 次请求',
      supportsSearch: true,
      supportsBrowse: false,
      searchOnly: true,
      kinds: [{ id: 'skill', label: '技能' }],
      sorts: ['stars', 'recent'],
      async browse({ q, sort, page, limit }) {
        const query = typeof q === 'string' ? q.trim() : ''
        if (query === '') {
          return { items: [], total: 0, exactTotal: false, note: 'SkillsMP 不支持浏览，请输入关键词后搜索。' }
        }
        const params = new URLSearchParams({
          q: query.slice(0, 200),
          limit: String(Math.min(Number(limit) || 24, 50)),
          page: String(Math.max(1, (Number(page) || 0) + 1)),
          sortBy: sort === 'recent' ? 'recent' : 'stars',
        })
        const response = await fetchText(`https://skillsmp.com/api/v1/skills/search?${params.toString()}`, {
          timeoutMs: 20000,
          retries: 0,
          headers: skillsmpKey === '' ? {} : { authorization: `Bearer ${skillsmpKey}` },
        })
        skillsmpQuota = readQuota(response.headers)
        const payload = JSON.parse(response.body)
        const skills = Array.isArray(payload?.data?.skills) ? payload.data.skills : []
        const pagination = payload?.data?.pagination ?? {}
        return {
          items: skills.map((entry) =>
            item({
              source: 'skillsmp',
              id: String(entry.id),
              kind: 'skill',
              name: String(entry.name ?? entry.id),
              description: String(entry.description ?? ''),
              stars: Number(entry.stars),
              author: entry.author,
              url: entry.githubUrl,
              updatedAt: Number.isFinite(entry.updatedAt) ? new Date(entry.updatedAt * 1000).toISOString() : undefined,
              extra: { skillUrl: entry.skillUrl, language: entry.contentLanguage ?? undefined },
            }),
          ),
          total: Number(pagination.total) || 0,
          exactTotal: pagination.totalIsExact === true,
        }
      },
      async read(entry) {
        const coordinates = parseGitHubUrl(entry.url)
        const skillText = coordinates === undefined
          ? undefined
          : await fetchRawFile({ ...coordinates, path: joinPath(coordinates.path, 'SKILL.md') }, { retries: 0 }).catch(() => undefined)
        return { entry, skillText }
      },
      async files(entry) {
        const coordinates = parseGitHubUrl(entry.url)
        if (coordinates === undefined) throw new Error('这条记录没有可下载的仓库地址')
        return await collectSkillFiles(coordinates, { cache })
      },
    },

    {
      id: 'repos',
      label: '社区技能仓库',
      labelEn: 'Community Repositories',
      homepage: 'https://github.com/Chat2AnyLLM/awesome-claude-skills',
      note: '6,369 个仓库 / 150,931 个技能 · 静态清单 · 点击可展开仓库内的技能',
      supportsSearch: true,
      supportsBrowse: true,
      kinds: [{ id: 'repo', label: '仓库' }],
      sorts: ['skills', 'name'],
      async browse({ q, sort, page, limit }) {
        const table = await loadRepoTable(cache)
        const query = typeof q === 'string' ? q.trim().toLowerCase() : ''
        const matched = query === '' ? table : table.filter((row) => row.repo.toLowerCase().includes(query) || row.note.toLowerCase().includes(query))
        // `loadRepoTable` already returns skill-count-descending, but sort
        // explicitly so the key actually means something here.
        const filtered = applySort(matched, sort, {
          skills: (row) => row.skills,
          name: (row) => row.repo,
        }, 'skills')
        const size = Math.min(Number(limit) || 24, 100)
        const offset = Math.max(0, (Number(page) || 0) * size)
        return {
          items: filtered.slice(offset, offset + size).map((row) => repoItem(row)),
          total: filtered.length,
          exactTotal: true,
          note: '状态 ✅ ok 的仓库才可展开；本清单按仓库聚合，不含单个技能名。',
        }
      },
      async read(entry) {
        const row = repoRowFromItem(entry)
        const listing = await listDirectory({ owner: row.owner, repo: row.name, branch: row.branch, path: row.path })
        return {
          entry,
          repoDetail: {
            owner: row.owner,
            repo: row.name,
            branch: row.branch,
            path: row.path,
            status: row.status,
            directories: listing?.dirs ?? [],
            files: listing?.files ?? [],
            healthy: row.status.includes('ok'),
          },
        }
      },
      async files() {
        throw new Error('请先在该仓库下选择一个具体技能，再安装。')
      },
    },

    {
      id: 'anthropic',
      label: 'Anthropic 官方技能',
      labelEn: 'Anthropic Official',
      homepage: 'https://github.com/anthropics/skills',
      note: '官方仓库 · 19 个技能 · 含 docx / pdf / pptx / xlsx',
      supportsSearch: true,
      supportsBrowse: true,
      kinds: [{ id: 'skill', label: '技能' }],
      // One order only: there are 19 official skills and no popularity metric
      // to rank them by, so the UI hides the sort control entirely.
      sorts: ['name'],
      async browse({ q, sort, page, limit }) {
        const list = await loadOfficialSkills(cache)
        const query = typeof q === 'string' ? q.trim().toLowerCase() : ''
        const matched = query === '' ? list : list.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(query))
        const filtered = applySort(matched, sort, { name: (entry) => entry.name }, 'name')
        const size = Math.min(Number(limit) || 24, 100)
        const offset = Math.max(0, (Number(page) || 0) * size)
        return {
          items: filtered.slice(offset, offset + size).map((entry) =>
            item({
              source: 'anthropic',
              id: entry.name,
              kind: 'skill',
              name: entry.name,
              description: entry.description,
              category: 'official',
              author: 'anthropics',
              url: `https://github.com/anthropics/skills/tree/main/skills/${entry.name}`,
              extra: { license: entry.license },
            }),
          ),
          total: filtered.length,
          exactTotal: true,
        }
      },
      async read(entry) {
        const name = entry.key.slice(entry.key.indexOf('|') + 1)
        const skillText = await fetchRawFile({ owner: 'anthropics', repo: 'skills', branch: 'main', path: `skills/${name}/SKILL.md` }, { retries: 0 })
        return { entry, skillText }
      },
      async files(entry) {
        const name = entry.key.slice(entry.key.indexOf('|') + 1)
        return await collectSkillFiles({ owner: 'anthropics', repo: 'skills', branch: 'main', path: `skills/${name}` }, { cache })
      },
    },

    {
      id: 'dsh',
      label: 'DSH 技能包',
      labelEn: 'DSH Skill Packs',
      homepage: 'https://awesome-dsh-plugin.com',
      note: 'DeepSeek Harness 插件生态中带技能包的条目 · 以插件方式安装',
      supportsSearch: true,
      supportsBrowse: true,
      kinds: [{ id: 'plugin', label: '技能包' }],
      sorts: ['stars', 'downloads'],
      async browse({ q, sort, page, limit }) {
        const list = await loadDshSkills(cache)
        const query = typeof q === 'string' ? q.trim().toLowerCase() : ''
        const matched = query === ''
          ? list
          : list.filter((entry) => `${entry.name} ${entry.owner} ${entry.descriptionZh} ${entry.descriptionEn}`.toLowerCase().includes(query))
        const filtered = applySort(matched, sort, {
          stars: (entry) => entry.stars,
          downloads: (entry) => entry.downloads,
        }, 'stars')
        const size = Math.min(Number(limit) || 24, 100)
        const offset = Math.max(0, (Number(page) || 0) * size)
        return {
          items: filtered.slice(offset, offset + size).map((entry) =>
            item({
              source: 'dsh',
              id: entry.name,
              kind: 'plugin',
              name: entry.name,
              description: entry.descriptionZh || entry.descriptionEn,
              category: entry.category,
              stars: entry.stars,
              author: entry.owner,
              url: entry.url,
              installs: entry.downloads,
              installable: false,
              extra: { npm: entry.npm, version: entry.version, install: entry.install, descriptionEn: entry.descriptionEn },
            }),
          ),
          total: filtered.length,
          exactTotal: true,
          note: '这些是 DSH 插件包，请用 dsh plugin add 安装，不是 SKILL.md 技能。',
        }
      },
      async read(entry) {
        return { entry }
      },
      async files() {
        throw new Error('DSH 技能包请通过插件方式安装。')
      },
    },
  ]

  return {
    /** @returns descriptor metadata for the UI's source picker. */
    list() {
      return descriptors.map((descriptor) => ({
        id: descriptor.id,
        label: descriptor.label,
        labelEn: descriptor.labelEn,
        homepage: descriptor.homepage,
        note: descriptor.note,
        supportsSearch: descriptor.supportsSearch === true,
        supportsBrowse: descriptor.supportsBrowse === true,
        searchOnly: descriptor.searchOnly === true,
        kinds: descriptor.kinds ?? [],
        sorts: descriptor.sorts ?? [],
      }))
    },

    /** @returns the adapter with this id, or `undefined`. */
    get(id) {
      return descriptors.find((descriptor) => descriptor.id === id)
    },

    /** @returns taxonomy plus live counters from the primary registry. */
    async taxonomy() {
      const result = await cache.through(
        `${NS}/claudeskills/meta`,
        60 * 60 * 1000,
        async () => {
          const payload = await fetchJson('https://claudeskills.info/api/v1/meta', { timeoutMs: 15000 })
          return {
            categories: Array.isArray(payload?.categories) ? payload.categories : [],
            counts: payload?.types ?? {},
            totalItems: Number(payload?.total_items) || 0,
            uniqueRepos: Number(payload?.unique_repos) || 0,
            scope: payload?.scope ?? '',
          }
        },
        { allowStaleOnError: true },
      )
      return { ...result.value, cached: result.cached === true, ageMs: result.ageMs }
    },

    /** @returns the last observed SkillsMP quota, when a search has run. */
    quota() {
      return skillsmpQuota
    },
  }
}

/**
 * Join a GitHub directory path with a file name.
 * @param directory - repository-relative directory, possibly empty.
 * @param file - file name to append.
 * @returns the repository-relative path.
 */
export function joinPath(directory, file) {
  return directory === undefined || directory === '' ? file : `${directory}/${file}`
}

/**
 * Translate SkillsMP's rate-limit headers into a quota snapshot.
 * @param headers - response headers.
 * @returns the snapshot, or `undefined` when the headers are absent.
 */
function readQuota(headers) {
  const daily = Number(headers.get('x-ratelimit-daily-limit'))
  const remaining = Number(headers.get('x-ratelimit-daily-remaining'))
  const minute = Number(headers.get('x-ratelimit-minute-limit'))
  if (!Number.isFinite(daily) && !Number.isFinite(remaining)) return undefined
  return {
    dailyLimit: Number.isFinite(daily) ? daily : undefined,
    dailyRemaining: Number.isFinite(remaining) ? remaining : undefined,
    minuteLimit: Number.isFinite(minute) ? minute : undefined,
    observedAt: new Date().toISOString(),
  }
}

/**
 * Load and parse the community repository table.
 *
 * The upstream document is a single Markdown table with the columns
 * `Repository | Skills | Branch | Path | Status | Note`, so it parses with one
 * pass and no HTML handling.
 * @param cache - the shared JSON cache.
 * @returns one row per repository, sorted by skill count.
 */
async function loadRepoTable(cache) {
  const result = await cache.through(
    `${NS}/repos/table`,
    24 * 60 * 60 * 1000,
    async () => {
      const { body } = await fetchText('https://raw.githubusercontent.com/Chat2AnyLLM/awesome-claude-skills/main/README.md', {
        accept: 'text/plain',
        timeoutMs: 30000,
        maxBytes: 8 * 1024 * 1024,
      })
      const rows = []
      for (const line of body.split('\n')) {
        if (!line.trimStart().startsWith('|')) continue
        const cells = line.split('|').map((cell) => cell.trim())
        if (cells.length !== 8) continue
        const [, repository, skills, branch, path, status, note] = cells
        const match = /\[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\)/.exec(repository)
        if (match === null) continue
        const [owner, name] = match[1].split('/')
        if (owner === undefined || name === undefined) continue
        rows.push({
          repo: match[1],
          url: match[2],
          owner,
          name,
          skills: Number.parseInt(skills, 10) || 0,
          branch: branch.replace(/`/g, '') || 'main',
          path: path.replace(/`/g, '') || '.',
          status: status.replace(/[^\x20-\x7e]/g, '').trim(),
          statusRaw: status,
          note: note.replace(/[^\x20-\x7e\u4e00-\u9fff]/g, '').trim(),
        })
      }
      rows.sort((a, b) => b.skills - a.skills || a.repo.localeCompare(b.repo))
      return rows
    },
    { allowStaleOnError: true },
  )
  return Array.isArray(result.value) ? result.value : []
}

/** Render one repository row as a catalog entry. */
function repoItem(row) {
  return item({
    source: 'repos',
    id: row.repo,
    kind: 'repo',
    name: row.repo,
    title: row.repo.split('/')[1] ?? row.repo,
    description:
      row.skills > 0
        ? `包含约 ${row.skills} 个技能 · 分支 ${row.branch} · 目录 ${row.path}`
        : `未探测到技能 · 分支 ${row.branch} · 目录 ${row.path}`,
    category: row.status.includes('ok') ? 'healthy' : 'unreachable',
    author: row.owner,
    url: row.url,
    installable: false,
    extra: { skills: row.skills, branch: row.branch, path: row.path, status: row.statusRaw, note: row.note, expandable: row.status.includes('ok') },
  })
}

/** Recover the repository row behind a catalog entry. */
function repoRowFromItem(entry) {
  const [owner, name] = String(entry.name).split('/')
  return {
    owner,
    name,
    branch: entry.extra?.branch ?? 'main',
    path: entry.extra?.path === '.' ? '' : (entry.extra?.path ?? ''),
    status: entry.extra?.status ?? '',
  }
}

/**
 * Enumerate Anthropic's official skills.
 *
 * The repository's own HTML tree page supplies the directory names; each
 * `SKILL.md` is then fetched for its real name and description, because the
 * directory name is not always the declared skill name.
 * @param cache - the shared JSON cache.
 * @returns one entry per official skill.
 */
async function loadOfficialSkills(cache) {
  const result = await cache.through(
    `${NS}/anthropic/list`,
    24 * 60 * 60 * 1000,
    async () => {
      const listing = await listDirectory({ owner: 'anthropics', repo: 'skills', branch: 'main', path: 'skills' })
      const names = listing?.dirs ?? []
      const entries = await mapLimit(names, 5, async (name) => {
        const text = await fetchRawFile({ owner: 'anthropics', repo: 'skills', branch: 'main', path: `skills/${name}/SKILL.md` }, { retries: 0 })
        if (text === undefined) return undefined
        const parsed = await parseSkillDocument(text)
        return {
          name,
          declaredName: stringField(parsed?.data, 'name') ?? name,
          description: stringField(parsed?.data, 'description') ?? '',
          license: stringField(parsed?.data, 'license'),
        }
      })
      return entries
    },
    { allowStaleOnError: true },
  )
  return Array.isArray(result.value) ? result.value : []
}

/**
 * Read the DSH plugin registry and keep its skill-pack entries.
 * @param cache - the shared JSON cache.
 * @returns one entry per skill-bearing plugin.
 */
async function loadDshSkills(cache) {
  const result = await cache.through(
    `${NS}/dsh/skill-packs`,
    12 * 60 * 60 * 1000,
    async () => {
      // 90s, not 30s. This is one 5.1 MB JSON document and the host serves it
      // slowly — measured three times at 27s, 37s and 44s, so a 30s window
      // failed more often than it succeeded. It is cached for 12 hours, so the
      // wait is paid once a day, and paying it beats showing an empty list.
      const payload = await fetchJson('https://awesome-dsh-plugin.com/plugins.json', { timeoutMs: 90000, maxBytes: 32 * 1024 * 1024 })
      const plugins = Array.isArray(payload?.plugins) ? payload.plugins : []
      return plugins
        .filter((plugin) => plugin?.category === 'skill')
        .map((plugin) => ({
          name: String(plugin.name ?? ''),
          owner: String(plugin.owner ?? ''),
          url: String(plugin.url ?? ''),
          category: String(plugin.category ?? ''),
          descriptionZh: String(plugin.description?.zh ?? ''),
          descriptionEn: String(plugin.description?.en ?? ''),
          npm: plugin.npm === undefined ? undefined : String(plugin.npm),
          version: plugin.version === undefined ? undefined : String(plugin.version),
          stars: Number(plugin.stars),
          downloads: Number(plugin.downloads),
          install: plugin.install === undefined ? undefined : String(plugin.install),
        }))
        .filter((entry) => entry.name !== '')
    },
    { allowStaleOnError: true },
  )
  return Array.isArray(result.value) ? result.value : []
}
