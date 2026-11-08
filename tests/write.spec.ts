/**
 * Profile-write tests: append-only patches, timestamped backups, fresh-file
 * creation, and backup pruning — all against a real temp directory.
 *
 * @module dsh-mcp-workbench/test/write.spec
 */

import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { appendPatchFragment, replaceOwnedBlock } from '../src/write.ts'

const FRAGMENT = "- insert:\n    - id: mcp-x\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: x\n        transport: stdio\n        command: npx\n"

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-workbench-write-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    try {
      for (const name of await readdir(dir)) await unlink(join(dir, name))
      await rmdir(dir)
    } catch {
      // Best-effort cleanup only.
    }
  }
})

describe('appendPatchFragment', () => {
  it('creates a fresh patch file with a header and a backup', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cordis.patch.yml')
    const { backupPath, bytes } = await appendPatchFragment(file, FRAGMENT, 5)
    const content = await readFile(file, 'utf8')
    expect(content).toContain('# dsh-mcp-workbench managed patch layer')
    expect(content).toContain('- insert:')
    expect(content).toContain("serverName: x")
    expect(bytes).toBeGreaterThan(0)
    expect(backupPath.startsWith(`${file}.bak-`)).toBe(true)
  })

  it('never rewrites existing content: appends after it, byte-for-byte', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cordis.patch.yml')
    const original = `# my hand-written comment\n- insert:\n    - id: keep\n      name: x\n`
    await writeFile(file, original, 'utf8')
    await appendPatchFragment(file, FRAGMENT, 5)
    const content = await readFile(file, 'utf8')
    expect(content.startsWith(original)).toBe(true)
    expect(content).toContain('mcp-x')
    // YAML list shape stays valid: two top-level `- insert:` blocks.
    expect(content.match(/- insert:/g)).toHaveLength(2)
  })

  it('replaces an empty root list instead of appending after it', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cordis.patch.yml')
    await writeFile(file, '# hand-written comment\n[]\n', 'utf8')
    await appendPatchFragment(file, FRAGMENT, 5)
    const content = await readFile(file, 'utf8')
    expect(content).toContain('# hand-written comment')
    expect(content.trim().split('\n').some(line => line.trim() === '[]')).toBe(false)
    expect(content.match(/- insert:/g)).toHaveLength(1)
  })

  it('prunes backups beyond the retention count (newest kept)', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cordis.patch.yml')
    await writeFile(file, '[]\n', 'utf8')
    for (let index = 0; index < 7; index += 1) {
      // Staggered writes produce distinct timestamps on fast machines too.
      await new Promise(resolve => { setTimeout(resolve, 5) })
      await appendPatchFragment(file, FRAGMENT, 3)
    }
    const backups = (await readdir(dir)).filter(name => name.startsWith('cordis.patch.yml.bak-'))
    expect(backups.length).toBe(3)
  })
})

describe('replaceOwnedBlock', () => {
  const MARKER = '# dsh-mcp-workbench: update tool filter'
  const block = (tools: readonly string[]): string =>
    `${MARKER} (2026-11-02)\n- id: mcp-workbench\n  name: dsh-mcp-workbench\n  config:\n    disabledTools:\n      parallel:\n${tools.map(tool => `        - ${tool}\n`).join('')}`

  it('keeps exactly one own block no matter how many writes happened', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cordis.patch.yml')
    await writeFile(file, '# user comment\n- id: other\n  config:\n    keep: me\n', 'utf8')
    await replaceOwnedBlock(file, MARKER, block(['web_search']), 5)
    await replaceOwnedBlock(file, MARKER, block(['web_fetch']), 5)
    const content = await readFile(file, 'utf8')
    const occurrences = content.split(MARKER).length - 1
    expect(occurrences).toBe(1)
    // Disjoint states prove the first block is gone, not merely superseded at
    // load time (a superseded block would still be sitting in the file).
    expect(content).toContain('- web_fetch')
    expect(content).not.toContain('- web_search')
  })

  it('leaves content it did not write untouched', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cordis.patch.yml')
    await writeFile(file, '# keep this comment\n- id: other\n  config:\n    keep: me\n', 'utf8')
    await replaceOwnedBlock(file, MARKER, block(['web_search']), 5)
    const content = await readFile(file, 'utf8')
    expect(content.startsWith('# keep this comment\n- id: other\n  config:\n    keep: me\n')).toBe(true)
  })

  it('collapses several older own blocks into one', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cordis.patch.yml')
    await writeFile(file, `${block(['a'])}\n${block(['a', 'b'])}\n${block(['a', 'b', 'c'])}\n`, 'utf8')
    const { replaced } = await replaceOwnedBlock(file, MARKER, block(['b']), 5)
    expect(replaced).toBe(3)
    expect((await readFile(file, 'utf8')).split(MARKER).length - 1).toBe(1)
  })

  it('replaces one row\'s block without touching a prefix-sharing row', async () => {
    // `mcp-a` and `mcp-a-b` are different rows: the marker carries the closing
    // ` (` of the date stamp so a prefix match can never swallow the longer id.
    const dir = await tempDir()
    const file = join(dir, 'cordis.patch.yml')
    const editBlock = (entryId: string, url: string): string =>
      `# dsh-mcp-workbench: edit server ${entryId} (2026-11-08)\n- id: ${entryId}\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    url: ${url}`
    // Blank line between blocks, exactly as `appendPatchFragment` leaves them.
    await writeFile(file, `${editBlock('mcp-a', 'one')}\n\n${editBlock('mcp-a-b', 'other')}\n`, 'utf8')
    await replaceOwnedBlock(file, '# dsh-mcp-workbench: edit server mcp-a (', editBlock('mcp-a', 'two'), 5)
    const content = await readFile(file, 'utf8')
    expect(content).toContain('url: two')
    expect(content).not.toContain('url: one')
    // The sibling row survives verbatim.
    expect(content).toContain('edit server mcp-a-b (2026-11-08)')
    expect(content).toContain('url: other')
  })
})
