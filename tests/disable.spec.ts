/**
 * Tool-visibility tests: the config map, the derived public names, and the
 * per-agent restriction that keeps a hidden tool's schema out of the prompt.
 *
 * @module dsh-mcp-workbench/test/disable.spec
 */

import { describe, expect, it } from 'vitest'
import { hiddenToolNames, restrictAgentTools } from '../src/disable.ts'
import { resolveConfig, resolveDisabledTools } from '../src/config.ts'
import { toggleHidden } from '../src/disable.ts'

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
})
