/**
 * Profile patch-layer writes for the console. APPEND-ONLY for CRUD rows: the
 * console appends one generated operation block at a time, after copying the
 * current file to a timestamped backup. The Loader applies patch lists in
 * order, so an appended operation is the effective configuration; user
 * comments and unrelated rows stay byte-for-byte untouched. Backups are
 * pruned to the newest `backupCount`.
 *
 * The ONE exception is {@link replaceOwnedBlock}: the console's own tool
 * filter is a piece of STATE, not an event, so appending a block per click
 * grew the file without bound (two clicks left two blocks, each restating the
 * whole filter). That path removes only blocks this plugin wrote — recognised
 * by the marker comment it puts above every one of them — and appends the new
 * one. Anything without that marker is never a candidate for removal.
 *
 * Every write is reversible: the backup restores the previous state.
 *
 * @module dsh-mcp-workbench/write
 */

import { readdir, copyFile, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** Backup filename suffix: `<file>.bak-<epoch-ms>`. */
const BACKUP_SUFFIX = '.bak-'

/** Fresh-file header when the patch layer does not exist yet. */
const FRESH_FILE_HEADER = `# dsh-mcp-workbench managed patch layer (created by the MCP console).
# Operations are APPEND-ONLY: the console never rewrites existing content.
`

/**
 * Copy the current patch file to a timestamped backup, append one fragment,
 * and prune backups beyond `backupCount` (newest kept). Creates the file with
 * an empty list header when it does not exist.
 *
 * @param filePath - absolute path of the profile patch layer.
 * @param fragment - the generated YAML block (no trailing newline needed).
 * @param backupCount - backups retained (>= 1).
 * @returns the absolute backup path and the number of bytes appended.
 * @throws when any file operation fails; nothing is partially applied after
 *   the backup step (backup → append, in that order).
 */
export async function appendPatchFragment(
  filePath: string,
  fragment: string,
  backupCount: number,
): Promise<{ readonly backupPath: string; readonly bytes: number }> {
  const existing = await readIfPresent(filePath)
  const backupPath = `${filePath}${BACKUP_SUFFIX}${Date.now()}`
  if (existing === null) {
    await writeFile(filePath, FRESH_FILE_HEADER, 'utf8')
  } else {
    await copyFile(filePath, backupPath)
  }
  const bytes = await appendFragment(filePath, fragment)
  await pruneBackups(filePath, backupCount)
  return { backupPath, bytes }
}

/**
 * Replace the blocks this plugin wrote, identified by `marker`: remove every
 * block that starts with that comment, then append `fragment` once.
 *
 * This is the module's only rewrite, and it stays narrow by construction: a
 * line is only dropped when it starts with the exact marker the plugin emits,
 * and only until the next blank line — the renderer never puts a blank line
 * inside a block. User rows, comments and other plugins' blocks are never
 * matched, so they survive untouched.
 *
 * @param filePath - absolute path of the profile patch layer.
 * @param marker - marker comment prefix the plugin writes above its block.
 * @param fragment - the replacement block (no trailing newline needed).
 * @param backupCount - backups retained (>= 1).
 * @returns the backup path, bytes written, and how many blocks were replaced.
 */
export async function replaceOwnedBlock(
  filePath: string,
  marker: string,
  fragment: string,
  backupCount: number,
): Promise<{ readonly backupPath: string; readonly bytes: number; readonly replaced: number }> {
  const existing = await readIfPresent(filePath)
  const backupPath = `${filePath}${BACKUP_SUFFIX}${Date.now()}`
  if (existing !== null) await copyFile(filePath, backupPath)
  const { content, replaced } = dropMarkedBlocks(stripEmptyRootList(existing ?? FRESH_FILE_HEADER), marker)
  await writeFile(filePath, content, 'utf8')
  const bytes = await appendFragment(filePath, fragment)
  await pruneBackups(filePath, backupCount)
  return { backupPath, bytes, replaced }
}

/** Read a file, or null when it does not exist. Other errors propagate. */
async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
    return null
  }
}

/**
 * A patch layer that only contains an empty root list (`[]`) plus comments is
 * not a valid prefix for an appended operation: `[]` ends the YAML document.
 * Removing that one sentinel is the only rewrite the append path performs;
 * any real row keeps the append-only guarantee.
 */
function stripEmptyRootList(content: string): string {
  const lines = content.split('\n')
  let emptyRoot = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (trimmed === '[]') { emptyRoot = true; continue }
    return content
  }
  if (!emptyRoot) return content
  return lines.filter(line => line.trim() !== '[]').join('\n')
}

/**
 * Drop every block that opens with `marker`.
 *
 * A block is the marker line plus the non-blank lines that follow it; the
 * first blank line ends it, which is exactly how the renderer separates one
 * block from the next. Content that does not open with the marker is copied
 * through unchanged.
 *
 * @param content - the whole file content.
 * @param marker - the marker comment prefix to match.
 * @returns the content without those blocks, plus how many were dropped.
 */
function dropMarkedBlocks(content: string, marker: string): { content: string; replaced: number } {
  const lines = content.split('\n')
  const kept: string[] = []
  let replaced = 0
  let inBlock = false
  for (const line of lines) {
    if (line.trim().startsWith(marker)) {
      inBlock = true
      replaced += 1
      continue
    }
    if (inBlock) {
      if (line.trim() !== '') continue
      inBlock = false
    }
    kept.push(line)
  }
  // Removal can leave a run of blank lines where a block used to be.
  return { content: kept.join('\n').replace(/\n{3,}/gu, '\n\n'), replaced }
}

/** Append one fragment with surrounding newlines, normalizing a trailing newline first. */
async function appendFragment(filePath: string, fragment: string): Promise<number> {
  const content = await readFile(filePath, 'utf8')
  const base = stripEmptyRootList(content)
  const normalized = base.endsWith('\n') ? base : `${base}\n`
  const block = normalized.endsWith('\n\n') || normalized === '' ? `${fragment}\n` : `\n${fragment}\n`
  await writeFile(filePath, `${normalized}${block}`, 'utf8')
  // Readback: the appended block must survive exactly as written — a partial
  // write would otherwise surface as a "written" success (issue #27 hardening).
  const after = await readFile(filePath, 'utf8')
  if (!after.includes(fragment)) {
    throw new Error('dsh-mcp-workbench: the appended patch fragment could not be read back — the write is suspect; inspect the file before retrying')
  }
  return Buffer.byteLength(block, 'utf8')
}

/** Keep only the newest `keep` `*.bak-*` siblings of `filePath`. */
async function pruneBackups(filePath: string, keep: number): Promise<void> {
  const dir = join(filePath, '..')
  const prefix = filePath.slice(dir.length + 1) + BACKUP_SUFFIX
  let names: string[]
  try {
    names = (await readdir(dir)).filter(name => name.startsWith(prefix))
  } catch {
    return // Directory listing failed — pruning is best-effort, never fatal.
  }
  if (names.length <= keep) return
  const sorted = names
    .map(name => ({ name, stamp: Number(name.slice(prefix.length)) }))
    .filter(entry => Number.isFinite(entry.stamp))
    .sort((left, right) => right.stamp - left.stamp)
  for (const entry of sorted.slice(keep)) {
    try {
      await unlink(join(dir, entry.name))
    } catch {
      // A busy backup file only skips pruning.
    }
  }
}
