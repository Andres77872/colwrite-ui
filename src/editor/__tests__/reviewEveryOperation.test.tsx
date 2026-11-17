import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRef, useImperativeHandle } from 'react';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { TestWorkspace } from '@/__tests__/workspace';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ReviewPill } from '@/components/editor/Review/ReviewPill';
import { ChangeCard } from '@/components/editor/Review/ChangeCard';
import { http, problem, recordRequests, server } from '@/__tests__/server';
import { FIXTURE_DOCUMENT_ID, changeSetsOf, liveDocument, storeProposedEdits } from '@/dev/msw/fixtures';
import type { Doc } from '../types';
import { useProposals, type ProposalsContextValue } from '../proposalsContextState';

/**
 * One change set with every operation kind, end to end against the mock
 * API: it stages from the server's pending list, each accepted operation
 * applies as one undo step of the author's own, and each decision is
 * recorded on the server by operation index. Nothing here is mocked but the
 * API, which `src/dev/msw` serves.
 */

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('./editorHarness');
const { ProposalsProvider } = await import('../ProposalsContext');

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();
const reviewRef = createRef<ProposalsContextValue>();
function Capture() {
  const editor = useEditorProbe();
  const review = useProposals();
  useImperativeHandle(editorRef, () => editor, [editor]);
  useImperativeHandle(reviewRef, () => review, [review]);
  return null;
}
const editor = () => editorRef.current!;
const review = () => reviewRef.current!;

function ReviewSurface() {
  const { pending } = useProposals();
  return (
    <ConfirmProvider>
      <ReviewPill />
      {pending.map((change) => <ChangeCard key={change.id} change={change} />)}
    </ConfirmProvider>
  );
}

function mount(showReview = false) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TestWorkspace initialDocumentId={FIXTURE_DOCUMENT_ID}>
        <EditorProvider>
          <ProposalsProvider>
            <Capture />
            {showReview && <ReviewSurface />}
          </ProposalsProvider>
        </EditorProvider>
      </TestWorkspace>
    </QueryClientProvider>,
  );
}

