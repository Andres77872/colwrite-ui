import { get, put } from './api';

export type AgentToolMode = 'assistant' | 'rewrite';
export type AgentToolSourcePolicy = 'all' | 'any';

export type AgentPaperSource = {
  id: string;
  label: string;
  description: string;
  default_enabled: boolean;
  enabled: boolean;
  available: boolean;
  effective_enabled: boolean;
};

export type AgentToolOption = {
  id: string;
  label: string;
  description: string;
  category: string;
  default_enabled: boolean;
  enabled: boolean;
  available: boolean;
  effective_enabled: boolean;
  modes: AgentToolMode[];
  requires_sources: string[];
  requires_tools?: string[];
  source_policy: AgentToolSourcePolicy;
};

export type AgentToolCategory = {
  id: string;
  label: string;
  description: string;
  tools: AgentToolOption[];
};

export type AgentToolSettings = {
  version: number;
  sources: AgentPaperSource[];
  categories: AgentToolCategory[];
  /** Older servers omit these catalogs; missing capabilities stay unavailable. */
  skills?: AgentCapabilityOption[];
  features?: AgentCapabilityOption[];
};

/** Guidance and runtime capabilities are enforced separately from tool access. */
export type AgentCapabilityOption = {
  id: string;
  label: string;
  description: string;
  default_enabled: boolean;
  enabled: boolean;
  available: boolean;
  effective_enabled: boolean;
  requires_tools: string[];
  modes: AgentToolMode[];
  unavailable_reason: string | null;
};

export type AgentToolSettingsUpdate = {
  sources?: Record<string, boolean>;
  tools?: Record<string, boolean>;
  skills?: Record<string, boolean>;
  features?: Record<string, boolean>;
};

export async function getAgentToolSettings(): Promise<AgentToolSettings> {
  return get<AgentToolSettings>('/users/me/agent-tools');
}

export async function updateAgentToolSettings(
  changes: AgentToolSettingsUpdate,
): Promise<AgentToolSettings> {
  return put<AgentToolSettings>('/users/me/agent-tools', changes);
}
