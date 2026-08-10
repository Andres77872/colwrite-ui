import { createRef, useEffect, useImperativeHandle } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSessionsProvider } from '@/components/chat/ChatSessionsContext';
import {
  useChatSessions,
  type ChatSessionsValue,
} from '@/components/chat/chatSessionsState';
import { ProposalsProvider } from '../ProposalsContext';
import {
  EditorActionsContext,
  EditorContext,
  type EditorContextValue,
} from '../editorContextState';
import {
  useProposals,
  type ProposalsContextValue,
} from '../proposalsContextState';
import type { ToolAction } from '../types';

let childMounts = 0;
let childUnmounts = 0;
const captureRef = createRef<{
  review: ProposalsContextValue;
  chats: ChatSessionsValue;
}>();

const applyPatch = vi.fn(() => ({ blocks: [], desynced: [], touched: [] }));
const adoptServerVersion = vi.fn();
const markRecentlyChanged = vi.fn();

function editorValue(documentId: string): EditorContextValue {
  return {
    documentId,
    blocks: [],
    applyPatch,
    adoptServerVersion,
    markRecentlyChanged,
  } as unknown as EditorContextValue;
}

/** A staged batch: one reviewable change, plus a document the agent created. */
function proposal(documentId: string): ToolAction {
  return {
    tool: 'doc_edit',
    toolCallId: `call-${documentId}`,
    documentId,
    version: 1,
    status: 'proposed',
    actions: [
      { op: 'create_document', documentId: `${documentId}-created` },
      { op: 'append_block', block: { id: `${documentId}-block`, type: 'divider' } },
    ],
  };
}

/**
 * A batch the server did not carry out.
 *
 * Its operations are deliberately not staged: an Accept button for work that
 * failed would write the agent's abandoned draft into the document. Only the
 * message reaches the author.
 */
function failedProposal(documentId: string): ToolAction {
  return {
    ...proposal(documentId),
    toolCallId: `call-${documentId}-failed`,
    status: 'error',
    message: 'Review failed',
    actions: [
      { op: 'append_block', block: { id: `${documentId}-failed`, type: 'divider' } },
    ],
  };
}

function CaptureDocumentState() {
  const review = useProposals();
  const chats = useChatSessions();
  useImperativeHandle(captureRef, () => ({ review, chats }), [review, chats]);

  useEffect(() => {
    childMounts += 1;
    return () => {
      childUnmounts += 1;
    };
  }, []);

  return null;
}

function Tree({ documentId }: { documentId: string }) {
  const value = editorValue(documentId);
  // The fake carries both state and actions, so it feeds both halves of the
  // split context.
  return (
    <EditorContext.Provider value={value}>
      <EditorActionsContext.Provider value={value}>
        <ProposalsProvider>
          <ChatSessionsProvider>
            <CaptureDocumentState />
          </ChatSessionsProvider>
        </ProposalsProvider>
      </EditorActionsContext.Provider>
    </EditorContext.Provider>
  );
}

function currentReview(): ProposalsContextValue {
  if (!captureRef.current) throw new Error('Proposal capture is not mounted');
  return captureRef.current.review;
}

function currentChats(): ChatSessionsValue {
  if (!captureRef.current) throw new Error('Chat capture is not mounted');
  return captureRef.current.chats;
}

beforeEach(() => {
  localStorage.clear();
  childMounts = 0;
  childUnmounts = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('document-scoped providers', () => {
  it('resets proposal and chat state without remounting descendants or accepting stale setters', () => {
    localStorage.setItem('colwrite:chat:selected:doc-b', 'persisted-b');
    const view = render(<Tree documentId="doc-a" />);

    act(() => {
      currentReview().receive(proposal('doc-a'));
      currentReview().receive(failedProposal('doc-a'));
      currentChats().setSelectedChatId('chat-a');
      currentChats().setSelectedThreadId(7);
    });

    // Two batches arrived; only the one the server actually staged is
    // reviewable. The failed one contributes its message and nothing else.
    expect(currentReview().pendingCount).toBe(1);
    expect(currentReview().invites).toHaveLength(1);
    expect(currentReview().focusedChangeId).not.toBeNull();
    expect(currentReview().error).toBe('Review failed');
    expect(currentChats().selectedChatId).toBe('chat-a');
    expect(currentChats().selectedThreadId).toBe(7);

    const staleReceive = currentReview().receive;
    const staleSetChat = currentChats().setSelectedChatId;
    const staleSetThread = currentChats().setSelectedThreadId;

    act(() => {
      view.rerender(<Tree documentId="doc-b" />);
    });

    expect(childMounts).toBe(1);
    expect(childUnmounts).toBe(0);
    expect(currentReview().sets).toEqual([]);
    expect(currentReview().invites).toEqual([]);
    expect(currentReview().focusedChangeId).toBeNull();
    expect(currentReview().error).toBeNull();
    expect(currentChats().selectedChatId).toBe('persisted-b');
    expect(currentChats().selectedThreadId).toBeNull();

    act(() => {
      staleReceive(proposal('doc-a'));
      staleSetChat('stale-chat');
      staleSetThread(99);
    });

    expect(currentReview().pendingCount).toBe(0);
    expect(currentReview().invites).toEqual([]);
    expect(currentChats().selectedChatId).toBe('persisted-b');
    expect(currentChats().selectedThreadId).toBeNull();
    expect(localStorage.getItem('colwrite:chat:selected:doc-b')).toBe('persisted-b');
  });
});
