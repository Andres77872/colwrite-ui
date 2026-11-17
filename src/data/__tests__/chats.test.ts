import { describe, expect, it } from 'vitest';
import { pathOf, recordRequests } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { FIXTURE_DOCUMENT_ID, chatsOf, recordAnswer, recordQuestion } from '@/dev/msw/fixtures';
import { TurnRecord } from '@/dev/msw/turnRecord';
import { getChatSource, listChats, listMessages, renameChat } from '../chats';

const WS = TEST_WORKSPACE_ID;

describe('chats', () => {
  it('reads one recorded excerpt on demand from its own source and chat', async () => {
    const sent = recordRequests();
    const source = await getChatSource(WS, FIXTURE_DOCUMENT_ID, 'chat-related', 'S3', { passage: 'S3.1' });
    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${FIXTURE_DOCUMENT_ID}/chats/chat-related/sources/S3?passage=S3.1`);
    expect(source.source.handle).toBe('S3');
    expect(source.passages).toEqual([expect.objectContaining({
      id: 'S3.1', level: 'snippet', text: 'Mixture of Experts enable models to be pretrained with far less compute.',
    })]);
  });

  it('does not return a passage through another source or chat', async () => {
    await expect(getChatSource(WS, FIXTURE_DOCUMENT_ID, 'chat-related', 'S1', { passage: 'S3.1' }))
      .rejects.toMatchObject({ status: 404 });
    await expect(getChatSource(WS, FIXTURE_DOCUMENT_ID, 'chat-method', 'S3', { passage: 'S3.1' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('lists a page’s chats by cursor, each named by its id', async () => {
    const sent = recordRequests();
    const page = await listChats(WS, FIXTURE_DOCUMENT_ID, { limit: 1 });
    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${FIXTURE_DOCUMENT_ID}/chats?limit=1`);
    expect(page.items.map((chat) => chat.id)).toEqual(['chat-method']);
    expect(page.items[0]?.last_message_id).toBe(2);
    expect(page.next_cursor).toEqual(expect.any(String));
  });

  it('renames with PATCH', async () => {
    const sent = recordRequests();
    const chat = await renameChat(WS, FIXTURE_DOCUMENT_ID, 'chat-method', 'Method');
    expect(sent[0]?.method).toBe('PATCH');
    expect(chat.title).toBe('Method');
  });

  it('asks for a branch with leaf and reads leaf_id', async () => {
    const sent = recordRequests();

    const res = await listMessages(WS, FIXTURE_DOCUMENT_ID, 'chat-method', 1);

    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${FIXTURE_DOCUMENT_ID}/chats/chat-method/messages?leaf=1`);
    expect(res.leaf_id).toBe(1);
    expect(res.items.map((message) => message.content)).toEqual([
      'Tighten the method section without losing the load-balancing detail.',
    ]);
  });

  it('without a leaf, reads the newest branch and says which it is', async () => {
    // A second turn continued from the first question: a branch of its own.
    const turn = recordQuestion(FIXTURE_DOCUMENT_ID, { chatId: 'chat-method', leafId: 1, text: 'Shorter, please.', preset: null, runId: 'run-2', web: false });
    const record = new TurnRecord();
    record.observe({ event: 'token', data: { content: 'Shorter.' } });
    recordAnswer(FIXTURE_DOCUMENT_ID, { ...turn, runId: 'run-2' }, record.text, record.snapshot('completed', { cost_limit: 5, limit_reached: null }), record.hasActivity);
    const messageId = turn.answerId;
    const sent = recordRequests();

    const res = await listMessages(WS, FIXTURE_DOCUMENT_ID, 'chat-method', null);

    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${FIXTURE_DOCUMENT_ID}/chats/chat-method/messages`);
    expect(res.leaf_id).toBe(messageId);
    expect(res.items.map((message) => message.role)).toEqual(['user', 'user', 'assistant']);
    expect(chatsOf(FIXTURE_DOCUMENT_ID)[0]?.messages).toHaveLength(4);
    // Each stored with what its turn was: the question's preset, the reply's record.
    expect(res.items.at(-2)?.record).toEqual({ kind: 'request', preset: null, effort: 'standard', web: false, plan_id: null });
    expect(res.items.at(-1)?.record).toMatchObject({ kind: 'reply', status: 'completed', tool_calls: [] });
  });
});
