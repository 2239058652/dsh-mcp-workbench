/**
 * Pure URL handling for the server editor's endpoint field.
 *
 * @module dsh-mcp-workbench/client/url
 */

/**
 * Whether the value is an absolute http(s) URL (the host's own requirement).
 *
 * @param raw - field text as typed.
 * @returns true when the host's patch validator would accept it.
 */
export function isAbsoluteHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Trim one URL field and drop words pasted in front of the scheme, so
 * "name https://host/path" becomes the URL the host expects.
 *
 * @param raw - field text as typed.
 * @returns the trimmed URL, or the trimmed input when no scheme is present.
 */
export function normalizeUrl(raw: string): string {
  const text = raw.trim()
  if (text === '' || isAbsoluteHttpUrl(text)) return text
  const match = /https?:\/\/\S+$/u.exec(text)
  return match === null ? text : match[0]
}
