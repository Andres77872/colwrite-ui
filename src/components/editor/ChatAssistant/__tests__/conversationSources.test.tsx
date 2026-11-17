import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { agentSource } from '@/__tests__/agentSource';
import type { ReferenceRecord } from '@/editor/types';
import { emptyMessage, type ChatMessage } from '../chatUtils';
import { conversationSources } from '../transcript';

vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: vi.fn(),
  saveDocument: vi.fn(async () => ({ etag: 'cw:2', updatedAt: null })),
  getDocument: vi.fn(),
}));

const { EditorProvider, useEditorDoc } = await import('@/editor');
const { MessageRow } = await import('../MessageRow');

/**
 * A handle lasts for the conversation (`ColWrite-api/docs/assistant-notebook.md`):
 * a reply's `[S1]` names what any turn of it registered, so it is read
 * against every reply's sources, not only its own.
 */

const PAPER = agentSource(
  'S1',
  { key: 'arxiv:2101.03961', title: 'Switch Transformers', authors: 'William Fedus, Barret Zoph', year: 2021, provider: 'semantic_scholar', kind: 'preprint' },
);
const PAGE = agentSource('S2', { key: 'url:https://huggingface.co/blog/moe', title: 'Mixture of Experts Explained', provider: 'web', kind: 'web' });

const reply = (id: string, content: string, sources?: ChatMessage['sources']): ChatMessage => (
  { ...emptyMessage('assistant', content), id, ...(sources ? { sources } : {}) }
);

/** The page's library as it stands after each render. */
const library = vi.fn<(sources: ReferenceRecord[] | undefined) => void>();
function Library() {
  const { doc } = useEditorDoc();
  useEffect(() => library(doc.sources));
  return null;
}

function mount(message: ChatMessage, known: ChatMessage['sources'] = []) {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <EditorProvider>
          <Library />
          <MessageRow
            message={message}
            knownSources={known}
            live={false}
            latest={false}
            openChangeIds={[]}
            onFocusChange={() => {}}
          />
        </EditorProvider>
      </TooltipProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockDocumentList();
  library.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the conversation’s sources', () => {
  it('hold every reply’s sources once by handle, where each first arrived, with the latest entry of each', () => {
    const better = agentSource('S1', { ...PAPER.record, csl: { ...PAPER.record.csl, DOI: '10.5555/switch' } });
    const messages = [reply('a', 'One [S1].', [PAPER]), emptyMessage('user', 'More?'), reply('b', 'Two [S2], one [S1].', [PAGE, better])];
    expect(conversationSources(messages)).toEqual([better, PAGE]);
    expect(conversationSources([emptyMessage('user', 'Hi')])).toEqual([]);
  });
});

describe('a reply citing what an earlier turn found', () => {
  it('numbers its marker, lists the source under it, and keeps the source’s record in the page', async () => {
    mount(reply('r2', 'As found earlier [S1]. Made up [S9].'), [PAPER, PAGE]);

    expect(screen.getByRole('button', { name: /Source 1: Switch Transformers/ })).toBeTruthy();
    // A handle the conversation never received is not a source.
    expect(screen.getByText(/Made up \[S9\]/)).toBeTruthy();
    // Listed with what it cites; the page found earlier and not cited is not this reply's to list.
    const list = within(screen.getByRole('region', { name: 'Sources' }));
    expect(list.getByText('Switch Transformers')).toBeTruthy();
    expect(list.queryByText('Mixture of Experts Explained')).toBeNull();

    fireEvent.click(list.getByRole('button', { name: 'Add “Switch Transformers” to sources' }));
    // The library entry is the record as it came, and nothing of the handle.
    await waitFor(() => expect(library).toHaveBeenLastCalledWith([PAPER.record]));
  });

  it('leaves a marker as text when only the reply’s own sources are read, as an inline run’s are', () => {
    mount(reply('r3', 'As found earlier [S1].'));
    expect(screen.queryByRole('button', { name: /Source 1/ })).toBeNull();
    expect(screen.getByText(/As found earlier \[S1\]/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Sources' })).toBeNull();
  });
});
