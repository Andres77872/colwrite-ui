import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { HttpResponse, http, jsonOf, pathOf, recordRequests, server } from '@/__tests__/server';
import { ToastProvider } from '@/components/ui/toast';
import { NavigationProvider } from '@/components/layout/NavigationContext';
import { EditorProvider, useDocumentSession, useEditorActions } from '@/editor';
import {
  DELETED_WORKSPACE_ID,
  FIXTURE_DOCUMENT_ID,
  LAB_DOCUMENT_ID,
  LAB_WORKSPACE_ID,
  OWNED_WORKSPACE_ID,
  PERSONAL_WORKSPACE_ID,
  fixtures,
  workspaceDetail,
} from '@/dev/msw/fixtures';
import { documentKeys } from '@/data/documents';
import { isWorkspaceQuery, removeWorkspaceQueries, workspaceKeys, workspaceQuery } from '@/data/workspaces';
import { LAST_WORKSPACE_KEY, chatSelectionKey, draftKey, lastPageKey, unsavedKey } from '@/lib/storageKeys';
import { WorkspaceProvider } from '../WorkspaceProvider';
import { WorkspaceScope } from '../WorkspaceScope';
import { useWorkspace } from '../workspaceContextState';

/**
 * The workspace being shown, through the real providers against the mock
 * API's two workspaces (`docs/workspace_collection/08` §3.2, §5.1–5.3): the
 * choice and the URL it writes, what the server is told, the page the scope
 * opens first, and the switch.
 */

/** What the scope shows: the workspace, its open page, and a way to edit and to switch. */
function Probe() {
  const { workspace, switchWorkspace } = useWorkspace();
  const { documentId, pageCount, loadingDocumentId } = useDocumentSession();
  const { setDocName } = useEditorActions();
  return (
    <div>
      <p data-testid="workspace">{workspace.id}</p>
      <p data-testid="page">{documentId ?? 'none'}</p>
      <p data-testid="loading">{loadingDocumentId ?? 'none'}</p>
      <p data-testid="page-count">{pageCount ?? 'unknown'}</p>
      <button type="button" onClick={() => setDocName('Renamed before leaving')}>Edit</button>
      <button type="button" onClick={() => void switchWorkspace(LAB_WORKSPACE_ID)}>To the lab</button>
    </div>
  );
}

let queryClient: QueryClient;

