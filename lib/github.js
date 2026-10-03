/**
 * GitHub helpers for the skill center.
 *
 * The unauthenticated REST API is effectively unusable from a shared IP (its
 * 60-requests-per-hour core bucket is routinely exhausted), but two other
 * surfaces are not rate limited in practice and need no token:
 *
 * - `raw.githubusercontent.com` serves any file verbatim.
 * - A repository's HTML tree page embeds its child directory and file names,
 *   which is enough to walk a skill directory without the tree API.
 *
 * Everything here is built on those two, with the REST API only as an
 * opportunistic upgrade when the caller has supplied a token.
 *
 * @module dsh-skill-center/github
 */
import { completenessOf, SKIP_REASON } from './completeness.js'
import { fetchBinary, fetchText } from './net.js'
import { decodeText, extractTarGz } from './tarball.js'

/** Cap on how many files one skill install may pull. */
const MAX_SKILL_FILES = 80

/** Cap on the combined size of one skill install, in bytes. */
const MAX_SKILL_BYTES = 4 * 1024 * 1024

/** How many directory levels below the skill root are walked. */
const MAX_SKILL_DEPTH = 3

/** Directory names never worth walking into during an install. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.github', '.venv', '__pycache__'])

/**
 * Cache namespace for a skill read out of an archive.
 *
 * A commit names exactly one tree, so an entry under this key can never go
 * stale and never needs invalidating — the only way to get a different answer
 * is to ask about a different commit, which is a different key.
 */
const TREE_NS = 'skill-center/tree'

/**
 * Parse a GitHub URL into the coordinates needed to fetch its files.
 * Accepts `tree` and `blob` URLs as well as a bare repository URL.
 * @param url - candidate GitHub URL.
 * @returns owner, repo, branch, and path; branch and path may be empty.
 */
export function parseGitHubUrl(url) {
  if (typeof url !== 'string') return undefined
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return undefined
  const segments = parsed.pathname.split('/').filter((segment) => segment !== '')
  if (segments.length < 2) return undefined
  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/, '')
  if (segments.length === 2) return { owner, repo, branch: '', path: '' }
  const kind = segments[2]
  if (kind !== 'tree' && kind !== 'blob') return { owner, repo, branch: '', path: '' }
  const branch = segments[3] ?? ''
  const rest = segments.slice(4).map(decodeURIComponent)
  if (kind === 'blob') rest.pop()
  return { owner, repo, branch, path: rest.join('/') }
}

/**
 * Build the raw.githubusercontent.com URL for one file.
 * @param coordinates - owner, repo, branch, and repository-relative path.
 * @returns the raw file URL.
 */
