/**
 * Tool-visibility tests: the config map, the derived public names, and the
 * per-agent restriction that keeps a hidden tool's schema out of the prompt.
 *
 * @module dsh-mcp-workbench/test/disable.spec
 */

import { describe, expect, it } from 'vitest'
import { hiddenToolNames, installToolMask, restrictAgentTools, toggleHidden } from '../src/disable.ts'
import { resolveConfig, resolveDisabledTools } from '../src/config.ts'

/** Minimal context face `restrictAgentTools` reads. */
function fakeContext(): { ctx: never; calls: { deny: readonly string[] }[] } {
  const calls: { deny: readonly string[] }[] = []
  const ctx = {
    tools: {
      restrict: (filter: { deny?: readonly string[] }) => {
        calls.push({ deny: filter.deny ?? [] })
        return () => {}
      },
    },
  }
  return { ctx: ctx as never, calls }
}

describe('hiddenToolNames', () => {
  it('expands server + bare name into the bridged public name', () => {
    expect(hiddenToolNames({ firecrawl: ['firecrawl_crawl', 'firecrawl_map'] })).toEqual([
      'mcp__firecrawl__firecrawl_crawl',
      'mcp__firecrawl__firecrawl_map',
    ])
  })

  it('returns nothing when no tool is disabled', () => {
    expect(hiddenToolNames({})).toEqual([])
  })
})

describe('restrictAgentTools', () => {
  it('denies only the names the global layer actually registers', () => {
    const { ctx, calls } = fakeContext()
    restrictAgentTools(ctx, ['mcp__a__x', 'mcp__a__gone'], new Set(['mcp__a__x']))
    expect(calls).toEqual([{ deny: ['mcp__a__x'] }])
  })

  it('does not call restrict when every name is unknown (a stale config must not break new agents)', () => {
    const { ctx, calls } = fakeContext()
    restrictAgentTools(ctx, ['mcp__a__gone'], new Set(['mcp__a__x']))
    expect(calls).toEqual([])
  })
})

