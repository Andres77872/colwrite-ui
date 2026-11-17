import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInWorkspace } from '@/__tests__/renderInWorkspace';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

const mocks = vi.hoisted(() => ({
  switchTo: vi.fn(async () => true),
  documentId: 'doc-1' as string | null,
  loadingDocumentId: null as string | null,
}));

vi.mock('@/editor', () => ({
  useDocumentSession: () => ({
    documentId: mocks.documentId,
    loadingDocumentId: mocks.loadingDocumentId,
  }),
  useDocumentActions: () => ({ switchTo: mocks.switchTo }),
}));

const { DocumentUrlSync, NavigationProvider } = await import('../NavigationContext');
const { useView } = await import('../viewContextState');

function Harness() {
  const { view, setView } = useView();
  return (
    <div>
      <p data-testid="view">{view}</p>
      <button type="button" onClick={() => setView('settings')}>
        To settings
      </button>
      <button type="button" onClick={() => setView('editor')}>
        To editor
      </button>
    </div>
  );
}

/** The workspace and page the address bar names. */
function urlTarget() {
  const params = new URLSearchParams(window.location.search);
  return { ws: params.get('ws'), doc: params.get('doc') };
}

function renderAt(search: string) {
  window.history.replaceState(null, '', `/${search}`);
  return renderInWorkspace(
    <NavigationProvider>
      <DocumentUrlSync />
      <Harness />
    </NavigationProvider>,
  );
}

beforeEach(() => {
  mocks.switchTo.mockReset().mockResolvedValue(true);
  mocks.documentId = 'doc-1';
  mocks.loadingDocumentId = null;
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('navigation routing', () => {
  it('opens the editor when the URL says nothing', () => {
    renderAt('');
    expect(screen.getByTestId('view').textContent).toBe('editor');
  });

  it('opens Settings from ?view=settings', () => {
    renderAt('?view=settings');
    expect(screen.getByTestId('view').textContent).toBe('settings');
  });

  it('does not read the old ?view=profile', () => {
    renderAt('?view=profile');
    expect(screen.getByTestId('view').textContent).toBe('editor');
  });

  it('writes the surface into the URL so the link can be shared', () => {
    renderAt('');

    fireEvent.click(screen.getByRole('button', { name: 'To settings' }));
    expect(new URLSearchParams(window.location.search).get('view')).toBe('settings');

    // The editor is the default, so it is an absent parameter rather than an
    // explicit one — a clean URL for the common case. The open document stays,
    // because it is still open.
    fireEvent.click(screen.getByRole('button', { name: 'To editor' }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBeNull();
    expect(params.get('doc')).toBe('doc-1');
  });

  it('reflects the workspace and the open document in the URL', async () => {
    renderAt('');
    await waitFor(() => expect(urlTarget()).toEqual({ ws: TEST_WORKSPACE_ID, doc: 'doc-1' }));
  });

  it('leaves the URL alone while it names the workspace being switched to', async () => {
    renderAt('?ws=wsp-other&doc=doc-7');
    await act(async () => {});
    expect(urlTarget()).toEqual({ ws: 'wsp-other', doc: 'doc-7' });
    expect(mocks.switchTo).not.toHaveBeenCalled();
  });

  it('does not load a startup target a second time while the editor is hydrating it', () => {
    mocks.documentId = null;
    mocks.loadingDocumentId = 'doc-9';
    renderAt('?doc=doc-9');

    expect(mocks.switchTo).not.toHaveBeenCalled();
    expect(urlTarget().doc).toBe('doc-9');
  });

  it('does not re-open the document that is already open', () => {
    renderAt('?doc=doc-1');
    expect(mocks.switchTo).not.toHaveBeenCalled();
  });

  it('restores the committed URL after startup hydration fails', async () => {
    mocks.documentId = 'doc-1';
    mocks.loadingDocumentId = 'missing';
    const view = renderAt('?doc=missing');

    expect(urlTarget().doc).toBe('missing');
    mocks.loadingDocumentId = null;
    view.rerender(
      <NavigationProvider>
        <DocumentUrlSync />
        <Harness />
      </NavigationProvider>,
    );

    await waitFor(() => expect(urlTarget()).toEqual({ ws: TEST_WORKSPACE_ID, doc: 'doc-1' }));
    expect(mocks.switchTo).not.toHaveBeenCalled();
  });

  it('follows the back button between surfaces', async () => {
    renderAt('');
    fireEvent.click(screen.getByRole('button', { name: 'To settings' }));
    expect(screen.getByTestId('view').textContent).toBe('settings');

    // jsdom does not run history navigation, so the pop is simulated the way a
    // browser would deliver it: URL first, then the event.
    window.history.replaceState(null, '', '/?doc=doc-1');
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByTestId('view').textContent).toBe('editor');
  });

  it('opens the page Back returns to', async () => {
    renderAt('?doc=doc-1');
    window.history.replaceState(null, '', '/?doc=doc-2');
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(mocks.switchTo).toHaveBeenCalledWith('doc-2', { source: 'history' });
  });

  it('leaves a Back into another workspace to the workspace switch', async () => {
    renderAt(`?ws=${TEST_WORKSPACE_ID}&doc=doc-1`);
    window.history.replaceState(null, '', '/?ws=wsp-other&doc=doc-2');
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(mocks.switchTo).not.toHaveBeenCalled();
  });
});