function renderAt(search: string) {
  window.history.replaceState(null, '', `/${search}`);
  queryClient = createTestQueryClient();
  return render(
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationProvider>
          <WorkspaceProvider>
            <WorkspaceScope>
              <EditorProvider>
                <Probe />
              </EditorProvider>
            </WorkspaceScope>
          </WorkspaceProvider>
        </NavigationProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

/** Back, as the browser does it: the history moves, then `popstate` fires. */
async function goBack() {
  await act(async () => {
    window.history.back();
    await new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
  });
}

const shown = (id: string) => screen.findByText(id, { selector: '[data-testid="workspace"]' });
const urlWorkspace = () => new URLSearchParams(window.location.search).get('ws');
const paths = (sent: Request[]) => sent.map((request) => `${request.method} ${pathOf(request).replace(/^\/api/, '')}`);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('choosing the workspace', () => {
  it('opens a bare page link in the page’s workspace, says so, writes ?ws= and tells the server', async () => {
    const sent = recordRequests();
    renderAt(`?doc=${LAB_DOCUMENT_ID}`);

    await shown(LAB_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(LAB_DOCUMENT_ID));
    expect(await screen.findByText('Opened in Lab workspace')).toBeTruthy();
    expect(urlWorkspace()).toBe(LAB_WORKSPACE_ID);
    expect(paths(sent)).toContain(`GET /documents/${LAB_DOCUMENT_ID}/location`);
    const remembered = sent.find((request) => pathOf(request).endsWith('/users/me/last-workspace'));
    expect(await jsonOf(remembered)).toEqual({ workspace_id: LAB_WORKSPACE_ID });
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe(LAB_WORKSPACE_ID);
  });

  it('takes ?ws= without a page, and opens that workspace’s newest page', async () => {
    localStorage.setItem(LAST_WORKSPACE_KEY, PERSONAL_WORKSPACE_ID);
    const sent = recordRequests();
    renderAt(`?ws=${LAB_WORKSPACE_ID}`);

    await shown(LAB_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(LAB_DOCUMENT_ID));
    expect(paths(sent).some((path) => path.startsWith('GET /documents/'))).toBe(false);
    expect(paths(sent)).toContain(`GET /workspaces/${LAB_WORKSPACE_ID}/documents?limit=1&sort_by=updated_at&sort_order=desc`);
  });

  it('reopens the workspace the server remembers, without telling it again', async () => {
    fixtures.lastWorkspaceId = LAB_WORKSPACE_ID;
    localStorage.setItem(LAST_WORKSPACE_KEY, PERSONAL_WORKSPACE_ID);
    const sent = recordRequests();
    renderAt('');

    await shown(LAB_WORKSPACE_ID);
    expect(urlWorkspace()).toBe(LAB_WORKSPACE_ID);
    expect(paths(sent).some((path) => path.includes('last-workspace'))).toBe(false);
  });

  it('opens this workspace’s last page before asking for its newest', async () => {
    localStorage.setItem(lastPageKey(PERSONAL_WORKSPACE_ID), FIXTURE_DOCUMENT_ID);
    const sent = recordRequests();
    renderAt('');

    await shown(PERSONAL_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(FIXTURE_DOCUMENT_ID));
    expect(paths(sent).some((path) => path.startsWith(`GET /workspaces/${PERSONAL_WORKSPACE_ID}/documents?`))).toBe(false);
  });

  it('says plainly that a link it cannot locate is unavailable, and goes back to the workspace', async () => {
    const sent = recordRequests();
    // A page that is gone and one in a workspace the account is not in answer alike.
    renderAt('?doc=66f0c0ffee000000000000ff');

    expect(await screen.findByRole('heading', { name: 'This page isn’t available' })).toBeTruthy();
    expect(paths(sent).some((path) => path.startsWith(`GET /workspaces/${PERSONAL_WORKSPACE_ID}/documents/`))).toBe(false);
    expect(new URLSearchParams(window.location.search).get('doc')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Personal' }));
    await shown(PERSONAL_WORKSPACE_ID);
  });

  it('keeps a page it cannot locate requested in the ?ws= it names, whose read then says what it found', async () => {
    const sent = recordRequests();
    renderAt(`?ws=${PERSONAL_WORKSPACE_ID}&doc=66f0c0ffee000000000000ff`);

    await shown(PERSONAL_WORKSPACE_ID);
    await waitFor(() =>
      expect(paths(sent)).toContain(`GET /workspaces/${PERSONAL_WORKSPACE_ID}/documents/66f0c0ffee000000000000ff`),
    );
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('none'));
    expect(screen.getByTestId('page').textContent).toBe('none');
  });

  it('says nothing about a link into the workspace the order picks anyway', async () => {
    renderAt(`?doc=${FIXTURE_DOCUMENT_ID}`);
    await shown(PERSONAL_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(FIXTURE_DOCUMENT_ID));
    expect(screen.queryByText(/^Opened in/)).toBeNull();
  });
});

describe('a first run', () => {
  it('reads only the workspaces and the workspace’s page count, and opens the first-run screen', async () => {
    server.use(http.get('/workspaces/{workspace_id}', ({ params, response }) => {
      const workspace = fixtures.workspaces.get(params.workspace_id);
      if (!workspace) throw new Error(`No workspace ${params.workspace_id}`);
      const detail = workspaceDetail(workspace);
      return response(200).json({ ...detail, counts: { ...detail.counts, pages: 0 } });
    }));
    const sent = recordRequests();
    renderAt('');

    await shown(PERSONAL_WORKSPACE_ID);
    // `pageCount === 0` with no page open is what the canvas shows
    // "Start your first page" for.
    await waitFor(() => expect(screen.getByTestId('page-count').textContent).toBe('0'));
    expect(screen.getByTestId('page').textContent).toBe('none');
    expect(paths(sent).filter((path) => path.startsWith('GET '))).toEqual([
      'GET /workspaces',
      `GET /workspaces/${PERSONAL_WORKSPACE_ID}`,
    ]);
  });
});

describe('switching workspaces', () => {
  it('saves the open page first, drops the old workspace’s queries, and opens the new one', async () => {
    localStorage.setItem(lastPageKey(PERSONAL_WORKSPACE_ID), FIXTURE_DOCUMENT_ID);
    renderAt('');
    await shown(PERSONAL_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(FIXTURE_DOCUMENT_ID));
    queryClient.setQueryData(documentKeys.content(PERSONAL_WORKSPACE_ID, 'doc-x'), { doc: { blocks: [] } });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sent = recordRequests();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'To the lab' }));
    });

    await shown(LAB_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(LAB_DOCUMENT_ID));
    const order = paths(sent);
    const save = order.indexOf(`PUT /workspaces/${PERSONAL_WORKSPACE_ID}/documents/${FIXTURE_DOCUMENT_ID}`);
    const firstLab = order.findIndex((path) => path.includes(LAB_WORKSPACE_ID));
    // The edit reached the server before anything of the next workspace was read.
    expect(save).toBeGreaterThanOrEqual(0);
    expect(save).toBeLessThan(firstLab);
    expect(fixtures.documents.get(FIXTURE_DOCUMENT_ID)?.name).toBe('Renamed before leaving');
    // Nothing of the old workspace is left in the cache to be shown or refetched.
    expect(queryClient.getQueryCache().findAll({ predicate: isWorkspaceQuery(PERSONAL_WORKSPACE_ID) })).toEqual([]);
    expect(urlWorkspace()).toBe(LAB_WORKSPACE_ID);
  });

  it('keeps the open page’s edits on this device when their save fails, before the next workspace mounts', async () => {
    localStorage.setItem(lastPageKey(PERSONAL_WORKSPACE_ID), FIXTURE_DOCUMENT_ID);
    renderAt('');
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(FIXTURE_DOCUMENT_ID));
    server.use(http.put('/workspaces/{workspace_id}/documents/{document_id}', () => HttpResponse.error()));

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'To the lab' }));
    });

    await shown(LAB_WORKSPACE_ID);
    // Kept under the workspace it belongs to, offered back when the page opens there again.
    const kept = localStorage.getItem(unsavedKey(PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID));
    expect(kept).toContain('Renamed before leaving');
    expect(fixtures.documents.get(FIXTURE_DOCUMENT_ID)?.name).not.toBe('Renamed before leaving');
  });

  it('pushes the switch, so Back returns to the previous workspace and its last page', async () => {
    localStorage.setItem(lastPageKey(PERSONAL_WORKSPACE_ID), FIXTURE_DOCUMENT_ID);
    renderAt('');
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(FIXTURE_DOCUMENT_ID));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'To the lab' }));
    });
    await shown(LAB_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(LAB_DOCUMENT_ID));

    await goBack();
    await shown(PERSONAL_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe(FIXTURE_DOCUMENT_ID));
    expect(urlWorkspace()).toBe(PERSONAL_WORKSPACE_ID);
    // Nothing of the lab is left in the cache.
    expect(queryClient.getQueryCache().findAll({ predicate: isWorkspaceQuery(LAB_WORKSPACE_ID) })).toEqual([]);
  });

  it('moves on, saying so, when the workspace shown leaves the list (deleted elsewhere)', async () => {
    renderAt(`?ws=${OWNED_WORKSPACE_ID}`);
    await shown(OWNED_WORKSPACE_ID);
    const side = fixtures.workspaces.get(OWNED_WORKSPACE_ID);
    if (!side) throw new Error('No owned workspace');
    side.deleted_at = new Date().toISOString();
    side.purge_after = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
    });
    await shown(PERSONAL_WORKSPACE_ID);
    expect(await screen.findByText('This workspace isn’t available')).toBeTruthy();
  });
});

