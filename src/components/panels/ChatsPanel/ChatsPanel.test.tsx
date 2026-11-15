import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { ChatsPanel } from './ChatsPanel';
import { useChatHistory } from './useChatHistory';
import { FakeEditorProviders, type EditorProbe } from '@/editor/__tests__/editorHarness';
import { ConfirmContext, type ConfirmOptions } from '@/components/ui/confirmContext';
import { ToastContext } from '@/components/ui/toastContext';
import { ChatSessionsContext } from '@/components/chat/chatSessionsState';
import { http, problem, server } from '@/__tests__/server';
import type { ChatListResponse, ChatSummary } from '@/api/schema';

/**
 * The chat list inside the assistant's switcher, with the hook that loads it.
 *
 * Chats are stored against the document id, so the list is read as soon as the
 * document has one. A server that is still catching up answers with a
 * retryable problem — a wait, not a failure. These tests pin that the panel
 * says so and recovers by itself.
 */

const DOC_ID = 'doc-1';

type Answer<Body> = Body | Response | Promise<Body | Response>;

/**
 * The server's chat routes for this page, one call per request: the list (by
 * its query), a chat's deletion (its id) and its rename (its id and new
 * title). Each answers a body, or a `Response` for a problem.
 */
const chats = {
  list: vi.fn<(query: Record<string, string>) => Answer<ChatListResponse>>(),
  remove: vi.fn<(chatId: string) => Answer<null>>(),
  rename: vi.fn<(chatId: string, title: string) => Answer<ChatSummary>>(),
};

function mockChatRoutes() {
  const chat = '/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}';
  server.use(
    http.get('/workspaces/{workspace_id}/documents/{document_id}/chats', async ({ request, response }) => {
      const value = await chats.list(Object.fromEntries(new URL(request.url).searchParams));
      return value instanceof Response ? response.untyped(value) : response(200).json(value);
    }),
    http.delete(chat, async ({ params, response }) => {
      const value = await chats.remove(params.chat_id);
      return value instanceof Response ? response.untyped(value) : response(204).empty();
    }),
    http.patch(chat, async ({ params, request, response }) => {
      const value = await chats.rename(params.chat_id, (await request.json()).title ?? '');
      return value instanceof Response ? response.untyped(value) : response(200).json(value);
    }),
  );
}

function editorValue(): EditorProbe {
  return {
    documentId: DOC_ID,
    ensureRemoteDocument: async () => DOC_ID,
  } as unknown as EditorProbe;
}

const confirm = vi.fn(async (_options: ConfirmOptions) => true);
const onNewChat = vi.fn();
const onSelect = vi.fn();

/** What the assistant does: load the list, hand it to the panel. */
function Switcher() {
  const history = useChatHistory();
  return <ChatsPanel history={history} onNewChat={onNewChat} onSelect={onSelect} />;
}
const toast = vi.fn(() => 'toast-1');

const CHAT: ChatSummary = {
  id: 'chat-1',
  title: 'Outline review',
  last_message_id: 7,
  created_at: '2026-11-14T10:00:00Z',
  updated_at: '2026-11-14T10:00:00Z',
};

/** A page of the list; a next cursor says there are more chats. */
const listOf = (items: ChatSummary[], nextCursor: string | null = null): ChatListResponse => ({ items, next_cursor: nextCursor });

