/** The MCP console page: a server list plus dialogs for detail, trial and CRUD. */

import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { presentMcpPanel, probeBadge, summarizePanel, type BadgeTone, type PresentedServerRow } from './present.ts'
import { ServerEditor } from './ServerEditor.tsx'
import { Modal } from './Modal.tsx'
import type {
  McpPanelSnapshot,
  McpProbeView,
  McpServerView,
  McpTrialResultWire,
  PatchPreview,
  PatchWriteResult,
  ProbeStarted,
  ReloadResult,
} from '../wire.ts'

/** Registration-side injected face: the console RPCs (RemoteResult already unwrapped). */
export interface McpPanelTabInjected {
  /** Read the current Host snapshot. */
  status: () => Promise<McpPanelSnapshot>
  /** Start a one-shot probe of one server (panel-only result). */
  probe: (serverName: string) => Promise<ProbeStarted>
  /** Render one CRUD operation as its patch fragment (no write). */
  previewPatch: (opJson: string) => Promise<PatchPreview>
  /** Approval-gated append of one CRUD operation to the profile patch layer. */
  writePatch: (opJson: string, confirmed: boolean) => Promise<PatchWriteResult>
  /** Trial-call one tool through the official pipeline. */
  callTool: (requestJson: string) => Promise<McpTrialResultWire>
  /** Restart one mcp-client row (dispose + start); no config is written. */
  reloadServer: (serverName: string) => Promise<ReloadResult>
}

/** Full component props assembled by the slot renderer (this is a `main` panel). */
export type McpPanelTabProps =
  PropsLocale<'settings.mcpPanel'>
  & InjectFace<McpPanelTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: McpPanelSnapshot }

/** One resources-browse outcome per server. */
type ResourceBrowseState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'done'; readonly result: McpTrialResultWire }

/** Inline trial state for one (server, tool) pair. */
interface TrialState {
  readonly args: string
  readonly running: boolean
  readonly result: McpTrialResultWire | null
  readonly error: string | null
}

/** Initial inline-trial state: an empty JSON object, ready to run. */
const EMPTY_TRIAL: TrialState = { args: '{}', running: false, result: null, error: null }

/** Stable per-(server, tool) key for the trial map. */
function trialKey(serverName: string, toolName: string): string {
  return `${serverName}\u0000${toolName}`
}

/** Message text of an arbitrary thrown value. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

/** Pretty-print one result JSON; unparseable (truncated) text renders raw. */
function prettyResultJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

/**
 * Read the `uri` entries out of a resource listing result. The shared tools
 * return MCP's own JSON, so this walks any nesting and collects objects that
 * carry a string `uri`; anything unexpected yields an empty list.
 */
function resourceEntries(result: McpTrialResultWire): readonly { uri: string; label: string }[] {
  const found: { uri: string; label: string }[] = []
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    const record = value as Record<string, unknown>
    const uri = record['uri']
    if (typeof uri === 'string') {
      const name = typeof record['name'] === 'string' ? record['name'] : ''
      found.push({ uri, label: name === '' ? uri : `${name} — ${uri}` })
      return
    }
    for (const nested of Object.values(record)) visit(nested, depth + 1)
  }
  try {
    visit(JSON.parse(result.resultJson) as unknown, 0)
  } catch {
    return []
  }
  return found
}

/** Localized label for one server badge code. */
function badgeLabel(badge: PresentedServerRow['badge'], t: McpPanelTabProps['t']): string {
  switch (badge) {
    case 'disabled': return t('statusDisabled')
    case 'failed': return t('statusFailed')
    case 'connecting': return t('statusConnecting')
    case 'connected': return t('statusConnected')
    case 'waiting': return t('statusWaiting')
    case 'exhausted': return t('statusExhausted')
    case 'disposed': return t('statusDisposed')
    default: return t('statusUnknown')
  }
}

/** Localized label for one probe badge code. */
function probeLabel(badge: ReturnType<typeof probeBadge>['badge'], t: McpPanelTabProps['t']): string {
  switch (badge) {
    case 'running': return t('probeRunning')
    case 'completed': return t('probeCompleted')
    case 'failed': return t('probeFailed')
    case 'killed': return t('probeKilled')
    case 'stopping': return t('probeStopping')
    default: return t('probeUnknown')
  }
}

