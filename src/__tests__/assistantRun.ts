import type { AssistantRunSummary } from '@/api/schema';
import { FIXTURE_DOCUMENT_ID } from '@/dev/msw/fixtures';

export function assistantRun(overrides: Partial<AssistantRunSummary> = {}): AssistantRunSummary {
  return {
    id: 'run-interrupted', session_id: 'session-1', chat_id: 'chat-method', document_id: FIXTURE_DOCUMENT_ID,
    request: { document_id: FIXTURE_DOCUMENT_ID, message: 'Original request', effort: 'deep', web: false,
      engine: 'gateway', profile: 'chat', apply_mode: 'propose' },
    leaf_id: 2, status: 'interrupted', profile: 'chat', effort: 'deep', engine: 'gateway', preset: null,
    cost: 0.012, limit_reached: null, error_code: null, duration_ms: 20_000, resumed_from: null, resumable: true,
    created_at: '2026-11-16T10:00:00Z', started_at: '2026-11-16T10:00:00Z', ended_at: '2026-11-16T10:00:20Z',
    ...overrides,
  };
}
