import { describe, expect, it, vi } from 'vitest';
import { server } from '@/__tests__/server';
import { streamAgentSession } from '@/api/assistant/agentSessionChat';
import { listReviewComments, reviewRunsQuery } from '@/data/reviews';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { PERSONAL_WORKSPACE_ID, chatsOf, fixtures } from './fixtures';
import { assistantSocket, assistantTurn } from './socket';
import { seedReviewFixture } from './reviews';

describe('a durable review, live and read back', () => {
  it.each(['completed', 'failed', 'stopped'] as const)('keeps the %s summary and comments, never creating a chat', async (ending) => {
    const doc = seedReviewFixture();
    const original = structuredClone(doc);
    const controller = new AbortController();
    server.use(assistantSocket({
      stream: async function* (request, context) {
        for await (const event of assistantTurn(request, context)) {
          yield event;
          if (event.event === 'comment' && ending === 'failed') throw new Error('Simulated review failure');
        }
      },
    }));
    let comments = 0;
    const result = await streamAgentSession({
      workspace_id: PERSONAL_WORKSPACE_ID, document_id: doc._id, message: '',
      profile: 'review', review: 'peer_review', effort: 'standard',
    }, {
      onComments: (items) => {
        comments += items.length;
        if (ending === 'stopped') controller.abort('cancel');
      },
    }, { signal: controller.signal, abortBehavior: 'detach' });
    if (ending !== 'stopped') expect(result.terminal).toBe(ending === 'failed' ? 'error' : 'done');
    expect(comments).toBe(3);
    // These are new HTTP reads, not the live event or the socket's in-memory reply.
    const client = createTestQueryClient();
    await vi.waitFor(async () => {
      const page = await client.fetchInfiniteQuery({ ...reviewRunsQuery(doc.workspace_id, doc._id), staleTime: 0 });
      expect(page.pages[0]?.items[0]?.status).toBe(ending);
      expect(page.pages[0]?.items[0]?.session_id).toEqual(expect.any(String));
      expect(page.pages[0]?.items[0]?.counts.total).toBe(3);
    });
    const listed = await listReviewComments(doc.workspace_id, doc._id, null);
    expect(listed.items).toHaveLength(3);
    expect(chatsOf(doc._id)).toEqual([]);
    expect(fixtures.documents.get(doc._id)).toEqual(original);
    client.clear();
  });
});
