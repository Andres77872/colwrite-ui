import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRef, useImperativeHandle } from 'react';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { TestWorkspace } from '@/__tests__/workspace';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FIXTURE_DOCUMENT_ID, fixtures } from '@/dev/msw/fixtures';
import { LEPIKHIN, OKAFOR, VASWANI, VASWANI_DOI } from '@/dev/fixtureReferences';
import { useProposals, type ProposalsContextValue } from '@/editor/proposalsContextState';

/**
 * Reference health on the preview's fixture page, against the mock API
 * (P2.UI-4): the retracted work is marked in the reference list itself;
 * "Check references" runs the audit as a job, and then the list and the
 * Sources panel say what it found (an out-of-date record, a duplicate),
 * the refresh it proposed is staged for review, and the export dialog
 * gives the counts before a file is made.
 */

const { EditorProvider } = await import('@/editor');
const { ProposalsProvider } = await import('@/editor/ProposalsContext');
const { PanelsProvider } = await import('@/components/panels/panelsContext');
const { SourcesPanel } = await import('@/components/panels/SourcesPanel/SourcesPanel');
const { ReferencesSection, ReferenceHealthProvider } = await import('@/components/editor/References');
const { DocumentExportDialog } = await import('@/components/editor/DocumentChrome/DocumentExportDialog');

const reviewRef = createRef<ProposalsContextValue>();
function Capture() {
  const review = useProposals();
  useImperativeHandle(reviewRef, () => review, [review]);
  return null;
}

function mount(withExport = false) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>
        <TooltipProvider>
          <PanelsProvider>
            <TestWorkspace initialDocumentId={FIXTURE_DOCUMENT_ID}>
              <EditorProvider>
                <ProposalsProvider>
                  <ReferenceHealthProvider>
                    <Capture />
                    <SourcesPanel />
                    <ReferencesSection />
                    {withExport && <DocumentExportDialog open onOpenChange={() => {}} />}
                  </ReferenceHealthProvider>
                </ProposalsProvider>
              </EditorProvider>
            </TestWorkspace>
          </PanelsProvider>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const entry = (key: string) => document.querySelector<HTMLElement>(`[data-reference-key="${CSS.escape(key)}"]`);

beforeEach(() => {
  localStorage.clear();
  fixtures.jobDurationMs = 0;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('reference health on the fixture page', () => {
  it('marks the retracted work in the reference list itself, before any check', async () => {
    mount();
    await waitFor(() => expect(entry(OKAFOR.key)).toBeTruthy(), { timeout: 5_000 });
    const retracted = entry(OKAFOR.key)!.querySelector('[data-mark="retracted"]');
    expect(retracted?.textContent).toContain('Retracted');
    // Said as text, so a reader of the page or its print sees it without hovering.
    expect(entry(OKAFOR.key)!.textContent).toContain('Retracted');
    expect(await screen.findByText('References not checked yet.')).toBeTruthy();
  });

  it('checks the references, says what it found where each reference is, and stages the refresh for review', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Check references' }, { timeout: 5_000 }));
    expect(await screen.findByText(/^Checked .+: 1 retracted · 2 out of date · 1 duplicate · 1 to review\.$/, undefined, { timeout: 5_000 })).toBeTruthy();

    // The list: the duplicate on both its entries, the out-of-date record on its own.
    await waitFor(() => expect(entry(VASWANI.key)?.querySelector('[data-finding="duplicate"]')).toBeTruthy());
    expect(entry(VASWANI_DOI.key)?.querySelector('[data-finding="duplicate"]')).toBeTruthy();
    expect(entry(LEPIKHIN.key)?.querySelector('[data-finding="stale"]')).toBeTruthy();
    expect(entry(LEPIKHIN.key)?.textContent).toContain('The registries now give its marks and notices otherwise. A refresh is proposed for review.');
    expect(entry(OKAFOR.key)?.querySelector('[data-finding]')).toBeNull();

    // The Sources panel's rows say the same.
    const row = document.querySelector<HTMLElement>(`[data-source-key="${CSS.escape(VASWANI_DOI.key)}"]`)!;
    expect(within(row).getByText(/^The same work as “Attention Is All You Need”/)).toBeTruthy();

    // The refresh is reviewed like any change set: the newer records, by key.
    await waitFor(() => expect(reviewRef.current?.pending).toHaveLength(1), { timeout: 5_000 });
    expect(reviewRef.current?.pending[0]?.kind).toBe('sources');
  }, 20_000);

  it('gives the counts in the export dialog, from the page’s records and then from the check', async () => {
    mount(true);
    const note = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-reference-counts]');
      if (!found) throw new Error('no counts yet');
      return found;
    }, { timeout: 5_000 });
    // From the page: the retracted work, the needs-review and unchecked ones, no orphan.
    expect(note.textContent).toContain('References: 1 retracted · 2 not verified · 0 cited with no entry in the sources.');
    expect(note.textContent).toContain('From the page’s own records; not checked yet.');
    fireEvent.click(within(note).getByRole('button', { name: 'Check references' }));
    await waitFor(() => expect(note.textContent).toMatch(/From the reference check of /), { timeout: 5_000 });
    // The registries verify the entry typed by hand: one fewer not verified.
    expect(note.textContent).toContain('References: 1 retracted · 1 not verified · 0 cited with no entry in the sources.');
  }, 20_000);
});
