import { describe, expect, it } from 'vitest';
import { http, pathOf, recordRequests, server } from '@/__tests__/server';
import { FIXTURE_DOCUMENT_ID, PERSONAL_WORKSPACE_ID, LAB_WORKSPACE_ID } from '@/dev/msw/fixtures';
import { proposePlan, savePlan } from '@/dev/msw/plans';
import { getChatPlan, updateChatPlan } from '../chatPlans';

function fixture() {
  const plan = proposePlan(PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID, 'chat-method');
  return {
    plan, location: { workspaceId: PERSONAL_WORKSPACE_ID, documentId: FIXTURE_DOCUMENT_ID, chatId: 'chat-method', planId: plan.plan_id },
  };
}

describe('the chat’s plans', () => {
  it('reads its actual ETag and sends that validator with an ordered edit', async () => {
    const { plan, location } = fixture();
    const sent = recordRequests();
    const read = await getChatPlan(location);
    expect(read.etag).toBe('"cwplan:1"');
    const sections = [...plan.sections].reverse().map(({ id, title, goal, sources }) => ({ id, title, goal, sources }));
    const updated = await updateChatPlan(location, read.etag, { sections });
    expect(updated.etag).toBe('"cwplan:2"');
    expect(updated.plan.sections.map((section) => section.id)).toEqual(['questions', 'evidence', 'mechanism']);
    expect(pathOf(sent[0])).toBe(`/api/workspaces/${location.workspaceId}/documents/${location.documentId}/chats/chat-method/plans/${plan.plan_id}`);
    expect(sent.at(-1)?.method).toBe('PATCH');
    expect(sent.at(-1)?.headers.get('If-Match')).toBe('"cwplan:1"');
    expect(sent.at(-1)?.headers.get('Idempotency-Key')).toBeNull();
  });

  it('reports a stale revision once rather than replaying the edit on a new validator', async () => {
    const { plan, location } = fixture();
    const read = await getChatPlan(location);
    savePlan({ ...plan, brief: 'Changed elsewhere.' });
    const sent = recordRequests();
    await expect(updateChatPlan(location, read.etag, { brief: 'My draft.' })).rejects.toMatchObject({
      status: 412, data: { code: 'stale_plan', expected_head: '"cwplan:1"', current_head: '"cwplan:2"' },
    });
    expect(sent).toHaveLength(1);
    expect((await getChatPlan(location)).plan.brief).toBe('Changed elsewhere.');
  });

  it('discards a proposed plan without changing page content or approving it', async () => {
    const { location } = fixture();
    const version = await getChatPlan(location);
    const discarded = await updateChatPlan(location, version.etag, { state: 'discarded' });
    expect(discarded.plan.state).toBe('discarded');
    expect(discarded.plan.sections.every((section) => section.state === 'pending')).toBe(true);
  });

  it('keeps a plan to its own chat and workspace', async () => {
    const { location } = fixture();
    await expect(getChatPlan({ ...location, chatId: 'chat-related' })).rejects.toMatchObject({ status: 404, data: { code: 'plan_not_found' } });
    await expect(getChatPlan({ ...location, workspaceId: LAB_WORKSPACE_ID })).rejects.toMatchObject({ status: 404 });
  });

  it('does not invent a validator when the server omitted its ETag', async () => {
    const { plan, location } = fixture();
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/plans/{plan_id}', ({ response }) => response(200).json(plan), { once: true }));
    await expect(getChatPlan(location)).rejects.toThrow('no revision validator');
  });
});
