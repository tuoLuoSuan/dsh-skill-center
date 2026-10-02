/**
 * How much of a skill's file tree actually made it back.
 *
 * A truncated file set is the one failure mode the user cannot see: a 429
 * halfway through a repository walk yields a skill that installs cleanly and is
 * missing the script its own SKILL.md tells the model to run. Every cap in the
 * fetchers is therefore recorded here instead of being swallowed, and the
 * detail pane says "partial" out loud rather than presenting a guess as the
 * whole tree.
 */

/** Why a path is absent from `files`. */
export const SKIP_REASON = {
  /** The file cap was reached before this path was reached. */
  fileBudget: 'file-budget',
  /** The byte cap was reached before this path was reached. */
  byteBudget: 'byte-budget',
  /** The directory sits deeper than the walk goes. */
  depthLimit: 'depth-limit',
  /** The directory is one we never walk (`.git`, `node_modules`, …). */
  skippedDirectory: 'skipped-directory',
  /** The directory listing could not be read, so its children are unknown. */
  listingUnavailable: 'listing-unavailable',
  /** A single file was listed but its content did not come back. */
  fileUnavailable: 'file-unavailable',
  /** The file exists but the process could not read it. */
  unreadable: 'unreadable',
  /** A flat `.md` skill: there is no tree to be complete about. */
  flatFile: 'flat-file',
}

const MESSAGES = {
  [SKIP_REASON.fileBudget]: '达到文件数上限，其余文件没有取回',
  [SKIP_REASON.byteBudget]: '达到体积上限，其余文件没有取回',
  [SKIP_REASON.depthLimit]: '目录层级超过上限，更深的内容没有取回',
  [SKIP_REASON.skippedDirectory]: '这个目录被跳过（依赖或版本控制目录）',
  [SKIP_REASON.listingUnavailable]: '目录列表读取失败，里面的文件未知',
  [SKIP_REASON.fileUnavailable]: '文件已列出但内容没有取回',
  [SKIP_REASON.unreadable]: '文件存在但读取失败',
  [SKIP_REASON.flatFile]: '这是根目录下的单文件技能，没有附带文件',
}

/**
 * Build the completeness record for one fetched tree.
 * @param value - counts, the caps that were in force, and the skipped paths.
 * @returns a serializable completeness record.
 */
export function completenessOf({ limits = {}, skipped = [], fileCount = 0, byteCount = 0 } = {}) {
  return {
    // `complete` means "nothing was dropped". It is not a claim that the
    // upstream tree is healthy — a dead repository reference also yields a
    // short list, and that is what the status column is for.
    complete: skipped.length === 0,
    fileCount,
    byteCount,
    limits: { files: limits.files ?? 0, bytes: limits.bytes ?? 0, depth: limits.depth ?? 0 },
    skipped: skipped.map((entry) => ({
      path: entry.path,
      reason: entry.reason,
      message: MESSAGES[entry.reason] ?? entry.reason,
    })),
  }
}

/** The record for something with nothing to truncate. */
export function completeTree(fileCount, byteCount) {
  return completenessOf({ fileCount, byteCount })
}

/**
 * Trim a completeness record for the wire: the skipped list can hold a hundred
 * paths and the UI shows at most a handful before collapsing to a count.
 * @param value - a record from `completenessOf`, or undefined.
 * @param limit - how many skipped entries to keep.
 */
export function summarizeCompleteness(value, limit = 12) {
  if (value === undefined || value === null) return undefined
  const skipped = Array.isArray(value.skipped) ? value.skipped : []
  return {
    complete: value.complete === true,
    fileCount: value.fileCount ?? 0,
    byteCount: value.byteCount ?? 0,
    // Only the reasons that actually occurred, de-duplicated, so the UI can
    // explain the truncation without listing every affected path.
    reasons: [...new Set(skipped.map((entry) => entry.reason))].map((reason) => ({
      reason,
      message: skipped.find((entry) => entry.reason === reason)?.message ?? reason,
      count: skipped.filter((entry) => entry.reason === reason).length,
    })),
    skippedCount: skipped.length,
    skipped: skipped.slice(0, limit),
  }
}
