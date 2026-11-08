/**
 * The console's host service: assembles the MCP snapshot and serves it under
 * the `mcpWorkbench` Typert Remote namespace (`mcpWorkbench/status`), plus the three
 * console actions — `previewPatch` (render a CRUD operation),
 * `writePatch` (approval-gated append to the profile patch layer, with
 * automatic backup), and `callTool` (a tool trial through the OFFICIAL
 * `ctx.tools.execute` pipeline) — and the panel probe action.
 *
 * Data sources, all read-only:
 * - `ctx.loader` — mcp-client rows (raw config, effective disabled, fiber phase).
 * - `ctx.tools.schemas()` / `ctx.tools.execute()` — registered `mcp__*` tools
 *   and the official execution pipeline (permission + approval + guards).
 * - the shipped upstream `mcp/status` seam — observed via {@link observe}.
 * - `ctx.jobs` — unowned `mcp-probe` background jobs (panel-only results),
 *   retired from the registry the moment they settle: an unowned job is
 *   visible to EVERY session's job list, so settled probes would accumulate
 *   in a process-lifetime list the panel's own cap cannot bound.
 * - `ctx.approval` / `ctx.agents` — feature-detected approval routing.
 *
 * Connection status is reported honestly: without upstream observations the
 * view reads `unknown` with `statusSource: 'derived'`; the panel never infers
 * a connection state from tool-registry presence.
 *
 * Writes are APPEND-ONLY and never touch any file before the approval gate
 * passes; every write first copies the current patch layer to a timestamped
 * backup (see `src/write.ts`).
 *
 * @module dsh-mcp-workbench/service
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: activates the `ctx.jobs` Context merge.
import type {} from '@deepseek-ai/dsh-jobs'
// Type-only: activates the `ctx.agents` Context merge (feature-detected at runtime).
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: activates the `mcp-probe` JobKindMap extension.
import type {} from './probe.ts'
import {
  aggregateSnapshot,
  configViewOf,
  MCP_CLIENT_MODULE,
  serverNameOf,
  type McpLoaderRow,
} from './aggregate.ts'
import { groupMcpTools } from './grouping.ts'
import { hiddenToolNames, restrictAgentTools, toggleHidden } from './disable.ts'
import { NAME_PATTERN } from './config.ts'
import type { ToolVisibilityResult } from './wire.ts'
import {
  patchMarker,
  renderPatchFragment,
  renderConfigOverride,
  TOOL_FILTER_MARKER,
  resolvePatchOp,
  type McpPatchResolution,
  type ResolvedPatchOp,} from './patch.ts'
import { appendPatchFragment, replaceOwnedBlock } from './write.ts'
import { createTrialCaller, validateTrialRequest, RESOURCE_TOOL_NAMES, RESOURCE_TOOL_SET, type McpAgentRegistryFace, type McpTrialRequest } from './trial.ts'
import { probeJob, probeJobLabel, PROBE_KIND, PROBE_LABEL_PREFIX, startProbeJob, type ProbeTarget } from './probe.ts'
import { sanitizeText } from './sanitize.ts'
import { exportMcpConfigs, parseMcpConfigsImport } from './config-io.ts'
import type { McpServerStatus, McpStatusPhase } from './upstream.ts'
import type {
  McpCatalogEntryView,
  McpFiberPhase,
  McpPanelSnapshot,
  McpProbeView,
  McpTrialResultWire,
  PatchPreview,
  PatchWriteResult,
  ProbeStarted,
  ReloadResult,
} from './wire.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** MCP management console snapshot + actions service (this package). */
    mcpWorkbench: McpPanelService
  }
}

/**
 * Runtime mirror of the Cordis `FiberState` const enum (numeric cross-package
 * const enums have no runtime import), projected to the wire phases.
 */
const FIBER_PHASE: Record<number, McpFiberPhase> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

/** The profile patch-layer filename the console writes (append-only). */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/**
 * Supervisor phases this panel understands. Upstream payloads are
 * unvalidated runtime data (any plugin can emit `mcp/status`): a payload
 * whose required fields do not match the wire codec would otherwise be
 * stored verbatim and later REJECT the whole `mcpWorkbench/status` snapshot on
 * the strict Typert codec, taking down the panel over one bad event.
 */
const KNOWN_PHASES: ReadonlySet<string> = new Set(['connecting', 'connected', 'waiting', 'exhausted', 'disposed'])

/** Background-job statuses the panel displays; anything else reads `unknown`. */
const KNOWN_JOB_STATUSES: ReadonlySet<string> = new Set(['running', 'stopping', 'completed', 'killed', 'failed'])

/**
 * Structural face of the approval seam (`@deepseek-ai/dsh-user-approval`),
 * feature-detected so the panel never hard-depends on the approval package.
 * The real service's `request` throws when no turn is open; the panel checks
 * turn state before asking and never lets an approval failure fall through
 * to an ungated write.
 */
interface ApprovalSeamFace {
  request(req: {
    agent: unknown
    toolName: string
    reason?: string
    signal?: AbortSignal
  }): Promise<unknown>
}

/** The one approval outcome that authorizes a write. */
const ALLOWED_ONCE = 'allowed-once'

