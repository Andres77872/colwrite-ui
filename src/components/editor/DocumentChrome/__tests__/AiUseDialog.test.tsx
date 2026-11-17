import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { TestWorkspace } from '@/__tests__/workspace';
import { recordRequests, queryOf } from '@/__tests__/server';
import { ToastProvider } from '@/components/ui/toast';
import { FIXTURE_DOCUMENT_ID } from '@/dev/msw/fixtures';

/**
 * "AI use…" (P2.UI-4): the page's AI-use log, read from the server, and a
 * draft statement for a venue the API lists, copied as written.
 */

const { EditorProvider } = await import('@/editor');
const { AiUseDialog } = await import('../AiUseDialog');

function mount() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>
        <TestWorkspace initialDocumentId={FIXTURE_DOCUMENT_ID}>
          <EditorProvider>
            <AiUseDialog open onOpenChange={() => {}} />
          </EditorProvider>
        </TestWorkspace>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const writeText = vi.fn(async () => {});
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  writeText.mockClear();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('the AI use dialog', () => {
  it('lists what the assistant did, with how each was verified', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'AI use' });
    const log = within(dialog).getByRole('region', { name: 'On this page' });
    await waitFor(() => expect(log.querySelectorAll('[data-ai-use-kind]')).toHaveLength(2), { timeout: 5_000 });
    const [cite, suggestion] = [...log.querySelectorAll('[data-ai-use-kind]')].map((row) => row.textContent);
    expect(cite).toContain('Added citations');
    expect(cite).toContain('In Introduction · anthropic/claude-sonnet-5.5 · Accepted one change at a time');
    expect(suggestion).toContain('Suggested a rewrite');
    expect(suggestion).toContain('Kept or discarded in the editor');
  });

  it('writes the statement for the venue chosen, from the venues the API lists, and copies it as written', async () => {
    const sent = recordRequests();
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'AI use' });
    const venue = within(dialog).getByRole('combobox', { name: 'Venue' });
    expect([...venue.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Elsevier journals', 'Taylor & Francis', 'IEEE', 'PLOS', 'Science journals', 'ACM', 'NeurIPS', 'ICLR',
    ]);
    const statement = () => dialog.querySelector('[data-ai-use-statement]')?.textContent ?? '';
    await waitFor(() => expect(statement()).toMatch(/^During the preparation of this work the author\(s\) used the ColWrite assistant/), { timeout: 5_000 });

    fireEvent.change(venue, { target: { value: 'ieee' } });
    await waitFor(() => expect(statement()).toContain('It was used in the sections “Introduction” and “Method”.'));
    expect(within(dialog).getByText(/^The acknowledgments: the AI system used/)).toBeTruthy();
    expect(sent.filter((request) => request.url.includes('/ai-use/statement')).map((request) => queryOf(request).venue)).toEqual(['elsevier', 'ieee']);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(statement()));
    expect(statement()).toContain('it does not cover text from other tools pasted into it');
  });
});
