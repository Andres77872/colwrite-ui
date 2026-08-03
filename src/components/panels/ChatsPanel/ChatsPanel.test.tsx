import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ChatsPanel } from './ChatsPanel';
import { EditorContext, type EditorContextValue } from '@/editor/editorContextState';
import { ConfirmContext, type ConfirmOptions } from '@/components/ui/confirmContext';
import { ToastContext } from '@/components/ui/toastContext';
import { ChatSessionsContext } from '@/components/chat/chatSessionsState';
import { ApiError } from '@/services/contracts';
import * as chatsService from '@/services/chats';

/**
 * A conversation is stored against the document's projected numeric identity,
 * which the server writes shortly after the save that produced it. Until it
 * lands the list cannot be read — a wait, not a failure. These tests pin that
 * the panel says so and recovers by itself.
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

function renderPanel() {
  return render(
    <EditorContext.Provider value={editorValue()}>
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
    </EditorContext.Provider>,
  );
}

function projectionPending(): ApiError {
  return new ApiError('Document reference projection is not ready', 503, {
    code: 'projection_pending',
    retryable: true,
    readiness_status: 'ready',
    expected_head_seq: 8,
    applied_head_seq: 3,
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
  it('reads as a wait, not a failure, and loads once the projection lands', async () => {
    mocked.listChats
      .mockRejectedValueOnce(projectionPending())
      .mockResolvedValueOnce({
        chats: [
          {
            chat_id: 'chat-1',
            document_id: DOC_ID,
            user_id: null,
            title: 'Outline review',
            last_thread_id: 7,
            created_at: null,
            updated_at: null,
          },
        ],
        count: 1,
        status: 'ok',
        message: '',
      });

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText('This document is still syncing on the server.')).toBeTruthy(),
    );
    // The machinery's own words never reach the author.
    expect(screen.queryByText('Could not load chats')).toBeNull();
    expect(screen.getByText('Getting your chats ready')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => expect(screen.getByText('Outline review')).toBeTruthy());
    expect(screen.queryByText('Getting your chats ready')).toBeNull();
  });

  it('stops polling and reports a failure the server does not call retryable', async () => {
    mocked.listChats.mockRejectedValue(new ApiError('Document not found', 404, {
      code: 'document_not_found',
      retryable: false,
    }));

    renderPanel();

    await waitFor(() => expect(screen.getByText('Could not load chats')).toBeTruthy());
    expect(screen.getByText('Document not found')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(5000);
    expect(mocked.listChats).toHaveBeenCalledTimes(1);
  });

  it('gives up after a bounded number of reloads', async () => {
    mocked.listChats.mockRejectedValue(projectionPending());

    renderPanel();
    await waitFor(() => expect(screen.getByText('Getting your chats ready')).toBeTruthy());

    // Reload delays grow 1s, 2s, 3s, 4s. Step the clock a second at a time,
    // each step its own `act`, so every reload commits and schedules its
    // successor before the clock moves past it.
    for (let second = 0; second < 20; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }

    // The first load plus MAX_PREPARING_POLLS reloads, and no more: a stalled
    // projection must not turn into an endless background poll.
    expect(mocked.listChats).toHaveBeenCalledTimes(5);
    expect(screen.getByText('Getting your chats ready')).toBeTruthy();
  });
});
