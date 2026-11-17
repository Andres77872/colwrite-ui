import { itemAt } from '@/lib/itemAt';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { NavigationProvider } from '@/components/layout/NavigationContext';
import { http, server, serverError } from '@/__tests__/server';
import type { UpdateUserProfileRequest } from '@/api/schema';
import type { UserMe } from '@/data/userProfile';
import type { WorkspaceUsage } from '@/data/workspaces';

/**
 * The server: `GET /users/me`, `PATCH /users/me` with its body, and the
 * workspace's `GET /workspaces/{w}/usage` by its query. A stand-in that
 * throws is the server failing.
 */
const getMe = vi.fn<() => Promise<UserMe>>();
const getUsage = vi.fn<(query: Record<string, string>) => Promise<WorkspaceUsage>>();
const updateProfile = vi.fn<(body: UpdateUserProfileRequest) => Promise<UserMe>>();
const setPanel = vi.fn();

// Settings no longer opens pages, so it never reads the editor. The module
// is stubbed only because the navigation provider imports it for its URL
// sync, which this test does not mount.
vi.mock('@/editor', () => ({}));
vi.mock('@/components/panels/panelsContextState', () => ({ usePanels: () => ({ setPanel }) }));
vi.mock('@/components/preferences', () => ({
  AssistantPreferences: ({ leading }: { leading?: React.ReactNode }) => (
    <section aria-label="Agent preferences">
      {leading}
      Agent capability controls
      <input aria-label="Agent preference draft" />
    </section>
  ),
  AgentEnginePreferences: () => <div>Agent engine choice</div>,
}));

const { ProfileView } = await import('../ProfileView');

const ME: UserMe = {
  identity: { user_id: 'usr-1', username: 'ada', email: 'ada@example.test', user_type: 'consumer' },
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
    last_seen_at: '2026-07-20T10:00:00Z',
    created_at: '2026-01-05T09:00:00Z',
    updated_at: '2026-07-20T10:00:00Z',
  },
};

const USAGE: WorkspaceUsage = {
  days: 30,
  summary: {
    documents_active: 3,
    documents_deleted: 1,
    first_document_at: '2026-01-06T09:00:00Z',
    last_document_at: '2026-07-19T18:00:00Z',
    document_saves: 128,
    chats_total: 6,
    chat_messages_total: 42,
    assistant_runs_total: 17,
    assistant_runs_completed: 15,
    assistant_runs_failed: 2,
    last_assistant_run_at: '2026-07-19T18:00:00Z',
    tokens_input: 120_000,
    tokens_output: 34_000,
    tokens_cached: 80_000,
    cost: 0.4213,
    llm_calls_total: 51,
    tool_calls_total: 88,
    tool_calls_failed: 3,
    resources_active: 2,
    resources_bytes: 3_145_728,
    last_resource_at: '2026-07-18T12:00:00Z',
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
      last_used_at: '2026-07-19T18:00:00Z',
    },
  ],
  pages: [
    {
      id: '507f1f77bcf86cd799439011',
      name: 'Thesis draft',
      updated_at: '2026-07-19T18:00:00Z',
      saves: 64,
      chats: 3,
      assistant_runs: 9,
      pdfs: 1,
    },
  ],
  storage: { pdfs: 2, pdf_bytes: 3_145_728 },
};

/** Radix tabs activate on mousedown. */
function openPane(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
}

