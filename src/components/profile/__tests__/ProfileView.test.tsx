import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ViewProvider } from '@/components/layout/ViewContext';
import type { UserOverview } from '@/services/userProfile';
import { makeResource } from '@/services/__tests__/resourceFixtures';

const switchTo = vi.fn<(_id: string) => Promise<boolean>>(async () => true);
const getOverview = vi.fn<() => Promise<UserOverview>>();
const editorState = {
  documentId: null as string | null,
  loadingDocumentId: null as string | null,
};

// The editor context is mocked rather than mounted: the dashboard only uses
// it to open a document, and a real EditorProvider would pull the whole
// document-loading stack into a test about rendering an account page.
vi.mock('@/editor', () => ({ useEditor: () => ({ ...editorState, switchTo }) }));
vi.mock('@/services/userProfile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/userProfile')>();
  return { ...actual, getOverview: () => getOverview() };
});
vi.mock('@/components/preferences', () => ({
  AgentToolsPreferences: () => (
    <section aria-label="Agent preferences">
      Agent capability controls
      <input aria-label="Agent preference draft" />
    </section>
  ),
}));

const { ProfileView } = await import('../ProfileView');

const OVERVIEW: UserOverview = {
  identity: { user_id: 'usr-1', username: 'ada', user_type: 'consumer' },
  profile: {
    user_id: 'usr-1',
    username: 'ada',
    display_name: 'Ada Lovelace',
    headline: 'Computational linguistics',
    affiliation: 'Analytical Engine Lab',
    bio: 'Working on note-to-paper pipelines.',
    locale: 'en',
    timezone: 'UTC',
    avatar_url: null,
    preferences: null,
    last_seen_at: '2026-07-20T10:00:00',
    created_at: '2026-01-05T09:00:00',
    updated_at: '2026-07-20T10:00:00',
  },
  summary: {
    documents_active: 3,
    documents_deleted: 1,
    first_document_at: '2026-01-06T09:00:00',
    last_document_at: '2026-07-19T18:00:00',
    document_saves: 128,
    chats_total: 6,
    chat_messages_total: 42,
    agent_runs_total: 17,
    agent_runs_completed: 15,
    agent_runs_failed: 2,
    last_agent_run_at: '2026-07-19T18:00:00',
    tokens_input: 120_000,
    tokens_output: 34_000,
    llm_calls_total: 51,
    tool_calls_total: 88,
    tool_calls_failed: 3,
    resources_active: 2,
    resources_bytes: 3_145_728,
    last_resource_at: '2026-07-18T12:00:00',
    resources_extracted: 1,
    collections_active: 1,
  },
  activity: [],
  tools: [
    {
      tool_name: 'doc_edit',
      call_count: 40,
      error_count: 1,
      avg_duration_ms: 210,
      last_used_at: '2026-07-19T18:00:00',
    },
  ],
  documents: [
    {
      document_id: '507f1f77bcf86cd799439011',
      name: 'Thesis draft',
      version: 12,
      created_at: '2026-01-06T09:00:00',
      updated_at: '2026-07-19T18:00:00',
      chat_count: 3,
      agent_run_count: 9,
      save_count: 64,
      resource_count: 1,
    },
  ],
  resources: [makeResource()],
  collections: [],
};

function renderProfile() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <ViewProvider>
          <ProfileView />
        </ViewProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  switchTo.mockClear();
  switchTo.mockResolvedValue(true);
  editorState.documentId = null;
  editorState.loadingDocumentId = null;
  getOverview.mockReset();
  getOverview.mockResolvedValue(OVERVIEW);
});

afterEach(cleanup);

