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
import { fetchText } from './net.js'

/** Cap on how many files one skill install may pull. */
const MAX_SKILL_FILES = 80

/** Cap on the combined size of one skill install, in bytes. */
const MAX_SKILL_BYTES = 4 * 1024 * 1024

/** How many directory levels below the skill root are walked. */
const MAX_SKILL_DEPTH = 3

/** Directory names never worth walking into during an install. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.github', '.venv', '__pycache__'])

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
 * Collect the file set for one skill directory.
 *
 * Starts from the directory listing and always includes `SKILL.md`, falling
 * back to a bare `SKILL.md` fetch when the listing is unavailable (for
 * example a transient GitHub HTML failure) so a known-good skill can still be
 * installed.
 * @param coordinates - owner, repo, branch, and the skill's directory path.
 * @returns relative paths paired with their text content.
 * @throws when no `SKILL.md` can be retrieved.
 */
export async function collectSkillFiles({ owner, repo, branch, path }) {
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
  const completeness = completenessOf({
    limits: { files: MAX_SKILL_FILES, bytes: MAX_SKILL_BYTES, depth: MAX_SKILL_DEPTH },
    skipped: skipped.map((entry) => ({
      ...entry,
      path: prefix !== '' && entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path,
    })),
    fileCount: files.length,
    byteCount: bytes,
  })
  return { files, completeness }
}
