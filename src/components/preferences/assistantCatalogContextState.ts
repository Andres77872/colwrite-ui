import { createContext, useContext } from 'react';
import type {
  AssistantCatalog,
  AssistantPreset,
  CapabilitySwitch,
  CapabilitySwitchId,
  CatalogToolRow,
  CatalogToolsetRow,
  PaperSource,
  PaperSourceId,
} from '@/data/assistant';

/**
 * What the assistant can do here, as the workspace's catalog says it: the
 * account's switches as they apply in this workspace, each toolset and tool
 * with its state and the server's reason, each tool's display, the presets
 * and the workspace's policy. Every check fails closed until the catalog is
 * read. Nothing here decides: a state and a reason come from the server.
 */
export type AssistantCatalogValue = {
  catalog: AssistantCatalog | null;
  loading: boolean;
  error: string | null;
  /** A tool's catalog row; `undefined` for one this catalog does not list. */
  tool: (id: string) => CatalogToolRow | undefined;
  toolset: (id: string) => CatalogToolsetRow | undefined;
  /** One of the account's switches, as it applies in this workspace. */
  capabilitySwitch: (id: CapabilitySwitchId) => CapabilitySwitch | undefined;
  /** A paper source under Papers, as it applies in this workspace. */
  paperSource: (id: PaperSourceId) => PaperSource | undefined;
  /** Whether a paper source may be used here; `false` until the catalog is read. */
  paperSourceOn: (id: PaperSourceId) => boolean;
  /**
   * Whether paper search runs here (the paper routes, the Research panel,
   * the citation picker), as the catalog's Papers toolset says: on, or the
   * server's reason why not (the policy, the switch, its sources, the server).
   */
  papers: { on: boolean; reason: string | null };
  /** The server's presets, in its order. */
  presets: readonly AssistantPreset[];
  preset: (id: string) => AssistantPreset | undefined;
  /** The effort tiers, with what a run of each may spend (`quick`, `standard`, `deep`). The composer offers them in P3. */
  efforts: AssistantCatalog['efforts'];
  /** The tiers a surface's runs may name, and the one they run at when they name none (`chat`: standard; `inline`: quick). */
  profileEfforts: (profile: AssistantCatalog['profiles'][number]['id']) => { efforts: AssistantCatalog['efforts']; defaultEffort: AssistantCatalog['profiles'][number]['default_effort'] } | undefined;
};

export const AssistantCatalogContext = createContext<AssistantCatalogValue | undefined>(undefined);

export function useAssistantCatalog(): AssistantCatalogValue {
  const context = useContext(AssistantCatalogContext);
  if (!context) throw new Error('useAssistantCatalog must be used within AssistantCatalogProvider');
  return context;
}

/** The value for no catalog at all (a surface outside the workspace): everything closed. */
export const NO_CATALOG: AssistantCatalogValue = {
  catalog: null,
  loading: false,
  error: null,
  tool: () => undefined,
  toolset: () => undefined,
  capabilitySwitch: () => undefined,
  paperSource: () => undefined,
  paperSourceOn: () => false,
  papers: { on: false, reason: null },
  presets: [],
  preset: () => undefined,
  efforts: [],
  profileEfforts: () => undefined,
};

/** The catalog's value from one read of it. */
export function catalogValue(catalog: AssistantCatalog | null, loading: boolean, error: string | null): AssistantCatalogValue {
  if (!catalog) return { ...NO_CATALOG, loading, error };
  const tools = new Map(catalog.tools.map((row) => [row.id, row]));
  const toolsets = new Map(catalog.toolsets.map((row) => [row.id, row]));
  const switches = new Map(catalog.switches.map((row) => [row.id, row]));
  const sources = new Map(catalog.switches.flatMap((row) => row.sources).map((row) => [row.id, row]));
  const presets = new Map(catalog.presets.map((row) => [row.id, row]));
  const papersToolset = toolsets.get('papers');
  const papersOn = papersToolset?.state === 'on';
  const papersReason = papersOn ? null : papersToolset?.reason ?? switches.get('papers')?.reason ?? null;
  return {
    catalog,
    loading,
    error,
    tool: (id) => tools.get(id),
    toolset: (id) => toolsets.get(id),
    capabilitySwitch: (id) => switches.get(id),
    paperSource: (id) => sources.get(id),
    paperSourceOn: (id) => sources.get(id)?.state === 'on',
    papers: { on: papersOn, reason: papersReason },
    presets: catalog.presets,
    preset: (id) => presets.get(id),
    efforts: catalog.efforts,
    profileEfforts: (id) => {
      const profile = catalog.profiles.find((row) => row.id === id);
      return profile && {
        efforts: catalog.efforts.filter((effort) => profile.efforts.includes(effort.id)),
        defaultEffort: profile.default_effort,
      };
    },
  };
}
