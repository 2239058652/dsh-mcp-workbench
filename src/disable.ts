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
 * @param ctx - the plugin context (never an agent's, so the listener is global).
 * @param hidden - public tool names to hide.
 * @returns nothing; listeners live for the plugin's fiber.
 */
export function installToolMask(
  ctx: Context,
  hidden: readonly string[],
): void {
  if (hidden.length === 0) return
  const known = (): ReadonlySet<string> =>
    new Set(ctx.tools.schemas().map(schema => schema.name))
  ctx.on('agent/created', ({ agent }) => {
    restrictAgentTools(agent.ctx, hidden, known())
  })
  const agents = ctx.get('agents') as { list: () => Iterable<{ ctx: Context }> } | undefined
  if (agents !== undefined) {
    for (const agent of agents.list()) restrictAgentTools(agent.ctx, hidden, known())
  }
}
