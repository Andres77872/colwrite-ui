import type { AgentDone, AgentUsage } from '@/api/assistant/streamParser';

/** A turn's `done` as the handlers get it: its ids, its usage, and no models, cost, ledger or failed writes unless given. */
export function agentDone(
  chatId: string | null,
  messageId: number | null,
  usage: Partial<AgentUsage> = {},
  extra: Partial<Pick<AgentDone, 'models' | 'cost' | 'budget' | 'persistence'>> = {},
): AgentDone {
  return {
    chatId,
    messageId,
    usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, ...usage },
    models: [],
    cost: null,
    budget: null,
    persistence: null,
    ...extra,
  };
}
