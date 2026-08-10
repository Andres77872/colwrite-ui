import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatsPanel } from './ChatsPanel';
import { EditorActionsContext, EditorContext, type EditorContextValue } from '@/editor/editorContextState';
import { ConfirmContext, type ConfirmOptions } from '@/components/ui/confirmContext';
import { ToastContext } from '@/components/ui/toastContext';
import { ChatSessionsContext } from '@/components/chat/chatSessionsState';
import { ApiError } from '@/services/contracts';
import * as chatsService from '@/services/chats';

/**
 * Chats are stored against the document id, so the list is read as soon as the
 * document has one. A server that is still catching up answers with a
 * retryable problem — a wait, not a failure. These tests pin that the panel
 * says so and recovers by itself.
 */

vi.mock('@/services/chats', () => ({
  listChats: vi.fn(),
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  updateChatTitle: vi.fn(),
}));

const mocked = vi.mocked(chatsService);

const DOC_ID = 'doc-1';

function editorValue(): EditorContextValue {
  return {
    documentId: DOC_ID,
    ensureRemoteDocument: async () => DOC_ID,
  } as unknown as EditorContextValue;
}

const confirm = vi.fn(async (_options: ConfirmOptions) => true);
const toast = vi.fn(() => 'toast-1');

const CHAT = {
  chat_id: 'chat-1',
  document_id: DOC_ID,
  user_id: null,
  title: 'Outline review',
  last_thread_id: 7,
  created_at: null,
  updated_at: null,
};

function renderPanel({ strict = false }: { strict?: boolean } = {}) {
  const editor = editorValue();
  // The fake carries both state and actions, so it feeds both halves of the
  // split context.
  const tree = (
    <EditorContext.Provider value={editor}>
      <EditorActionsContext.Provider value={editor}>
        <ChatSessionsContext.Provider
          value={{
            selectedChatId: null,
            setSelectedChatId: () => {},
            selectedThreadId: null,
            setSelectedThreadId: () => {},
          }}
        >
          <ConfirmContext.Provider value={confirm}>
            <ToastContext.Provider value={{ toast, dismiss: () => {} }}>
              <ChatsPanel />
            </ToastContext.Provider>
          </ConfirmContext.Provider>
        </ChatSessionsContext.Provider>
      </EditorActionsContext.Provider>
    </EditorContext.Provider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function rateLimited(): ApiError {
  return new ApiError('Too many requests for this document', 429, {
    code: 'document_rate_limit_exceeded',
    retryable: true,
    retry_after: 1,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocked.listChats.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('ChatsPanel while the server catches up', () => {
  it('says the list is on its way when the server calls the failure retryable', async () => {
    mocked.listChats.mockRejectedValue(rateLimited());

    renderPanel();

    await waitFor(() => expect(screen.getByText('Getting your chats ready')).toBeTruthy());
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
    expect(mocked.listChats).toHaveBeenCalledTimes(1);
  });

  it('opens the list when the author retries and the server has caught up', async () => {
    mocked.listChats.mockRejectedValueOnce(rateLimited()).mockResolvedValue({
      chats: [CHAT],
      count: 1,
      status: 'ok',
      message: '',
    });

    renderPanel();
    await waitFor(() => expect(screen.getByText('Getting your chats ready')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Outline review')).toBeTruthy());
    expect(screen.queryByText('Getting your chats ready')).toBeNull();
  });

  it('reports a failure the server does not call retryable', async () => {
    mocked.listChats.mockRejectedValue(new ApiError('Document not found', 404, {
      code: 'document_not_found',
      retryable: false,
    }));

    renderPanel();

    await waitFor(() => expect(screen.getByText('Could not load chats')).toBeTruthy());
    expect(screen.getByText('Document not found')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocked.listChats).toHaveBeenCalledTimes(1);
  });

  it('issues one request under a StrictMode double mount', async () => {
    // Setup/cleanup/setup used to produce two real requests here, each
    // amplified by the transport's own retry ladder.
    mocked.listChats.mockResolvedValue({ chats: [], count: 0, status: 'ok', message: '' });

    renderPanel({ strict: true });

    await waitFor(() => expect(mocked.listChats).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mocked.listChats).toHaveBeenCalledTimes(1);
  });
});
