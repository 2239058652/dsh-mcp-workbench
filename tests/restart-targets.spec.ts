/**
 * Refresh-restart selection tests: which rows a refresh restarts, and — as
 * importantly — which it leaves alone.
 *
 * @module dsh-mcp-workbench/test/restart-targets.spec
 */

import { describe, expect, it } from 'vitest'
import { restartTargets } from '../src/client/restart.ts'
import type { McpPanelSnapshot } from '../src/wire.ts'

/** Probe row used by the fixtures. */
interface ProbeFixture {
  readonly serverName: string
  readonly status: 'completed' | 'failed' | 'killed' | 'running' | 'unknown'
}

/** Server row used by the fixtures. */
interface RowFixture {
  readonly serverName: string
  readonly enabled?: boolean
  readonly entryId?: string
  readonly tools?: number
}

/** Build the slice of a snapshot the selector reads. */
function snapshot(probes: readonly ProbeFixture[], rows: readonly RowFixture[]): McpPanelSnapshot {
  return {
    probes: probes.map((probe, index) => ({
      id: `mcp-probe-${index}`,
      serverName: probe.serverName,
      status: probe.status,
      startedAt: 0,
      finishedAt: null,
    })),
    servers: rows.map((row) => ({
      serverName: row.serverName,
      enabled: row.enabled ?? true,
      entryId: row.entryId ?? `mcp-${row.serverName}`,
      tools: Array.from({ length: row.tools ?? 0 }, (_, index) => ({ name: `tool-${index}` })),
    })),
  } as unknown as McpPanelSnapshot
}

describe('restartTargets', () => {
  it('restarts a row whose probe failed', () => {
    const targets = restartTargets(snapshot([{ serverName: 'dead', status: 'failed' }], [{ serverName: 'dead' }]))
    expect(targets).toEqual(['dead'])
  })

  it('restarts a reachable row that registered no tools', () => {
    const targets = restartTargets(snapshot([{ serverName: 'idle', status: 'completed' }], [{ serverName: 'idle', tools: 0 }]))
    expect(targets).toEqual(['idle'])
  })

  it('leaves a reachable row with tools alone', () => {
    const targets = restartTargets(snapshot([{ serverName: 'webstorm', status: 'completed' }], [{ serverName: 'webstorm', tools: 12 }]))
    expect(targets).toEqual([])
  })

  it('ignores rows whose probe has not settled', () => {
    const targets = restartTargets(snapshot([{ serverName: 'slow', status: 'running' }], [{ serverName: 'slow', tools: 0 }]))
    expect(targets).toEqual([])
  })

  it('does not restart rows the user disabled or that no row owns', () => {
    const targets = restartTargets(
      snapshot(
        [{ serverName: 'off', status: 'completed' }, { serverName: 'loose', status: 'completed' }],
        [{ serverName: 'off', enabled: false, tools: 0 }, { serverName: 'loose', entryId: '', tools: 0 }],
      ),
    )
    expect(targets).toEqual([])
  })

  it('lists a row once when it is both dead and empty', () => {
    const targets = restartTargets(snapshot([{ serverName: 'both', status: 'killed' }], [{ serverName: 'both', tools: 0 }]))
    expect(targets).toEqual(['both'])
  })

  it('reads the newest probe per server (probes are newest-first)', () => {
    const targets = restartTargets(
      snapshot(
        [
          { serverName: 'flaky', status: 'completed' },
          { serverName: 'flaky', status: 'failed' },
        ],
        [{ serverName: 'flaky', tools: 0 }],
      ),
    )
    expect(targets).toEqual(['flaky'])
  })
})
