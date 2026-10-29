/** Error boundary for the console page: one bad render must not blank the app. */

import { Component, type ReactNode } from 'react'

/** Boundary props. */
export interface PanelBoundaryProps {
  /** Heading shown when a child threw. */
  title: string
  /** Label of the recovery button. */
  retryLabel: string
  /** The subtree to protect. */
  children: ReactNode
}

/** Boundary state: the first error a child threw, or null. */
interface PanelBoundaryState {
  error: Error | null
}

/**
 * Catch render errors from the console subtree and show them in place.
 *
 * The panel is a `main` panel, so an uncaught throw unmounts the whole React
 * tree — the user sees a blank page instead of a broken panel. This keeps the
 * failure local and offers a retry that re-mounts the subtree.
 */
export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  constructor(props: PanelBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  /** React lifecycle: adopt the thrown error as state. */
  static getDerivedStateFromError(error: Error): PanelBoundaryState {
    return { error }
  }

  /** Render the subtree, or the failure card once a child threw. */
  override render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return (
      <div className="dmcp-failure">
        <p role="alert">{this.props.title}</p>
        <p className="dmcp-failure-detail">{this.state.error.message}</p>
        <button type="button" className="dmcp-action" onClick={() => { this.setState({ error: null }) }}>
          {this.props.retryLabel}
        </button>
      </div>
    )
  }
}