/** Local wall-clock range for one probe row; component-layer formatting only. */
function formatProbeTime(view: McpProbeView): string {
  const format = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour12: false })
  const start = format(view.startedAt)
  return view.finishedAt === null ? start : `${start}–${format(view.finishedAt)}`
}

/** Servers whose newest settled probe in one snapshot says they are not answering. */
function unreachableServers(snapshot: McpPanelSnapshot): readonly string[] {
  const settled = new Map<string, McpProbeView['status']>()
  for (const probeView of snapshot.probes) {
    if (probeView.status === 'running' || settled.has(probeView.serverName)) continue
    settled.set(probeView.serverName, probeView.status)
  }
  return [...settled.entries()]
    .filter(([, probeStatus]) => probeStatus !== 'completed')
    .map(([serverName]) => serverName)
}

/** Localized text for one diagnostic code (fallback: the wire's English text). */
function diagnosticText(code: string, text: string, t: McpPanelTabProps['t']): string {
  const key = `diag_${code}` as const
  const candidate = (t as unknown as (key: string) => string)(key)
  return candidate === key ? text : candidate
}

/** Render the MCP management console page. */
export function McpPanelTab({ status, probe, previewPatch, writePatch, callTool, reloadServer, t }: McpPanelTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [reloadState, setReloadState] = useState<{ server: string; busy: boolean; error: string | null; note: string | null } | null>(null)
  /** Header refresh phase: idle, probing, or restarting the dead rows. */
  const [refreshPhase, setRefreshPhase] = useState<'idle' | 'probing' | 'restarting'>('idle')
  /** Auxiliary dialog: the probe log or the capabilities sheet. */
  const [dialog, setDialog] = useState<'probes' | 'about' | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [toolQueries, setToolQueries] = useState<Record<string, string>>({})
  /** Server whose detail dialog is open, by namespace. */
  const [selected, setSelected] = useState<string | null>(null)
  // CRUD editor state: null = closed; { view: null } = add mode.
  const [editor, setEditor] = useState<{ readonly entryId: string; readonly view: McpServerView['config'] } | { readonly entryId: ''; readonly view: null } | null>(null)
  // Armed removal (a disable-patch write) per server namespace.
  const [removeArm, setRemoveArm] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // Resources browser state: per-server URI input + last browse outcome.
  const [resourceUri, setResourceUri] = useState<Record<string, string>>({})
  const [resourceState, setResourceState] = useState<Record<string, ResourceBrowseState>>({})
  // Inline tool trial: argument text and last outcome per (server, tool).
  const [trials, setTrials] = useState<Record<string, TrialState>>({})
  // Which tool's trial box is open on each server dialog (one at a time).
  const [openTrial, setOpenTrial] = useState<Record<string, string>>({})

  const reload = (): void => {
    setRequest(value => value + 1)
  }

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => status()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      (error: unknown) => {
        if (current) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      },
    )
    return () => { current = false }
  }, [status, request])

  // Optional polling: the host suggests an interval through the snapshot
  // (0 = on demand only). Errors during polling keep the last good snapshot.
  const intervalMs = state.status === 'ready' ? state.snapshot.refreshIntervalMs : 0
  useEffect(() => {
    if (intervalMs <= 0) return undefined
    const tick = (): void => { if (!document.hidden) reload() }
    const timer = setInterval(tick, intervalMs)
    const onVisible = (): void => { if (!document.hidden) reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])

  const model = state.status === 'ready' ? presentMcpPanel(state.snapshot) : undefined
  const summary = model !== undefined ? summarizePanel(model.servers) : null
  /**
   * Newest settled probe per server — the only liveness fact the console has.
   * A tool count stays in the registry after a transport dies, so a row whose
   * latest probe says `unreachable` must not present that count as if it were
   * usable today.
   */
  /**
   * Resolved liveness per server: the newest settled manual probe wins, else
   * the passive probe the host records on the snapshot (`probeState`). A tool
   * count stays in the registry after a transport dies, so a row known to be
   * unreachable must not present that count as usable.
   */
  const probeByServer = new Map<string, McpProbeView>()
  for (const probeRow of model?.probes ?? []) {
    if (probeRow.view.status === 'running' || probeByServer.has(probeRow.view.serverName)) continue
    probeByServer.set(probeRow.view.serverName, probeRow.view)
  }
  const livenessByServer = new Map<string, 'reachable' | 'unreachable'>()
  for (const row of model?.servers ?? []) {
    const activeProbe = probeByServer.get(row.view.serverName)
    if (activeProbe !== undefined) {
      livenessByServer.set(row.view.serverName, activeProbe.status === 'completed' ? 'reachable' : 'unreachable')
      continue
    }
    if (row.view.probeState !== null) livenessByServer.set(row.view.serverName, row.view.probeState)
  }
  const unreachableCount = [...livenessByServer.values()].filter(state => state === 'unreachable').length
  const reachableCount = livenessByServer.size - unreachableCount
  // Two summary modes: once liveness is known, it is the headline and the
  // registry count is background; before that the registry count is all we have.
  const summaryText = summary === null ? ''
    : livenessByServer.size > 0
      ? t('summaryProbed')
        .replace('{total}', String(summary.total))
        .replace('{reachable}', String(reachableCount))
        .replace('{unreachable}', String(unreachableCount))
        .replace('{toolTotal}', String(summary.toolTotal))
      : t('summaryTools')
        .replace('{total}', String(summary.total))
        .replace('{withTools}', String(summary.withTools))
        .replace('{toolTotal}', String(summary.toolTotal))
        .replace('{withoutTools}', String(summary.withoutTools))
  const upstreamText = summary === null || (summary.connected === 0 && summary.errored === 0) ? null : t('summaryUpstream')
    .replace('{connected}', String(summary.connected))
    .replace('{errored}', String(summary.errored))
  const probeRunning = model !== undefined && model.probes.some(probeRow => probeRow.view.status === 'running')
  // While a probe runs, poll on a short fixed cadence so the probe row settles
  // even when refreshIntervalMs is 0.
  useEffect(() => {
    if (!probeRunning) return undefined
    const timer = setInterval(() => { if (!document.hidden) reload() }, 1500)
    return () => { clearInterval(timer) }
  }, [probeRunning])

  /** Browse one server's resources through the OFFICIAL shared tools. */
  const runResource = (serverName: string, toolName: string, argsJson: string): void => {
    setResourceState(current => ({ ...current, [serverName]: { kind: 'loading' } }))
    void Promise.resolve().then(() => callTool(JSON.stringify({ serverName, toolName, argsJson }))).then(
      (outcome) => { setResourceState(current => ({ ...current, [serverName]: { kind: 'done', result: outcome } })) },
      (failure: unknown) => {
        setResourceState(current => ({ ...current, [serverName]: { kind: 'error', message: messageOf(failure) } }))
      },
    )
  }

  /** Patch one (server, tool)'s trial state. */
  const patchTrial = (key: string, patch: Partial<TrialState>): void => {
    setTrials((current) => {
      const previous = current[key] ?? EMPTY_TRIAL
      return { ...current, [key]: { ...previous, ...patch } }
    })
  }

  /** Run one tool through the official pipeline, inline. */
  const runTrial = (serverName: string, toolName: string): void => {
    const key = trialKey(serverName, toolName)
    const argsText = (trials[key] ?? EMPTY_TRIAL).args
    const trimmed = argsText.trim() === '' ? '{}' : argsText
    try {
      JSON.parse(trimmed)
    } catch {
      patchTrial(key, { error: t('trialArgsInvalid'), result: null })
      return
    }
    patchTrial(key, { running: true, error: null, result: null })
    void Promise.resolve().then(() => callTool(JSON.stringify({ serverName, toolName, argsJson: trimmed }))).then(
      (outcome) => { patchTrial(key, { running: false, result: outcome }) },
      (failure: unknown) => { patchTrial(key, { running: false, error: messageOf(failure) }) },
    )
  }

  const retry = (): void => {
    setState({ status: 'loading' })
    reload()
  }

  /** Restart one row: dispose its fiber, start it again, then refresh twice. */
  const doReload = (serverName: string): void => {
    setReloadState({ server: serverName, busy: true, error: null, note: null })
    void Promise.resolve().then(() => reloadServer(serverName)).then(
      () => {
        setReloadState({ server: serverName, busy: false, error: null, note: t('reloadDone') })
        reload()
        // Tools re-register after the new handshake; one delayed refresh catches them.
        setTimeout(() => { reload() }, 1500)
      },
      (failure: unknown) => {
        setReloadState({
          server: serverName,
          busy: false,
          error: t('reloadFailed').replace('{message}', messageOf(failure)),
          note: null,
        })
      },
    )
  }

  /**
   * Refresh everything: re-read the snapshot, probe every enabled
   * streamable-http row (one HTTP handshake each, harmless), then restart the
   * rows the probe found dead — a restart is the only way the bridge drops the
   * tools a dead transport left registered. stdio rows stay snapshot-only on
   * purpose: probing them would spawn their configured command.
   */
  const refreshAll = (): void => {
    setRefreshPhase('probing')
    setProbeError(null)
    reload()
    const targets = model === undefined ? [] : model.servers.filter(row =>
      row.view.transport === 'streamable-http' && row.view.enabled && row.view.entryId !== '')
    void Promise.allSettled(targets.map(row => Promise.resolve().then(() => probe(row.view.serverName))))
      .then(async (results) => {
        const rejected = results.find(result => result.status === 'rejected')
        if (rejected !== undefined && rejected.status === 'rejected') setProbeError(messageOf(rejected.reason))
        // Read the settled probes back: the probe call itself only returns a job id.
        let snapshot: McpPanelSnapshot | null = null
        try {
          snapshot = await status()
        } catch (failure: unknown) {
          setProbeError(messageOf(failure))
        }
        if (snapshot !== null) setState({ status: 'ready', snapshot })
        const dead = snapshot === null ? [] : unreachableServers(snapshot)
        if (dead.length === 0) {
          setRefreshPhase('idle')
          reload()
          return
        }
        setRefreshPhase('restarting')
        for (const serverName of dead) {
          try {
            await reloadServer(serverName)
          } catch (failure: unknown) {
            setProbeError(messageOf(failure))
          }
        }
        setRefreshPhase('idle')
        reload()
      })
  }

  const trialEnabled = state.status === 'ready' ? state.snapshot.trial.enabled : false
  const selectedRow = selected === null || model === undefined
    ? undefined
    : model.servers.find(row => row.view.serverName === selected)
  const selectedBrowse = selected === null ? undefined : resourceState[selected]

  /** Detail dialog body for one server row. */
  const detailBody = (row: PresentedServerRow): ReactNode => {
    const serverName = row.view.serverName
    const toolQuery = toolQueries[serverName] ?? ''
    const openTool = openTrial[serverName]
    const rowProbeRunning = model !== undefined && model.probes.some(
      probeRow => probeRow.view.status === 'running' && probeRow.view.serverName === serverName,
    )
    /** Latest liveness fact for this server (manual probe or passive probe). */
    const stale = livenessByServer.get(serverName) === 'unreachable'
    const visibleTools = row.view.tools.filter(tool => toolQuery.trim() === ''
      || tool.name.toLocaleLowerCase().includes(toolQuery.trim().toLocaleLowerCase())
      || tool.description.toLocaleLowerCase().includes(toolQuery.trim().toLocaleLowerCase()))
    return (
      <div className="dmcp-detail">
        <p className="dmcp-detail-target">
          <span className="dmcp-chip">{row.view.transport === 'unknown' ? '—' : row.view.transport}</span>
          <code>{row.view.target}</code>
          {stale ? <Badge tone="error" label={t('probeUnreachable')} /> : null}
        </p>
        {row.view.diagnostics.length > 0 ? (
          <div className="dmcp-health">
            <p className="dmcp-health-title">{t('healthSuggestions')}</p>
            <ul className="dmcp-health-list">
              {row.view.diagnostics.map(diagnostic => (
                <li key={diagnostic.code}>{diagnosticText(diagnostic.code, diagnostic.text, t)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="dmcp-section">
          <h4 className="dmcp-section-title">
            {t('tools')} · {row.view.tools.length}
            {stale ? <span className="dmcp-warn-text"> （{t('staleTools').replace('{n}', String(row.view.tools.length))}）</span> : null}
          </h4>
          {row.view.tools.length === 0 ? <p className="dmcp-status">{t('noTools')}</p> : (
            <>
              {row.view.tools.length > 6 ? (
                <input
                  type="search"
                  className="dmcp-tool-filter"
                  value={toolQuery}
                  placeholder={t('filterTools')}
                  aria-label={t('filterTools')}
                  onChange={(event) => {
                    setToolQueries(current => ({ ...current, [serverName]: event.currentTarget.value }))
                  }}
                />
              ) : null}
              <ul className="dmcp-tools">
                {visibleTools.map((tool) => {
                  const key = trialKey(serverName, tool.name)
                  const trialState = trials[key] ?? EMPTY_TRIAL
                  const isOpen = openTool === tool.name
                  return (
                    <li key={tool.name} className="dmcp-tool" data-open={isOpen ? 'true' : undefined}>
                      <div className="dmcp-tool-row">
                        <code className="dmcp-tool-name">{tool.name}</code>
                        {trialEnabled ? (
                          <button
                            type="button"
                            className="dmcp-action dmcp-tool-try"
                            disabled={stale}
                            title={stale ? t('staleTools').replace('{n}', String(row.view.tools.length)) : undefined}
                            onClick={() => {
                              setOpenTrial(current => ({ ...current, [serverName]: isOpen ? '' : tool.name }))
                            }}
                          >
                            {isOpen ? t('tryClose') : t('tryTool')}
                          </button>
                        ) : null}
                      </div>
                      {tool.description !== '' ? <span className="dmcp-tool-description" title={tool.description}>{tool.description}</span> : null}
                      {isOpen ? (
                        <div className="dmcp-try">
                          <label className="dmcp-field">
                            <span>{t('trialArgs')}</span>
                            <textarea
                              rows={4}
                              spellCheck={false}
                              value={trialState.args}
                              onChange={(event) => { patchTrial(key, { args: event.currentTarget.value }) }}
                            />
                          </label>
                          <div className="dmcp-editor-actions">
                            <button
                              type="button"
                              className="dmcp-action dmcp-primary"
                              disabled={trialState.running}
                              onClick={() => { runTrial(serverName, tool.name) }}
                            >
                              {trialState.running ? t('trialRunning') : t('trialRun')}
                            </button>
                          </div>
                          {trialState.error !== null ? <p className="dmcp-error-text" role="alert">{trialState.error}</p> : null}
                          {trialState.result !== null ? (
                            <div className="dmcp-trial-result">
                              <p className="dmcp-trial-meta">
                                <Badge tone={trialState.result.isError ? 'error' : 'ok'} label={trialState.result.isError ? 'error' : 'ok'} />
                                <span>{t('trialDuration').replace('{ms}', String(trialState.result.durationMs))}</span>
                                {trialState.result.truncated ? <span className="dmcp-warn-text">{t('trialTruncated')}</span> : null}
                              </p>
                              <pre className="dmcp-fragment dmcp-trial-json">{prettyResultJson(trialState.result.resultJson)}</pre>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <p className="dmcp-hint">{t('trialHint')}</p>
        </section>

        {model !== undefined && model.capabilities.resources.available && row.view.entryId !== '' ? (
          <details className="dmcp-subsection">
            <summary>{t('resources')}</summary>
            <div className="dmcp-resources">
              <div className="dmcp-editor-actions">
                <button type="button" className="dmcp-action" onClick={() => { runResource(serverName, 'list_mcp_resources', '{}') }}>
                  {t('resourceList')}
                </button>
                <button type="button" className="dmcp-action" onClick={() => { runResource(serverName, 'list_mcp_resource_templates', '{}') }}>
                  {t('resourceTemplates')}
                </button>
              </div>
              <div className="dmcp-editor-actions">
                <input
                  type="text"
                  className="dmcp-resource-uri"
                  value={resourceUri[serverName] ?? ''}
                  placeholder={t('resourceUri')}
                  aria-label={t('resourceUri')}
                  onChange={(event) => {
                    setResourceUri(current => ({ ...current, [serverName]: event.currentTarget.value }))
                  }}
                />
                <button
                  type="button"
                  className="dmcp-action"
                  disabled={(resourceUri[serverName] ?? '').trim() === ''}
                  onClick={() => {
                    runResource(serverName, 'read_mcp_resource', JSON.stringify({ uri: (resourceUri[serverName] ?? '').trim() }))
                  }}
                >
                  {t('resourceRead')}
                </button>
              </div>
              {selectedBrowse?.kind === 'loading' ? <p className="dmcp-status">{t('loading')}</p> : null}
              {selectedBrowse?.kind === 'error' ? <p className="dmcp-error-text" role="alert">{selectedBrowse.message}</p> : null}
              {selectedBrowse?.kind === 'done' ? (
                <>
                  {resourceEntries(selectedBrowse.result).length > 0 ? (
                    <ul className="dmcp-resource-list">
                      {resourceEntries(selectedBrowse.result).map(entry => (
                        <li key={entry.uri}>
                          <button
                            type="button"
                            className="dmcp-resource-entry"
                            onClick={() => {
                              setResourceUri(current => ({ ...current, [serverName]: entry.uri }))
                              runResource(serverName, 'read_mcp_resource', JSON.stringify({ uri: entry.uri }))
                            }}
                          >
                            {entry.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="dmcp-status">{t('resourceEmpty')}</p>}
                  <pre className="dmcp-fragment dmcp-trial-json">{prettyResultJson(selectedBrowse.result.resultJson)}</pre>
                </>
              ) : null}
              <p className="dmcp-hint">{t('resourceHint')}</p>
            </div>
          </details>
        ) : null}

        <details className="dmcp-subsection">
          <summary>{t('advanced')}</summary>
          <dl className="dmcp-details">
            <div><dt>{t('status')}</dt><dd>{badgeLabel(row.badge, t)}</dd></div>
            {row.hasAttemptBudget ? (
              <div>
                <dt>{t('attempt')}</dt>
                <dd>{row.view.attempt < 0 ? t('none') : row.view.attempt}/{row.view.maxAttempts < 0 ? t('none') : row.view.maxAttempts}</dd>
              </div>
            ) : null}
            <div><dt>{t('reconnects')}</dt><dd>{row.reconnects ?? t('none')}</dd></div>
            <div><dt>{t('fiber')}</dt><dd>{row.view.fiberPhase ?? t('none')}</dd></div>
            {row.view.configuredNote !== null ? <div><dt>{t('configured')}</dt><dd>{row.view.configuredNote}</dd></div> : null}
            {row.ageSeconds !== null ? <div><dt>{t('lastEvent')}</dt><dd>{row.ageSeconds}s</dd></div> : null}
            {row.view.delayMs !== null ? <div><dt>{t('retryIn')}</dt><dd>{row.view.delayMs} {t('ms')}</dd></div> : null}
            {row.view.exitCode !== null ? <div><dt>{t('exitCode')}</dt><dd>{row.view.exitCode}</dd></div> : null}
            {row.view.stderrTail !== null ? <div><dt>{t('stderrTail')}</dt><dd>{row.view.stderrTail}</dd></div> : null}
          </dl>
          {row.view.exitCode === null && row.view.stderrTail === null ? <p className="dmcp-hint">{t('healthPending')}</p> : null}
        </details>

        {removeArm === serverName && row.view.entryId !== '' ? (
          <div className="dmcp-remove">
            <p className="dmcp-status">{t('removeConfirm')}</p>
            {removeError !== null ? <p className="dmcp-error-text" role="alert">{removeError}</p> : null}
            <div className="dmcp-editor-actions">
              <button
                type="button"
                className="dmcp-action dmcp-danger"
                onClick={() => {
                  setRemoveError(null)
                  void Promise.resolve().then(() => writePatch(
                    JSON.stringify({ kind: 'disable', entryId: row.view.entryId, serverName }),
                    true,
                  )).then(
                    () => { setRemoveArm(null); reload() },
                    (error: unknown) => { setRemoveError(messageOf(error)) },
                  )
                }}
              >
                {t('confirmWrite')}
              </button>
              <button type="button" className="dmcp-action" onClick={() => { setRemoveArm(null) }}>{t('cancel')}</button>
            </div>
          </div>
        ) : null}

        <div className="dmcp-editor-actions">
          {row.view.config !== null ? (
            <button
              type="button"
              className="dmcp-action"
              onClick={() => {
                setSelected(null)
                setEditor({ entryId: row.view.entryId, view: row.view.config })
              }}
            >
              {t('editServer')}
            </button>
          ) : null}
          {row.view.entryId !== '' ? (
            <button
              type="button"
              className="dmcp-action"
              disabled={reloadState?.server === serverName && reloadState.busy === true}
              onClick={() => { doReload(serverName) }}
            >
              {reloadState?.server === serverName && reloadState.busy === true ? t('reloading') : t('reloadServer')}
            </button>
          ) : null}
          <button
            type="button"
            className="dmcp-action"
            disabled={rowProbeRunning}
            onClick={() => {
              setProbeError(null)
              void Promise.resolve().then(() => probe(serverName)).then(
                () => { reload() },
                (error: unknown) => { setProbeError(messageOf(error)) },
              )
            }}
          >
            {rowProbeRunning ? t('probeRunning') : t('probeNow')}
          </button>
          {row.view.config !== null ? (
            <button
              type="button"
              className="dmcp-action dmcp-danger"
              onClick={() => { setRemoveArm(serverName); setRemoveError(null) }}
            >
              {t('removeServer')}
            </button>
          ) : null}
        </div>
        {reloadState?.server === serverName && reloadState.note !== null ? <p className="dmcp-notice">{reloadState.note}</p> : null}
        {reloadState?.server === serverName && reloadState.error !== null ? <p className="dmcp-error-text" role="alert">{reloadState.error}</p> : null}
        {probeError !== null ? <p className="dmcp-error-text" role="alert">{t('probeFailedAction')}: {probeError}</p> : null}
      </div>
    )
  }

  return (
    <div className="dmcp-page" data-dsh-mcp-panel="" aria-busy={state.status === 'loading'}>
      <header className="dmcp-page-head">
        <h2 className="dmcp-page-title">{t('servers')}</h2>
        <div className="dmcp-head-actions">
          <button type="button" className="dmcp-action" onClick={refreshAll} disabled={refreshPhase !== 'idle' || state.status !== 'ready'} title={t('refreshHint')}>
            {refreshPhase === 'restarting' ? t('reloading') : refreshPhase === 'probing' ? t('refreshing') : t('refresh')}
          </button>
          <button type="button" className="dmcp-action" onClick={() => { setDialog('probes') }}>
            {t('probes')}{model !== undefined && model.probes.length > 0 ? ` (${model.probes.length})` : ''}
          </button>
          <button type="button" className="dmcp-action" onClick={() => { setDialog('about') }}>
            {t('about')}
          </button>
          <button type="button" className="dmcp-action dmcp-primary" onClick={() => { setEditor({ entryId: '', view: null }) }}>
            {t('addServer')}
          </button>
        </div>
      </header>

      {state.status === 'loading' ? <p className="dmcp-status">{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className="dmcp-failure">
          <p role="alert">{t('error')}</p>
          <p className="dmcp-failure-detail">{state.message}</p>
          <button type="button" className="dmcp-action" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}

      {model !== undefined ? (
        <>
          <p className="dmcp-summary">
            {summaryText}
            {upstreamText !== null ? <span className="dmcp-summary-sub">{upstreamText}</span> : null}
          </p>

          {model.empty ? <p className="dmcp-status">{t('empty')}</p> : null}

          <ul className="dmcp-rows">
            {model.servers.map((row) => {
              // Newest settled probe for this row: the only liveness fact the
              // console can show (tools stay registered after a transport dies).
              const liveness = livenessByServer.get(row.view.serverName)
              return (
              <li key={row.view.serverName} className="dmcp-row" data-mcp-server={row.view.serverName}>
                <button
                  type="button"
                  className="dmcp-row-main"
                  onClick={() => { setSelected(row.view.serverName); setRemoveArm(null); setProbeError(null) }}
                >
                  <span className="dmcp-card-status" data-tone={row.tone} aria-hidden="true" />
                  <span className="dmcp-card-ident">
                    <span className="dmcp-card-name">{row.view.serverName}</span>
                    <span className="dmcp-card-sub">
                      {row.view.transport === 'unknown' ? '—' : row.view.transport}
                      {row.view.target === '' ? '' : ` · ${row.view.target}`}
                    </span>
                  </span>
                  <span className="dmcp-card-trailing">
                    {liveness === undefined ? (
                      <span className="dmcp-tool-count" data-empty={row.hasTools ? undefined : 'true'}>{row.view.toolCount} {t('tools')}</span>
                    ) : liveness === 'reachable' ? (
                      <>
                        <Badge tone="ok" label={t('probeReachable')} />
                        <span className="dmcp-tool-count">{row.view.toolCount} {t('tools')}</span>
                      </>
                    ) : (
                      // Unreachable: the registry count is stale, so the row
                      // reports liveness only; the count stays in the dialog.
                      <Badge tone="error" label={t('probeUnreachable')} />
                    )}
                    {row.badge === 'unknown' ? null : <Badge tone={row.tone} label={badgeLabel(row.badge, t)} />}
                  </span>
                </button>
                {liveness === undefined && !row.hasTools && row.view.enabled && row.view.entryId !== '' && row.view.lastError === null
                  ? <p className="dmcp-card-hint">{t('noToolsHint')}</p>
                  : null}
                {row.hasError ? <p className="dmcp-card-error" role="alert">{row.view.lastError}</p> : null}
              </li>
              )
            })}
          </ul>

          {!model.observed && !model.empty ? <p className="dmcp-hint">{t('derivedNote')}</p> : null}
        </>
      ) : null}

      {dialog === 'probes' && model !== undefined ? (
        <Modal title={t('probes')} closeLabel={t('cancel')} onClose={() => { setDialog(null) }} width={760}>
          {model.probes.length === 0 ? <p className="dmcp-status">{t('probeEmpty')}</p> : (
            <ul className="dmcp-probes">
              {model.probes.map((probeRow) => {
                const badge = probeBadge(probeRow.view.status)
                return (
                  <li key={probeRow.view.id} className="dmcp-probe" data-mcp-probe={probeRow.view.id}>
                    <Badge tone={badge.tone} label={probeLabel(badge.badge, t)} />
                    <code>{probeRow.view.serverName}</code>
                    <span className="dmcp-probe-time">{formatProbeTime(probeRow.view)}</span>
                    <span className="dmcp-probe-detail">{probeRow.view.detail ?? t('none')}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Modal>
      ) : null}

      {dialog === 'about' && model !== undefined ? (
        <Modal title={t('about')} closeLabel={t('cancel')} onClose={() => { setDialog(null) }} width={640}>
          <div className="dmcp-capabilities">
            <ul className="dmcp-capabilities-list">
              <li>
                <Badge tone={model.capabilities.resources.available ? 'ok' : 'muted'} label={t('capResources')} />
                {!model.capabilities.resources.available ? <span className="dmcp-tool-description">{t('capPending')}</span> : null}
              </li>
              <li>
                <Badge tone={model.capabilities.prompts.available ? 'ok' : 'muted'} label={t('capPrompts')} />
                {!model.capabilities.prompts.available ? <span className="dmcp-tool-description">{t('capPending')}</span> : null}
              </li>
            </ul>
            <p className="dmcp-hint">{t('derivedNote')}</p>
            <p className="dmcp-hint">{t('patchHint')}</p>
            {model.patchFile !== null ? <p className="dmcp-hint"><code>{model.patchFile}</code></p> : null}
          </div>
        </Modal>
      ) : null}

      {selectedRow !== undefined ? (
        <Modal
          title={selectedRow.view.serverName}
          closeLabel={t('cancel')}
          onClose={() => { setSelected(null) }}
          width={860}
        >
          {detailBody(selectedRow)}
        </Modal>
      ) : null}

      {editor !== null ? (
        <Modal
          title={editor.view === null ? t('editorTitleAdd') : t('editorTitleEdit').replace('{name}', editor.view.serverName)}
          closeLabel={t('cancel')}
          onClose={() => { setEditor(null); reload() }}
          width={720}
        >
          <ServerEditor
            t={t}
            view={editor.view}
            entryId={editor.entryId}
            writeEnabled={model?.writeEnabled ?? false}
            actions={{ previewPatch, writePatch }}
            onClose={() => { setEditor(null); reload() }}
            onWritten={() => { reload() }}
          />
        </Modal>
      ) : null}
    </div>
  )
}

/** One tone-colored badge chip. The label is visible text, so no `role="img"`
 * or `aria-label`: screen readers announce it exactly once. */
function Badge({ tone, label }: { readonly tone: BadgeTone; readonly label: string }): ReactNode {
  return (
    <span className="dmcp-badge" data-tone={tone} title={label}>
      <span className="dmcp-dot" aria-hidden="true" />
      {label}
    </span>
  )
}
