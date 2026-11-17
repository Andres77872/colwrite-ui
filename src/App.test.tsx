import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from './components/ui/confirm-dialog';
import { ToastProvider } from './components/ui/toast';
import { TooltipProvider } from './components/ui/tooltip';
import { mockDocumentList } from './data/__tests__/documentFixtures';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { http, server } from '@/__tests__/server';

const mocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  saveDocument: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
}));

vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: (...args: unknown[]) => mocks.createDocument(...args),
  saveDocument: (...args: unknown[]) => mocks.saveDocument(...args),
  getDocument: (...args: unknown[]) => mocks.getDocument(...args),
}));

vi.mock('./components/auth/authContextState', () => ({
  useAuth: () => ({
    user: { name: 'Test Author', email: 'author@example.com' },
    status: 'authenticated',
    openAuth: vi.fn(),
    closeAuth: vi.fn(),
    logout: vi.fn(),
    loginWithCredentials: vi.fn(),
  }),
}));

// Keep the real app provider composition and document sidebar, while replacing
// unrelated visual surfaces with inert children. This makes remounts and list
// requests observable without pulling editor rendering into a routing test.
vi.mock('./components/layout/AppShell', () => ({
  AppShell: ({ left, main }: { left?: React.ReactNode; main: React.ReactNode }) => (
    <div>
      <aside>{left}</aside>
      <main>{main}</main>
    </div>
  ),
}));
vi.mock('./components/editor/Canvas', () => ({ Canvas: () => null }));
vi.mock('./components/editor/DocumentChrome', () => ({ PageTopbar: () => null }));
vi.mock('./components/editor/FloatingToolbar', () => ({ FloatingToolbar: () => null }));
vi.mock('./components/editor/SlashMenu', () => ({ SlashMenu: () => null }));
vi.mock('./components/layout/useAppChrome', () => ({
  useDocumentTitle: vi.fn(),
  useUnsavedGuard: vi.fn(),
  useStrayFileDropGuard: vi.fn(),
}));
vi.mock('./components/layout/Shortcuts', () => ({
  ShortcutsDialog: () => null,
  useAppShortcuts: vi.fn(),
}));
vi.mock('./components/landing', () => ({ LandingPage: () => null }));
vi.mock('./components/profile', () => ({ SettingsDialog: () => null }));
vi.mock('./components/preferences', () => ({
  AssistantCatalogProvider: ({ children }: { children: React.ReactNode }) => children,
  AgentEngineProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const { default: App } = await import('./App');

/** A page as the server answers it: its body and the ETag its next save locks on. */
function documentFor(id: string) {
  return {
    doc: {
      name: id === 'doc-a' ? 'Alpha' : 'Beta',
      blocks: [{ id: `${id}-p`, type: 'paragraph', html: id, children: [] }],
    },
    etag: `cw:${id}:1`,
    updatedAt: '2026-01-01T00:00:00Z',
    placement: { documentId: id, collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function listResult() {
  return {
    documents: [
      { id: 'doc-a', name: 'Alpha', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'doc-b', name: 'Beta', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    ],
    nextCursor: null,
  };
}

/** The page reads `getDocument(workspace, id, { signal })` makes. */
const opened = (id: string) => [TEST_WORKSPACE_ID, id, { signal: expect.any(AbortSignal) }];

function renderApp() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/?doc=doc-a');
  // The pages these tests open are the personal workspace's: a `?doc=` link
  // is located before it opens.
  server.use(http.get('/documents/{document_id}/location', ({ response }) =>
    response(200).json({ workspace_id: TEST_WORKSPACE_ID, collection_id: null })));
  mocks.createDocument.mockReset().mockResolvedValue({ id: 'created', ...documentFor('created') });
  mocks.saveDocument.mockReset().mockResolvedValue({ etag: 'cw:saved', updatedAt: null });
  mocks.getDocument.mockReset().mockImplementation(async (_workspaceId: string, id: string) => documentFor(id));
  mocks.listDocuments.mockReset().mockResolvedValue(listResult());
  mockDocumentList((body) => mocks.listDocuments(body));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:lastDocId`, 'doc-a');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('document selection integration', () => {
  it('shows the document skeleton immediately while an uncached startup target hydrates', async () => {
    const hydration = deferred<ReturnType<typeof documentFor>>();
    mocks.getDocument.mockReturnValue(hydration.promise);

    renderApp();

    // The workspace is chosen first; then the page shows its skeleton at once.
    expect(await screen.findByTestId('document-skeleton')).toBeTruthy();
    expect(screen.getByText('Opening page…')).toBeTruthy();
    expect(localStorage.getItem(`colwrite:ws:${TEST_WORKSPACE_ID}:draft:doc-a`)).toBeNull();

    await act(async () => {
      hydration.resolve(documentFor('doc-a'));
      await hydration.promise;
    });
    await waitFor(() => expect(screen.queryByTestId('document-skeleton')).toBeNull());
  });

  it('loads the selected document once without remounting or refetching the sidebar', async () => {
    renderApp();

    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledWith(...opened('doc-a')));
    const documents = await screen.findByRole('region', { name: 'Pages' });
    const beta = (await within(documents).findByText('Beta')).closest<HTMLElement>('[role="treeitem"]');
    if (!beta) throw new Error('Beta page row was not rendered');
    // The tree's pages at the top level, read once.
    const treeLoads = () => mocks.listDocuments.mock.calls.filter(
      ([options]) => (options as { collection_id?: string } | undefined)?.collection_id === 'root',
    ).length;
    await waitFor(() => expect(treeLoads()).toBe(1));

    const menuLoadsBefore = treeLoads();
    mocks.getDocument.mockClear();

    fireEvent.click(beta);

    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledTimes(1));
    expect(mocks.getDocument).toHaveBeenCalledWith(...opened('doc-b'));
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('doc')).toBe('doc-b');
    });

    // Give a stale URL effect or remount-triggered list timer several chances
    // to run. The active state and request counts must remain settled.
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(mocks.getDocument).toHaveBeenCalledTimes(1);
    expect(mocks.getDocument).toHaveBeenCalledWith(...opened('doc-b'));
    expect(new URLSearchParams(window.location.search).get('doc')).toBe('doc-b');
    expect(screen.getByRole('region', { name: 'Pages' })).toBe(documents);
    expect(treeLoads()).toBe(menuLoadsBefore);
  });

  it('keeps the committed URL until the requested document succeeds', async () => {
    renderApp();
    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledWith(...opened('doc-a')));
    await waitFor(() => expect(screen.queryByTestId('document-skeleton')).toBeNull());

    const opening = deferred<ReturnType<typeof documentFor>>();
    mocks.getDocument.mockImplementation((_workspaceId: string, id: string) => (
      id === 'doc-b' ? opening.promise : Promise.resolve(documentFor(id))
    ));
    const pages = await screen.findByRole('region', { name: 'Pages' });
    fireEvent.click((await within(pages).findByText('Beta')).closest('[role="treeitem"]')!);
    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledWith(...opened('doc-b')));
    expect(new URLSearchParams(window.location.search).get('doc')).toBe('doc-a');

    await act(async () => {
      opening.resolve(documentFor('doc-b'));
      await opening.promise;
    });
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('doc')).toBe('doc-b');
    });
  });

  it('restores the committed URL and shows one contextual notice after failed history navigation', async () => {
    renderApp();
    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledWith(...opened('doc-a')));
    await waitFor(() => expect(screen.queryByTestId('document-skeleton')).toBeNull());

    mocks.getDocument.mockRejectedValueOnce(new Error('No longer available'));
    window.history.pushState(null, '', '/?doc=doc-b');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(await screen.findByText('Could not go back to that page')).toBeTruthy();
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('doc')).toBe('doc-a');
    });
    expect(screen.getAllByText('Could not go back to that page')).toHaveLength(1);
  });
});
