/**
 * Endpoint-field URL handling: what the editor accepts, and how a paste with
 * stray words in front of the scheme is repaired.
 *
 * @module dsh-mcp-workbench/test/url.spec
 */

import { describe, expect, it } from 'vitest'
import { isAbsoluteHttpUrl, normalizeUrl } from '../src/client/url.ts'

describe('isAbsoluteHttpUrl', () => {
  it('accepts http and https endpoints', () => {
    expect(isAbsoluteHttpUrl('https://mcp.example.com/mcp')).toBe(true)
    expect(isAbsoluteHttpUrl('http://127.0.0.1:65250/stream')).toBe(true)
    expect(isAbsoluteHttpUrl('  https://example.com  ')).toBe(true)
  })

  it('rejects anything the host would refuse', () => {
    expect(isAbsoluteHttpUrl('')).toBe(false)
    expect(isAbsoluteHttpUrl('mcp.example.com/mcp')).toBe(false)
    expect(isAbsoluteHttpUrl('ftp://example.com/file')).toBe(false)
    expect(isAbsoluteHttpUrl('http parallel https://example.com')).toBe(false)
  })
})

describe('normalizeUrl', () => {
  it('keeps a valid endpoint, trimmed', () => {
    expect(normalizeUrl('  https://example.com/mcp  ')).toBe('https://example.com/mcp')
  })

  it('drops words pasted in front of the scheme', () => {
    expect(normalizeUrl('http parallel https://mcp.parallel.ai/mcp')).toBe('https://mcp.parallel.ai/mcp')
    expect(normalizeUrl('firecrawl https://mcp.firecrawl.dev/v2/mcp')).toBe('https://mcp.firecrawl.dev/v2/mcp')
  })

  it('leaves an empty or scheme-less value as typed so the user can finish it', () => {
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl('   ')).toBe('')
    expect(normalizeUrl('mcp.example.com')).toBe('mcp.example.com')
  })
})
