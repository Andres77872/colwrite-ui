import { createRef, useEffect, useImperativeHandle } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSessionsProvider } from '@/components/chat/ChatSessionsContext';
import {
  useChatSessions,
  type ChatSessionsValue,
} from '@/components/chat/chatSessionsState';
import { ProposalsProvider } from '../ProposalsContext';
import { FakeEditorProviders, type EditorProbe } from './editorHarness';
import {
  useProposals,
  type ProposalsContextValue,
} from '../proposalsContextState';
import type { ToolAction } from '../types';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

/** The server's change sets: one append on each page's set. */
vi.mock('@/data/documentHistory', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/data/documentHistory')),
  getChangeSet: vi.fn(async (_workspaceId: string, documentId: string, changeSetId: string) => ({
    changeSetId,
    documentId,
    status: 'pending',
    operations: [{ op: 'write_blocks', position: 'append', blockId: null, blocks: [{ id: `${documentId}-block`, type: 'divider' }] }],
    unmappableOperations: [],
    baseEtag: 'cw:1',
    toolCallId: `call-${documentId}`,
    summary: null,
    expiresAt: '2026-11-20T00:00:00Z',
    proposedAt: '2026-11-14T10:00:00Z',
    dependsOnChangeSetId: null,
    applyPolicy: 'review',
    autoBlockedReason: null,
    operationDecisions: [],
    operationTargets: null,
  })),
  listPendingChangeSets: vi.fn(async () => []),
  decideChangeSetOperations: vi.fn(async () => ({})),
}));

let childMounts = 0;
let childUnmounts = 0;
const captureRef = createRef<{
  review: ProposalsContextValue;
  chats: ChatSessionsValue;
}>();

const applyPatch = vi.fn(() => ({ blocks: [], doc: { blocks: [] }, desynced: [], touched: [] }));
const markRecentlyChanged = vi.fn();

function editorValue(documentId: string): EditorProbe {
  return {
    documentId,
    blocks: [],
    applyPatch,
    markRecentlyChanged,
  } as unknown as EditorProbe;
}

/** A stored change set with one reviewable change. */
function proposal(documentId: string): ToolAction {
  return {
    tool: 'doc_edit',
    toolCallId: `call-${documentId}`,
    documentId,
    status: 'proposed',
    actions: [],
    changeSetId: `cs-${documentId}`,
    proposalOperationCount: 1,
  };
}

/** A page the agent created, announced by `doc_create`. */
function created(documentId: string): ToolAction {
  return {
    tool: 'doc_create',
    toolCallId: `call-${documentId}-create`,
    documentId: `${documentId}-created`,
    status: 'applied',
    actions: [{ op: 'create_document', documentId: `${documentId}-created` }],
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
    changeSetId: null,
    message: 'Review failed',
    actions: [
      { op: 'write_blocks', position: 'append', blockId: null, blocks: [{ id: `${documentId}-failed`, type: 'divider' }] },
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
  // The fake carries every slice, so it feeds every editor context.
  return (
    <FakeEditorProviders value={value}>
      <ProposalsProvider>
        <ChatSessionsProvider>
          <CaptureDocumentState />
        </ChatSessionsProvider>
      </ProposalsProvider>
    </FakeEditorProviders>
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
  it('resets proposal and chat state without remounting descendants or accepting stale setters', async () => {
    localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:chat:doc-b`, 'persisted-b');
    const view = render(<Tree documentId="doc-a" />);

    await act(async () => {
      currentReview().receive(proposal('doc-a'));
      currentReview().receive(created('doc-a'));
      currentReview().receive(failedProposal('doc-a'));
      currentChats().setSelectedChatId('chat-a');
      currentChats().setSelectedLeafId(7);
    });

    // Two batches arrived; only the one the server actually staged is
    // reviewable. The failed one contributes its message and nothing else.
    expect(currentReview().pendingCount).toBe(1);
    expect(currentReview().invites).toHaveLength(1);
    expect(currentReview().focusedChangeId).not.toBeNull();
    expect(currentReview().error).toBe('Review failed');
    expect(currentChats().selectedChatId).toBe('chat-a');
    expect(currentChats().selectedLeafId).toBe(7);

    const staleReceive = currentReview().receive;
    const staleSetChat = currentChats().setSelectedChatId;
    const staleSetThread = currentChats().setSelectedLeafId;

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
    expect(currentChats().selectedLeafId).toBeNull();

    await act(async () => {
      staleReceive(proposal('doc-a'));
      staleReceive(created('doc-a'));
      staleSetChat('stale-chat');
      staleSetThread(99);
    });

    expect(currentReview().pendingCount).toBe(0);
    expect(currentReview().invites).toEqual([]);
    expect(currentChats().selectedChatId).toBe('persisted-b');
    expect(currentChats().selectedLeafId).toBeNull();
    expect(localStorage.getItem(`colwrite:ws:${TEST_WORKSPACE_ID}:chat:doc-b`)).toBe('persisted-b');
  });
});
