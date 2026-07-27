import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ViewProvider } from '@/components/layout/ViewContext';
import type { UserOverview } from '@/services/userProfile';

const switchTo = vi.fn(async () => {});
const getOverview = vi.fn<() => Promise<UserOverview>>();

// The editor context is mocked rather than mounted: the dashboard only uses
// it to open a document, and a real EditorProvider would pull the whole
// document-loading stack into a test about rendering an account page.
vi.mock('@/editor', () => ({ useEditor: () => ({ switchTo }) }));
vi.mock('@/services/userProfile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/userProfile')>();
  return { ...actual, getOverview: () => getOverview() };
});

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
    uploads_active: 2,
    uploads_bytes: 3_145_728,
    last_upload_at: '2026-07-18T12:00:00',
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
      upload_count: 1,
    },
  ],
  uploads: [
    {
      id: 1,
      filename: 'reference.pdf',
      content_type: 'application/pdf',
      byte_size: 1_048_576,
      checksum_sha256: 'a'.repeat(64),
      document_id: null,
      document_name: null,
      created_at: '2026-07-18T12:00:00',
      updated_at: '2026-07-18T12:00:00',
    },
  ],
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

    const open = await screen.findByRole('button', { name: 'Open' });
    open.click();

    await waitFor(() => expect(switchTo).toHaveBeenCalledWith('507f1f77bcf86cd799439011'));
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
      uploads: [{ ...OVERVIEW.uploads[0], filename: 'newer.pdf' }],
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
});
