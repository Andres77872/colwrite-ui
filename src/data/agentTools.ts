import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type {
  AgentCapabilityOption as WireAgentCapabilityOption,
  AgentPaperSourceOption,
  AgentToolCategory as WireAgentToolCategory,
  AgentToolOption as WireAgentToolOption,
  AgentToolSettingsResponse,
  UpdateAgentToolSettingsRequest,
} from '@/api/schema';

/*
 * The catalog as the contract has it (`AgentToolSettingsResponse`), with its
 * lists present: the contract marks a list the server fills by default as
 * optional, so the reads below put an empty list where one is missing.
 */

export type AgentToolMode = NonNullable<WireAgentToolOption['modes']>[number];
export type AgentToolSourcePolicy = WireAgentToolOption['source_policy'];
export type AgentPaperSource = AgentPaperSourceOption;

export type AgentToolOption = Omit<WireAgentToolOption, 'modes' | 'requires_sources' | 'requires_tools'>
  & Required<Pick<WireAgentToolOption, 'modes' | 'requires_sources' | 'requires_tools'>>;

export type AgentToolCategory = Omit<WireAgentToolCategory, 'tools'> & { tools: AgentToolOption[] };

/** Guidance and runtime capabilities are enforced separately from tool access. */
export type AgentCapabilityOption = Omit<WireAgentCapabilityOption, 'modes' | 'requires_tools' | 'unavailable_reason'>
  & Required<Pick<WireAgentCapabilityOption, 'modes' | 'requires_tools'>>
  & { unavailable_reason: string | null };

export type AgentToolSettings = {
  version: AgentToolSettingsResponse['version'];
  sources: AgentPaperSource[];
  categories: AgentToolCategory[];
  skills: AgentCapabilityOption[];
  features: AgentCapabilityOption[];
};

export type AgentToolSettingsUpdate = UpdateAgentToolSettingsRequest;

function toolOption(tool: WireAgentToolOption): AgentToolOption {
  return { ...tool, modes: tool.modes ?? [], requires_sources: tool.requires_sources ?? [], requires_tools: tool.requires_tools ?? [] };
}

function capability(option: WireAgentCapabilityOption): AgentCapabilityOption {
  return {
    ...option,
    modes: option.modes ?? [],
    requires_tools: option.requires_tools ?? [],
    unavailable_reason: option.unavailable_reason ?? null,
  };
}

function toolSettings(response: AgentToolSettingsResponse): AgentToolSettings {
  return {
    version: response.version,
    sources: response.sources ?? [],
    categories: (response.categories ?? []).map((category) => ({ ...category, tools: (category.tools ?? []).map(toolOption) })),
    skills: (response.skills ?? []).map(capability),
    features: (response.features ?? []).map(capability),
  };
}

export async function getAgentToolSettings(init?: { signal?: AbortSignal }): Promise<AgentToolSettings> {
  return toolSettings(await unwrap(api.GET('/users/me/agent-tools', { signal: init?.signal })));
}

export async function updateAgentToolSettings(
  changes: AgentToolSettingsUpdate,
): Promise<AgentToolSettings> {
  return toolSettings(await unwrap(api.PUT('/users/me/agent-tools', { body: changes })));
}

export const agentToolKeys = {
  settings: ['users', 'me', 'agent-tools'] as const,
};

/** Which sources, tools, skills and features the account's assistant may use. */
export function agentToolSettingsQuery() {
  return queryOptions({
    queryKey: agentToolKeys.settings,
    queryFn: ({ signal }) => getAgentToolSettings({ signal }),
  });
}

/**
 * Save the account's agent preferences. The answer is the new catalog, and it
 * supersedes a read still on its way, which could only restore the old one.
 */
export function useUpdateAgentToolSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: AgentToolSettingsUpdate) => updateAgentToolSettings(changes),
    onMutate: () => queryClient.cancelQueries({ queryKey: agentToolKeys.settings }),
    onSuccess: (settings) => queryClient.setQueryData(agentToolKeys.settings, settings),
  });
}
