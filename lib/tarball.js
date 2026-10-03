/**
 * Read a `.tar.gz` into memory, with no dependencies.
 *
 * `codeload.github.com` will hand over an entire repository as one gzipped
 * tarball. That is the only endpoint which is simultaneously live, immutable
 * (when addressed by commit), and one request regardless of tree size — which
 * makes it a better install source than fetching eighty files one at a time.
 *
 * Node ships `zlib`, so gzip is free. Tar is not a library so much as a
 * layout: 512-byte blocks, a header, then the file's bytes padded to the next
 * block boundary. The parts that actually bite are the three ways a name can be
 * longer than the 100 bytes a header allots it — the `prefix` field, a GNU
 * `L`ongName entry, and a PAX `x` header — so all three are handled rather than
 * assumed away.
 *
 * @module dsh-skill-center/tarball
 */
import { gunzipSync } from 'node:zlib'

/** One tar block. Headers and data are both measured in these. */
const BLOCK = 512

/** Guards against a decompression bomb; far above any real skill repository. */
const DEFAULT_MAX_ENTRIES = 20000

/** Guards against a decompression bomb, in bytes of extracted content. */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

/**
 * Read a NUL-terminated string out of a header field.
 * @param block - the 512-byte header.
 * @param offset - field start.
 * @param length - field length.
 * @returns the decoded field, trimmed at the first NUL.
 */
function field(block, offset, length) {
  const slice = block.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8')
}

/**
 * Read a tar numeric field.
 *
 * Old tar writes octal digits; GNU writes base-256 for values that will not
 * fit, signalled by the top bit of the first byte. Both appear in the wild, so
 * both are parsed.
 * @param block - the 512-byte header.
 * @param offset - field start.
 * @param length - field length.
 * @returns the number, or 0 when the field is empty or unparseable.
 */
function numeric(block, offset, length) {
  const slice = block.subarray(offset, offset + length)
  if (slice.length === 0) return 0
  if ((slice[0] & 0x80) !== 0) {
    // base-256: clear the flag bit and read big-endian.
    let value = slice[0] & 0x7f
    for (let index = 1; index < slice.length; index += 1) value = value * 256 + slice[index]
    return value
  }
  const text = field(block, offset, length).trim()
  if (text === '') return 0
  const parsed = Number.parseInt(text, 8)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Parse a PAX extended header body into its key/value pairs.
 *
 * Each record is `<decimal length><space><key>=<value>\n`, where the length
 * counts the whole record including itself — which is why this cannot be a
 * simple split.
 * @param text - the decoded header body.
 * @returns the record map.
 */
function parsePax(text) {
  const records = {}
  let cursor = 0
  while (cursor < text.length) {
    const space = text.indexOf(' ', cursor)
    if (space === -1) break
    const length = Number.parseInt(text.slice(cursor, space), 10)
    if (!Number.isFinite(length) || length <= 0) break
    const record = text.slice(space + 1, cursor + length)
    const equals = record.indexOf('=')
    if (equals !== -1) records[record.slice(0, equals)] = record.slice(equals + 1).replace(/\n$/, '')
    cursor += length
  }
  return records
}

/**
 * Join the header's name and prefix fields the way the tar spec intends.
 * @param name - the `name` field.
 * @param prefix - the `prefix` field, empty for old-style headers.
 * @returns the full path.
 */
function joinName(name, prefix) {
  return prefix === '' ? name : `${prefix}/${name}`
}

/**
 * Strip the single top-level directory that GitHub's tarballs wrap everything in.
 * @param path - a path from the archive.
 * @returns the path relative to the repository root.
 */
function stripRoot(path) {
  const slash = path.indexOf('/')
  return slash === -1 ? '' : path.slice(slash + 1)
}

/**
 * Decompress and parse a `.tar.gz` buffer.
 *
 * Only regular files are returned. Directories, symlinks and the header
 * entries that carry long names are consumed, because a caller that wants a
 * skill's files has no use for any of them.
 * @param buffer - the gzipped tarball.
 * @param options - `maxEntries` and `maxBytes` caps, and `stripTopLevel`.
 * @returns the extracted files with their raw bytes, plus what was left out.
 * @throws when the buffer is not gzip, or when a cap is exceeded.
 */
export function extractTarGz(buffer, options = {}) {
  const {
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxBytes = DEFAULT_MAX_BYTES,
    stripTopLevel = true,
  } = options

  const raw = gunzipSync(buffer)
  const files = []
  const skipped = []
  let offset = 0
  let entries = 0
  let bytes = 0

  // Carried between blocks: the long-name and PAX overrides apply to the entry
  // that follows them, not to the header they arrive in.
  let pendingName
  let pendingPax = {}

  while (offset + BLOCK <= raw.length) {
    const header = raw.subarray(offset, offset + BLOCK)
    offset += BLOCK
    // Two zero blocks end the archive; one is enough to stop.
    if (header.every((byte) => byte === 0)) break

    const size = numeric(header, 124, 12)
    const type = String.fromCharCode(header[156] || 0x30)
    const bodyStart = offset
    const bodyEnd = bodyStart + size
    offset = bodyStart + Math.ceil(size / BLOCK) * BLOCK

    entries += 1
    if (entries > maxEntries) throw new Error(`tarball exceeded ${maxEntries} entries`)

    if (type === 'x' || type === 'g') {
      pendingPax = type === 'x' ? parsePax(raw.subarray(bodyStart, bodyEnd).toString('utf8')) : {}
      continue
    }
    if (type === 'L') {
      pendingName = raw.subarray(bodyStart, bodyEnd).toString('utf8').replace(/\0.*$/, '')
      continue
    }
    if (type === 'K') continue

    const name = pendingName ?? pendingPax.path ?? joinName(field(header, 0, 100), field(header, 345, 155))
    const paxSize = pendingPax.size === undefined ? size : Number.parseInt(pendingPax.size, 10)
    pendingName = undefined
    pendingPax = {}

    const isFile = type === '0' || type === '\0' || type === ' '
    if (!isFile) {
      if (type === '5' || type === '2' || type === '1') skipped.push({ path: name, reason: 'not-a-file' })
      continue
    }

    const relative = stripTopLevel ? stripRoot(name) : name
    if (relative === '') continue
    const body = raw.subarray(bodyStart, bodyStart + paxSize)
    bytes += body.length
    if (bytes > maxBytes) throw new Error(`tarball exceeded ${maxBytes} bytes of content`)
    files.push({ path: relative, bytes: body })
  }

  return { files, skipped, entries, bytes }
}

/**
 * Decide whether a byte sequence is text, and decode it if so.
 *
 * Skill directories do contain images and PDFs, and writing those through a
 * UTF-8 round trip corrupts them silently. The test is strict on purpose: a
 * file is text only if it decodes without a single replacement character.
 * @param bytes - the file content.
 * @returns the text plus its encoding, ready for the installer.
 */
export function decodeText(bytes) {
  const text = bytes.toString('utf8')
  if (!text.includes('\uFFFD')) return { content: text, encoding: 'utf8' }
  return { content: bytes.toString('base64'), encoding: 'base64' }
}