describe('a workspace deleted elsewhere', () => {
  it('is noticed by the next read of it, which reads the list again and moves on', async () => {
    renderAt(`?ws=${OWNED_WORKSPACE_ID}`);
    await shown(OWNED_WORKSPACE_ID);
    const side = fixtures.workspaces.get(OWNED_WORKSPACE_ID);
    if (!side) throw new Error('No owned workspace');
    side.deleted_at = new Date().toISOString();
    side.purge_after = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    // The tree's poll, or any read under it, answers 404 workspace_not_found.
    await act(async () => {
      await queryClient.fetchQuery({ ...workspaceQuery(OWNED_WORKSPACE_ID), staleTime: 0 }).catch(() => undefined);
    });
    await shown(PERSONAL_WORKSPACE_ID);
    expect(await screen.findByText('This workspace isn’t available')).toBeTruthy();
    expect(urlWorkspace()).toBe(PERSONAL_WORKSPACE_ID);
  });
});

describe('sweeping removed workspaces (M5.UI-4)', () => {
  it('removes what this browser kept for workspaces the account no longer has, and keeps the restorable ones', async () => {
    const gone = 'wsp-0b1d2c3e-left-the-account';
    localStorage.setItem(lastPageKey(PERSONAL_WORKSPACE_ID), FIXTURE_DOCUMENT_ID);
    localStorage.setItem(unsavedKey(LAB_WORKSPACE_ID, LAB_DOCUMENT_ID), '{"name":"kept"}');
    localStorage.setItem(lastPageKey(gone), 'doc-gone');
    localStorage.setItem(draftKey(gone, 'doc-gone'), '{"name":"draft"}');
    localStorage.setItem(chatSelectionKey(gone, 'doc-gone'), 'chat-1');
    localStorage.setItem(unsavedKey(DELETED_WORKSPACE_ID, 'doc-old'), '{"name":"edits"}');
    localStorage.setItem(LAST_WORKSPACE_KEY, gone);
    localStorage.setItem('colwrite:device:theme', 'dark');

    renderAt('');
    await shown(PERSONAL_WORKSPACE_ID);

    const left = Object.keys(localStorage).filter((key) => key.startsWith('colwrite:'));
    expect(left.some((key) => key.includes(gone))).toBe(false);
    // The workspaces in the list keep theirs, and so does the deleted one still restorable.
    expect(localStorage.getItem(unsavedKey(LAB_WORKSPACE_ID, LAB_DOCUMENT_ID))).toBe('{"name":"kept"}');
    expect(localStorage.getItem(unsavedKey(DELETED_WORKSPACE_ID, 'doc-old'))).toBe('{"name":"edits"}');
    expect(localStorage.getItem('colwrite:device:theme')).toBe('dark');
    // This browser's pointer names a workspace of the account's again.
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe(PERSONAL_WORKSPACE_ID);
  });
});

describe('removeWorkspaceQueries', () => {
  it('drops one workspace’s domain and contract queries, and keeps everything else', async () => {
    const client = createTestQueryClient();
    const contract = (workspaceId: string) =>
      ['get', '/workspaces/{workspace_id}/documents/{document_id}/pdf-grants', { params: { path: { workspace_id: workspaceId, document_id: 'd' } } }];
    client.setQueryData(workspaceKeys.detail(PERSONAL_WORKSPACE_ID), 1);
    client.setQueryData(documentKeys.lists(PERSONAL_WORKSPACE_ID), 2);
    client.setQueryData(contract(PERSONAL_WORKSPACE_ID), 3);
    client.setQueryData(workspaceKeys.detail(LAB_WORKSPACE_ID), 4);
    client.setQueryData(contract(LAB_WORKSPACE_ID), 5);
    client.setQueryData(workspaceKeys.list(), 6);
    client.setQueryData(['users', 'me'], 7);

    await removeWorkspaceQueries(client, PERSONAL_WORKSPACE_ID);

    const left = client.getQueryCache().getAll().map((query) => query.state.data).sort();
    expect(left).toEqual([4, 5, 6, 7]);
  });
});
