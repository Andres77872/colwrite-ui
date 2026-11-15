import { describe, expect, it } from 'vitest';
import { pathOf, recordRequests } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { FIXTURE_DOCUMENT_ID, chatsOf, recordTurn } from '@/dev/msw/fixtures';
import { listChats, listMessages, renameChat } from '../chats';

const WS = TEST_WORKSPACE_ID;

describe('chats', () => {
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
    const { messageId } = recordTurn(FIXTURE_DOCUMENT_ID, 'chat-method', 1, 'Shorter, please.');
    const sent = recordRequests();

    const res = await listMessages(WS, FIXTURE_DOCUMENT_ID, 'chat-method', null);

    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${FIXTURE_DOCUMENT_ID}/chats/chat-method/messages`);
    expect(res.leaf_id).toBe(messageId);
    expect(res.items.map((message) => message.role)).toEqual(['user', 'user', 'assistant']);
    expect(chatsOf(FIXTURE_DOCUMENT_ID)[0]?.messages).toHaveLength(4);
  });
});
