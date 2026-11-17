import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import type { AgentChatOptions } from '@/api/assistant/agentChat';
import type { AgentEventHandlers } from '@/api/assistant/streamParser';
import { agentSource } from '@/__tests__/agentSource';
import type { Doc } from '@/editor/types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ui/toast';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

/** Ask AI on the shared run driver: what it does before, during and after a run. */

const PAGE: Doc = {
  name: 'Doc',
  blocks: [{ id: 'p1', type: 'paragraph', html: 'A long paragraph about routing.', children: [], columns: 1 }],
};
const documents = vi.hoisted(() => ({
  saveDocument: vi.fn(async (..._args: unknown[]) => ({ etag: 'cw:2', updatedAt: null })),
}));
vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  saveDocument: (...args: unknown[]) => documents.saveDocument(...args),
  getDocument: vi.fn(async () => ({ doc: PAGE, etag: 'cw:1', updatedAt: null, placement: { documentId: 'doc-1', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
}));

type Call = { handlers: AgentEventHandlers; options?: AgentChatOptions; finish: () => void };
const calls: Call[] = [];
const runAgentTurn = vi.fn((_params: unknown, handlers: AgentEventHandlers, options?: AgentChatOptions) =>
  new Promise((resolve) => {
    calls.push({ handlers, options, finish: () => resolve({ done: null, terminal: 'done' }) });
  }));
vi.mock('@/api/assistant/agentChat', () => ({
  runAgentTurn: (...args: Parameters<typeof runAgentTurn>) => runAgentTurn(...args),
}));

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { useAskAiTarget } = await import('./useAskAiTarget');
const { AskAiPanel } = await import('./AskAi');
const { openAskAi } = await import('./askAiEvents');

type Probe = ReturnType<typeof useEditorProbe>;
const probeRef = createRef<Probe>();
const probe = (): Probe => {
  if (!probeRef.current) throw new Error('not mounted');
  return probeRef.current;
};

function Harness({ open = true }: { open?: boolean }) {
  const editor = useEditorProbe();
  const askAi = useAskAiTarget();
  useImperativeHandle(probeRef, () => editor, [editor]);
  return open && askAi.target ? <AskAiPanel key={askAi.target.key} target={askAi.target} onClose={askAi.close} /> : null;
}

async function mount() {
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:lastDocId`, 'doc-1');
  const utils = render(
    <ToastProvider>
      <TooltipProvider>
        <EditorProvider>
          <Harness />
        </EditorProvider>
      </TooltipProvider>
    </ToastProvider>,
  );
  await waitFor(() => expect(probe().documentId).toBe('doc-1'));
  await waitFor(() => expect(probe().blocks.map((block) => block.id)).toEqual(['p1']));
  return utils;
}

beforeEach(() => {
  localStorage.clear();
  mockDocumentList();
  calls.length = 0;
  runAgentTurn.mockClear();
  documents.saveDocument.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Ask AI on the run driver', () => {
  it('saves pending edits before it asks, so the server reads what is on screen', async () => {
    await mount();
    act(() => probe().setDocName('Renamed by the author'));
    expect(probe().hasPendingEdits()).toBe(true);

    act(() => openAskAi({ blockId: 'p1', actionId: 'shorter' }));

    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    expect(documents.saveDocument).toHaveBeenCalledOnce();
    expect(documents.saveDocument.mock.invocationCallOrder[0]).toBeLessThan(runAgentTurn.mock.invocationCallOrder[0] ?? 0);
  });

  it('cancels its run when the panel goes away', async () => {
    const { rerender } = await mount();
    act(() => openAskAi({ blockId: 'p1', actionId: 'shorter' }));
    await waitFor(() => expect(calls).toHaveLength(1));

    rerender(
      <ToastProvider>
        <TooltipProvider>
          <EditorProvider>
            <Harness open={false} />
          </EditorProvider>
        </TooltipProvider>
      </ToastProvider>,
    );
    const [call] = calls;
    expect(call?.options?.signal?.aborted).toBe(true);
    expect(call?.options?.abortBehavior).toBe('cancel');
  });

  it('lists each source once, and what the run did, under the result', async () => {
    await mount();
    act(() => openAskAi({ blockId: 'p1', actionId: 'check' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const [call] = calls;
    if (!call) throw new Error('no run');
    const source = agentSource('S1', { key: 'doi:10.1000/one', title: 'A Study of Routing', provider: 'semantic_scholar' });

    await act(async () => {
      call.handlers.onToolCallStart?.('paper_search', 'c1', null);
      call.handlers.onEvidence?.({ sources: [source], passages: [{ id: 'S1.1', level: 'abstract' }] });
      call.handlers.onEvidence?.({ sources: [source], passages: [] });
      call.handlers.onToolCallEnd?.({ tool: 'paper_search', toolCallId: 'c1', durationMs: 900, isError: false, error: null, errorType: null, outputPreview: '1 paper', outputChars: 7, outputTruncated: false, argumentsPreview: '', argumentsTruncated: false });
      call.handlers.onToken?.('The claim is supported [S1].');
      call.finish();
    });

    expect(screen.getAllByText('A Study of Routing')).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'What the assistant did' })).toBeTruthy();
    expect(screen.getByText('Searched for papers')).toBeTruthy();
  });
});