/** Service-level runtime settings; the plugin passes its resolved config in. */
export interface McpPanelServiceConfig {
  /** Per-probe timeout in milliseconds. */
  probeTimeoutMs: number
  /** Cap on probe records shown in the panel. */
  maxProbes: number
  /** Suggested panel refresh interval in ms (0 = on demand). */
  refreshIntervalMs: number
  /** Whether the passive probe loop runs. */
  passiveProbeEnabled: boolean
  /** Passive probe interval in milliseconds. */
  passiveProbeIntervalMs: number
  /** Whether the tool trial console is enabled. */
  trialEnabled: boolean
  /** Panel-side deadline for one trial tool call. */
  trialTimeoutMs: number
  /** Cap on the trial result payload in chars. */
  trialMaxResultChars: number
  /** Whether profile-patch writes are allowed at all. */
  writeEnabled: boolean
  /** Whether each write is verified against the loader's re-applied state before success. */
  writeVerifyEnabled: boolean
  /** Polling budget for write verification in ms. */
  writeVerifyTimeoutMs: number
  /** Number of patch backups retained per write. */
  backupCount: number
  /** Merged recommended MCP server directory (built-in + user overlay). */
  catalog: readonly McpCatalogEntryView[]
  /** Tools hidden from the model, keyed by server name. */
  disabledTools: Readonly<Record<string, readonly string[]>>
}

/** Defaults for direct (non-Loader) service construction. */
const DEFAULT_SERVICE_CONFIG: McpPanelServiceConfig = {
  probeTimeoutMs: 10_000,
  maxProbes: 10,
  refreshIntervalMs: 0,
  passiveProbeEnabled: false,
  passiveProbeIntervalMs: 60_000,
  trialEnabled: true,
  trialTimeoutMs: 120_000,
  trialMaxResultChars: 60_000,
  writeEnabled: true,
  writeVerifyEnabled: true,
  writeVerifyTimeoutMs: 3_000,
  backupCount: 5,
  catalog: [],
  disabledTools: {},
}

/**
 * Whether the agent is running a turn right now (approval precondition).
 *
 * The previous implementation scanned the session event log for
 * `turn/start`/`turn/end` through the deprecated synchronous event-snapshot
 * read, which the 0.1.6 line prohibits for new calls; `agent.status` publishes
 * the same fact without touching the log API. The condition stays
 * conservative: the caller additionally requires the approval seam to be
 * present, so a host without that seam never silently becomes "no approval
 * needed" — it falls back to the explicit UI confirmation path instead.
 */
function isAgentRunning(agent: unknown): boolean {
  try {
    return (agent as { status?: unknown } | null)?.status === 'running'
  } catch {
    // A hostile agent shape must never crash the gate — treat as not running.
    return false
  }
}

/** MCP management console service, exported over the `mcpWorkbench` Remote namespace. */
export class McpPanelService extends TypertRemoteService {
  static inject = ['loader', 'tools']

  /**
   * Tools hidden from the model. Seeded from config at mount and kept current
   * by {@link setToolHidden}: the loader hot-reloads the patch layer, but this
   * instance keeps serving requests in the meantime, so a write that only
   * touched the file would leave the panel (and the next click's baseline)
   * reading the pre-write value.
   */
  private hiddenTools: Readonly<Record<string, readonly string[]>>
  private readonly statuses = new Map<string, McpServerStatus>()
  /** Cumulative reconnect attempts observed per server namespace. */
  private readonly reconnects = new Map<string, number>()
  /**
   * Highest `attempt` already counted per server, so re-observing the same
   * payload (HMR remount, event + query seed of one transition) never double
   * counts a reconnect.
   */
  private readonly countedAttempts = new Map<string, number>()
  /** Epoch ms of the latest upstream event receipt per server namespace. */
  private readonly observedAt = new Map<string, number>()
  /**
   * This process's latest probe verdict per server namespace, written by EVERY
   * probe (panel action, `/mcp … probe`, tool, and the passive loop) and
   * cleared for a row that gets restarted. Process memory only — which is what
   * the panel's open-once probe keys on.
   */
  private readonly probeStates = new Map<string, { state: 'reachable' | 'unreachable'; checkedAt: number }>()
  /**
   * The panel's own probe log, newest last.
   *
   * Probe jobs are UNOWNED, so the registry lists them for every session; they
   * are retired from it the moment they settle (see `startProbe`). The log is
   * what the panel reads instead, which is also the only place a settled
   * probe's outcome survives: it is capped at `maxProbes` and lives in memory
   * for this process, exactly like the job registry itself.
   */
  private readonly probeLog: McpProbeView[] = []

/** The trial caller with this instance's own callId sequence. */
private readonly trialCaller = createTrialCaller()
  /** Passive-probe loop guard: one sweep at a time. */
  private passiveRunning = false

  /**
   * @param ctx - context carrying the loader and tool registry.
   * @param config - resolved runtime settings; defaults apply for direct construction.
   */
  constructor(ctx: Context, private readonly config: McpPanelServiceConfig = DEFAULT_SERVICE_CONFIG) {
    super(ctx, 'mcpWorkbench')
    this.hiddenTools = config.disabledTools
    if (config.passiveProbeEnabled) {
      const timer = setInterval(() => { void this.runPassiveProbes() }, config.passiveProbeIntervalMs)
      // An armed probe timer must never hold the process open on its own.
      timer.unref?.()
      ctx.effect(() => () => { clearInterval(timer) }, 'dsh-mcp-workbench: passive probe loop')
    }
  }

