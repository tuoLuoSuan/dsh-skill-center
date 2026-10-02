/**
 * Which static-hosting hostnames can this machine actually reach?
 *
 * The interesting part is *why* something fails. A dead host returns a normal
 * NXDOMAIN or a refused connection; a poisoned one resolves to an address that
 * belongs to somebody else entirely, and that distinction decides whether the
 * answer is "try again later" or "this will never work here".
 *
 * Proxies are deliberately ignored: HTTP_PROXY on this machine would launder
 * the result and make every host look reachable. This measures the path a
 * visitor's browser would actually take.
 */
import { lookup } from 'node:dns/promises'
import { connect } from 'node:tls'
import { randomBytes } from 'node:crypto'

const HOSTS = [
  ['github.io', 'gh-pages'],
  ['pages.dev', 'cloudflare-pages'],
  ['netlify.app', 'netlify'],
  ['vercel.app', 'vercel'],
  ['workers.dev', 'cloudflare-workers'],
]

/** ASNs whose addresses have no business answering for a static host. */
const HIJACK_ASN = {
  32934: 'Meta/Facebook',
  13414: 'Twitter',
  132203: 'Tencent',
}

async function dnsOf(host) {
  try {
    return await lookup(host, { all: true })
  } catch (error) {
    return { error: error.code ?? error.message }
  }
}

function tlsProbe(host, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: true }, () => {
      const certificate = socket.getPeerCertificate()
      resolve({ ok: true, issuer: certificate?.issuer?.O ?? certificate?.issuer?.CN ?? '?' })
      socket.destroy()
    })
    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => { resolve({ ok: false, error: 'TLS timeout' }); socket.destroy() })
    socket.on('error', (error) => resolve({ ok: false, error: error.code ?? error.message }))
  })
}

// A random subdomain, not the apex: a wildcard hijack is the thing being
// tested, and the apex of a blocklisted host can be filtered separately.
const label = randomBytes(4).toString('hex')
const rows = []

for (const [domain, label_] of HOSTS) {
  const host = `${label}-${label_}.${domain}`
  const addresses = await dnsOf(host)
  const tls = await tlsProbe(host)
  rows.push({ domain, host, addresses, tls })
}

for (const row of rows) {
  const list = Array.isArray(row.addresses)
    ? row.addresses.map((entry) => entry.address).join(', ')
    : `DNS ${row.addresses.error}`
  const verdict = row.tls.ok ? `OK (${row.tls.issuer})` : `FAIL (${row.tls.error})`
  console.log(`${row.domain.padEnd(14)} ${list.padEnd(34)} ${verdict}`)
}

console.log(`\nnote: ${Object.values(HIJACK_ASN).join(' / ')} addresses answering for a hosting domain means DNS is lying.`)
