import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRef, useImperativeHandle } from 'react';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { TestWorkspace } from '@/__tests__/workspace';
import { recordRequests, queryOf } from '@/__tests__/server';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FIXTURE_DOCUMENT_ID } from '@/dev/msw/fixtures';
import { FEDUS } from '@/dev/fixtureReferences';
import type { CitationChild, ParagraphBlock } from '@/editor';

/**
 * Find citations, end to end against the mock API (P2.UI-3): the fixture
 * page's second paragraph is searched sentence by sentence on the paper
 * passages route, the author ticks one work, and Insert places only that
 * citation, after its sentence, as one undo step.
 */

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { Editable } = await import('@/components/common/Editable');
const { FindCitationsHost } = await import('../FindCitationsHost');
const { openFindCitations } = await import('../findCitationsTarget');
const { planSentences } = await import('../planSentences');
const { proseText } = await import('@/components/editor/References/citeAtCursor');

/** As the toolbar's "Find citations" does with the whole paragraph selected. */
const findCitationsFor = (el: HTMLElement) => openFindCitations('p-2', planSentences(el, paragraph(), 0, proseText(el).length));

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();
function Harness() {
  const editor = useEditorProbe();
  useImperativeHandle(editorRef, () => editor, [editor]);
  const block = editor.blocks.find((candidate) => candidate.id === 'p-2');
  return block?.type === 'paragraph' ? <Editable id={block.id} html={block.html} /> : null;
}
const editor = () => editorRef.current!;
const paragraph = () => editor().blocks.find((block) => block.id === 'p-2') as ParagraphBlock;
const citations = () => (paragraph().children ?? []).filter((child): child is CitationChild => child.type === 'citation');

function mount() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>
        <TooltipProvider>
          <TestWorkspace initialDocumentId={FIXTURE_DOCUMENT_ID}>
            <EditorProvider>
              <Harness />
              <FindCitationsHost />
            </EditorProvider>
          </TestWorkspace>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Find citations', () => {
  it('searches each sentence, and inserts only what the author ticked, as one undo step', async () => {
    mount();
    await waitFor(() => expect(paragraph()).toBeTruthy(), { timeout: 5_000 });
    const before = structuredClone(editor().doc);
    const el = await waitFor(() => {
      const found = editor().refs.current['p-2'];
      if (!found) throw new Error('no editable yet');
      return found;
    });
    const sent = recordRequests();
    act(() => findCitationsFor(el));

    const dialog = await screen.findByRole('dialog', { name: 'Find citations' });
    const sentences = within(dialog).getByRole('list', { name: 'Sentences' });
    expect(sentences.querySelectorAll(':scope > [data-sentence]')).toHaveLength(2);
    // Each sentence asked the passages route with its own words.
    await waitFor(() => expect(within(dialog).getAllByRole('checkbox').length).toBeGreaterThan(1));
    const asked = sent.filter((request) => request.url.includes('/papers/passages')).map((request) => queryOf(request).query);
    expect(asked).toEqual([
      'In this paper, we show that sparse routing lets models scale sublinearly in compute.',
      expect.stringMatching(/^The router assigns token\s+to expert\s+with a learned gate\.$/),
    ]);
    // Nothing is ticked until the author ticks it.
    expect(within(dialog).getAllByRole('checkbox').every((box) => box.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Insert' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(within(dialog).getByRole('checkbox', { name: `Cite “${FEDUS.csl.title}” for sentence 1` }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Insert 1 citation' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Find citations' })).toBeNull());

    // One citation, of the one work ticked, before the first sentence's period.
    expect(citations()).toHaveLength(1);
    const [cited] = citations();
    expect(cited).toMatchObject({ type: 'citation', keys: [FEDUS.key], style: 'nlm-citation-sequence-brackets' });
    expect(paragraph().html).toMatch(new RegExp(`in compute<span data-child-id="${cited!.id}"[^>]*></span>\\. The router`));
    // The work was in the library already: it is not added twice.
    expect(editor().doc.sources?.filter((source) => source.key === FEDUS.key)).toHaveLength(1);

    // One undo takes it out, and the page is as it was.
    act(() => editor().undo());
    expect(citations()).toHaveLength(0);
    expect(editor().doc.blocks.find((block) => block.id === 'p-2')).toEqual(before.blocks.find((block) => block.id === 'p-2'));
    expect(editor().doc.sources).toEqual(before.sources);
  }, 20_000);

  it('adds a work new to the page to its sources with the citation, and undoes both at once', async () => {
    mount();
    await waitFor(() => expect(editor().refs.current['p-2']).toBeTruthy(), { timeout: 5_000 });
    const before = structuredClone(editor().doc);
    const el = editor().refs.current['p-2']!;
    act(() => findCitationsFor(el));
    const dialog = await screen.findByRole('dialog', { name: 'Find citations' });
    const fresh = await waitFor(() => {
      const box = within(dialog).queryAllByRole('checkbox', { name: /for sentence 2$/ })
        .find((candidate) => !before.sources?.some((source) => candidate.getAttribute('aria-label')?.includes(source.csl.title)));
      if (!box) throw new Error('no new work offered yet');
      return box;
    });
    fireEvent.click(fresh);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Insert 1 citation' }));
    await waitFor(() => expect(citations()).toHaveLength(1));
    const [cited] = citations();
    expect(paragraph().html).toMatch(new RegExp(`learned gate<span data-child-id="${cited!.id}"[^>]*></span>\\.$`));
    expect(editor().doc.sources?.map((source) => source.key)).toContain(cited!.keys[0]);
    expect(before.sources?.map((source) => source.key)).not.toContain(cited!.keys[0]);

    act(() => editor().undo());
    expect(citations()).toHaveLength(0);
    expect(editor().doc.sources).toEqual(before.sources);
  }, 20_000);
});
