/**
 * The client-side Remote face of the `mcpWorkbench` namespace: the hand-written
 * `TypertRemoteContribution` mounted through `ctx.remote.$mount`, plus the
 * declaration merging that types `ctx.remote.mcpWorkbench`. The descriptor list
 * is shared with the host `./typert` manifest (`../wire.ts`), so the two
 * faces can never drift.
 *
 * @module dsh-mcp-workbench/client/remote
 */

import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { MCP_PANEL_INVOCATIONS } from '../wire.ts'
import type {
  McpPanelSnapshot,
  McpTrialResultWire,
  PatchPreview,
  PatchWriteResult,
  ProbeStarted,
  ReloadResult,
} from '../wire.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$mcpWorkbench {
    /** Read the current console snapshot. */
    status: () => Promise<RemoteResult<McpPanelSnapshot>>
    /** Start a one-shot connectivity probe of one streamable-http server. */
    probe: (serverName: string) => Promise<RemoteResult<ProbeStarted>>
    /** Render one CRUD operation as its patch fragment (no write). */
    previewPatch: (opJson: string) => Promise<RemoteResult<PatchPreview>>
    /** Approval-gated append of one CRUD operation to the profile patch layer. */
    writePatch: (opJson: string, confirmed: boolean, sessionId?: string) => Promise<RemoteResult<PatchWriteResult>>
    /** Trial-call one tool through the official pipeline. */
    callTool: (requestJson: string, sessionId?: string) => Promise<RemoteResult<McpTrialResultWire>>
    /** Restart one mcp-client row (dispose + start); no config is written. */
    reload: (serverName: string) => Promise<RemoteResult<ReloadResult>>
  }
  interface TypertRemoteMap {
    'mcpWorkbench/status': () => Promise<RemoteResult<McpPanelSnapshot>>
    'mcpWorkbench/probe': (serverName: string) => Promise<RemoteResult<ProbeStarted>>
    'mcpWorkbench/previewPatch': (opJson: string) => Promise<RemoteResult<PatchPreview>>
    'mcpWorkbench/writePatch': (opJson: string, confirmed: boolean, sessionId?: string) => Promise<RemoteResult<PatchWriteResult>>
    'mcpWorkbench/callTool': (requestJson: string, sessionId?: string) => Promise<RemoteResult<McpTrialResultWire>>
    'mcpWorkbench/reload': (serverName: string) => Promise<RemoteResult<ReloadResult>>
  }
  interface TypertRemoteNamespaceMap {
    mcpWorkbench: TypertRemoteNamespace$mcpWorkbench
  }
}

/** The client Remote contribution for the `mcpWorkbench` namespace. */
export const MCP_PANEL_REMOTE = Object.freeze({
  package: 'dsh-mcp-workbench',
  descriptors: MCP_PANEL_INVOCATIONS,
} satisfies TypertRemoteContribution)