function renderPanel({ strict = false }: { strict?: boolean } = {}) {
  const editor = editorValue();
  // The fake carries every slice, so it feeds every editor context.
  const tree = (
    <FakeEditorProviders value={editor}>
      <ChatSessionsContext.Provider
        value={{
          selectedChatId: null,
          setSelectedChatId: () => {},
          selectedLeafId: null,
          setSelectedLeafId: () => {},
        }}
      >
        <ConfirmContext.Provider value={confirm}>
          <ToastContext.Provider value={{ toast, dismiss: () => {} }}>
            <Switcher />
          </ToastContext.Provider>
        </ConfirmContext.Provider>
      </ChatSessionsContext.Provider>
    </FakeEditorProviders>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function rateLimited(): Response {
  return problem('document_rate_limit_exceeded', 'Too many requests for this document', { retry_after: 1 }, { headers: { 'Retry-After': '1' } });
}

/** The client replays a retryable problem after its `Retry-After`, a few times, before it reports it. */
async function outlastRetries() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  chats.list.mockReset();
  mockChatRoutes();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatsPanel while the server catches up', () => {
  it('says the list is on its way when the server calls the failure retryable', async () => {
    chats.list.mockImplementation(rateLimited);

    renderPanel();
    await outlastRetries();

    await waitFor(() => expect(screen.getByText('Getting your chats ready')).toBeTruthy());
    const requests = chats.list.mock.calls.length;
    // Our words for the problem, not the server's description of its machinery.
    expect(
      screen.getByText('Too many requests just now — wait a moment and try again.'),
    ).toBeTruthy();
    expect(screen.queryByText('Could not load chats')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    // Nothing is polling behind the author's back: the request layer has done
    // its retrying, and from here it is the Retry button's turn.
    expect(chats.list).toHaveBeenCalledTimes(requests);
  });

  it('opens the list when the author retries and the server has caught up', async () => {
    chats.list.mockImplementation(rateLimited);

    renderPanel();
    await outlastRetries();
    await waitFor(() => expect(screen.getByText('Getting your chats ready')).toBeTruthy());

    chats.list.mockImplementation(() => listOf([CHAT]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Outline review')).toBeTruthy());
    expect(screen.queryByText('Getting your chats ready')).toBeNull();
  });

  it('reports a failure the server does not call retryable', async () => {
    chats.list.mockImplementation(() => problem('document_not_found', 'Document not found'));

    renderPanel();

    await waitFor(() => expect(screen.getByText('Could not load chats')).toBeTruthy());
    expect(screen.getByText('Document not found')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(chats.list).toHaveBeenCalledTimes(1);
  });

  it('issues one request under a StrictMode double mount', async () => {
    // Setup/cleanup/setup used to produce two real requests here, each
    // amplified by the transport's own retry ladder.
    chats.list.mockImplementation(() => listOf([]));

    renderPanel({ strict: true });

    await waitFor(() => expect(chats.list).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(chats.list).toHaveBeenCalledTimes(1);
  });
});

describe('ChatsPanel rows', () => {
  beforeEach(() => {
    chats.list.mockImplementation(() => listOf([CHAT]));
    chats.remove.mockImplementation(() => null);
    chats.rename.mockImplementation((_chatId, title) => ({ ...CHAT, title }));
  });

  it('renames a chat in place', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Outline review' }));
    const field = screen.getByRole('textbox', { name: 'Chat title' });
    fireEvent.change(field, { target: { value: 'Method review' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() =>
      expect(chats.rename).toHaveBeenCalledWith('chat-1', 'Method review'),
    );
  });

  it('asks before deleting a chat', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Outline review' }));

    await waitFor(() => expect(chats.remove).toHaveBeenCalledWith('chat-1'));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete “Outline review”?', destructive: true }),
    );
  });

  it('hands a picked chat and New chat back to the assistant', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Outline review/ }));
    expect(onSelect).toHaveBeenCalledWith(CHAT);
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('shows more chats by asking for a longer list, and stops when there are no more', async () => {
    const older = { ...CHAT, id: 'chat-0', title: 'First draft notes' };
    chats.list.mockImplementation((query) =>
      query.limit === '10' ? listOf([CHAT], 'cursor-2') : listOf([CHAT, older]),
    );
    renderPanel();
    await screen.findByRole('button', { name: /^Outline review/ });
    fireEvent.click(screen.getByRole('button', { name: 'Show more chats' }));

    expect(await screen.findByRole('button', { name: /^First draft notes/ })).toBeTruthy();
    expect(chats.list).toHaveBeenLastCalledWith({ limit: '20' });
    expect(screen.getByRole('button', { name: /^Outline review/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more chats' })).toBeNull();
  });

  it('filters the list by title', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /^Outline review/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search chats' }), {
      target: { value: 'budget' },
    });
    expect(screen.queryByRole('button', { name: /^Outline review/ })).toBeNull();
    expect(screen.getByText('No chats match.')).toBeTruthy();
  });
});
