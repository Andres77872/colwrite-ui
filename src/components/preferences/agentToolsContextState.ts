import { createContext, useContext } from 'react';
import type {
  AgentToolSettings,
  AgentToolSettingsUpdate,
} from '@/data/agentTools';
import type { WorkspacePolicy } from '@/data/workspaces';

/** A switch of the workspace policy that can take a feature away (D7). */
export type PolicySwitch = keyof WorkspacePolicy;

export type AgentToolsContextValue = {
  /** The person's own settings, as Settings → AI & tools shows and saves them. */
  settings: AgentToolSettings | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<AgentToolSettings | null>;
  updateSettings: (changes: AgentToolSettingsUpdate) => Promise<AgentToolSettings>;
  /** Whether a source may be used here: the person's setting, then the workspace's policy. */
  isSourceEnabled: (sourceId: string) => boolean;
  /** Whether a tool may be used here: the person's setting, then the workspace's policy. */
  isToolEnabled: (toolId: string) => boolean;
  /** The workspace's policy, or `null` until it is read (every check fails closed meanwhile). */
  policy: WorkspacePolicy | null;
  /** The policy switch that takes a source or a tool away in this workspace, if one does. */
  switchedOffBy: (kind: 'source' | 'tool', id: string) => PolicySwitch | null;
};

export const AgentToolsContext = createContext<AgentToolsContextValue | undefined>(undefined);

export function useAgentTools(): AgentToolsContextValue {
  const context = useContext(AgentToolsContext);
  if (!context) throw new Error('useAgentTools must be used within AgentToolsProvider');
  return context;
}

/** The paper sources outside research covers (`outside_research`). */
export const OUTSIDE_RESEARCH_SOURCES: ReadonlySet<string> = new Set(['arxiv', 'semantic_scholar']);
/** The tools `web_search: false` removes (`ColWrite-api/src/workspaces/policy.py`). */
export const WEB_TOOLS: ReadonlySet<string> = new Set(['web_search', 'web_read']);
/** The tools `outside_research: false` removes. */
export const OUTSIDE_RESEARCH_TOOLS: ReadonlySet<string> = new Set([
  'search_citations',
  'semantic_scholar_search',
  'semantic_scholar_paper',
  'semantic_scholar_graph',
  'semantic_scholar_recommendations',
  'semantic_scholar_snippets',
  'validate_claim',
]);

/** Which switch of `policy` takes a source or a tool away, if one does. */
export function policySwitchFor(policy: WorkspacePolicy, kind: 'source' | 'tool', id: string): PolicySwitch | null {
  if (kind === 'source') return !policy.outside_research && OUTSIDE_RESEARCH_SOURCES.has(id) ? 'outside_research' : null;
  if (!policy.web_search && WEB_TOOLS.has(id)) return 'web_search';
  if (!policy.outside_research && OUTSIDE_RESEARCH_TOOLS.has(id)) return 'outside_research';
  return null;
}

/** What a switched-off feature is called, for "… is switched off in this workspace". */
export const POLICY_FEATURE: Record<PolicySwitch, string> = {
  web_search: 'Web search',
  outside_research: 'Outside research',
  auto: 'Auto',
};
