import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from './components/ui/confirm-dialog';
import { ToastProvider } from './components/ui/toast';
import { TooltipProvider } from './components/ui/tooltip';

const mocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  saveDocument: vi.fn(),
  loadDocument: vi.fn(),
  deleteDocument: vi.fn(),
  listDocuments: vi.fn(),
}));

vi.mock('@/services', () => ({
  createDocument: (...args: unknown[]) => mocks.createDocument(...args),
  saveDocument: (...args: unknown[]) => mocks.saveDocument(...args),
  loadDocument: (...args: unknown[]) => mocks.loadDocument(...args),
  deleteDocument: (...args: unknown[]) => mocks.deleteDocument(...args),
  listDocuments: (...args: unknown[]) => mocks.listDocuments(...args),
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
}));
vi.mock('./components/layout/Shortcuts', () => ({
  ShortcutsDialog: () => null,
  useAppShortcuts: vi.fn(),
}));
vi.mock('./components/landing', () => ({ LandingPage: () => null }));
vi.mock('./components/profile', () => ({ SettingsDialog: () => null }));
vi.mock('./components/preferences', () => ({
  AgentToolsProvider: ({ children }: { children: React.ReactNode }) => children,
  AgentEngineProvider: ({ children }: { children: React.ReactNode }) => children,
  useAgentTools: () => ({
    isSourceEnabled: () => false,
    isToolEnabled: () => false,
  }),
}));

const { default: App } = await import('./App');

function documentFor(id: string) {
  return {
    version: id === 'doc-a' ? 1 : 2,
    name: id === 'doc-a' ? 'Alpha' : 'Beta',
    blocks: [{ id: `${id}-p`, type: 'paragraph', html: id, children: [] }],
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
      {
        id: 'doc-a',
        name: 'Alpha',
        version: 1,
        tags: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'doc-b',
        name: 'Beta',
        version: 2,
        tags: [],
        createdAt: '2026-01-02T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ],
    count: 2,
    page: 1,
    limit: 10,
    totalPages: 1,
    sortBy: 'updated_at',
    sortOrder: 'desc',
    status: 'ok',
    message: '',
  };
}

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
  mocks.createDocument.mockReset().mockResolvedValue({ document_id: 'created', version: 1 });
  mocks.saveDocument.mockReset().mockResolvedValue({ status: 'ok', message: '', version: 2 });
  mocks.loadDocument.mockReset().mockImplementation(async (id: string) => documentFor(id));
  mocks.deleteDocument.mockReset().mockResolvedValue({ status: 'ok', message: '' });
  mocks.listDocuments.mockReset().mockResolvedValue(listResult());
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
  localStorage.setItem('colwrite:lastDocId', 'doc-a');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('document selection integration', () => {
  it('shows the document skeleton immediately while an uncached startup target hydrates', async () => {
    const hydration = deferred<ReturnType<typeof documentFor>>();
    mocks.loadDocument.mockReturnValue(hydration.promise);

    renderApp();

    expect(screen.getByTestId('document-skeleton')).toBeTruthy();
    expect(screen.getByText('Opening document…')).toBeTruthy();
    expect(localStorage.getItem('colwrite:doc:doc-a')).toBeNull();

    await act(async () => {
      hydration.resolve(documentFor('doc-a'));
      await hydration.promise;
    });
    await waitFor(() => expect(screen.queryByTestId('document-skeleton')).toBeNull());
  });

  it('loads the selected document once without remounting or refetching the sidebar', async () => {
    renderApp();

    await waitFor(() => expect(mocks.loadDocument).toHaveBeenCalledWith(
      'doc-a',
      { signal: expect.any(AbortSignal) },
    ));
    const documents = await screen.findByRole('region', { name: 'Documents' });
    const beta = (await screen.findByText('Beta')).closest('button');
    if (!beta) throw new Error('Beta document button was not rendered');
    await waitFor(() => {
      const menuLoads = mocks.listDocuments.mock.calls.filter(
        ([options]) => (options as { limit?: number } | undefined)?.limit === 10,
      );
      expect(menuLoads).toHaveLength(1);
    });

    const menuLoadsBefore = mocks.listDocuments.mock.calls.filter(
      ([options]) => (options as { limit?: number } | undefined)?.limit === 10,
    ).length;
    mocks.loadDocument.mockClear();

    fireEvent.click(beta);

    await waitFor(() => expect(mocks.loadDocument).toHaveBeenCalledTimes(1));
    expect(mocks.loadDocument).toHaveBeenCalledWith(
      'doc-b',
      { signal: expect.any(AbortSignal) },
    );
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

    expect(mocks.loadDocument).toHaveBeenCalledTimes(1);
    expect(mocks.loadDocument).toHaveBeenCalledWith(
      'doc-b',
      { signal: expect.any(AbortSignal) },
    );
    expect(new URLSearchParams(window.location.search).get('doc')).toBe('doc-b');
    expect(screen.getByRole('region', { name: 'Documents' })).toBe(documents);
    const menuLoadsAfter = mocks.listDocuments.mock.calls.filter(
      ([options]) => (options as { limit?: number } | undefined)?.limit === 10,
    ).length;
    expect(menuLoadsAfter).toBe(menuLoadsBefore);
  });

  it('keeps the committed URL until the requested document succeeds', async () => {
    renderApp();
    await waitFor(() => expect(mocks.loadDocument).toHaveBeenCalledWith(
      'doc-a',
      { signal: expect.any(AbortSignal) },
    ));
    await waitFor(() => expect(screen.queryByTestId('document-skeleton')).toBeNull());

    const opening = deferred<ReturnType<typeof documentFor>>();
    mocks.loadDocument.mockImplementation((id: string) => (
      id === 'doc-b' ? opening.promise : Promise.resolve(documentFor(id))
    ));
    fireEvent.click((await screen.findByText('Beta')).closest('button')!);
    await waitFor(() => expect(mocks.loadDocument).toHaveBeenCalledWith(
      'doc-b',
      { signal: expect.any(AbortSignal) },
    ));
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
    await waitFor(() => expect(mocks.loadDocument).toHaveBeenCalledWith(
      'doc-a',
      { signal: expect.any(AbortSignal) },
    ));
    await waitFor(() => expect(screen.queryByTestId('document-skeleton')).toBeNull());

    mocks.loadDocument.mockRejectedValueOnce(new Error('No longer available'));
    window.history.pushState(null, '', '/?doc=doc-b');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(await screen.findByText('Could not open that document from history')).toBeTruthy();
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('doc')).toBe('doc-a');
    });
    expect(screen.getAllByText('Could not open that document from history')).toHaveLength(1);
  });
});