  /**
   * Record one upstream `mcp/status` payload (event or query-seed). Payloads
   * are validated before storage — they are unvalidated runtime data and a
   * malformed one must never poison the strict wire codec downstream. A
   * `connecting` payload with a strictly increasing attempt counts one
   * reconnect; re-observing the same payload never double counts.
   *
   * @param payload - post-transition status facts.
   */
  observe(payload: McpServerStatus): void {
    if (typeof payload !== 'object' || payload === null) return
    const { serverName, phase, attempt, maxAttempts, toolCount } = payload
    if (typeof serverName !== 'string' || serverName === '') return
    if (typeof phase !== 'string' || !KNOWN_PHASES.has(phase)) return
    if (!Number.isFinite(attempt) || !Number.isFinite(maxAttempts) || !Number.isFinite(toolCount)) return
    // Normalize into the exact shape the wire codec accepts; optional fields
    // drop when they are not codec-shaped instead of rejecting the snapshot.
    const clean: McpServerStatus = {
      serverName,
      phase: phase as McpStatusPhase,
      attempt: Math.floor(attempt),
      maxAttempts: Math.floor(maxAttempts),
      toolCount: Math.floor(toolCount),
      ...(Number.isFinite(payload.delayMs) ? { delayMs: Math.floor(payload.delayMs as number) } : {}),
      ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
      ...(Number.isFinite(payload.connectedAt) ? { connectedAt: Math.floor(payload.connectedAt as number) } : {}),
      // Proposed upstream diagnostics extension: kept only when shaped.
      ...(Number.isFinite(payload.exitCode) ? { exitCode: Math.floor(payload.exitCode as number) } : {}),
      ...(typeof payload.stderrTail === 'string' ? { stderrTail: payload.stderrTail } : {}),
    }
    this.statuses.set(serverName, clean)
    this.observedAt.set(serverName, Date.now())
    if (clean.phase === 'connecting' && clean.attempt > 0) {
      const counted = this.countedAttempts.get(serverName) ?? 0
      if (clean.attempt > counted) {
        this.countedAttempts.set(serverName, clean.attempt)
        this.reconnects.set(serverName, (this.reconnects.get(serverName) ?? 0) + 1)
      }
    } else if (clean.phase === 'connected' || clean.phase === 'disposed') {
      // A recovery or teardown resets the counter so the next outage counts
      // from attempt 1 again. `waiting`/`exhausted` keep it: those phases
      // carry the ongoing outage's attempt and must not re-arm counting.
      this.countedAttempts.set(serverName, 0)
    }
  }

