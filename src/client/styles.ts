/**
 * Scoped stylesheet for the MCP tab. Standalone client bundles cannot use the
 * in-repo CSS-module pipeline, so the sheet ships as a string and is
 * installed effect-scoped into a `<style data-dsh-mcp-panel>` element.
 * Every selector is scoped under `[data-dsh-mcp-panel]` and uses theme
 * design tokens only, so it follows both color schemes.
 *
 * @module dsh-mcp-panel/client/styles
 */

/** Live installations of the panel stylesheet (one element, many mounts). */
let liveInstalls = 0

/**
 * One `<style>` installation; returns the exact disposer that releases it.
 * Ownership is counted across mounts: the element is created once, any live
 * install keeps it, and only the last disposer removes it — an earlier unmount
 * can no longer pull the sheet out from under a surviving mount, and the
 * disposer is idempotent.
 */
export function installPanelStyles(): () => void {
  let disposed = false
  liveInstalls += 1
  let element = document.querySelector<HTMLStyleElement>('style[data-dsh-mcp-panel]')
  if (element === null) {
    element = document.createElement('style')
    element.dataset.dshMcpPanel = ''
    element.textContent = PANEL_CSS
    document.head.append(element)
  }
  return () => {
    if (disposed) return
    disposed = true
    liveInstalls -= 1
    if (liveInstalls <= 0) {
      liveInstalls = 0
      element?.remove()
    }
  }
}

