import { createRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { decodeSources, type AgentSource } from '@/api/assistant/streamParser';
import { searchPapers } from '@/data/papers';
import { resolveSource } from '@/data/sources';
import { FEDUS } from '@/dev/fixtureReferences';
import { PREVIEW_PAPERS } from '@/dev/msw/fixtures';
import { RunEvidence, emptyEvidence } from '@/dev/msw/evidence';
import { referenceByline, referenceTitle, type ReferenceRecord } from '@/editor';

/**
 * One work, one record (P2.UI-1, P2.UI-2): Switch Transformers as the
 * Research panel's paper search, the citation picker's search, an
 * assistant reply's `evidence` event and the resolver hand it out. Every
 * entry point shows the same title and byline, and Add to sources puts the
 * same library entry in the page from the panel as from the reply.
 */

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { PanelsProvider } = await import('@/components/panels/panelsContext');
const { ResearchPanel } = await import('@/components/panels/ResearchPanel');
const { AnswerSources } = await import('@/components/editor/ChatAssistant/AnswerSources');

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();
function Capture() {
  const editor = useEditorProbe();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

/** Switch Transformers as a scripted turn's `evidence` event sends it, decoded as the client decodes it. */
function fromTheAssistant(): AgentSource {
  const store = new RunEvidence(emptyEvidence());
  store.register(PREVIEW_PAPERS[0]!);
  const event = store.drain();
  const [source] = decodeSources(event?.sources ?? []);
  if (!source) throw new Error('the mock sent no source');
  return source;
}

function mount(reply: AgentSource) {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <PanelsProvider>
          <EditorProvider>
            <Capture />
            <ResearchPanel />
            <AnswerSources messageId="m1" text="Top-1 routing [S1]." sources={[reply]} known={[reply]} />
          </EditorProvider>
        </PanelsProvider>
      </TooltipProvider>
    </ToastProvider>,
  );
}

const sameWork = (record: ReferenceRecord) => ({ key: record.key, kind: record.kind, csl: record.csl });

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('one record for one work, from every entry point', () => {
  it('reads the same from the paper search, the citation picker, the assistant and the resolver', async () => {
    const reply = fromTheAssistant();
    const [picked] = (await searchPapers(TEST_WORKSPACE_ID, { query: 'trillion parameter', limit: 6 })).items;
    const resolved = await resolveSource(TEST_WORKSPACE_ID, '2101.03961');

    // The same key, kind and CSL item everywhere; the resolver's has been checked since.
    expect(sameWork(reply.record)).toEqual(sameWork(picked!.record));
    expect(sameWork(resolved.record)).toEqual(sameWork(picked!.record));
    expect(picked!.record).toEqual(reply.record);
    expect(resolved.record).toMatchObject({ key: FEDUS.key, state: 'needs_review', differs: ['issued'] });

    mount(reply);
    fireEvent.change(screen.getByPlaceholderText('Search papers…'), { target: { value: 'trillion parameter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`article[data-paper-key="${FEDUS.key}"]`);
      if (!found) throw new Error('no result row yet');
      return found;
    });
    const answer = within(screen.getByRole('region', { name: 'Sources' }));

    // The same title and byline in the panel and under the reply.
    expect(row.textContent).toContain(referenceByline(picked!.record).split(' · ')[0]);
    expect(answer.getByText(referenceTitle(picked!.record))).toBeTruthy();
    expect(answer.getByText(/William Fedus, Barret Zoph, Noam Shazeer · 2022/)).toBeTruthy();

    // Added from the panel: the library holds the record as the search returned it…
    fireEvent.click(within(row).getByRole('button', { name: `Add “${FEDUS.csl.title}” to sources` }));
    await waitFor(() => expect(editorRef.current?.doc.sources).toEqual([picked!.record]));
    // …and the reply's source is that same entry, already in the page's sources.
    expect(answer.getByRole('button', { name: `“${FEDUS.csl.title}” is in sources` }).getAttribute('aria-pressed')).toBe('true');
  }, 20_000);
});