export function rawUrl({ owner, repo, branch, path }) {
  const ref = branch === '' || branch === 'HEAD' ? 'HEAD' : branch
  const suffix = path === '' ? '' : `/${path}`
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}${suffix}`
}

/**
 * Fetch a repository file through raw.githubusercontent.com.
 * @param coordinates - owner, repo, branch, and path.
 * @param options - forwarded to the fetch helper.
 * @returns the file text, or `undefined` when it does not exist.
 */
export async function fetchRawFile(coordinates, options = {}) {
  try {
    const { body } = await fetchText(rawUrl(coordinates), {
      accept: 'text/plain, */*',
      timeoutMs: 15000,
      retries: 1,
      ...options,
    })
    return body
  } catch (error) {
    if (error?.status === 404) return undefined
    throw error
  }
}

/**
 * List one repository directory by scraping its HTML tree page.
 *
 * GitHub returns 404 for a path that is a file rather than a directory, which
 * is treated as "no children" so callers can probe speculatively.
 * @param coordinates - owner, repo, branch, and directory path.
 * @returns child directory and file names, or `undefined` when unreadable.
 */
export async function listDirectory({ owner, repo, branch, path }) {
  const ref = branch === '' || branch === 'HEAD' ? 'HEAD' : branch
  const suffix = path === '' ? '' : `/${path}`
  const url = `https://github.com/${owner}/${repo}/tree/${ref}${suffix}`
  let body
  try {
    const response = await fetchText(url, { accept: 'text/html', timeoutMs: 20000, retries: 1, maxBytes: 6 * 1024 * 1024 })
    body = response.body
  } catch {
    return undefined
  }
  const escaped = `${owner}/${repo}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const prefix = `/${escaped}/`
  // The branch segment is matched loosely on purpose: a request for `HEAD` is
  // redirected to the default branch, and the links on the page name that
  // branch rather than the one the caller asked for.
  const pathPrefix = path === '' ? '' : `${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`
  const dirs = new Set()
  const files = new Set()
  const pattern = new RegExp(`href="${prefix}(tree|blob)/[^/"]+/${pathPrefix}([^"?#/]+)"`, 'g')
  for (const match of body.matchAll(pattern)) {
    const name = decodeURIComponent(match[2])
    if (name === '' || name === '..') continue
    if (match[1] === 'tree') dirs.add(name)
    else files.add(name)
  }
  return { dirs: [...dirs].sort(), files: [...files].sort() }
}

/**
 * Collect one skill's files by walking the repository's HTML tree pages.
 *
 * Kept as the fallback for when codeload is unreachable. It costs one request
 * per file and sees only the branch, so a proxy may serve it a revision that is
 * up to five minutes out of date.
 * @param coordinates - owner, repo, branch, and the skill's directory path.
 * @returns relative paths paired with their text content.
 * @throws when no `SKILL.md` can be retrieved.
 */
async function crawlSkillFiles({ owner, repo, branch, path }) {
  const wanted = []
  const queue = [{ path, depth: 0 }]
  const seen = new Set()
  // Everything the walk declines to fetch is recorded rather than dropped: a
  // short file list and a complete one look identical to the caller otherwise.
  const skipped = []
  let budget = MAX_SKILL_FILES
  while (queue.length > 0) {
    const current = queue.shift()
    if (seen.has(current.path)) continue
    seen.add(current.path)
    const listing = await listDirectory({ owner, repo, branch, path: current.path })
    if (listing === undefined) {
      skipped.push({ path: current.path === '' ? '.' : current.path, reason: SKIP_REASON.listingUnavailable })
      continue
    }
    for (const file of listing.files) {
      if (budget <= 0) {
        skipped.push({ path: current.path === '' ? file : `${current.path}/${file}`, reason: SKIP_REASON.fileBudget })
        continue
      }
      budget -= 1
      wanted.push(current.path === '' ? file : `${current.path}/${file}`)
    }
    for (const dir of listing.dirs) {
      const child = current.path === '' ? dir : `${current.path}/${dir}`
      if (SKIPPED_DIRECTORIES.has(dir)) {
        skipped.push({ path: child, reason: SKIP_REASON.skippedDirectory })
        continue
      }
      if (current.depth >= MAX_SKILL_DEPTH) {
        skipped.push({ path: child, reason: SKIP_REASON.depthLimit })
        continue
      }
      queue.push({ path: child, depth: current.depth + 1 })
    }
  }
  if (!wanted.includes(path === '' ? 'SKILL.md' : `${path}/SKILL.md`)) {
    wanted.unshift(path === '' ? 'SKILL.md' : `${path}/SKILL.md`)
  }
  const files = []
  let bytes = 0
  for (const relativePath of wanted) {
    let text = await fetchRawFile({ owner, repo, branch, path: relativePath })
    if (text === undefined && relativePath.endsWith('.md') && relativePath.toLowerCase() !== relativePath) {
      // Some repositories rename case between the listing and the blob.
      text = await fetchRawFile({ owner, repo, branch, path: relativePath.toLowerCase() })
    }
    if (text === undefined) {
      skipped.push({ path: relativePath, reason: SKIP_REASON.fileUnavailable })
      continue
    }
    bytes += Buffer.byteLength(text, 'utf8')
    // Unlike a dropped file, an oversized skill cannot be installed honestly at
    // all, so this stays a loud failure instead of a completeness note.
    if (bytes > MAX_SKILL_BYTES) throw new Error(`skill exceeds ${MAX_SKILL_BYTES} bytes`)
    const prefix = path === '' ? '' : `${path}/`
    const stripTo = prefix !== '' && relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : relativePath
    files.push({ path: stripTo, content: text, encoding: 'utf8' })
  }
  if (!files.some((file) => file.path === 'SKILL.md')) throw new Error('SKILL.md not found in this skill directory')
  // The prefix is an implementation detail of this walk; the caller works in
  // skill-relative paths, so the skipped list is stripped the same way.
  const prefix = path === '' ? '' : `${path}/`
  return {
    files,
    bytes,
    skipped: skipped.map((entry) => ({
      ...entry,
      path: prefix !== '' && entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path,
    })),
  }
}

/**
 * Resolve a branch or tag to the commit it currently points at.
 *
 * This is the one place the plugin spends its unauthenticated API budget, and
 * it buys the thing that makes everything else exact: a commit id is immutable,
 * so every URL built from it can be cached by any proxy along the way without
 * ever going stale. A branch name is a moving target, and the CDN in front of
 * raw.githubusercontent.com will serve one for five minutes after it moves.
 *
 * Failure is not an error. The API allows sixty anonymous requests an hour, and
 * a caller that cannot get a commit id can still install from the branch; it
 * just cannot promise which revision it got.
 * @param coordinates - owner, repo, and the branch or tag to resolve.
 * @param options - forwarded to the fetch helper.
 * @returns the commit, or `undefined` when the API would not say.
 */
export async function resolveCommit({ owner, repo, branch }, options = {}) {
  const ref = branch === '' || branch === 'HEAD' ? 'HEAD' : branch
  try {
    const { body } = await fetchText(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
      { accept: 'application/vnd.github+json', timeoutMs: 15000, retries: 0, ...options },
    )
    const parsed = JSON.parse(body)
    if (typeof parsed?.sha !== 'string') return undefined
    return {
      sha: parsed.sha,
      committedAt: parsed.commit?.committer?.date ?? parsed.commit?.author?.date,
      message: typeof parsed.commit?.message === 'string' ? parsed.commit.message.split('\n')[0] : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * Download an entire repository at one revision.
 *
 * One request regardless of how many files the skill has, against one request
 * per file for the crawl path — and because codeload accepts a commit id as the
 * revision, the bytes cannot be stale.
 * @param coordinates - owner, repo, and the revision to fetch.
 * @param options - forwarded to the fetch helper.
 * @returns every file in the repository, keyed by repository-relative path.
 * @throws when the archive cannot be fetched or is not a tarball.
 */
export async function downloadTree({ owner, repo, ref }, options = {}) {
  const { bytes } = await fetchBinary(
    `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(ref)}`,
    {
      accept: 'application/gzip, application/octet-stream, */*',
      timeoutMs: 60000,
      // A repository is much larger than any single file, so this is a bomb
      // guard rather than a size policy. The policy is applied after extraction.
      maxBytes: 96 * 1024 * 1024,
      retries: 1,
      ...options,
    },
  )
  return extractTarGz(bytes)
}

/**
 * Turn a whole-repository archive into one skill's file list.
 * @param tree - the extracted archive.
 * @param path - the skill's directory inside the repository, possibly empty.
 * @returns skill-relative files, plus what the budgets left out.
 * @throws when the directory holds no `SKILL.md`, or the skill is oversized.
 */
function selectSkillFiles(tree, path) {
  const prefix = path === '' ? '' : `${path}/`
  const within = []
  const skipped = []
  for (const entry of tree.files) {
    if (prefix !== '' && !entry.path.startsWith(prefix)) continue
    const relative = prefix === '' ? entry.path : entry.path.slice(prefix.length)
    if (relative === '') continue
    const segments = relative.split('/')
    // A skipped directory disqualifies a file wherever it appears in the path,
    // not just at the top: `assets/.git/config` is no more wanted than
    // `.git/config`.
    const blocked = segments.slice(0, -1).find((segment) => SKIPPED_DIRECTORIES.has(segment))
    if (blocked !== undefined) {
      skipped.push({ path: relative, reason: SKIP_REASON.skippedDirectory })
      continue
    }
    // No depth limit here, deliberately. The crawl needs one because every
    // directory level costs a request; the archive is already in memory, so a
    // file five levels down costs nothing extra to keep and dropping it would
    // only mean shipping a skill that is missing part of itself.
    within.push({ path: relative, bytes: entry.bytes })
  }
  // SKILL.md is the one file whose absence makes the install pointless, so it
  // is ordered first and exempted from the budgets below.
  within.sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path)))

  const files = []
  let bytes = 0
  for (const entry of within) {
    const essential = entry.path === 'SKILL.md'
    if (!essential && files.length >= MAX_SKILL_FILES) {
      skipped.push({ path: entry.path, reason: SKIP_REASON.fileBudget })
      continue
    }
    if (!essential && bytes + entry.bytes.length > MAX_SKILL_BYTES) {
      skipped.push({ path: entry.path, reason: SKIP_REASON.byteBudget })
      continue
    }
    bytes += entry.bytes.length
    // Unlike a dropped file, an oversized skill cannot be installed honestly at
    // all, so this stays a loud failure instead of a completeness note.
    if (bytes > MAX_SKILL_BYTES) throw new Error(`skill exceeds ${MAX_SKILL_BYTES} bytes`)
    files.push({ path: entry.path, ...decodeText(entry.bytes), byteLength: entry.bytes.length })
  }
  if (!files.some((file) => file.path === 'SKILL.md')) throw new Error('SKILL.md not found in this skill directory')
  return { files, skipped, bytes }
}

/**
 * Fetch one skill's files at an explicit revision.
 *
 * Unlike {@link collectSkillFiles} this never falls back to the crawl: a caller
 * that names a revision wants that revision or an error, because quietly
 * answering from the branch would make an update check compare against
 * something other than what it asked for.
 * @param coordinates - owner, repo, the revision, and the skill's directory.
 * @returns the skill-relative files plus what the budgets left out.
 * @throws when the archive cannot be read, or holds no `SKILL.md`.
 */
export async function fetchSkillAt({ owner, repo, ref, path }) {
  const tree = await downloadTree({ owner, repo, ref })
  return selectSkillFiles(tree, path)
}

/**
 * Collect the file set for one skill directory.
 *
 * Prefers one request for the whole repository at a pinned commit over one
 * request per file at a moving branch. The crawl stays as a fallback because
 * codeload is a different host from raw.githubusercontent.com and can be
 * blocked where that one is not.
 * @param coordinates - owner, repo, branch, and the skill's directory path.
 * @param options - `commit` and `committedAt` to skip resolution; `prefer: 'crawl'` to skip codeload.
 * @returns the files, their completeness, and the revision they came from.
 * @throws when no `SKILL.md` can be retrieved.
 */
export async function collectSkillFiles({ owner, repo, branch, path }, options = {}) {
  let commit = options.commit
  let committedAt = options.committedAt
  if (options.prefer !== 'crawl' && commit === undefined) {
    const found = await resolveCommit({ owner, repo, branch })
    if (found !== undefined) {
      commit = found.sha
      committedAt = found.committedAt
    }
  }
  if (options.prefer !== 'crawl' && commit !== undefined) {
    try {
      // One repository archive serves every skill in it, and a preview is
      // almost always followed by an install of the same thing. Caching what
      // was read out of a commit turns those into a single download, and the
      // key needs no expiry because the commit cannot change.
      const selected =
        options.cache === undefined
          ? selectSkillFiles(await downloadTree({ owner, repo, ref: commit }), path)
          : (
              await options.cache.through(
                `${TREE_NS}/${owner}/${repo}/${commit}/${path}`,
                Number.POSITIVE_INFINITY,
                async () => selectSkillFiles(await downloadTree({ owner, repo, ref: commit }), path),
                { allowStaleOnError: false },
              )
            ).value
      return {
        files: selected.files,
        commit,
        committedAt,
        source: 'tarball',
        completeness: completenessOf({
          limits: { files: MAX_SKILL_FILES, bytes: MAX_SKILL_BYTES },
          skipped: selected.skipped,
          fileCount: selected.files.length,
          byteCount: selected.bytes,
        }),
      }
    } catch (error) {
      // A tarball that will not download should not cost the user an install.
      // A refusal about the skill itself must not be retried into a different
      // answer, so those two messages propagate.
      const message = String(error?.message ?? '')
      if (message.startsWith('skill exceeds') || message.startsWith('SKILL.md not found')) throw error
    }
  }
  const crawled = await crawlSkillFiles({ owner, repo, branch, path })
  return {
    files: crawled.files,
    commit,
    committedAt,
    source: 'crawl',
    completeness: completenessOf({
      limits: { files: MAX_SKILL_FILES, bytes: MAX_SKILL_BYTES, depth: MAX_SKILL_DEPTH },
      skipped: crawled.skipped,
      fileCount: crawled.files.length,
      byteCount: crawled.bytes,
    }),
  }
}
