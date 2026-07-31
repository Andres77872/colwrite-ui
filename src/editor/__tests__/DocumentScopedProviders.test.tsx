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
    applyPatch,
    adoptServerVersion,
    markRecentlyChanged,
  } as unknown as EditorContextValue;
}

function proposal(documentId: string): ToolAction {
  return {
    tool: 'doc_edit',
    toolCallId: `call-${documentId}`,
    documentId,
    version: 1,
    status: 'error',
    message: 'Review failed',
    actions: [
      { op: 'create_document', documentId: `${documentId}-created` },
      { op: 'append_block', block: { id: `${documentId}-block`, type: 'divider' } },
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
  return (
    <EditorContext.Provider value={editorValue(documentId)}>
      <ProposalsProvider>
        <ChatSessionsProvider>
          <CaptureDocumentState />
        </ChatSessionsProvider>
      </ProposalsProvider>
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
      currentChats().setSelectedChatId('chat-a');
      currentChats().setSelectedThreadId(7);
    });

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