/** The panel stylesheet, scoped and token-driven. */
const PANEL_CSS = `
[data-dsh-mcp-panel] .dmcp-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
[data-dsh-mcp-panel].dmcp-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 40px;
}
[data-dsh-mcp-panel] .dmcp-page-title {
  margin: 0;
  font-size: 1.2em;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
[data-dsh-mcp-panel] .dmcp-page > :not(.dmcp-backdrop) {
  box-sizing: border-box;
  max-width: 1180px;
  width: 100%;
}
[data-dsh-mcp-panel] .dmcp-page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
[data-dsh-mcp-panel] .dmcp-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
[data-dsh-mcp-panel] .dmcp-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[data-dsh-mcp-panel] .dmcp-row {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
[data-dsh-mcp-panel] .dmcp-row:hover {
  border-color: var(--dsw-alias-border-l3);
}
[data-dsh-mcp-panel] .dmcp-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  background: none;
  border: 0;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
}
[data-dsh-mcp-panel] .dmcp-row-main:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
[data-dsh-mcp-panel] .dmcp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
[data-dsh-mcp-panel] .dmcp-modal {
  box-sizing: border-box;
  width: 100%;
  max-height: min(86vh, 900px);
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  outline: none;
}
[data-dsh-mcp-panel] .dmcp-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
[data-dsh-mcp-panel] .dmcp-modal-title {
  margin: 0;
  font-size: 1.05em;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-mcp-panel] .dmcp-iconbtn {
  flex-shrink: 0;
  background: none;
  border: 0;
  border-radius: 4px;
  padding: 0 8px;
  font-size: 1.3em;
  line-height: 1.4;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
[data-dsh-mcp-panel] .dmcp-iconbtn:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
}
[data-dsh-mcp-panel] .dmcp-modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
}
[data-dsh-mcp-panel] .dmcp-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
[data-dsh-mcp-panel] .dmcp-detail-target {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
[data-dsh-mcp-panel] .dmcp-chip {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l3);
  font-size: 0.85em;
  white-space: nowrap;
}
[data-dsh-mcp-panel] .dmcp-section-title {
  margin: 0;
  font-size: 0.95em;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-mcp-panel] .dmcp-modal-body .dmcp-editor {
  border: 0;
  padding: 0;
  background: none;
}
[data-dsh-mcp-panel] .dmcp-modal-body .dmcp-editor > .dmcp-heading {
  display: none;
}
[data-dsh-mcp-panel] .dmcp-status {
  color: var(--dsw-alias-label-secondary);
  margin: 0;
}
[data-dsh-mcp-panel] .dmcp-failure {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
[data-dsh-mcp-panel] .dmcp-failure button {
  font: inherit;
  cursor: pointer;
}
[data-dsh-mcp-panel] .dmcp-failure-detail {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
[data-dsh-mcp-panel] .dmcp-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
[data-dsh-mcp-panel] .dmcp-heading {
  margin: 4px 0 0;
  font-size: 1em;
  color: var(--dsw-alias-label-primary);
}
[data-dsh-mcp-panel] .dmcp-summary {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-mcp-panel] .dmcp-summary-sub {
  color: var(--dsw-alias-label-tertiary);
  font-size: 0.9em;
}
[data-dsh-mcp-panel] .dmcp-card-hint {
  margin: 0;
  padding: 0 12px 10px 32px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 0.9em;
}
[data-dsh-mcp-panel] .dmcp-tool-count[data-empty='true'] {
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-mcp-panel] .dmcp-tool-count[data-stale='true'] {
  color: var(--dsw-alias-label-tertiary);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
  cursor: help;
}
[data-dsh-mcp-panel] .dmcp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
[data-dsh-mcp-panel] .dmcp-server-filter {
  flex: 1 1 180px;
  min-width: 0;
}
[data-dsh-mcp-panel] .dmcp-action {
  font: inherit;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 4px;
  padding: 4px 10px;
}
[data-dsh-mcp-panel] .dmcp-action:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
[data-dsh-mcp-panel] .dmcp-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
[data-dsh-mcp-panel] .dmcp-card {
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
[data-dsh-mcp-panel] .dmcp-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  font: inherit;
  text-align: left;
  background: none;
  border: 0;
  color: var(--dsw-alias-label-primary);
  padding: 10px 12px;
  cursor: pointer;
}
[data-dsh-mcp-panel] .dmcp-card-head:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
[data-dsh-mcp-panel] .dmcp-card-status {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--dsw-alias-label-tertiary);
}
[data-dsh-mcp-panel] .dmcp-card-status[data-tone='ok'] {
  background: var(--dsw-alias-state-success-primary);
}
[data-dsh-mcp-panel] .dmcp-card-status[data-tone='warn'] {
  background: var(--dsw-alias-state-warn-primary);
}
[data-dsh-mcp-panel] .dmcp-card-status[data-tone='error'] {
  background: var(--dsw-alias-state-error-primary);
}
[data-dsh-mcp-panel] .dmcp-card-ident {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}
[data-dsh-mcp-panel] .dmcp-card-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-mcp-panel] .dmcp-card-sub {
  color: var(--dsw-alias-label-tertiary);
  font-size: 0.85em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-mcp-panel] .dmcp-card-error {
  margin: 0;
  padding: 0 12px 10px 32px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 0.9em;
  overflow-wrap: anywhere;
}
[data-dsh-mcp-panel] .dmcp-hint {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 0.85em;
  overflow-wrap: anywhere;
}
[data-dsh-mcp-panel] .dmcp-primary {
  color: var(--dsw-alias-brand-primary);
  border-color: currentColor;
  font-weight: 600;
}
[data-dsh-mcp-panel] .dmcp-tool-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[data-dsh-mcp-panel] .dmcp-tool {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
}
[data-dsh-mcp-panel] .dmcp-tool[data-open='true'] {
  border-color: var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-2);
}
[data-dsh-mcp-panel] .dmcp-tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
[data-dsh-mcp-panel] .dmcp-tool-name {
  overflow-wrap: anywhere;
}
[data-dsh-mcp-panel] .dmcp-tool-try {
  flex-shrink: 0;
  padding: 1px 8px;
  font-size: 0.85em;
}
[data-dsh-mcp-panel] .dmcp-try {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}
[data-dsh-mcp-panel] .dmcp-subsection {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
[data-dsh-mcp-panel] .dmcp-subsection > summary {
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font-size: 0.9em;
}
[data-dsh-mcp-panel] .dmcp-resource-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
[data-dsh-mcp-panel] .dmcp-resource-entry {
  font: inherit;
  font-size: 0.85em;
  text-align: left;
  background: none;
  border: 0;
  padding: 2px 0;
  color: var(--dsw-alias-brand-primary);
  cursor: pointer;
  overflow-wrap: anywhere;
}
[data-dsh-mcp-panel] .dmcp-resource-entry:hover {
  text-decoration: underline;
}
[data-dsh-mcp-panel] .dmcp-tool-filter {
  font: inherit;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 4px;
  padding: 4px 8px;
}
[data-dsh-mcp-panel] .dmcp-probe-now {
  align-self: flex-start;
  font: inherit;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 4px;
  padding: 4px 10px;
}
[data-dsh-mcp-panel] .dmcp-probe-now:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
[data-dsh-mcp-panel] .dmcp-probe-now:disabled {
  opacity: 0.6;
  cursor: default;
}
[data-dsh-mcp-panel] .dmcp-card-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-mcp-panel] .dmcp-card-trailing {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
[data-dsh-mcp-panel] .dmcp-tool-count {
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
[data-dsh-mcp-panel] .dmcp-card-details {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
[data-dsh-mcp-panel] .dmcp-details {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
}
[data-dsh-mcp-panel] .dmcp-details dt {
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-mcp-panel] .dmcp-details dd {
  margin: 0;
  overflow-wrap: anywhere;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
}
[data-dsh-mcp-panel] .dmcp-error-text {
  color: var(--dsw-alias-state-error-primary);
}
[data-dsh-mcp-panel] .dmcp-target {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-mcp-panel] .dmcp-tools {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[data-dsh-mcp-panel] .dmcp-tools li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
[data-dsh-mcp-panel] .dmcp-tool-description {
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
[data-dsh-mcp-panel] .dmcp-derived-note,
[data-dsh-mcp-panel] .dmcp-patch-hint {
  color: var(--dsw-alias-label-secondary);
  margin: 0;
  overflow-wrap: anywhere;
}
[data-dsh-mcp-panel] .dmcp-probes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[data-dsh-mcp-panel] .dmcp-probe {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
[data-dsh-mcp-panel] .dmcp-probe-time {
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}
[data-dsh-mcp-panel] .dmcp-probe-detail {
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
  flex: 1 1 100%;
}
[data-dsh-mcp-panel] .dmcp-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.85em;
  white-space: nowrap;
  border: 1px solid currentColor;
}
[data-dsh-mcp-panel] .dmcp-badge[data-tone='ok'] {
  color: var(--dsw-alias-state-success-primary);
}
[data-dsh-mcp-panel] .dmcp-badge[data-tone='warn'] {
  color: var(--dsw-alias-state-warn-primary);
}
[data-dsh-mcp-panel] .dmcp-badge[data-tone='error'] {
  color: var(--dsw-alias-state-error-primary);
}
[data-dsh-mcp-panel] .dmcp-badge[data-tone='muted'] {
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-mcp-panel] .dmcp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
[data-dsh-mcp-panel] .dmcp-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 12px;
}
[data-dsh-mcp-panel] .dmcp-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
[data-dsh-mcp-panel] .dmcp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9em;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-mcp-panel] .dmcp-field input,
[data-dsh-mcp-panel] .dmcp-field select,
[data-dsh-mcp-panel] .dmcp-field textarea {
  font: inherit;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 4px;
  padding: 4px 8px;
}
[data-dsh-mcp-panel] .dmcp-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-mcp-panel] .dmcp-map {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}
[data-dsh-mcp-panel] .dmcp-map legend {
  font-size: 0.9em;
  color: var(--dsw-alias-label-secondary);
  padding: 0 4px;
}
[data-dsh-mcp-panel] .dmcp-map-row {
  display: flex;
  gap: 6px;
}
[data-dsh-mcp-panel] .dmcp-map-row input {
  font: inherit;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 4px;
  padding: 4px 8px;
  min-width: 0;
}
[data-dsh-mcp-panel] .dmcp-map-key {
  flex: 1 1 40%;
}
[data-dsh-mcp-panel] .dmcp-map-value {
  flex: 2 1 60%;
}
[data-dsh-mcp-panel] .dmcp-editor-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
[data-dsh-mcp-panel] .dmcp-action:disabled {
  opacity: 0.6;
  cursor: default;
}
[data-dsh-mcp-panel] .dmcp-danger {
  color: var(--dsw-alias-state-error-primary);
  border-color: currentColor;
}
[data-dsh-mcp-panel] .dmcp-confirm {
  color: var(--dsw-alias-state-warn-primary);
  border-color: currentColor;
}
[data-dsh-mcp-panel] .dmcp-patch {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
[data-dsh-mcp-panel] .dmcp-fragment {
  margin: 0;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--dsw-alias-font-mono, monospace);
  font-size: 0.85em;
}
[data-dsh-mcp-panel] .dmcp-notice {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
[data-dsh-mcp-panel] .dmcp-warn-text {
  color: var(--dsw-alias-state-warn-primary);
}
[data-dsh-mcp-panel] .dmcp-health {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
[data-dsh-mcp-panel] .dmcp-health-title {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-mcp-panel] .dmcp-health-list {
  list-style: disc;
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--dsw-alias-label-primary);
}
[data-dsh-mcp-panel] .dmcp-diag-code {
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-mcp-panel] .dmcp-remove {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 4px;
  padding: 8px;
}
[data-dsh-mcp-panel] .dmcp-trial {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding-top: 12px;
}
[data-dsh-mcp-panel] .dmcp-trial-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: flex-end;
}
[data-dsh-mcp-panel] .dmcp-trial-row .dmcp-field {
  flex: 1 1 180px;
  min-width: 0;
}
[data-dsh-mcp-panel] .dmcp-trial-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[data-dsh-mcp-panel] .dmcp-trial-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-mcp-panel] .dmcp-trial-call {
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-alias-font-mono, monospace);
  font-size: 0.85em;
}
[data-dsh-mcp-panel] .dmcp-trial-json {
  max-height: 320px;
}
[data-dsh-mcp-panel] .dmcp-capabilities {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[data-dsh-mcp-panel] .dmcp-capabilities-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[data-dsh-mcp-panel] .dmcp-capabilities-list li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
[data-dsh-mcp-panel] .dmcp-resources {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--dmcp-border, rgba(127, 127, 127, 0.25));
}
[data-dsh-mcp-panel] .dmcp-resources .dmcp-editor-actions {
  flex-wrap: wrap;
}
[data-dsh-mcp-panel] .dmcp-resource-uri {
  flex: 1 1 220px;
  min-width: 160px;
  padding: 4px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
}
/* --- density & hierarchy pass (overrides above) --- */
[data-dsh-mcp-panel].dmcp-page {
  gap: 10px;
  padding: 22px 28px 48px;
  font-size: 13px;
  line-height: 1.5;
}
[data-dsh-mcp-panel] .dmcp-page-title {
  font-size: 15px;
  letter-spacing: 0.01em;
}
[data-dsh-mcp-panel] .dmcp-rows {
  gap: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
[data-dsh-mcp-panel] .dmcp-row {
  border: 0;
  border-radius: 0;
  background: none;
}
[data-dsh-mcp-panel] .dmcp-row + .dmcp-row {
  border-top: 1px solid var(--dsw-alias-border-l2);
}
[data-dsh-mcp-panel] .dmcp-row:hover {
  background: var(--dsw-alias-bg-layer-2);
}
[data-dsh-mcp-panel] .dmcp-row-main {
  padding: 9px 12px;
  gap: 9px;
}
[data-dsh-mcp-panel] .dmcp-card-name {
  font-size: 13px;
}
[data-dsh-mcp-panel] .dmcp-card-sub {
  font-size: 11.5px;
}
[data-dsh-mcp-panel] .dmcp-summary {
  font-size: 12px;
}
[data-dsh-mcp-panel] .dmcp-action {
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 12px;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
[data-dsh-mcp-panel] .dmcp-action:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l3);
}
[data-dsh-mcp-panel] .dmcp-primary {
  border-color: var(--dsw-alias-brand-primary);
}
[data-dsh-mcp-panel] .dmcp-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
[data-dsh-mcp-panel] .dmcp-section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-mcp-panel] .dmcp-tool-name {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-mcp-panel] .dmcp-tool-description {
  font-size: 12px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
[data-dsh-mcp-panel] .dmcp-tool[data-open='true'] .dmcp-tool-description {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}
[data-dsh-mcp-panel] .dmcp-modal {
  border-radius: 12px;
}
[data-dsh-mcp-panel] .dmcp-modal-head {
  padding: 13px 20px;
}
[data-dsh-mcp-panel] .dmcp-modal-title {
  font-size: 14px;
}
[data-dsh-mcp-panel] .dmcp-modal-body {
  padding: 16px 20px 20px;
}
[data-dsh-mcp-panel] .dmcp-detail {
  gap: 12px;
}
`