describe('ProfileView', () => {
  it('loads the whole dashboard in a single request', async () => {
    renderProfile();

    await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 });
    expect(getOverview).toHaveBeenCalledTimes(1);
  });

  it('shows the application-owned profile, not auth fields', async () => {
    renderProfile();

    await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 });
    expect(screen.getByText('@ada')).toBeTruthy();
    expect(screen.getByText('Computational linguistics')).toBeTruthy();
    expect(screen.getByText('Analytical Engine Lab')).toBeTruthy();
  });

  it('provides a dedicated agent tools preferences tab', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 });

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agent tools' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByRole('region', { name: 'Agent preferences' })).toBeTruthy();
  });

  it('keeps an unsaved preferences draft when switching profile tabs', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 });

    const agentTab = screen.getByRole('tab', { name: 'Agent tools' });
    fireEvent.mouseDown(agentTab, { button: 0, ctrlKey: false });
    const draft = await screen.findByRole('textbox', { name: 'Agent preference draft' });
    fireEvent.change(draft, { target: { value: 'unsaved choice' } });

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Overview' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.mouseDown(agentTab, { button: 0, ctrlKey: false });

    expect(
      (screen.getByRole('textbox', {
        name: 'Agent preference draft',
      }) as HTMLInputElement).value,
    ).toBe('unsaved choice');
  });

  it('renders the usage tiles from the summary', async () => {
    renderProfile();

    await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 });
    // Scoped: "Documents" is both a tile label and a section heading.
    const tiles = within(screen.getByRole('region', { name: 'Usage summary' }));
    expect(tiles.getByText('Documents')).toBeTruthy();
    expect(tiles.getByText('Tokens')).toBeTruthy();
    // 120,000 in + 34,000 out, compacted.
    expect(tiles.getByText('154K')).toBeTruthy();
    expect(tiles.getByText('120K in · 34K out')).toBeTruthy();
    // Uploaded bytes are shown as a size, not a raw count.
    expect(tiles.getByText('3.0 MB')).toBeTruthy();
  });

  it('lists documents with the activity only MySQL knows', async () => {
    renderProfile();

    await screen.findByText('Thesis draft');
    expect(screen.getByText('64')).toBeTruthy();
    expect(screen.getByText('assistant runs')).toBeTruthy();
  });

  it('opens a document and returns to the editor', async () => {
    renderProfile();

    // "Open" alone is not a name a screen-reader user can act on in a list of
    // documents, so each button names its document.
    const open = await screen.findByRole('button', { name: 'Open Thesis draft' });
    open.click();

    await waitFor(() => expect(switchTo).toHaveBeenCalledWith('507f1f77bcf86cd799439011'));
  });

  it('makes the document name itself open the document', async () => {
    renderProfile();

    const name = await screen.findByRole('button', { name: 'Thesis draft' });
    name.click();

    await waitFor(() => expect(switchTo).toHaveBeenCalledWith('507f1f77bcf86cd799439011'));
  });

  it('shows pending feedback without marking the requested row current', async () => {
    editorState.documentId = 'another-document';
    editorState.loadingDocumentId = '507f1f77bcf86cd799439011';
    renderProfile();

    const name = await screen.findByRole('button', { name: 'Thesis draft' });
    expect(name.getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Thesis draft' }).textContent).toContain('Opening…');

    name.click();
    expect(switchTo).not.toHaveBeenCalled();
  });

  it('lists uploaded PDFs with their size', async () => {
    renderProfile();

    await screen.findByText('reference.pdf');
    expect(screen.getByText(/1\.0 MB/)).toBeTruthy();
  });

  it('refreshes the lists, not only the tiles', async () => {
    renderProfile();
    await screen.findByText('Thesis draft');

    getOverview.mockResolvedValue({
      ...OVERVIEW,
      documents: [{ ...OVERVIEW.documents[0], name: 'Renamed elsewhere' }],
      resources: [{ ...OVERVIEW.resources[0], filename: 'newer.pdf' }],
    });
    screen.getByRole('button', { name: /refresh/i }).click();

    // The list sections seed their paging state from props, so a refresh only
    // reaches them if they are remounted for the new fetch.
    await screen.findByText('Renamed elsewhere');
    expect(screen.getByText('newer.pdf')).toBeTruthy();
  });

  it('reports a failed load in place, with a way to retry', async () => {
    getOverview.mockRejectedValue(new Error('Service unavailable'));
    renderProfile();

    await screen.findByRole('alert');
    expect(screen.getByText('Service unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('keeps agent preferences reachable when overview loading fails', async () => {
    getOverview.mockRejectedValue(new Error('Overview unavailable'));
    renderProfile();
    await screen.findByText('Overview unavailable');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agent tools' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByRole('region', { name: 'Agent preferences' })).toBeTruthy();
  });
});
