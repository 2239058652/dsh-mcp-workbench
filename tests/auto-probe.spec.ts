/**
 * Open-time probe selection tests: the panel probes a row only when THIS
 * process has no verdict for it yet, which is what keeps a re-open free while
 * still colouring every row after a Host restart.
 *
 * @module dsh-mcp-workbench/test/auto-probe.spec
 */

import { describe, expect, it } from 'vitest'
import { autoProbeTargets } from '../src/client/auto-probe.ts'
import type { McpServerView } from '../src/wire.ts'

/** Build the slice of a server view the selector reads. */
function row(
  serverName: string,
  overrides: Partial<Pick<McpServerView, 'transport' | 'enabled' | 'entryId' | 'probeState'>> = {},
): McpServerView {
  return {
    serverName,
    transport: 'streamable-http',
    enabled: true,
    entryId: `mcp-${serverName}`,
    probeState: null,
    ...overrides,
  } as unknown as McpServerView
}

describe('autoProbeTargets', () => {
  it('probes every enabled, configured, never-probed http row', () => {
    expect(autoProbeTargets([row('a'), row('b')])).toEqual(['a', 'b'])
  })

  it('skips rows this process already probed — reachable or not', () => {
    // The whole point: a re-opened panel costs nothing, and a known-dead row
    // is not re-hammered on every visit.
    const targets = autoProbeTargets([
      row('reachable', { probeState: 'reachable' }),
      row('dead', { probeState: 'unreachable' }),
      row('fresh'),
    ])
    expect(targets).toEqual(['fresh'])
  })

  it('returns nothing when every row already has a verdict', () => {
    expect(autoProbeTargets([
      row('a', { probeState: 'reachable' }),
      row('b', { probeState: 'unreachable' }),
    ])).toEqual([])
  })

  it('skips stdio rows — probing one spawns its configured command', () => {
    expect(autoProbeTargets([row('cli', { transport: 'stdio' })])).toEqual([])
  })

  it('skips disabled rows and leftover namespaces with no loader row', () => {
    expect(autoProbeTargets([
      row('off', { enabled: false }),
      row('ghost', { entryId: '' }),
    ])).toEqual([])
  })
})
