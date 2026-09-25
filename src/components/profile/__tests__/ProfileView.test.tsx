import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ViewProvider } from '@/components/layout/ViewContext';
import type { UserOverview } from '@/services/userProfile';
import { makeResource } from '@/services/__tests__/resourceFixtures';

const switchTo = vi.fn<(_id: string) => Promise<boolean>>(async () => true);
const getOverview = vi.fn<() => Promise<UserOverview>>();
const updateProfile = vi.fn();
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
  return {
    ...actual,
    getOverview: () => getOverview(),
    updateProfile: (changes: unknown) => updateProfile(changes),
  };
});
vi.mock('@/components/preferences', () => ({
  AgentToolsPreferences: ({ leading }: { leading?: React.ReactNode }) => (
    <section aria-label="Agent preferences">
      {leading}
      Agent capability controls
      <input aria-label="Agent preference draft" />
    </section>
  ),
  AgentEnginePreferences: () => <div>Agent engine choice</div>,
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

/** Radix tabs activate on mousedown. */
function openPane(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
}

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
  updateProfile.mockReset();
  getOverview.mockResolvedValue(OVERVIEW);
});

afterEach(cleanup);

describe('ProfileView', () => {
  it('loads the whole dashboard in a single request', async () => {
    renderProfile();

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(getOverview).toHaveBeenCalledTimes(1);
  });

  it('lays the account out as labelled rows, editable in place', async () => {
    renderProfile();

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.getByText(/@ada/)).toBeTruthy();
    const value = (name: string) => (screen.getByLabelText(name) as HTMLInputElement).value;
    expect(value('Preferred name')).toBe('Ada Lovelace');
    expect(value('Headline')).toBe('Computational linguistics');
    expect(value('Affiliation')).toBe('Analytical Engine Lab');
    expect(value('About')).toBe('Working on note-to-paper pipelines.');
    expect(value('Time zone')).toBe('UTC');
    // No "Edit profile" detour, and the username is shown read-only.
    expect(screen.queryByRole('button', { name: /edit profile/i })).toBeNull();
    expect(screen.getByText('Username')).toBeTruthy();
    expect(screen.getByText(/managed by your ColWrite account/)).toBeTruthy();
  });

  it('shows no badge for the default account type', async () => {
    renderProfile();

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.queryByText('consumer')).toBeNull();
  });

  it('offers a save bar once a field changes, and saves every field', async () => {
    updateProfile.mockResolvedValue({
      profile: { ...OVERVIEW.profile, headline: 'Parsing at scale' },
    });
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Parsing at scale' } });
    const bar = screen.getByRole('region', { name: 'Unsaved changes' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    expect(updateProfile.mock.calls[0][0]).toMatchObject({
      display_name: 'Ada Lovelace',
      headline: 'Parsing at scale',
      affiliation: 'Analytical Engine Lab',
      timezone: 'UTC',
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull());
  });

  it('discards unsaved edits from the save bar', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });

    fireEvent.change(screen.getByLabelText('Affiliation'), { target: { value: 'Elsewhere' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect((screen.getByLabelText('Affiliation') as HTMLInputElement).value).toBe('Analytical Engine Lab');
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
  });

  it('lays settings out as panes with a navigation list', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });

    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Account',
      'Preferences',
      'AI & tools',
      'Usage',
      'Documents & files',
    ]);
  });

  it('provides a dedicated agent tools preferences pane', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });

    openPane('AI & tools');

    expect(await screen.findByRole('region', { name: 'Agent preferences' })).toBeTruthy();
  });

  it('hides the force-mounted agent pane while another pane is showing', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });

    // Mounted for the draft's sake, and hidden by its inactive state (jsdom
    // applies no stylesheet, so the hook itself is what can be checked).
    const pane = screen.getByRole('region', { name: 'Agent preferences' }).closest('[role="tabpanel"]');
    expect(pane?.getAttribute('data-state')).toBe('inactive');
    expect(pane?.className).toContain('data-[state=inactive]:hidden');
  });

  it('keeps an unsaved preferences draft when switching profile tabs', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });

    openPane('AI & tools');
    const draft = await screen.findByRole('textbox', { name: 'Agent preference draft' });
    fireEvent.change(draft, { target: { value: 'unsaved choice' } });

    openPane('Account');
    openPane('AI & tools');

    expect(
      (screen.getByRole('textbox', {
        name: 'Agent preference draft',
      }) as HTMLInputElement).value,
    ).toBe('unsaved choice');
  });

  it('renders the usage tiles from the summary', async () => {
    renderProfile();

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    openPane('Usage');
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
    openPane('Documents & files');

    await screen.findByText('Thesis draft');
    expect(screen.getByText('64')).toBeTruthy();
    expect(screen.getByText('assistant runs')).toBeTruthy();
  });

  it('opens a document and returns to the editor', async () => {
    renderProfile();
    openPane('Documents & files');

    // "Open" alone is not a name a screen-reader user can act on in a list of
    // documents, so each button names its document.
    const open = await screen.findByRole('button', { name: 'Open Thesis draft' });
    open.click();

    await waitFor(() => expect(switchTo).toHaveBeenCalledWith('507f1f77bcf86cd799439011'));
  });

  it('makes the document name itself open the document', async () => {
    renderProfile();
    openPane('Documents & files');

    const name = await screen.findByRole('button', { name: 'Thesis draft' });
    name.click();

    await waitFor(() => expect(switchTo).toHaveBeenCalledWith('507f1f77bcf86cd799439011'));
  });

  it('shows pending feedback without marking the requested row current', async () => {
    editorState.documentId = 'another-document';
    editorState.loadingDocumentId = '507f1f77bcf86cd799439011';
    renderProfile();
    openPane('Documents & files');

    const name = await screen.findByRole('button', { name: 'Thesis draft' });
    expect(name.getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Thesis draft' }).textContent).toContain('Opening…');

    name.click();
    expect(switchTo).not.toHaveBeenCalled();
  });

  it('lists uploaded PDFs with their size', async () => {
    renderProfile();
    openPane('Documents & files');

    await screen.findByText('reference.pdf');
    expect(screen.getByText(/1\.0 MB/)).toBeTruthy();
  });

  it('refreshes the lists, not only the tiles', async () => {
    renderProfile();
    openPane('Documents & files');
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

    openPane('AI & tools');

    expect(await screen.findByRole('region', { name: 'Agent preferences' })).toBeTruthy();
  });
});