/** What a step changed, comparable across undo. */
const shape = (doc: Doc) => ({
  name: doc.name,
  blocks: doc.blocks.map((block) => `${block.id}:${'html' in block ? block.html : ''}`),
  sources: (doc.sources ?? []).map((source) => source.key),
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a change set with every operation kind, against the mock', () => {
  it('stages every operation, applies each accepted one as one undo step, and records each decision', async () => {
    const stored = storeProposedEdits(FIXTURE_DOCUMENT_ID, { apply_policy: 'review', auto_blocked_reason: null });
    expect(stored.operations.map((operation) => operation.op)).toEqual([
      'replace_text', 'write_blocks', 'write_blocks', 'delete_blocks', 'move_block', 'set_meta', 'add_sources', 'remove_sources', 'write_blocks',
    ]);

    mount();
    await waitFor(() => expect(review().pending).toHaveLength(9), { timeout: 5_000 });
    expect(review().pending.map((change) => change.kind).sort()).toEqual(
      ['delete', 'insert', 'insert', 'meta', 'move', 'replace', 'replace', 'sources', 'sources'],
    );

    const steps: ReturnType<typeof shape>[] = [shape(editor().doc)];
    const byIndex = (opIndex: number) => review().sets
      .flatMap((set) => set.changes)
      .find((change) => change.opIndex === opIndex)!;

    // In the order they were proposed; the move is one the author does not want.
    for (const opIndex of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const change = byIndex(opIndex);
      expect(change.status, `operation ${opIndex}`).toBe('pending');
      if (opIndex === 4) {
        act(() => review().reject(change.id));
        expect(shape(editor().doc)).toEqual(steps.at(-1));
        continue;
      }
      expect(review().ready(change), `operation ${opIndex}`).toBe(true);
      act(() => review().accept(change.id));
      // Once the last is decided the settled set is dropped, so this asks
      // whether it is still pending rather than for its status.
      await waitFor(() => expect(review().pending.some((candidate) => candidate.id === change.id)).toBe(false));
      expect(review().error).toBeNull();
      steps.push(shape(editor().doc));
    }

    // What the page holds now: every accepted operation, the move left out.
    const done = editor().doc;
    expect(done.name).toBe('Sparse Routing for Long-Context Pretraining at Scale');
    expect(done.blocks.find((block) => block.id === 'p-2')).toMatchObject({ html: expect.stringContaining('in compute while keeping quality.') });
    const ids = done.blocks.map((block) => block.id);
    expect(ids.slice(ids.indexOf('li-1'), ids.indexOf('li-5') + 1)).toEqual(['li-1', 'li-2', 'li-2b', 'li-3', 'li-4', 'li-5']);
    expect(ids).not.toContain('q-1');
    expect(ids.indexOf('todo-1')).toBeLessThan(ids.indexOf('todo-2'));
    expect(ids.at(-1)).toBe('p-6');
    expect(done.sources?.map((source) => source.key)).toEqual([
      'arxiv:1706.03762', 'arxiv:2101.03961', 'arxiv:2006.16668', 'doi:10.5555/jsm.2019.042', 'doi:10.48550/arxiv.1706.03762', 'arxiv:2202.08906',
    ]);
    await act(async () => { expect(await editor().flushPendingSave()).toBe(true); });

    // Each accept is one undo step: undoing walks back through them in turn.
    for (let step = steps.length - 1; step > 0; step -= 1) {
      act(() => editor().undo());
      expect(shape(editor().doc), `undo to step ${step - 1}`).toEqual(steps[step - 1]);
    }

    // The server holds every decision, by operation index, and the set has
    // left `pending`: at least one was accepted.
    await waitFor(() => {
      const [record] = changeSetsOf(FIXTURE_DOCUMENT_ID).filter((set) => set.change_set_id === stored.change_set_id);
      expect(record?.decisions.map(({ index, decision }) => [index, decision]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
        [0, 'accepted'], [1, 'accepted'], [2, 'accepted'], [3, 'accepted'], [4, 'rejected'],
        [5, 'accepted'], [6, 'accepted'], [7, 'accepted'], [8, 'accepted'],
      ]);
      expect(record?.status).toBe('superseded');
    }, { timeout: 5_000 });
  }, 20_000);

  it('keeps flagged cards, waits for the accepted page to save, and reopens with only undecided operations', async () => {
    const { change_set_id: id } = storeProposedEdits(FIXTURE_DOCUMENT_ID, { apply_policy: 'review', auto_blocked_reason: null });
    const record = () => changeSetsOf(FIXTURE_DOCUMENT_ID).find((set) => set.change_set_id === id)!;
    const savedPage = () => liveDocument(FIXTURE_DOCUMENT_ID)!;
    const originalName = savedPage().name;
    const sent = recordRequests();
    const posts = () => sent.filter((request) => request.method === 'POST' && request.url.endsWith(`/change-sets/${id}/decisions`));
    let view = mount(true);
    fireEvent.click(await screen.findByRole('button', { name: '9 suggestions, review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept eligible (7)' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Accept 7 eligible changes?' });
    expect(within(confirmation).getByText(/2 with new information will still need individual review/)).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Accept eligible' }));
    await screen.findByRole('button', { name: '2 suggestions, review' });
    expect(review().pending.map((change) => change.opIndex)).toEqual([6, 8]);
    expect(editor().doc.name).toBe('Sparse Routing for Long-Context Pretraining at Scale');
    expect(editor().doc.blocks.find((block) => block.id === 'p-2')).toMatchObject({ html: expect.stringContaining('while keeping quality') });

    server.use(http.put('/workspaces/{workspace_id}/documents/{document_id}',
      () => problem('stale_head', 'Someone saved a newer version.'), { once: true }));
    await act(async () => { expect(await editor().flushPendingSave()).toBe(false); });
    expect(posts()).toHaveLength(0);
    expect(record().decisions).toEqual([]);
    expect(savedPage().name).toBe(originalName);
    expect(editor().saveConflict).toBe(true);

    await act(async () => editor().resolveSaveConflict('mine'));
    await waitFor(() => expect(record().decisions.map((decision) => decision.index)).toEqual([0, 1, 2, 3, 4, 5, 7]));
    expect(savedPage().name).toBe(editor().doc.name);
    expect(record().status).toBe('pending');
    expect(posts()).toHaveLength(1);

    view.unmount();
    view = mount(true);
    await screen.findByRole('button', { name: '2 suggestions, review' });
    expect(review().pending.map((change) => change.opIndex)).toEqual([6, 8]);
    expect(editor().doc.name).toBe('Sparse Routing for Long-Context Pretraining at Scale');
    fireEvent.click(screen.getByRole('button', { name: /^Accept: Add a source/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Accept: Add paragraph/ }));
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    await act(async () => { expect(await editor().flushPendingSave()).toBe(true); });
    await waitFor(() => expect(record().status).toBe('superseded'));
    expect(savedPage().sources?.some((source) => source.key === 'arxiv:2202.08906')).toBe(true);
    expect(savedPage().blocks.some((block) => block.id === 'p-6')).toBe(true);

    view.unmount();
    mount(true);
    await waitFor(() => expect(editor().loadingDocumentId).toBeNull());
    expect(editor().doc.blocks.some((block) => block.id === 'p-6')).toBe(true);
    expect(screen.queryByRole('button', { name: /suggestions?, review/ })).toBeNull();
  }, 20_000);
});
