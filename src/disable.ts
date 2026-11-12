/**
 * Hide a configured subset of MCP tools from the model.
 *
 * The official client registers every synced tool into the GLOBAL tool layer,
 * and the system prompt carries one schema per visible tool — that is the
 * token cost a disabled tool must stop paying. `ctx.tools.restrict()` is the
 * shipped seam for exactly this: it narrows what a scope INHERITS (the global
 * layer) and `wireSchemas()` reads the narrowed view, so a denied tool leaves
 * the prompt while its registration stays intact (the panel can still list it
 * and trial it).
 *
 * Two constraints shape the code below:
 * - `restrict()` throws on a context-global call ("would mask every agent"),
 *   so it runs on each agent's own context, once per agent.
 * - A restriction never filters its OWN layer, and restrictions intersect, so
 *   re-applying to the same agent is both safe and idempotent.
 *
 * @module dsh-mcp-workbench/disable
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'

/** Prefix the official client gives every bridged tool. */
const MCP_TOOL_PREFIX = 'mcp__'

/**
 * Public tool names to hide, from the `server → raw names` config map.
 *
 * @param disabledTools - resolved config map.
 * @returns the `mcp__<server>__<raw>` names, or an empty list when disabled.
 */
export function hiddenToolNames(
  disabledTools: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const names: string[] = []
  for (const [serverName, rawNames] of Object.entries(disabledTools)) {
    for (const rawName of rawNames) names.push(`${MCP_TOOL_PREFIX}${serverName}__${rawName}`)
  }
  return names
}

/**
 * Apply the packed-down tool set to one agent's scope.
 *
 * Names the agent's scope cannot see (a server that never connected, a tool
 * the server no longer exposes) are filtered out first: `restrict()` fails
 * closed on unknown names, and a stale entry in config must not break every
 * new agent.
 *
 * @param agentContext - the agent's own context (`agent.ctx`).
 * @param hidden - public tool names to hide.
 * @param known - the tool names the global layer currently registers.
 * @returns a disposer that lifts the restriction.
 */
export function restrictAgentTools(
  agentContext: Context,
  hidden: readonly string[],
  known: ReadonlySet<string>,
): () => void {
  const deny = hidden.filter(name => known.has(name))
  if (deny.length === 0) return () => {}
  return agentContext.tools.restrict({ deny })
}

/**
 * Toggle one tool in the `server → raw names` map, returning a new map with
 * empty servers removed (an empty array would otherwise linger in config).
 *
 * @param current - the resolved map.
 * @param serverName - server namespace.
 * @param toolName - bare tool name.
 * @param hidden - true to add, false to remove.
 * @returns a new frozen map.
 */
export function toggleHidden(
  current: Readonly<Record<string, readonly string[]>>,
  serverName: string,
  toolName: string,
  hidden: boolean,
): Readonly<Record<string, readonly string[]>> {
  const next: Record<string, readonly string[]> = {}
  for (const [name, tools] of Object.entries(current)) next[name] = [...tools]
  const existing = next[serverName] ?? []
  if (hidden) {
    if (!existing.includes(toolName)) next[serverName] = [...existing, toolName]
  } else {
    const remaining = existing.filter(name => name !== toolName)
    if (remaining.length === 0) delete next[serverName]
    else next[serverName] = remaining
  }
  const out: Record<string, readonly string[]> = {}
  for (const [name, tools] of Object.entries(next)) if (tools.length > 0) out[name] = Object.freeze(tools)
  return Object.freeze(out)
}

/**
 * Hide `hidden` from every agent created from now on, and from the ones
 * already registered.
 *
 * Restrictions are applied to a SPECIFIC set of names, and `restrictAgentTools`
 * drops the ones the registry does not have yet (it must, or a stale config
 * would break every new agent). MCP tools arrive ASYNCHRONOUSLY — the bridge
 * connects after this plugin mounts — so a single pass at agent creation
 * commonly finds nothing to deny and the mask silently does nothing, leaving
 * every MCP tool visible. `tools/change` is the seam for that: it fires on
 * every registration and on every scoped restriction change, so the mask is
 * re-derived against the live registry instead of one stale snapshot.
 *
 * The mask must be IDEMPOTENT. That event also fires for the restriction this
 * function installs and for the one it lifts, so any design that re-applies
 * unconditionally reschedules itself and starves the event loop: `dsh web`
 * binds its port and then never answers. Every entry point below therefore
 * skips work whose result is already in place.
 *
 * @param ctx - the plugin context (never an agent's, so the listener is global).
 * @param hidden - public tool names to hide.
 * @returns nothing; listeners live for the plugin's fiber.
 */
