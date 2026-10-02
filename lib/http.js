/**
 * HTTP helpers for the skill center's host-side routes.
 *
 * The shapes here mirror the ones the rest of the DSH plugin ecosystem uses,
 * so a route written against this module behaves the same behind a reverse
 * proxy, on a LAN hostname, or inside the desktop shell.
 *
 * @module dsh-skill-center/http
 */

/** Largest JSON body any route in this plugin accepts. */
export const MAX_BODY_BYTES = 256 * 1024

/**
 * Send a JSON response with caching disabled.
 * @param response - the Node response object.
 * @param status - HTTP status code.
 * @param payload - value to serialize.
 */
export function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * Send a small error envelope.
 * @param response - the Node response object.
 * @param status - HTTP status code.
 * @param message - human-readable reason.
 */
export function sendError(response, status, message, extra = {}) {
  sendJson(response, status, { ok: false, error: message, ...extra })
}

/**
 * Send a text or SVG response.
 * @param response - the Node response object.
 * @param status - HTTP status code.
 * @param contentType - MIME type to advertise.
 * @param body - response body.
 * @param maxAgeSeconds - cache lifetime; omit to disable caching.
 */
export function sendText(response, status, contentType, body, maxAgeSeconds) {
  response.writeHead(status, {
    'cache-control': maxAgeSeconds === undefined ? 'no-store' : `public, max-age=${maxAgeSeconds}`,
    'content-type': `${contentType}; charset=utf-8`,
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * Read and parse a JSON request body.
 * @param request - the Node request object.
 * @param maxBytes - size ceiling; larger bodies are rejected.
 * @returns the parsed body, or `{}` when the body is empty.
 */
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw === '') return {}
  return JSON.parse(raw)
}

/**
 * Decide whether a hostname refers to this machine.
 * @param host - the authority from the `Host` header, with or without a port.
 * @returns `true` for loopback names and addresses.
 */
export function loopbackAuthority(host) {
  if (typeof host !== 'string' || host === '') return false
  let hostname = host
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end !== -1) hostname = host.slice(1, end)
  } else {
    const colon = host.lastIndexOf(':')
    if (colon !== -1) hostname = host.slice(0, colon)
  }
  hostname = hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true
  return /^127\./.test(hostname)
}

/**
 * Decide whether a hostname was explicitly trusted by configuration.
 * @param host - the authority from the `Host` header.
 * @param trustedHosts - configured allow-list of authorities.
 * @returns `true` when the authority matches an entry.
 */
export function trustedAuthority(host, trustedHosts) {
  if (!Array.isArray(trustedHosts) || trustedHosts.length === 0) return false
  const normalized = String(host).toLowerCase()
  const bare = normalized.includes(':') ? normalized.slice(0, normalized.lastIndexOf(':')) : normalized
  return trustedHosts.some((candidate) => {
    const value = String(candidate).trim().toLowerCase()
    return value !== '' && (value === normalized || value === bare)
  })
}

/**
 * Guard a mutating route against cross-site callers.
 *
 * An `exact` route is matched before the framework's own `/api` fence, so the
 * fence never sees these requests and each handler must judge for itself.
 * Rejecting only non-loopback hosts would break every POST behind a reverse
 * proxy or tunnel, so the rule is: a request is acceptable when it did not come
 * from a browser page at all, or when it came from the same origin it is
 * addressed to.
 * @param request - the Node request object.
 * @param trustedHosts - extra authorities to accept.
 * @returns `null` when the request is allowed, otherwise the reason.
 */
export function sameOrigin(request, trustedHosts = []) {
  const host = request.headers.host
  const origin = request.headers.origin

  if (typeof request.headers['sec-fetch-site'] === 'string' && request.headers['sec-fetch-site'].toLowerCase() === 'cross-site') {
    return 'cross-site request rejected'
  }
  // No Host header means this is not a browser page navigation.
  if (typeof host !== 'string' || host === '') return null
  // The desktop shell strips Origin, so its absence must be tolerated.
  if (typeof origin !== 'string' || origin === '') {
    return loopbackAuthority(host) || trustedAuthority(host, trustedHosts) ? null : 'untrusted host'
  }
  if (loopbackAuthority(host) === false && trustedAuthority(host, trustedHosts) === false) return 'untrusted host'
  if (origin === 'null') return 'opaque origin rejected'
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return 'malformed origin rejected'
  }
  if (parsed.host !== host) return 'origin does not match host'
  return null
}

/**
 * Read the client address of a request.
 * @param request - the Node request object.
 * @returns the remote address, or an empty string.
 */
export function requestAddress(request) {
  const address = request.socket?.remoteAddress
  return typeof address === 'string' ? address : ''
}

/**
 * Build a small namespaced logger that never throws on partial services.
 * @param logger - the host logger, if any.
 * @param namespace - prefix for every message.
 * @returns an object with `info`, `warn`, and `error`.
 */
export function createLogger(logger, namespace) {
  const prefix = `[${namespace}]`
  return {
    info(message, ...rest) {
      logger?.info?.(`${prefix} ${message}`, ...rest)
    },
    warn(message, ...rest) {
      logger?.warn?.(`${prefix} ${message}`, ...rest)
    },
    error(message, ...rest) {
      const sink = logger?.error ?? logger?.warn
      sink?.(`${prefix} ${message}`, ...rest)
    },
  }
}