function renderProfile() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <NavigationProvider>
          <ProfileView />
        </NavigationProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '/?view=settings');
  setPanel.mockReset();
  getMe.mockReset().mockResolvedValue(ME);
  getUsage.mockReset().mockResolvedValue(USAGE);
  updateProfile.mockReset();
  server.use(
    http.get('/users/me', ({ response }) => getMe().then((body) => response(200).json(body), serverError)),
    http.get('/workspaces/{workspace_id}/usage', ({ request, response }) =>
      getUsage(Object.fromEntries(new URL(request.url).searchParams)).then((body) => response(200).json(body), serverError)),
    http.patch('/users/me', async ({ request, response }) =>
      updateProfile(await request.json()).then((body) => response(200).json(body), serverError)),
  );
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('ProfileView', () => {
  it('reads the person and the shown workspace’s usage, one request each', async () => {
    renderProfile();

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(getUsage).toHaveBeenCalledExactlyOnceWith({ days: '30' });
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
      identity: ME.identity,
      profile: { ...ME.profile, headline: 'Parsing at scale' },
    });
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Parsing at scale' } });
    const bar = screen.getByRole('region', { name: 'Unsaved changes' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    expect(updateProfile.mock.calls[0]?.[0]).toMatchObject({
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

  it('lays settings out as six panes with a navigation list', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });

    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
    // Pages are managed in the sidebar and PDFs in the Library: no pane
    // lists either.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Account',
      'Preferences',
      'AI & tools',
      'Workspace',
      'Members',
      'Usage',
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
    const tiles = within(screen.getByRole('region', { name: 'Usage summary' }));
    expect(tiles.getByText('Pages')).toBeTruthy();
    expect(tiles.getByText('Tokens')).toBeTruthy();
    // 120,000 in + 34,000 out, compacted.
    expect(tiles.getByText('154K')).toBeTruthy();
    expect(tiles.getByText('120K in · 34K out · 80K cached')).toBeTruthy();
    // The runs, with how many did not finish.
    expect(tiles.getByText('Assistant runs')).toBeTruthy();
    expect(tiles.getByText('2 did not finish')).toBeTruthy();
    // What the providers reported the assistant's model calls cost.
    expect(tiles.getByText('Cost')).toBeTruthy();
    expect(tiles.getByText('$0.42')).toBeTruthy();
    expect(tiles.getByText('Over 51 model calls')).toBeTruthy();
    // The PDF count is Storage's, not a tile.
    expect(tiles.queryByText('PDFs')).toBeNull();
  });

  it('shows activity by page as usage, with no save counter and no way to open the page', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    openPane('Usage');

    const table = screen.getByRole('table', { name: 'Saves, chats and assistant runs for each page' });
    const row = within(table).getByRole('row', { name: /Thesis draft/ });
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['64', '3', '9']);
    expect(row.textContent).not.toMatch(/\bv\d+\b/);
    // Pages are opened from the sidebar; Settings keeps no page list.
    expect(screen.queryByRole('button', { name: /Thesis draft/ })).toBeNull();
    // Three active pages, one row: the table says it shows only the latest.
    expect(screen.getByText('The 1 most recently edited of 3 pages.')).toBeTruthy();
  });

  it('summarises storage and opens the Library over the editor', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    openPane('Usage');

    const storage = within(screen.getByRole('region', { name: 'Storage' }));
    expect(storage.getByText('2 PDFs')).toBeTruthy();
    // Uploaded bytes are shown as a size, not a raw count.
    expect(storage.getByText(/3\.0 MB/)).toBeTruthy();
    expect(storage.getByText('1 of 2 converted to text · 1 collection')).toBeTruthy();
    expect(screen.queryByText('reference.pdf')).toBeNull();

    fireEvent.click(storage.getByRole('button', { name: 'Open Library' }));
    expect(setPanel).toHaveBeenCalledWith('library');
    // Settings closes: the Library is a tab beside the page, behind the dialog.
    expect(new URLSearchParams(window.location.search).get('view')).toBeNull();
  });

  it('says plainly when there are no pages or PDFs yet, and still offers the Library', async () => {
    getUsage.mockResolvedValue({
      ...USAGE,
      summary: { ...USAGE.summary, documents_active: 0, resources_active: 0, resources_bytes: 0 },
      pages: [],
      storage: { pdfs: 0, pdf_bytes: 0 },
    });
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    openPane('Usage');

    expect(screen.getByText('No pages yet')).toBeTruthy();
    expect(screen.queryByRole('table', { name: /each page/ })).toBeNull();
    const storage = within(screen.getByRole('region', { name: 'Storage' }));
    expect(storage.getByText('0 PDFs')).toBeTruthy();
    expect(storage.getByText('Upload PDFs in the Library to use them on your pages.')).toBeTruthy();
    expect(storage.getByRole('button', { name: 'Open Library' })).toBeTruthy();
  });

  it('refreshes activity by page, not only the tiles', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    openPane('Usage');
    expect(screen.getByText('Thesis draft')).toBeTruthy();

    getUsage.mockResolvedValue({
      ...USAGE,
      pages: [{ ...itemAt(USAGE.pages, 0), name: 'Renamed elsewhere' }],
    });
    screen.getByRole('button', { name: /refresh/i }).click();

    await screen.findByText('Renamed elsewhere');
    expect(screen.queryByText('Thesis draft')).toBeNull();
  });

  it('reports a failed load in place, with a way to retry', async () => {
    getMe.mockRejectedValue(new Error('Service unavailable'));
    renderProfile();

    await screen.findByRole('alert');
    expect(screen.getByText('Service unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('keeps the account when the usage fails to load', async () => {
    getUsage.mockRejectedValue(new Error('Usage unavailable'));
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    openPane('Usage');

    expect(await screen.findByText('Usage unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('keeps agent preferences reachable when the profile fails to load', async () => {
    getMe.mockRejectedValue(new Error('Profile unavailable'));
    renderProfile();
    await screen.findByText('Profile unavailable');

    openPane('AI & tools');

    expect(await screen.findByRole('region', { name: 'Agent preferences' })).toBeTruthy();
  });

  it('switches Usage between this workspace and every workspace of the account', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    openPane('Usage');

    const scope = await screen.findByRole('radiogroup', { name: 'Usage of' });
    const thisOne = within(scope).getByRole('radio', { name: 'This workspace' });
    expect(thisOne.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(scope).getByRole('radio', { name: 'All workspaces' }));

    expect(await screen.findByRole('heading', { name: 'By workspace' })).toBeTruthy();
    expect(screen.getByText('Counting every workspace you are in.')).toBeTruthy();
    // Each workspace's runs and cost, from the mock's account usage.
    const byWorkspace = within(screen.getByRole('heading', { name: 'By workspace' }).closest('section') as HTMLElement).getByRole('table');
    expect(within(byWorkspace).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(
      ['Workspace', 'Pages', 'Assistant runs', 'Cost', 'PDFs', 'Storage'],
    );
    expect(within(byWorkspace).getAllByRole('row')[1]?.textContent).toContain('$1.68');
    // The pages table is one workspace's; the account-wide view has none.
    expect(screen.queryByRole('heading', { name: /Activity by page/ })).toBeNull();
  });
});
