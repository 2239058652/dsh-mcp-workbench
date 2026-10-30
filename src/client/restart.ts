/**
 * Pure selection of the rows one refresh should restart.
 *
 * @module dsh-mcp-workbench/client/restart
 */

import type { McpPanelSnapshot, McpProbeView } from '../wire.ts'

/**
 * Rows a refresh should restart: the ones the probe found dead, plus the ones
 * it found reachable with nothing registered — the port answers but the bridge
 * never synced tools, and only a restart makes it handshake again.
 *
 * @param snapshot - current panel snapshot (probes newest-first).
 * @returns server names to restart, in probe order then row order.
 */
export function restartTargets(snapshot: McpPanelSnapshot): readonly string[] {
  const settled = new Map<string, McpProbeView['status']>()
  for (const probeView of snapshot.probes) {
    if (probeView.status === 'running' || settled.has(probeView.serverName)) continue
    settled.set(probeView.serverName, probeView.status)
  }
  const targets = new Set<string>()
  for (const [serverName, probeStatus] of settled) {
    if (probeStatus !== 'completed') targets.add(serverName)
  }
  for (const view of snapshot.servers) {
    if (!view.enabled || view.entryId === '' || view.tools.length > 0) continue
    if (settled.get(view.serverName) === 'completed') targets.add(view.serverName)
  }
  return [...targets]
}
