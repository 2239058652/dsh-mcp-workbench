/**
 * `dsh-mcp-panel`, browser half: mounts the `mcpPanel` Remote contribution,
 * then registers the MCP console as a first-class left-sidebar panel — one
 * `sidebar.panellist` row whose id addresses the `main` panel key of the
 * same name. All data arrives through the `remote.mcpPanel` namespace — the
 * page issues no other RPC and holds no state of its own beyond expansion,
 * the editor/trial forms, and the last loaded snapshot. The current session
 * id (for approval routing) is read from the sessions store at call time.
 *
 * @module dsh-mcp-panel/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the api-remotes client declares the 'remote' service on the
// client Context (the shell graph owns the runtime value; this package reads
// the merged contract).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { McpPanelTab, type McpPanelTabInjected } from './McpPanelTab.tsx'
import { McpPanelIcon } from './McpPanelIcon.tsx'
// The harness locale registry accepts only the 'en' | 'zh' UI language codes
// today (its LocaleDictOf face), so the tab ships those two dictionaries and
// follows the app's UI language. The `/mcp` command language is a separate
// plugin config (`outputLanguage`) with its own five-language dictionaries.
import { en, zh, type McpPanelLocaleKey } from './locales.ts'
import { MCP_PANEL_REMOTE } from './remote.ts'
import { installPanelStyles } from './styles.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  McpPanelSnapshot,
  McpTrialResultWire,
  PatchPreview,
  PatchWriteResult,
  ProbeStarted,
  ReloadResult,
} from '../wire.ts'

export type { McpPanelTabInjected, McpPanelTabProps } from './McpPanelTab.tsx'
export type { McpPanelLocaleKey } from './locales.ts'
export { presentMcpPanel, connectionBadge, probeBadge } from './present.ts'
export type { PresentedMcpPanel, PresentedProbeRow, PresentedServerRow, BadgeTone } from './present.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP management console copy. */
    'settings.mcpPanel': McpPanelLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.mcpPanel'

/** Plugin name: matches the package name, the graph row id, and the bundle id. */
export const name = 'dsh-mcp-panel'

/** Services the console reads; `remote.mcpPanel` appears once this plugin mounts its contribution. */
export const inject = ['slots', 'locale', 'remote', 'sessions']

/**
 * Minimal structural contract of the client slots registry this console tab
 * registers into. Declared locally because the service's owner package moved
 * across harness lines (rc.2's client runtime, then the UI renderer); the
 * runtime contract is structural, so only the two call sites this client uses
 * are named here.
 */
interface McpPanelSlots {
  inject(slot: string, callback: () => unknown): void
  register(options: { name: string; locale: string } & Record<string, unknown>, component: unknown): () => void
}

/** Main-panel key and the sidebar list id that addresses it (they must match). */
export const PANEL_ID = 'mcp'

/**
 * Browser plugin body: dictionaries, the scoped stylesheet, the Remote
 * contribution mount, the left-sidebar entry, and the `main` panel page.
 *
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-panel: dictionaries')
  ctx.effect(() => installPanelStyles(), 'dsh-mcp-panel: stylesheet')

  // $mount registers the 'remote.mcpPanel' namespace service and owns its
  // removal for this fiber's lifetime.
  await ctx.remote.$mount(MCP_PANEL_REMOTE)

  ctx.inject(['remote.mcpPanel'], (scope) => {
    // The slots service owner moved across harness lines (rc.2's client
    // runtime, then the UI renderer); read it through the local structural
    // contract so both lines compile against the same runtime shape.
    const slots = scope.get('slots') as unknown as McpPanelSlots
    const t = scope.locale.bind(NS)
    const unwrap = <T>(result: RemoteResult<T>, method: string): T => {
      if (!result.ok) {
        throw new Error(`mcpPanel.${method} failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    }
    const status: McpPanelTabInjected['status'] = async () =>
      unwrap<McpPanelSnapshot>(await scope.remote.mcpPanel.status(), 'status')
    const probe: McpPanelTabInjected['probe'] = async (serverName) =>
      unwrap<ProbeStarted>(await scope.remote.mcpPanel.probe(serverName), 'probe')
    const previewPatch: McpPanelTabInjected['previewPatch'] = async (opJson) =>
      unwrap<PatchPreview>(await scope.remote.mcpPanel.previewPatch(opJson), 'previewPatch')
    const writePatch: McpPanelTabInjected['writePatch'] = async (opJson, confirmed) =>
      unwrap<PatchWriteResult>(await scope.remote.mcpPanel.writePatch(opJson, confirmed, currentSessionId(scope.get('sessions'))), 'writePatch')
    const callTool: McpPanelTabInjected['callTool'] = async (requestJson) =>
      unwrap<McpTrialResultWire>(await scope.remote.mcpPanel.callTool(requestJson, currentSessionId(scope.get('sessions'))), 'callTool')
    const reloadServer: McpPanelTabInjected['reloadServer'] = async (serverName) =>
      unwrap<ReloadResult>(await scope.remote.mcpPanel.reload(serverName), 'reload')
    const injected = (): McpPanelTabInjected => ({ status, probe, previewPatch, writePatch, callTool, reloadServer })
    // Left-sidebar entry: the list id addresses the matching `main` panel key,
    // and the sidebar resolves the row label from this registration's metadata.
    slots.inject('sidebar.panellist', () => slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 20,
      label: () => t('tab'),
      locale: NS,
    }, McpPanelIcon))
    // The console page itself, opened by that sidebar entry.
    slots.inject('main', () => slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: injected,
    }, McpPanelTab))
  })
}

/**
 * Read the current session id from the sessions store face (structural: the
 * store shape differs across harness lines, so only the leaves are read).
 * `SessionListState.current` was removed on the 0.1.6 line, so the session the
 * main view retains is derived from the per-session retention facts (the
 * upstream `ui-session` pattern); a host that still publishes `current` wins,
 * so both lines agree.
 */
function currentSessionId(sessions: unknown): string | undefined {
  try {
    const list = (sessions as { list?: unknown } | null)?.list
    if (typeof list !== 'object' || list === null) return undefined
    const getSnapshot = (list as { getSnapshot?: unknown }).getSnapshot
    if (typeof getSnapshot !== 'function') return undefined
    const snapshot = (getSnapshot as () => {
      current?: unknown
      byId?: Record<string, { retainedBy?: { mainView?: number } } | undefined>
    })()
    const current = snapshot.current
    if (typeof current === 'string' && current !== '') return current
    const byId = snapshot.byId
    if (byId === null || typeof byId !== 'object') return undefined
    for (const [id, entry] of Object.entries(byId)) {
      if ((entry?.retainedBy?.mainView ?? 0) > 0) return id
    }
    return undefined
  } catch {
    return undefined
  }
}
