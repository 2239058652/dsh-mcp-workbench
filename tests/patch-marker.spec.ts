/**
 * Patch-marker tests: which operations restate one row's state (and must
 * replace their previous block) versus which are genuine events (and may
 * append).
 *
 * @module dsh-mcp-workbench/test/patch-marker.spec
 */

import { describe, expect, it } from 'vitest'
import { patchComment, patchMarker, renderPatchFragment, type ResolvedPatchOp } from '../src/patch.ts'

const EDIT: ResolvedPatchOp = { kind: 'edit', entryId: 'mcp-web', rowConfig: { serverName: 'web' } }
const DISABLE: ResolvedPatchOp = { kind: 'disable', entryId: 'mcp-web' }
const ENABLE: ResolvedPatchOp = { kind: 'enable', entryId: 'mcp-web' }
const ADD: ResolvedPatchOp = { kind: 'add', entryId: 'mcp-new', rowConfig: { serverName: 'new' } }

describe('patchMarker', () => {
  it('leaves an add append-only — an insert is an event, not a state', () => {
    expect(patchMarker(ADD)).toBeNull()
  })

  it('gives every state operation of one row its own marker', () => {
    // Distinct markers so the three kinds coexist: only the newest block of
    // each kind wins, which is how the Loader reads them.
    const markers = [patchMarker(EDIT), patchMarker(DISABLE), patchMarker(ENABLE)]
    expect(new Set(markers).size).toBe(3)
    for (const marker of markers) expect(marker).not.toBeNull()
  })

  it('binds the marker to the exact entry id', () => {
    expect(patchMarker({ kind: 'edit', entryId: 'mcp-a', rowConfig: {} } as ResolvedPatchOp))
      .not.toBe(patchMarker({ kind: 'edit', entryId: 'mcp-a-b', rowConfig: {} } as ResolvedPatchOp))
  })

  it('matches the comment line renderPatchFragment actually emits', () => {
    // The marker and the rendered comment must not drift apart: a marker the
    // renderer does not emit would silently never match, and the file would
    // grow again.
    const now = new Date('2026-11-08T00:00:00Z')
    for (const op of [EDIT, DISABLE, ENABLE]) {
      const marker = patchMarker(op)!
      const comment = patchComment(op, now)
      // renderPatchFragment prefixes the comment with `# `.
      expect(renderPatchFragment(op, now).startsWith(`# ${comment}`)).toBe(true)
      // And the marker is that whole line up to the date's opening ` (`.
      const head = comment.slice(0, comment.indexOf(' ('))
      expect(marker).toBe(`# ${head} (`)
    }
  })
})
