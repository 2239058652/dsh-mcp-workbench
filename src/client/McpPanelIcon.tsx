/** Sidebar rail icon for the MCP panel (rendered by `sidebar.panellist`). */

import type { ReactNode } from 'react'

/** Sidebar icon share: the requested edge and whether this panel is selected. */
export interface McpPanelIconProps {
  /** Requested square edge in pixels. */
  size: number
  /** Whether this panel is the selected one in the main column. */
  active: boolean
}

/**
 * Render the MCP rail icon: two linked plugs, tinted by the selection state.
 *
 * @param props - the sidebar's icon share.
 * @returns a decorative inline SVG.
 */
export function McpPanelIcon({ size, active }: McpPanelIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.1 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      opacity={active ? 1 : 0.8}
    >
      <path d="M9 3v5" />
      <path d="M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </svg>
  )
}
