import type { AgentChatRequestOutput, AssistantRun, AssistantSession } from '@/api/schema';
import { PERSONAL_WORKSPACE_ID } from '@/dev/msw/fixtures';
import type { AssistantSnapshot } from '@/api/assistant/agentSessionChat';

const AT = '2026-11-14T10:00:00Z';

type RunFields = Pick<AssistantRun, 'id' | 'session_id' | 'status'>
  & Partial<Omit<AssistantRun, 'request'>>
  & { request: Pick<AgentChatRequestOutput, 'document_id'> & Partial<AgentChatRequestOutput> };

/**
 * A `sessions.get` reply as the contract types it, from the fields a test
 * cares about; the rest takes the server's defaults.
 */
export function assistantSnapshot({
  session,
  run,
}: {
  session: Pick<AssistantSession, 'id' | 'document_id'> & Partial<AssistantSession>;
  run: RunFields | null;
}): AssistantSnapshot {
  return {
    session: {
      workspace_id: PERSONAL_WORKSPACE_ID,
      chat_id: null,
      title: 'Chat',
      profile: 'chat',
      last_seq: 0,
      active_run_id: null,
      request_id: null,
      created_at: AT,
      updated_at: AT,
      ...session,
    },
    run: run && {
      workspace_id: PERSONAL_WORKSPACE_ID,
      request_id: 'request',
      created_at: AT,
      updated_at: AT,
      event_bytes: 0,
      event_count: 0,
      after_seq: 0,
      resumed_from: null,
      ...run,
      request: {
        message: '',
        chat_id: null,
        leaf_id: null,
        model: null,
        gateway_models: null,
        engine: 'gateway',
        profile: 'chat',
        review: null,
        preset: null,
        apply_mode: 'propose',
        context: null,
        effort: null,
        web: false,
        plan_id: null,
        plan: null,
        answers: null,
        ...run.request,
      },
    },
  };
}
