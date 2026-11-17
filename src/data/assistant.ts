import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type {
  AssistantCatalogResponse,
  AssistantPaperSource,
  AssistantSettingsResponse,
  AssistantSwitch,
  CatalogPreset,
  CatalogTool,
  CatalogToolset,
  ToolDisplay,
  UpdateAssistantSettingsRequest,
} from '@/api/schema';
import type { AgentEngineId } from './agentEngines';

/*
 * What the assistant can do, as the server says it: the account's four
 * capability switches (`GET`/`PUT /users/me/assistant`) and, in a workspace,
 * the catalog (`GET /workspaces/{w}/assistant/catalog?engine=`): the
 * profiles, the switches as they apply there, each toolset and tool with its
 * state and reason, each tool's display, the presets, the skills, the
 * engines and the workspace's policy. The client renders from these and
 * holds no rule of its own (`ColWrite-api/docs/agent-capabilities.md`).
 */

export type AssistantCatalog = AssistantCatalogResponse;
export type AssistantSettings = AssistantSettingsResponse;
export type AssistantSettingsUpdate = UpdateAssistantSettingsRequest;
export type AssistantDefaults = AssistantSettings['defaults'];
export type PermissionGroup = keyof AssistantSettings['permissions'];
export type CapabilitySwitch = AssistantSwitch;
export type CapabilitySwitchId = AssistantSwitch['id'];
export type PaperSource = AssistantPaperSource;
export type PaperSourceId = AssistantPaperSource['id'];
export type CatalogToolRow = CatalogTool;
export type CatalogToolsetRow = CatalogToolset;
export type AssistantPreset = CatalogPreset;
/** How the feed names a tool: a catalog row's display fields, or a `tool_call_start`'s. */
export type ToolDisplayInfo = ToolDisplay;
/**
 * `on`; `off` by the account's own switch; `blocked` by the workspace's
 * policy or the caller's role; `unavailable` because the server or the
 * engine cannot. Every state but `on` comes with the server's reason.
 */
export type CapabilityState = CatalogTool['state'];

export async function getAssistantSettings(init?: { signal?: AbortSignal }): Promise<AssistantSettings> {
  return unwrap(api.GET('/users/me/assistant', { signal: init?.signal }));
}

/** Change some switches or sources; the others keep their values. */
export async function updateAssistantSettings(changes: AssistantSettingsUpdate, signal?: AbortSignal): Promise<AssistantSettings> {
  return unwrap(api.PUT('/users/me/assistant', { body: changes, signal }));
}

/** What the assistant can do for this account in the workspace, on `engine`. */
export async function getAssistantCatalog(
  workspaceId: string,
  engine: AgentEngineId,
  init?: { signal?: AbortSignal },
): Promise<AssistantCatalog> {
  return unwrap(api.GET('/workspaces/{workspace_id}/assistant/catalog', {
    params: { path: { workspace_id: workspaceId }, query: { engine } },
    signal: init?.signal,
  }));
}

export const assistantKeys = {
  settings: ['users', 'me', 'assistant'] as const,
  catalogs: (workspaceId: string) => ['ws', workspaceId, 'assistant', 'catalog'] as const,
  catalog: (workspaceId: string, engine: AgentEngineId) => [...assistantKeys.catalogs(workspaceId), engine] as const,
};

/** The account's switches, outside any workspace (nothing is `blocked` there). */
export function assistantSettingsQuery() {
  return queryOptions({
    queryKey: assistantKeys.settings,
    queryFn: ({ signal }) => getAssistantSettings({ signal }),
    refetchOnWindowFocus: true,
  });
}

/** The assistant's catalog in a workspace, for the engine a run would use. */
export function agentCatalogQuery(workspaceId: string, engine: AgentEngineId) {
  return queryOptions({
    queryKey: assistantKeys.catalog(workspaceId, engine),
    queryFn: ({ signal }) => getAssistantCatalog(workspaceId, engine, { signal }),
    refetchOnWindowFocus: true,
  });
}

/** Read every catalog of the account again: a switch, the policy or the role changed. */
export function invalidateAssistantCatalogs(queryClient: QueryClient, workspaceId?: string): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === 'ws' && queryKey[2] === 'assistant' && queryKey[3] === 'catalog'
      && (workspaceId === undefined || queryKey[1] === workspaceId),
  });
}

/**
 * Save a change to the account's switches. The answer is the new state, and
 * it supersedes a read still on its way; every catalog is read again, since
 * what a run gets follows from the switches.
 */
const SETTINGS_WRITE = 'assistant-settings';

export function useUpdateAssistantSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: SETTINGS_WRITE },
    mutationFn: (changes: AssistantSettingsUpdate) => {
      const { signal } = settingsLifetime(queryClient);
      signal.throwIfAborted();
      return updateAssistantSettings(changes, signal);
    },
    onMutate: () => queryClient.cancelQueries({ queryKey: assistantKeys.settings }),
    onSuccess: (settings) => {
      queryClient.setQueryData(assistantKeys.settings, settings);
      void invalidateAssistantCatalogs(queryClient);
    },
  });
}

// The query client belongs to the signed-in account. Once it ends, a save
// queued on it must never send with the next account's cookies.
const settingsLifetimes = new WeakMap<QueryClient, AbortController>();
function settingsLifetime(client: QueryClient): AbortController {
  let lifetime = settingsLifetimes.get(client);
  if (!lifetime) {
    lifetime = new AbortController();
    settingsLifetimes.set(client, lifetime);
  }
  return lifetime;
}

export function stopAssistantSettingsWrites(client: QueryClient) {
  settingsLifetime(client).abort();
}

export function flushAssistantSettingsWrites(client: QueryClient): Promise<void> {
  const mutations = client.getMutationCache();
  const { signal } = settingsLifetime(client);
  return new Promise((resolve) => {
    const check = () => {
      if (!signal.aborted && mutations.getAll().some((write) =>
        write.options.scope?.id === SETTINGS_WRITE && write.state.status === 'pending')) return;
      signal.removeEventListener('abort', check);
      unsubscribe();
      resolve();
    };
    const unsubscribe = mutations.subscribe(check);
    signal.addEventListener('abort', check, { once: true });
    check();
  });
}

/**
 * A detail line for a call: the first template whose `{placeholders}` all
 * have a value in the call's `arguments`, filled in, or `undefined`. The
 * templates name only what a closed set bounds (an enum, a number, a
 * boolean, a list's `_count`, a web host; TD34), so nothing here is free
 * text the events withhold. An enum's value is written in the words the
 * display's `value_labels` give it ("cited by" for `citations`), and as
 * sent where it gives none.
 */
export function fillDetailTemplate(
  templates: readonly string[],
  args: Record<string, unknown> | undefined,
  valueLabels: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): string | undefined {
  if (!args) return undefined;
  const valueOf = (name: string): string | null => {
    const value = args[name];
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
    if (typeof value === 'boolean') return String(value);
    if (typeof value !== 'string' || value === '') return null;
    const words = valueLabels[name];
    return words && Object.hasOwn(words, value) ? (words[value] ?? value) : value;
  };
  for (const template of templates) {
    const names = [...template.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? '');
    if (names.some((name) => valueOf(name) === null)) continue;
    return template.replace(/\{([^{}]*)\}/g, (_whole, name: string) => valueOf(name) ?? '');
  }
  return undefined;
}