export function installToolMask(
  ctx: Context,
  hidden: readonly string[],
): void {
  if (hidden.length === 0) return
  /**
   * The restriction installed on each agent's scope, together with the deny
   * list it was built from.
   *
   * Remembering the list is what makes a sweep IDEMPOTENT, and that is the
   * property the whole design rests on: `restrict()` and its disposer both
   * emit `tools/change`, so a sweep that re-applied unconditionally would
   * reschedule itself forever and starve the event loop — the process binds
   * its port and then never answers a request. An agent already carrying the
   * current deny set is skipped, so a sweep triggered by its own work finds
   * nothing to do, emits nothing, and stops.
   */
  const installed = new WeakMap<Context, { deny: readonly string[]; dispose: () => void }>()
  /** True while a sweep runs; the events its own work emits are not news. */
  let applying = false
  /** A coalesced sweep is already queued for the next microtask. */
  let queued = false

  /**
   * The deny list the live registry currently supports. Names the servers do
   * not expose are dropped: `restrict()` fails closed on unknown names, and a
   * stale entry in config must not break the mask.
   *
   * @returns the hidden names that are registered right now.
   */
  const currentDeny = (): readonly string[] => {
    // One registry read per sweep, not one per agent: this walks every tool
    // schema and deep-copies it, so it is by far the expensive part.
    const known = new Set(ctx.tools.schemas().map(schema => schema.name))
    return hidden.filter(name => known.has(name))
  }

  /**
   * Bring one agent's scope to `deny`.
   *
   * The replacement goes on BEFORE the old restriction is lifted: disposing
   * one also emits `tools/change`, and an empty window there would let a
   * reader on that tick see every tool. Overlapping restrictions intersect,
   * so the outcome is the same either way.
   *
   * @param agentContext - the agent's own context.
   * @param deny - the names to hide, already filtered against the registry.
   */
  const applyTo = (agentContext: Context, deny: readonly string[]): void => {
    const previous = installed.get(agentContext)
    if (previous !== undefined && sameNames(previous.deny, deny)) return
    if (deny.length === 0) {
      // Nothing to hide: hold no layer at all rather than a no-op registration.
      installed.delete(agentContext)
      previous?.dispose()
      return
    }
    let dispose: () => void
    try {
      dispose = agentContext.tools.restrict({ deny })
    } catch {
      // The agent was disposed between the snapshot and this call (deleting a
      // session does exactly that): `restrict()` creates an effect on the
      // agent's ctx and a dead fiber throws INACTIVE_EFFECT. The scope is
      // gone, so there is nothing left to mask and nothing to remember.
      installed.delete(agentContext)
      previous?.dispose()
      return
    }
    installed.set(agentContext, { deny, dispose })
    previous?.dispose()
  }

  /** One pass over every live agent. Never runs re-entrantly. */
  const sweep = (): void => {
    if (applying) return
    applying = true
    try {
      const deny = currentDeny()
      for (const agent of agentsOf(ctx) ?? []) {
        if (!isLive(agent.ctx)) continue
        applyTo(agent.ctx, deny)
      }
    } finally {
      applying = false
    }
  }

  /**
   * Queue one coalesced sweep.
   *
   * A server syncing 40 tools emits 40 changes in one batch, and each sweep
   * costs a full registry snapshot; coalescing leaves ONE pass per batch.
   * Leaving the synchronous path is safe because the only reader is the
   * request assembly (`systemPrompt.tools` callback), which runs long after
   * the microtask queue drains.
   */
  const scheduleApply = (): void => {
    // The guard has to be here, not only inside `sweep`: a change emitted by
    // our own `restrict()` still reaches this listener, and queueing from it
    // would outlive the `applying` window and restart the loop.
    if (applying || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      sweep()
    })
  }

  ctx.on('agent/created', ({ agent }) => {
    if (applying) return
    applying = true
    try {
      // A new agent usually arrives long after the tools settled, so resolve
      // the deny set here instead of sweeping every other agent again.
      applyTo(agent.ctx, currentDeny())
    } finally {
      applying = false
    }
  })
  ctx.on('tools/change', scheduleApply)
  sweep()
}

/**
 * Whether two deny lists name the same tools (order-insensitive).
 *
 * @param left - one list.
 * @param right - the other.
 * @returns true when both hold exactly the same names.
 */
function sameNames(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  for (const name of left) if (!right.includes(name)) return false
  return true
}

/** Live agents, or an empty list when the registry is not composed. */
function agentsOf(ctx: Context): Iterable<{ ctx: Context }> | undefined {
  return (ctx.get('agents') as { list: () => Iterable<{ ctx: Context }> } | undefined)?.list()
}

/**
 * Whether a context can still take an effect.
 *
 * Deleting a session disposes its agent, and a disposed fiber reports
 * `uid === null` — `ctx.effect()` then throws INACTIVE_EFFECT. A sweep can
 * reach a dead agent because `agents.list()` and the registry update race the
 * disposal; skipping it here keeps that race from taking down the process.
 *
 * @param agentContext - the agent's own context.
 * @returns true while the context still accepts effects.
 */
function isLive(agentContext: Context): boolean {
  const fiber = (agentContext as { fiber?: { uid?: number | null } }).fiber
  return fiber === undefined || fiber.uid !== null
}