describe('installToolMask', () => {
  /**
   * A context whose registry starts empty and grows on demand, emitting
   * `tools/change` exactly like the real one (including on `restrict`).
   *
   * @returns the fake plugin context, the agent scope, and a registrar.
   */
  function maskHarness(): {
    ctx: never
    apply: { deny: readonly string[] }[]
    addTool: (name: string) => void
    createAgent: () => void
    /** Dispose one agent the way deleting its session does. */
    deleteAgent: (index: number) => void
    liveRestrictions: () => number
    maxLivePerScope: () => number
  } {
    const names = new Set<string>()
    const apply: { deny: readonly string[] }[] = []
    const listenersByEvent = new Map<string, Array<(...args: never[]) => void>>()
    /** Live restrictions: each `restrict` until its disposer runs. */
    const live = new Set<() => void>()
    const liveByScope = new Map<string, number>()
    let maxPerScope = 0
    const emit = (event: string, ...args: unknown[]): void => {
      for (const fn of listenersByEvent.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args)
    }
    /** One agent scope. The registry returns these from `list()`. */
    const agentScopes: { ctx: Record<string, unknown> }[] = []
    let scopeSeq = 0
    const deadScopes = new Set<string>()
    /** Restrictions owned by each scope, so a deletion drops only its own. */
    const disposersByScope = new Map<string, Set<() => void>>()
    const scopeFor = (): Record<string, unknown> => {
      const id = `scope-${scopeSeq += 1}`
      liveByScope.set(id, 0)
      disposersByScope.set(id, new Set())
      return {
        id,
        // A disposed fiber reports `uid === null`; the module reads this to
        // skip an agent whose session was deleted mid-sweep.
        fiber: { get uid() { return deadScopes.has(id) ? null : 1 } },
        tools: {
          schemas: () => [...names].map(name => ({ name })),
          restrict: (filter: { deny?: readonly string[] }) => {
            // The real registry creates an effect on the agent's ctx, which a
            // dead fiber rejects with INACTIVE_EFFECT.
            if (deadScopes.has(id)) {
              const error = new Error('cannot create effect on inactive context')
              ;(error as { code?: string }).code = 'INACTIVE_EFFECT'
              throw error
            }
            apply.push({ deny: filter.deny ?? [] })
            const held = (liveByScope.get(id) ?? 0) + 1
            liveByScope.set(id, held)
            maxPerScope = Math.max(maxPerScope, held)
            const dispose = (): void => {
              if (!live.delete(dispose)) return
              disposersByScope.get(id)?.delete(dispose)
              liveByScope.set(id, (liveByScope.get(id) ?? 1) - 1)
              emit('tools/change')
            }
            live.add(dispose)
            disposersByScope.get(id)?.add(dispose)
            emit('tools/change')
            return dispose
          },
        },
      }
    }
    const ctx = {
      tools: scopeFor()['tools'],
      on: (event: string, fn: (...args: never[]) => void) => {
        const list = listenersByEvent.get(event) ?? []
        list.push(fn)
        listenersByEvent.set(event, list)
        return () => {}
      },
      get: (name: string) => (name === 'agents' ? { list: () => agentScopes } : undefined),
    }
    return {
      ctx: ctx as never,
      apply,
      addTool: (name: string) => { names.add(name); emit('tools/change') },
      createAgent: () => {
        const agent = { ctx: scopeFor() }
        agentScopes.push(agent)
        emit('agent/created', { agent })
      },
      deleteAgent: (index: number) => {
        const agent = agentScopes[index]
        if (agent === undefined) return
        const id = String(agent.ctx['id'])
        deadScopes.add(id)
        // Disposing the scope drops ITS restrictions and nobody else's.
        for (const dispose of [...disposersByScope.get(id) ?? []]) dispose()
        agentScopes.splice(index, 1)
        emit('tools/change')
      },
      liveRestrictions: () => live.size,
      maxLivePerScope: () => maxPerScope,
    }
  }
  /**
   * Drain the microtask queue the module under test shares with this one.
   *
   * @returns after pending callbacks and chained ones have run.
   */
  const flush = (): Promise<void> => new Promise(resolve => { setImmediate(resolve) })

  it('masks tools that register AFTER the agent exists', async () => {
    // The bug this covers: MCP tools arrive asynchronously, so a mask derived
    // at agent creation finds nothing to deny and silently does nothing.
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden'])
    h.createAgent()
    expect(h.apply).toEqual([])
    h.addTool('mcp__a__hidden')
    await flush()
    expect(h.apply).toEqual([{ deny: ['mcp__a__hidden'] }])
  })

  it('does not stack a new restriction on every tool change', async () => {
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden'])
    h.createAgent()
    h.addTool('mcp__a__hidden')
    await flush()
    h.addTool('mcp__a__other')
    await flush()
    h.addTool('mcp__a__third')
    await flush()
    // One layer stays installed no matter how many changes arrived.
    expect(h.liveRestrictions()).toBe(1)
    expect(h.apply.at(-1)).toEqual({ deny: ['mcp__a__hidden'] })
  })

  it('collapses a burst of registrations into one re-apply', async () => {
    // A server syncing 40 tools emits 40 changes in one batch. Every one of
    // them arrives while the mask is already correct, so the burst must cost
    // NOTHING: the sweep is coalesced and each agent's deny set is unchanged.
    // (Two hidden tools register up front; the 40 filler tools are unrelated.)
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden', 'mcp__a__second'])
    h.createAgent()
    h.addTool('mcp__a__hidden')
    h.addTool('mcp__a__second')
    await flush()
    const before = h.apply.length
    expect(before).toBe(1)
    for (let index = 0; index < 40; index += 1) h.addTool(`mcp__a__t${index}`)
    await flush()
    expect(h.apply.length).toBe(before)
  })

  it('re-applies once when the burst actually changes the deny set', async () => {
    // The other half: a burst that DOES introduce a hidden name must cost
    // exactly one re-apply, not one per event.
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden'])
    h.createAgent()
    await flush()
    expect(h.apply.length).toBe(0)
    for (let index = 0; index < 40; index += 1) h.addTool(`mcp__a__t${index}`)
    h.addTool('mcp__a__hidden')
    await flush()
    expect(h.apply.length).toBe(1)
  })

  it('settles instead of looping on the change its own restrict emits', async () => {
    // THE regression this design exists for: `restrict()` and its disposer
    // both emit `tools/change`. A sweep that re-applied unconditionally would
    // reschedule itself forever and starve the event loop — `dsh web` bound
    // its port and never answered a request. The sweep must reach a fixpoint.
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden'])
    h.createAgent()
    h.addTool('mcp__a__hidden')
    await flush()
    const settled = h.apply.length
    // Drain several more turns: nothing new may happen.
    for (let turn = 0; turn < 5; turn += 1) await flush()
    expect(h.apply.length).toBe(settled)
  })

  it('stops scheduling once the deny set is stable', async () => {
    // The self-emitted change must not queue work at all, otherwise the loop
    // merely becomes periodic instead of stopping.
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden'])
    h.createAgent()
    h.addTool('mcp__a__hidden')
    await flush()
    const settled = h.apply.length
    await flush()
    await flush()
    expect(h.apply.length).toBe(settled)
  })

  it('holds no layer at all while no hidden tool is registered', async () => {
    // `restrict({ deny: [] })` would be a pointless layer that still costs a
    // scope registration; an empty deny set must install nothing.
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden'])
    h.createAgent()
    await flush()
    expect(h.liveRestrictions()).toBe(0)
    h.addTool('mcp__a__hidden')
    await flush()
    expect(h.liveRestrictions()).toBe(1)
  })

  it('never leaves a window with no restriction installed', async () => {
    // Re-deriving replaces the layer: the new one goes on before the old one
    // is lifted, so nothing observes an unmasked instant mid-swap.
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden', 'mcp__a__second'])
    h.createAgent()
    h.addTool('mcp__a__hidden')
    await flush()
    const before = h.apply.length
    h.addTool('mcp__a__second')
    await flush()
    expect(h.liveRestrictions()).toBe(1)
    expect(h.apply.length).toBe(before + 1)
  })

  it('keeps one live restriction per agent scope, disposing the old one', async () => {
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden'])
    h.createAgent()
    h.createAgent()
    h.addTool('mcp__a__hidden')
    await flush()
    expect(h.liveRestrictions()).toBe(2)
    expect(h.maxLivePerScope()).toBe(1)
  })

  it('does nothing at all when no tool is disabled', async () => {
    const h = maskHarness()
    installToolMask(h.ctx, [])
    h.addTool('mcp__a__x')
    await flush()
    expect(h.apply).toEqual([])
  })

  it('survives a session deletion that races the sweep', async () => {
    // Deleting a session disposes its agent. A sweep that reaches it would
    // call `restrict()` on a dead fiber, which throws INACTIVE_EFFECT and took
    // the whole `dsh web` process down. It must be skipped, not crash.
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden'])
    h.createAgent()
    h.deleteAgent(0)
    expect(() => h.addTool('mcp__a__hidden')).not.toThrow()
    await flush()
    expect(h.liveRestrictions()).toBe(0)
  })

  it('keeps masking the surviving agents after one is deleted', async () => {
    const h = maskHarness()
    installToolMask(h.ctx, ['mcp__a__hidden'])
    h.createAgent()
    h.createAgent()
    h.addTool('mcp__a__hidden')
    await flush()
    expect(h.liveRestrictions()).toBe(2)
    h.deleteAgent(0)
    expect(() => h.addTool('mcp__a__second')).not.toThrow()
    await flush()
    // The removed agent's layer went with its scope; the survivor keeps one.
    expect(h.liveRestrictions()).toBe(1)
    expect(h.apply.at(-1)).toEqual({ deny: ['mcp__a__hidden'] })
  })
})

