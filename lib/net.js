/**
 * Networking and on-disk caching primitives for the skill center.
 *
 * Everything the plugin fetches is public and unauthenticated, so the only
 * real hazards are slow upstreams, huge payloads, and rate limits. Each
 * request therefore carries a timeout, a byte cap, and a small retry budget;
 * every response body that is worth keeping is cached on disk with a TTL so
 * the UI can render instantly and refresh in the background.
 *
 * @module dsh-skill-center/net
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Identifies this plugin to the public endpoints it reads. */
export const USER_AGENT = 'dsh-skill-center/0.1 (+https://github.com/dsh-skill-center)'

/** Default per-request wall clock budget. */
const DEFAULT_TIMEOUT_MS = 20000

/** Default response body cap; guards against a hostile or runaway payload. */
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024

/** Sleep helper used by the retry backoff. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetch a URL as text with a timeout, a byte cap, and bounded retries.
 * @param url - absolute http(s) URL.
 * @param options - request tuning; `retries` counts *additional* attempts.
 * @returns the response body plus the status and headers that produced it.
 * @throws when every attempt fails, or when the final response is not ok.
 */
export async function fetchText(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    retries = 2,
    headers = {},
    accept = 'application/json, text/plain, */*',
  } = options

  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(4000, 400 * 2 ** (attempt - 1)))
    try {
      const signal = AbortSignal.timeout(timeoutMs)
      const response = await fetch(url, {
        redirect: 'follow',
        signal,
        headers: { 'user-agent': USER_AGENT, accept, ...headers },
      })
      const body = await readCapped(response, maxBytes)
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 200)}`)
        error.status = response.status
        error.retryAfter = response.headers.get('retry-after')
        // 4xx other than 408/429 will not improve on retry.
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          error.fatal = true
          throw error
        }
        lastError = error
        continue
      }
      return { status: response.status, body, headers: response.headers, url: response.url }
    } catch (error) {
      lastError = error
      if (error && error.fatal === true) break
    }
  }
  throw lastError ?? new Error(`request failed: ${url}`)
}

/**
 * Read a response body while refusing to buffer more than `maxBytes`.
 * @param response - the streaming response to drain.
 * @param maxBytes - hard cap on the decoded body size.
 * @returns the fully decoded body.
 * @throws when the cap is exceeded.
 */
async function readCapped(response, maxBytes) {
  if (response.body === null) return ''
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > maxBytes) throw new Error(`response exceeded ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Fetch and parse a JSON document.
 * @param url - absolute http(s) URL.
 * @param options - request tuning forwarded to {@link fetchText}.
 * @returns the parsed JSON value.
 * @throws when the body is not valid JSON.
 */
export async function fetchJson(url, options = {}) {
  const { body } = await fetchText(url, options)
  return JSON.parse(body)
}

/** Resolve whether a file currently exists. */
async function exists(path) {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

/**
 * A tiny JSON file cache with per-entry TTLs.
 *
 * Entries live in memory and are mirrored to one JSON file per key so a
 * harness restart does not re-hit every upstream. Writes go through a
 * temporary file and a rename, so a crash mid-write cannot leave a truncated
 * cache behind.
 */
export class JsonCache {
  /**
   * @param directory - directory holding one `<key>.json` file per entry.
   */
  constructor(directory) {
    this.directory = directory
    /** @type {Map<string, {value: unknown, storedAt: number, ttlMs: number}>} */
    this.memory = new Map()
    /** @type {Map<string, Promise<unknown>>} */
    this.inflight = new Map()
  }

  /** Absolute path of one cache key's backing file. */
  fileFor(key) {
    return join(this.directory, `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
  }

  /**
   * Read a cached value without ever throwing.
   * @param key - cache key.
   * @returns the stored value plus its age, or `undefined` on a miss.
   */
  async read(key) {
    const hit = this.memory.get(key)
    if (hit !== undefined) return { value: hit.value, ageMs: Date.now() - hit.storedAt, ttlMs: hit.ttlMs }
    const path = this.fileFor(key)
    if (!(await exists(path))) return undefined
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      if (parsed === null || typeof parsed !== 'object') return undefined
      const entry = { value: parsed.value, storedAt: Number(parsed.storedAt) || 0, ttlMs: Number(parsed.ttlMs) || 0 }
      this.memory.set(key, entry)
      return { value: entry.value, ageMs: Date.now() - entry.storedAt, ttlMs: entry.ttlMs }
    } catch {
      return undefined
    }
  }

  /**
   * Persist a value under a key.
   * @param key - cache key.
   * @param value - JSON-serializable value.
   * @param ttlMs - how long the entry counts as fresh.
   */
  async write(key, value, ttlMs) {
    const entry = { value, storedAt: Date.now(), ttlMs }
    this.memory.set(key, entry)
    const path = this.fileFor(key)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify({ value, storedAt: entry.storedAt, ttlMs }), 'utf8')
    await rename(temporary, path)
  }

  /**
   * Serve a key from cache, falling back to `produce` on a miss or a stale hit.
   *
   * Concurrent callers for one key share a single upstream request, which is
   * what keeps a burst of UI polls from turning into a burst of API calls.
   * @param key - cache key.
   * @param ttlMs - freshness window.
   * @param produce - async factory invoked when the cached value is not fresh.
   * @param options - `allowStaleOnError` keeps a stale value when `produce` throws.
   * @returns the value plus whether it came from a fresh cache hit.
   */
  async through(key, ttlMs, produce, options = {}) {
    const { allowStaleOnError = true } = options
    const cached = await this.read(key)
    if (cached !== undefined && cached.ageMs < ttlMs) {
      return { value: cached.value, cached: true, ageMs: cached.ageMs, ttlMs }
    }
    const running = this.inflight.get(key)
    if (running !== undefined) return await running
    const task = (async () => {
      try {
        const value = await produce()
        await this.write(key, value, ttlMs)
        return { value, cached: false, ageMs: 0, ttlMs }
      } catch (error) {
        if (allowStaleOnError && cached !== undefined) {
          return { value: cached.value, cached: true, stale: true, ageMs: cached.ageMs, ttlMs, error: String(error?.message ?? error) }
        }
        throw error
      } finally {
        this.inflight.delete(key)
      }
    })()
    this.inflight.set(key, task)
    return await task
  }
}
