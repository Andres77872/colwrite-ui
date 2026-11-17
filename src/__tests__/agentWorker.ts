import type { SubagentData } from '@/api/schema';

/** One typed worker brief, as every live status and stored reply carries it. */
export function agentWorker(overrides: Partial<SubagentData> = {}): SubagentData {
  return {
    id: 'w1', status: 'completed', engine: 'gateway', profile: 'web_researcher',
    title: 'Routing evidence', objective: 'Find evidence about router stability in the available sources.',
    ...overrides,
  };
}