describe('resolveDisabledTools', () => {
  it('dedupes and freezes the map', () => {
    const resolved = resolveDisabledTools({ a: ['x', 'x', 'y'] })
    expect(resolved).toEqual({ a: ['x', 'y'] })
  })

  it('rejects a prefixed tool name so the config cannot drift from the derived name', () => {
    expect(() => resolveDisabledTools({ a: ['mcp__a__x'] })).toThrow(/bare name/)
  })

  it('rejects an invalid server name', () => {
    expect(() => resolveDisabledTools({ 'bad name': ['x'] })).toThrow(/invalid server name/)
  })
})

describe('resolveConfig', () => {
  it('carries disabledTools through to the resolved config', () => {
    const resolved = resolveConfig({ disabledTools: { firecrawl: ['firecrawl_crawl'] } })
    expect(resolved.disabledTools).toEqual({ firecrawl: ['firecrawl_crawl'] })
  })

  it('defaults to an empty map', () => {
    expect(resolveConfig(undefined).disabledTools).toEqual({})
  })
})

describe('toggleHidden', () => {
  it('adds a tool and drops the server key when the last one is shown again', () => {
    const withHidden = toggleHidden({}, 'a', 'x', true)
    expect(withHidden).toEqual({ a: ['x'] })
    expect(toggleHidden(withHidden, 'a', 'x', false)).toEqual({})
  })

  it('is idempotent and leaves other servers alone', () => {
    const start = { a: ['x'], b: ['y'] }
    expect(toggleHidden(start, 'a', 'x', true)).toEqual({ a: ['x'], b: ['y'] })
    expect(toggleHidden(start, 'a', 'z', true)).toEqual({ a: ['x', 'z'], b: ['y'] })
  })

  it('accumulates when the caller feeds the previous result back in', () => {
    // The service keeps its own live map as the baseline: feeding the returned
    // value back in is what makes the second click see the first one. Computing
    // every toggle from the mounted config instead re-appended the same block.
    let live: Readonly<Record<string, readonly string[]>> = {}
    live = toggleHidden(live, 'parallel', 'web_search', true)
    live = toggleHidden(live, 'parallel', 'web_fetch', true)
    expect(live).toEqual({ parallel: ['web_search', 'web_fetch'] })
  })
})
