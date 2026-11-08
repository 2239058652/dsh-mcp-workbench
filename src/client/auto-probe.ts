/**
 * Pure selection of the rows an open should probe.
 *
 * @module dsh-mcp-workbench/client/auto-probe
 */

import type { McpServerView } from '../wire.ts'

/**
 * Rows the panel probes when it opens: enabled streamable-http rows this
 * process has NOT probed yet.
 *
 * The host keeps every server's latest probe for the life of the process, so
 * re-opening the panel probes nothing; a Host restart empties that memory and
 * the next open probes once. stdio rows are excluded on purpose — probing one
 * spawns the configured command.
 *
 * @param servers - the snapshot's server views.
 * @returns the server names to probe, in snapshot order.
 */
export function autoProbeTargets(servers: readonly McpServerView[]): readonly string[] {
  return servers
    .filter(row => row.transport === 'streamable-http'
      && row.enabled
      && row.entryId !== ''
      && row.probeState === null)
    .map(row => row.serverName)
}
