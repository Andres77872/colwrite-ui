import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRef, useImperativeHandle } from 'react';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { TestWorkspace } from '@/__tests__/workspace';
import { FIXTURE_DOCUMENT_ID, changeSetsOf, storeSourceRefresh } from '@/dev/msw/fixtures';
import { LEPIKHIN } from '@/dev/fixtureReferences';
import { ToastProvider } from '@/components/ui/toast';
import { useProposals, type ProposalsContextValue } from '../proposalsContextState';

/**
 * The reference audit's refresh (`update_sources`), end to end against the
 * mock API: it stages, and accepting it replaces the library entry by key
 * as one undo step, which the reference list reads at once. Its card is in
 * `ChangeCard.test.tsx`.
 */

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('./editorHarness');
const { ProposalsProvider } = await import('../ProposalsContext');
const { ReferencesSection } = await import('@/components/editor/References');

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

function mount() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>
        <TestWorkspace initialDocumentId={FIXTURE_DOCUMENT_ID}>
          <EditorProvider>
            <ProposalsProvider>
              <Capture />
              <ReferencesSection />
            </ProposalsProvider>
          </EditorProvider>
        </TestWorkspace>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a refresh of the page’s references (update_sources)', () => {
  it('stages, replaces the entry by key when accepted, and undoes as one step', async () => {
    const corrected = {
      ...structuredClone(LEPIKHIN),
      flags: ['corrected' as const],
      checked: '2026-11-16',
      notices: [{ type: 'correction' as const, date: '2026-10-02', doi: '10.5555/iclr.fix', source: 'crossref' }],
      csl: { ...structuredClone(LEPIKHIN.csl), issued: { 'date-parts': [[2020]] } },
    };
    const stored = storeSourceRefresh(FIXTURE_DOCUMENT_ID, [corrected], { apply_policy: 'review', auto_blocked_reason: null });

    mount();
    await waitFor(() => expect(review().pending).toHaveLength(1), { timeout: 5_000 });
    const [change] = review().pending;
    expect(change?.kind).toBe('sources');

    const before = editor().doc.sources?.find((source) => source.key === LEPIKHIN.key);
    act(() => review().accept(change!.id));
    await waitFor(() => expect(review().pending).toHaveLength(0));
    // The entry is replaced where it stood, by key; nothing else moves.
    const after = editor().doc.sources ?? [];
    expect(after.map((source) => source.key)).toEqual(['arxiv:1706.03762', 'arxiv:2101.03961', LEPIKHIN.key, 'arxiv:1701.06538', 'doi:10.5555/jsm.2019.042', 'doi:10.48550/arxiv.1706.03762']);
    expect(after.find((source) => source.key === LEPIKHIN.key)).toEqual(corrected);
    // The reference list reads the library's record at once, its new mark with it.
    expect(document.querySelector(`[data-reference-key="${LEPIKHIN.key}"] [data-mark="corrected"]`)).toBeTruthy();

    await act(async () => { expect(await editor().flushPendingSave()).toBe(true); });
    act(() => editor().undo());
    expect(editor().doc.sources?.find((source) => source.key === LEPIKHIN.key)).toEqual(before);

    await waitFor(() => {
      const [record] = changeSetsOf(FIXTURE_DOCUMENT_ID).filter((set) => set.change_set_id === stored.change_set_id);
      expect(record?.decisions.map(({ index, decision }) => [index, decision])).toEqual([[0, 'accepted']]);
    }, { timeout: 5_000 });
  }, 20_000);
});
