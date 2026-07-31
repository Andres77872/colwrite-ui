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
};

export type AgentToolSettingsUpdate = {
  sources?: Record<string, boolean>;
  tools?: Record<string, boolean>;
};

export async function getAgentToolSettings(): Promise<AgentToolSettings> {
  return get<AgentToolSettings>('/users/me/agent-tools');
}

export async function updateAgentToolSettings(
  changes: AgentToolSettingsUpdate,
): Promise<AgentToolSettings> {
  return put<AgentToolSettings>('/users/me/agent-tools', changes);
}
