import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** The verdict the shared readiness probe returns for the next load. */
let readiness: { ready: boolean; status: string };
const waitForReady = vi.fn(async () => readiness);

function editorValue(): EditorContextValue {
  return {
    documentId: DOC_ID,
    ensureRemoteDocument: async () => DOC_ID,
    waitForReady,
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
  const tree = (
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
    </EditorContext.Provider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
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
  waitForReady.mockClear();
  readiness = { ready: true, status: 'ready' };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('ChatsPanel while the server catches up', () => {
  it('never asks for the list while the projection is behind', async () => {
    readiness = { ready: false, status: 'stale' };

    renderPanel();

    await waitFor(() => expect(screen.getByText('Getting your chats ready')).toBeTruthy());
    expect(screen.getByText('This document is still syncing on the server.')).toBeTruthy();
    // The machinery's own words never reach the author.
    expect(screen.queryByText('Could not load chats')).toBeNull();

    // The whole point of the gate: the endpoint that would have logged a 503
    // per attempt is never called at all, so the console stays clean.
    expect(mocked.listChats).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    // And nothing is polling behind the author's back either.
    expect(mocked.listChats).not.toHaveBeenCalled();
  });

  it('opens the list when the author retries and the projection has landed', async () => {
    readiness = { ready: false, status: 'stale' };
    mocked.listChats.mockResolvedValue({
      chats: [CHAT],
      count: 1,
      status: 'ok',
      message: '',
    });

    renderPanel();
    await waitFor(() => expect(screen.getByText('Getting your chats ready')).toBeTruthy());

    readiness = { ready: true, status: 'ready' };
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Outline review')).toBeTruthy());
    expect(screen.queryByText('Getting your chats ready')).toBeNull();
  });

  it('still reads, exactly once, when the probe itself is inconclusive', async () => {
    // A probe we could not trust must not wall off a read that may well work —
    // but it is capped at one attempt so a stale backend costs one line.
    readiness = { ready: false, status: 'unavailable' };
    mocked.listChats.mockRejectedValue(projectionPending());

    renderPanel();

    await waitFor(() => expect(screen.getByText('Getting your chats ready')).toBeTruthy());
    expect(mocked.listChats).toHaveBeenCalledTimes(1);
    expect(mocked.listChats.mock.calls[0][3]).toMatchObject({
      retry: { maxAttempts: 1 },
    });
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