  /**
   * Assemble the current snapshot. Read-only: touches no configuration file
   * and mutates no registry. Exported on the wire by the `mcpWorkbench/status`
   * invocation descriptor in `./wire.ts` (registered through the package's
   * `./typert` manifest) — no method decorator, so the built bundle stays
   * plain ESM.
   *
   * @returns the wire snapshot (validated by the strict Typert codec on both faces).
   */
  status(): McpPanelSnapshot {
    const rows: McpLoaderRow[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== MCP_CLIENT_MODULE) continue
      rows.push({
        // options.id is the user-written patch id (entry.id prefixes enclosing
        // group ids such as `include:`), so patch suggestions match on reload.
        entryId: entry.options.id,
        disabled: entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state] ?? null,
        config: entry.options.config,
      })
    }
    const schemas = this.ctx.tools.schemas()
    const configuredNames = rows.map(row => serverNameOf(row.config, `entry:${row.entryId}`))
    const groups = groupMcpTools(schemas, configuredNames)
    // Mark the tools this plugin hides from the model. The mask itself is
    // applied per agent scope (see ./disable.ts); the flag is purely display,
    // so the panel can still list and trial a hidden tool.
    const hiddenNames = new Set(hiddenToolNames(this.hiddenTools))
    const markedGroups = groups.map(group => ({
      ...group,
      tools: group.tools.map(tool => ({ ...tool, hidden: hiddenNames.has(tool.name) })),
    }))
    // Resources are bridged by the SHIPPED `@deepseek-ai/dsh-mcp-resources`
    // service (mounted by the base bundle): the official client registers each
    // connection's provider, and the package owns the three shared tools. The
    // console feature-detects the service AND the registered tools; Prompts
    // remain deferred upstream, so their capability stays false.
    const schemaList = Array.from(schemas)
    const registeredResourceTools = schemaList
      .filter(schema => RESOURCE_TOOL_SET.has(schema.name))
      .map(schema => schema.name)
    const resourcesAvailable = this.ctx.get('mcpResources') !== undefined
      && RESOURCE_TOOL_NAMES.every(name => registeredResourceTools.includes(name))
    return aggregateSnapshot({
      rows,
      groups: markedGroups,
      facts: {
        statuses: this.statuses,
        reconnects: this.reconnects,
        observedAt: this.observedAt,
        probeStates: this.probeStates,
      },
      probes: this.probeViews(),
      patchFile: this.patchFile(),
      refreshIntervalMs: this.config.refreshIntervalMs,
      capabilities: {
        resources: { available: resourcesAvailable },
        prompts: { available: false },
      },
      trial: {
        enabled: this.config.trialEnabled,
        timeoutMs: this.config.trialTimeoutMs,
        maxResultChars: this.config.trialMaxResultChars,
      },
      writeEnabled: this.config.writeEnabled,
      catalog: this.config.catalog,
    })
  }

  /**
   * Start a one-shot connectivity probe of one configured MCP server
   * (streamable-http or stdio) as an UNOWNED background job — panel-only,
   * like the `mcp_probe` tool, but callable from the settings tab. Exported
   * on the wire by the `mcpWorkbench/probe` invocation descriptor.
   *
   * @param serverName - configured namespace.
   * @returns the started job id and where the result lands.
   */
  probe(serverName: string): ProbeStarted {
    const target = this.probeSpec(serverName)
    if (target === undefined) {
      throw new Error(`dsh-mcp-workbench: "${serverName}" is not a configured MCP server (streamable-http or stdio)`)
    }
    return this.startProbe(serverName, target)
  }

  /**
   * Start one probe job for a server whose spec the caller already resolved,
   * and file it in the panel's own probe log.
   *
   * The job is retired from the registry as soon as it settles: an unowned job
   * is listed for EVERY session, so leaving settled probes registered would
   * grow every conversation's background-job header for the life of the
   * process — and the registry never drops an unowned record on its own.
   * A timeout here is the panel's to bracket, so nothing long-lived is lost.
   *
   * @param serverName - configured namespace (also the log's row label).
   * @param target - resolved probe spec, already validated by the caller.
   * @returns the started job id and where the result lands.
   */
  startProbe(serverName: string, target: ProbeTarget): ProbeStarted {
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) {
      throw new Error('dsh-mcp-workbench: ctx.jobs is not composed — the panel probe action needs a background-job registry')
    }
    const startedAt = Date.now()
    const jobId = startProbeJob(jobs, target, this.config.probeTimeoutMs, probeJobLabel(serverName), (id, settlement) => {
      const settled: McpProbeView = {
        id,
        serverName,
        status: settlement.status,
        startedAt,
        finishedAt: Date.now(),
        detail: settlement.detail === '' ? null : sanitizeText(settlement.detail),
      }
      const index = this.probeLog.findIndex(view => view.id === id)
      if (index === -1) this.probeLog.push(settled)
      else this.probeLog[index] = settled
      this.trimProbeLog()
      // Every probe — panel action, `/mcp … probe`, or the tool — is also the
      // row's liveness fact for THIS process. That is what lets the panel open
      // without re-probing a row it already knows: the memory lives exactly as
      // long as the Host process, so a restart (new ports, new network) reads
      // as `null` again and the next open probes once.
      this.probeStates.set(serverName, {
        state: settlement.status === 'completed' ? 'reachable' : 'unreachable',
        checkedAt: settled.finishedAt ?? startedAt,
      })
    })
    // A producer can settle before `start` even returns (a rejected fetch), in
    // which case the settle callback already wrote the finished record; only
    // file the placeholder when it did not.
    if (!this.probeLog.some(view => view.id === jobId)) {
      this.probeLog.push({
        id: jobId,
        serverName,
        status: 'running',
        startedAt,
        finishedAt: null,
        detail: null,
      })
      this.trimProbeLog()
    }
    return {
      jobId,
      note: 'Probe results are panel-only: left sidebar → MCP.',
    }
  }

  /**
   * Render one CRUD operation as its append-only patch fragment WITHOUT
   * touching any file. Exported by `mcpWorkbench/previewPatch`; the editor uses
   * it for the copy-to-clipboard path and the confirm review.
   *
   * @param opJson - JSON of the operation (add / edit / disable / enable).
   * @returns the fragment, the target file, and the operation count.
   */
  previewPatch(opJson: string): PatchPreview {
    const resolution = this.resolveOp(opJson)
    if (!resolution.ok) throw this.issueError(resolution)
    return {
      fragment: renderPatchFragment(resolution.op),
      file: this.patchFile(),
      ops: 1,
    }
  }

  /**
   * Persist one tool's model visibility and apply it to live agents.
   *
   * Writes the plugin's OWN config row (the mcp-client row has no such field):
   * reads the profile patch layer, drops unrelated appended blocks by locating
   * this plugin's row, and appends an id-targeted override carrying the whole
   * `disabledTools` map. The append-only dialect replaces the entire config, so
   * every other key of this plugin's row is restated.
   *
   * @param serverName - configured MCP namespace.
   * @param toolName - bare tool name (no `mcp__` prefix).
   * @param hidden - true to hide from the model, false to show it again.
   * @returns the applied change with a human note.
   */
  async setToolHidden(serverName: string, toolName: string, hidden: boolean): Promise<ToolVisibilityResult> {
    if (!this.config.writeEnabled) {
      throw new Error('dsh-mcp-workbench: config writes are disabled (config.writeEnabled: false) — edit the file by hand')
    }
    if (!NAME_PATTERN.test(serverName) || !NAME_PATTERN.test(toolName)) {
      throw new Error(`dsh-mcp-workbench: "${serverName}"/"${toolName}" is not a valid server/tool name pair`)
    }
    const file = this.patchFile()
    if (file === null) {
      throw new Error('dsh-mcp-workbench: the profile patch path is unknown (no ctx.baseUrl) — cannot write')
    }
    // Baseline is the in-memory value, which setToolHidden keeps current: the
    // loader picks the write up asynchronously, and computing from the mounted
    // config would re-append the same block on every click and drop earlier
    // toggles in between.
    const next = toggleHidden(this.hiddenTools, serverName, toolName, hidden)
    if (sameHiddenMap(next, this.hiddenTools)) {
      return {
        serverName,
        toolName,
        hidden,
        note: `"${toolName}" is already ${hidden ? 'hidden' : 'visible'} — nothing to write.`,
      }
    }
    const row = this.pluginRow()
    if (row === null) {
      throw new Error('dsh-mcp-workbench: this plugin\'s own loader row was not found — cannot persist the tool filter')
    }
    const fragment = renderConfigOverride(row.entryId, { ...row.config, disabledTools: next })
    // Replace this plugin's own previous filter block rather than appending:
    // the filter is state, not an event, so appending per click grew the file
    // without bound. Only blocks carrying our marker are removed.
    await replaceOwnedBlock(file, TOOL_FILTER_MARKER, fragment, this.config.backupCount)
    // Adopt the new map before returning: `status()` and the next click both
    // read it, so the panel reflects the write without waiting for a reload.
    this.hiddenTools = next
    // Live agents first: a model call admitted after this point already reads
    // the narrowed schema set. New agents pick it up in disable.ts.
    const hiddenNames = hiddenToolNames(next)
    const known = new Set(this.ctx.tools.schemas().map(schema => schema.name))
    for (const agent of this.agents().list()) restrictAgentTools(agent.ctx, hiddenNames, known)
    const total = Object.values(next).reduce((sum, names) => sum + names.length, 0)
    return {
      serverName,
      toolName,
      hidden,
      note: hidden
        ? `"${toolName}" is now hidden from the model (${total} tool(s) hidden in total). Applies to this session immediately; the config override is appended to the profile patch layer.`
        : `"${toolName}" is visible to the model again (${total} tool(s) still hidden).`,
    }
  }

  /** This plugin's own loader row (entry id + config), or null. */
  private pluginRow(): { entryId: string; config: Record<string, unknown> } | null {
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== PLUGIN_MODULE) continue
      const config = entry.options.config
      return {
        entryId: entry.options.id,
        config: typeof config === 'object' && config !== null ? config as Record<string, unknown> : {},
      }
    }
    return null
  }

  /** The live agent registry face. */
  private agents(): { list: () => Iterable<{ ctx: Context }> } {
    const agents = this.ctx.get('agents') as { list: () => Iterable<{ ctx: Context }> } | undefined
    if (agents === undefined) throw new Error('dsh-mcp-workbench: ctx.agents is not composed — cannot apply a tool filter')
    return agents
  }


  /**
   * Append one CRUD operation to the profile patch layer, approval-gated.
   * Order: validate → resolve against loader facts → render → APPROVE →
   * backup → append. The approval gate:
   *
   * - when the harness approval service exists AND the caller's session has
   *   a live agent with an open turn, the write asks through
   *   `ctx.approval.request` — only `allowed-once` proceeds (rejection,
   *   cancellation, unavailability, and audit failures all fail closed);
   * - otherwise (settings-page writes happen outside turns) the explicit
   *   interactive confirmation is the approval channel, and the write
   *   proceeds only when the client's `confirmed` flag is true;
   * - `writeEnabled: false` rejects every write up front (kill switch).
   *
   * @param opJson - JSON of the operation.
   * @param confirmed - whether the human reviewed and confirmed in the UI.
   * @param sessionId - optional current session for approval routing.
   * @returns the applied write with audit facts.
   */
  async writePatch(opJson: string, confirmed: boolean, sessionId: string | undefined): Promise<PatchWriteResult> {
    if (!this.config.writeEnabled) {
      throw new Error('dsh-mcp-workbench: profile writes are disabled (config.writeEnabled: false) — flip the kill switch or edit the file by hand')
    }
    const file = this.patchFile()
    if (file === null) {
      throw new Error('dsh-mcp-workbench: the profile patch path is unknown (no ctx.baseUrl) — cannot write')
    }
    const resolution = this.resolveOp(opJson)
    if (!resolution.ok) throw this.issueError(resolution)
    const fragment = renderPatchFragment(resolution.op)

    const approval = this.ctx.get('approval') as ApprovalSeamFace | undefined
    const agents = this.ctx.get('agents') as McpAgentRegistryFace | undefined
    const agent = sessionId === undefined || sessionId === '' ? undefined : agents?.get(sessionId)
    let approvalPath: PatchWriteResult['approvalPath'] | null = null
    if (approval !== undefined && agent !== undefined && isAgentRunning(agent)) {
      const outcome = await approval.request({
        agent,
        toolName: 'mcp-workbench/writePatch',
        reason: `append a dsh-mcp-workbench operation (${resolution.op.kind}) to the profile patch layer`,
      })
      if (outcome === ALLOWED_ONCE) {
        approvalPath = 'harness-approval'
      } else if (outcome === 'rejected') {
        throw new Error('dsh-mcp-workbench: the profile write was rejected')
      } else if (outcome === 'cancelled') {
        throw new Error('dsh-mcp-workbench: approval for the profile write was cancelled')
      } else {
        throw new Error('dsh-mcp-workbench: no approval channel is available for the profile write')
      }
    }
    if (approvalPath === null) {
      if (confirmed !== true) {
        throw new Error('dsh-mcp-workbench: the profile write needs confirmation — review the fragment and confirm in the console')
      }
      approvalPath = 'interactive-confirmation'
    }

    // A state operation (edit / disable / enable) restates ONE row, so only
    // its last block counts: replace this plugin's own previous block of the
    // same kind for the same row instead of appending. `add` stays a genuine
    // append — an insert creates a row, and two adds are two different rows.
    const marker = patchMarker(resolution.op)
    const { backupPath, bytes, replaced } = marker === null
      ? { ...await appendPatchFragment(file, fragment, this.config.backupCount), replaced: 0 }
      : await replaceOwnedBlock(file, marker, fragment, this.config.backupCount)
    // Issue #27 hardening: the loader dialect previously skipped the emitted
    // `- set:` fragments silently. The web profile hot-reloads patch edits, so
    // verify the loader actually re-applied the operation before reporting
    // success; a skipped patch (wrong dialect, a row living in a layer this
    // file cannot target, or a name mismatch) reads as a failure with the
    // backup kept.
    if (this.config.writeVerifyEnabled) {
      await this.verifyWrite(resolution.op)
    }
    return {
      file,
      backupPath,
      approvalPath,
      bytes,
      ops: 1,
      note: replaced === 0
        ? 'The web surface hot-reloads cordis.patch.yml edits; other surfaces restart.'
        : `The web surface hot-reloads cordis.patch.yml edits; ${replaced} earlier block(s) of the same operation were replaced.`,
    }
  }

  /**
   * Run one `mcp__*` tool through the OFFICIAL pipeline
   * (`ctx.tools.execute`): pre-execute permission policy, approval asks,
   * guards, the tool body, and post-execute all apply exactly as for model
   * calls. Exported by `mcpWorkbench/callTool`; results are panel-only and never
   * enter model context.
   *
   * @param requestJson - JSON of `{ serverName, toolName, argsJson }`.
   * @param sessionId - optional current session for approval routing.
   * @returns the capped trial result.
   */
  async callTool(requestJson: string, sessionId: string | undefined): Promise<McpTrialResultWire> {
    if (!this.config.trialEnabled) {
      throw new Error('dsh-mcp-workbench: the tool trial console is disabled (config.trialEnabled: false)')
    }
    let request: unknown
    try {
      request = JSON.parse(requestJson)
    } catch {
      throw new Error('dsh-mcp-workbench: requestJson is not valid JSON')
    }
    const problem = validateTrialRequest(request)
    if (problem !== null) throw new Error(`dsh-mcp-workbench: ${problem}`)
    return this.trialCaller.runTrialCall(
      this.ctx.tools,
      agentsOf(this.ctx),
      sessionId,
      request as McpTrialRequest,
      { timeoutMs: this.config.trialTimeoutMs, maxResultChars: this.config.trialMaxResultChars },
    )
  }

  /**
   * Export every configured MCP server as a versioned JSON document (backup or
   * share). A row whose config carries a `!!js` expression (not plain JSON)
   * exports as `{ config: null, reason }` — the expression is never evaluated.
   * @returns the pretty-printed JSON export.
   */
  exportConfigs(): string {
    const servers: Array<{ entryId: string; config: unknown }> = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== MCP_CLIENT_MODULE) continue
      servers.push({ entryId: entry.options.id, config: entry.options.config })
    }
    return exportMcpConfigs(servers)
  }

  /**
   * Parse an MCP config export into per-server append-only `add` patch
   * fragments WITHOUT touching any file. The client reviews the fragments and
   * confirms a write through the existing `writePatch` gate.
   * @param json - the export JSON text (untrusted).
   * @returns `{ entryId, fragment }` per imported server, in document order.
   */
  importPreview(json: string): Array<{ entryId: string; fragment: string }> {
    const rows = parseMcpConfigsImport(json)
    return rows.map(({ entryId, config }) => {
      const resolution = this.resolveOp(JSON.stringify({ kind: 'add', config }))
      if (!resolution.ok) throw this.issueError(resolution)
      return { entryId, fragment: renderPatchFragment(resolution.op) }
    })
  }

  /** Resolve one wire op against the live loader facts. */
  private resolveOp(opJson: string): McpPatchResolution {
    let op: unknown
    try {
      op = JSON.parse(opJson)
    } catch {
      throw new Error('dsh-mcp-workbench: opJson is not valid JSON')
    }
    const rawFor = new Map<string, unknown>()
    const viewFor = new Map<string, ReturnType<typeof configViewOf>>()
    const existingIds = new Set<string>()
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== MCP_CLIENT_MODULE) continue
      const entryId = entry.options.id
      rawFor.set(entryId, entry.options.config)
      viewFor.set(entryId, configViewOf(entry.options.config, `entry:${entryId}`))
      existingIds.add(entryId)
    }
    return resolvePatchOp(op, rawFor, viewFor, existingIds)
  }

  /** Render validation issues as one actionable error. */
  private issueError(resolution: Extract<McpPatchResolution, { ok: false }>): Error {
    return new Error(`dsh-mcp-workbench: invalid patch operation — ${resolution.issues.map(issue => issue.text).join(' ')}`)
  }

  /**
   * Restart one mcp-client row in place: dispose its fiber (the bridge tears
   * the transport down) and start it again (a fresh handshake + tool sync).
   * No config file is written — this is a runtime restart of the row that is
   * already configured, which is the only reconnect this console performs.
   *
   * @param serverName - the row's configured namespace.
   * @returns the restarted row's identity and a note for the dialog.
   */
  async reload(serverName: string): Promise<ReloadResult> {
    const wanted = serverName.trim()
    if (wanted === '') throw new Error('dsh-mcp-workbench: reload requires a serverName')
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== MCP_CLIENT_MODULE) continue
      const config = entry.options.config as { serverName?: unknown } | undefined
      const name = typeof config?.serverName === 'string' ? config.serverName : entry.options.id
      if (name !== wanted) continue
      if (entry.disabled) {
        throw new Error(`dsh-mcp-workbench: "${wanted}" is disabled — enable the row before reconnecting`)
      }
      entry.fiber?.dispose()
      await entry.init()
      // The row just re-handshook: every probe fact this process holds about it
      // describes the connection that was torn down. Dropping both keeps a
      // restarted-but-healthy row from wearing the old red dot, and lets the
      // panel probe it again instead of trusting a stale verdict.
      this.probeStates.delete(wanted)
      // In place: `probeLog` is a readonly binding, and a filtered copy would
      // also break the running-placeholder bookkeeping.
      for (let index = this.probeLog.length - 1; index >= 0; index -= 1) {
        if (this.probeLog[index]?.serverName === wanted) this.probeLog.splice(index, 1)
      }
      return {
        serverName: wanted,
        entryId: entry.options.id,
        note: 'The row was restarted; its tools re-sync after the new handshake.',
      }
    }
    throw new Error(`dsh-mcp-workbench: no mcp-client row for "${wanted}" (a leftover namespace has nothing to restart)`)
  }

  /** The loader row for one entry id, or undefined when absent or foreign. */
  private entryOf(entryId: string): { disabled: boolean; config: unknown } | undefined {
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.id !== entryId || entry.options.name !== MCP_CLIENT_MODULE) continue
      return { disabled: entry.disabled, config: entry.options.config }
    }
    return undefined
  }

  /**
   * Verify that the loader actually re-applied an appended patch operation.
   * The web profile hot-reloads `cordis.patch.yml` edits, so a valid override
   * becomes observable on the live entry within the budget; anything else
   * (a skipped patch, a row inserted by a later-composed layer such as
   * `$DSH_HOME/cordis.patch.yml`, or a name mismatch) leaves the loader
   * unchanged and must not read as success.
   *
   * @param op - the operation that was appended.
   * @param budgetMs - polling budget; the loop checks every 250 ms.
   */
  private async verifyWrite(op: ResolvedPatchOp, budgetMs = this.config.writeVerifyTimeoutMs): Promise<void> {
    const deadline = Date.now() + budgetMs
    for (;;) {
      if (this.writeVerified(op)) return
      if (Date.now() >= deadline) {
        throw new Error(
          `dsh-mcp-workbench: the fragment was appended (backup kept), but the loader did not apply it within ${budgetMs}ms — `
          + 'the row may live in a layer a profile patch cannot reach (e.g. inserted by $DSH_HOME/cordis.patch.yml), '
          + 'or the patch was skipped; inspect with dsh --profile web --dump-config',
        )
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  /** Whether the loader currently reflects the intent of one applied op. */
  private writeVerified(op: ResolvedPatchOp): boolean {
    const entry = this.entryOf(op.entryId)
    switch (op.kind) {
      case 'add': return entry !== undefined
      case 'disable': return entry?.disabled === true
      case 'enable': return entry !== undefined && entry.disabled === false
      case 'edit': {
        if (entry === undefined) return false
        const current = entry.config as Record<string, unknown> | undefined
        for (const [key, value] of Object.entries(op.rowConfig)) {
          if (current === undefined || JSON.stringify(current[key]) !== JSON.stringify(value)) return false
        }
        return true
      }
    }
  }

  /** One passive-probe sweep over every configured MCP server (both transports). */
  private async runPassiveProbes(): Promise<void> {
    if (this.passiveRunning) return
    this.passiveRunning = true
    try {
      for (const entry of this.ctx.loader.entries()) {
        if (entry.options.name !== MCP_CLIENT_MODULE) continue
        const serverName = serverNameOf(entry.options.config, `entry:${entry.options.id}`)
        const target = this.probeSpec(serverName)
        if (target === undefined) continue
        const outcome = await probeJob(target, this.config.probeTimeoutMs).done
        this.probeStates.set(serverName, { state: outcome.status === 'completed' ? 'reachable' : 'unreachable', checkedAt: Date.now() })
      }
    } finally {
      this.passiveRunning = false
    }
  }

  /**
   * Resolve one configured server's probe spec. Credentials stay inside the
   * returned value and are used for the probe only — they never reach a
   * snapshot, a log, or a display. Streamable-http rows yield their raw
   * endpoint + configured headers; stdio rows yield the launch spec
   * (`command`/`args`, explicit `env` merged after the scrub, optional
   * `cwd`) that the probe spawns.
   *
   * @param serverName - configured namespace.
   * @returns the transport-tagged probe spec, or `undefined` when the server
   *   is not a configured MCP row of either transport.
   */
  probeSpec(serverName: string): ProbeTarget | undefined {
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== MCP_CLIENT_MODULE) continue
      const config = entry.options.config
      // `entry.options.id` — not `entry.id` — keeps the namespace fallback
      // identical to the snapshot's (`entry:<options.id>`); `entry.id` carries
      // enclosing group prefixes (e.g. `include:`), which would silently break
      // probe targeting for rows nested in groups.
      if (serverNameOf(config, `entry:${entry.options.id}`) !== serverName) continue
      if (typeof config !== 'object' || config === null || Array.isArray(config)) return undefined
      const row = config as Record<string, unknown>
      if (row['transport'] === 'streamable-http') {
        const url = row['url']
        if (typeof url !== 'string' || url === '') return undefined
        const headersValue = row['headers']
        const headers: Record<string, string> = {}
        if (typeof headersValue === 'object' && headersValue !== null && !Array.isArray(headersValue)) {
          for (const [name, value] of Object.entries(headersValue as Record<string, unknown>)) {
            if (typeof value === 'string') headers[name] = value
          }
        }
        return { kind: 'http', url, headers }
      }
      if (row['transport'] === 'stdio') {
        const command = row['command']
        if (typeof command !== 'string' || command === '') return undefined
        const argsValue = row['args']
        const args: string[] = []
        if (Array.isArray(argsValue)) {
          for (const value of argsValue) {
            if (typeof value !== 'string') return undefined
            args.push(value)
          }
        } else if (argsValue !== undefined) return undefined
        const envValue = row['env']
        const env: Record<string, string> = {}
        if (typeof envValue === 'object' && envValue !== null && !Array.isArray(envValue)) {
          for (const [name, value] of Object.entries(envValue as Record<string, unknown>)) {
            if (typeof value !== 'string') return undefined
            env[name] = value
          }
        } else if (envValue !== undefined) return undefined
        const cwd = row['cwd']
        if (cwd !== undefined && (typeof cwd !== 'string' || cwd === '')) return undefined
        return { kind: 'stdio', command, args, env, ...(typeof cwd === 'string' ? { cwd } : {}) }
      }
      return undefined
    }
    return undefined
  }

  /**
   * Resolve one server's raw endpoint for the streamable-http probe path.
   * Credentials stay inside this return value and are used for the request
   * only — they never reach a snapshot, a log, or a display.
   *
   * @param serverName - configured namespace.
   * @returns the raw URL + configured headers, or `undefined` when the server
   *   is not a configured streamable-http row.
   */
  rawEndpoint(serverName: string): { url: string; headers: Record<string, string> } | undefined {
    const spec = this.probeSpec(serverName)
    return spec?.kind === 'http' ? { url: spec.url, headers: { ...spec.headers } } : undefined
  }

  /** Drop the oldest log entries beyond the display cap. */
  private trimProbeLog(): void {
    const excess = this.probeLog.length - this.config.maxProbes
    if (excess > 0) this.probeLog.splice(0, excess)
  }

  /** Unowned `mcp-probe` background jobs still registered, newest first, sanitized for display. */
  private runningProbes(): McpProbeView[] {
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) return []
    return jobs
      .list()
      .filter(job => job.kind === PROBE_KIND)
      .map(job => ({
        id: job.id,
        serverName: job.label.startsWith(PROBE_LABEL_PREFIX) ? job.label.slice(PROBE_LABEL_PREFIX.length) : job.label,
        // Job registries may grow lifecycle states; anything outside the
        // panel's vocabulary reads `unknown` instead of failing the codec.
        status: KNOWN_JOB_STATUSES.has(job.status) ? job.status as McpProbeView['status'] : 'unknown',
        startedAt: job.startedAt,
        finishedAt: job.finishedAt ?? null,
        detail: job.detail === undefined ? null : sanitizeText(job.detail),
      }))
      .reverse()
  }

  /**
   * The panel's probe rows, newest first.
   *
   * The log is authoritative for anything this process started (its settled
   * records are retired from the job registry, so the registry cannot answer
   * for them), and the registry fills in probes that are still live. The merge
   * is by job id, so a running probe appears once, not twice.
   *
   * @returns at most `maxProbes` rows.
   */
  private probeViews(): McpProbeView[] {
    const seen = new Set<string>()
    const merged: McpProbeView[] = []
    for (const view of [...this.runningProbes(), ...this.probeLog]) {
      if (seen.has(view.id)) continue
      seen.add(view.id)
      merged.push(view)
    }
    // One total order regardless of which source answered: newest first.
    merged.sort((left, right) => right.startedAt - left.startedAt)
    return merged.slice(0, this.config.maxProbes)
  }

  /** Absolute path of the profile patch layer the console writes, or null. */
  private patchFile(): string | null {
    const base = this.ctx.baseUrl
    if (typeof base !== 'string' || base === '') return null
    const dir = base.startsWith('file://') ? fileURLToPath(base) : base
    return join(dir, PROFILE_PATCH_FILENAME)
  }
}

/** This plugin's own loader module name (the row the console edits). */
const PLUGIN_MODULE = 'dsh-mcp-workbench'

/**
 * Structural equality for two `server → tool names` maps (order-insensitive
 * inside a server), so a toggle that changes nothing writes nothing.
 *
 * @param left - one map.
 * @param right - the other map.
 * @returns true when both name exactly the same tools.
 */
function sameHiddenMap(
  left: Readonly<Record<string, readonly string[]>>,
  right: Readonly<Record<string, readonly string[]>>,
): boolean {
  const leftKeys = Object.keys(left).filter(key => (left[key] ?? []).length > 0)
  const rightKeys = Object.keys(right).filter(key => (right[key] ?? []).length > 0)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    const a = new Set(left[key])
    const b = new Set(right[key] ?? [])
    if (a.size !== b.size) return false
    for (const name of a) if (!b.has(name)) return false
  }
  return true
}

/** Read the optional agent registry face from a context. */
function agentsOf(ctx: Context): McpAgentRegistryFace | undefined {
  const agents = ctx.get('agents')
  if (typeof agents !== 'object' || agents === null) return undefined
  return agents as McpAgentRegistryFace
}

export default McpPanelService
