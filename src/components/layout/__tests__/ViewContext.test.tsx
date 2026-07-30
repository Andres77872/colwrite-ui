import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  switchTo: vi.fn(async () => undefined),
  documentId: 'doc-1' as string | null,
  toast: vi.fn(),
}));

vi.mock('@/editor', () => ({
  useEditor: () => ({ documentId: mocks.documentId, switchTo: mocks.switchTo }),
}));
vi.mock('@/components/ui/toastContext', () => ({ useToast: () => ({ toast: mocks.toast }) }));

const { ViewProvider } = await import('../ViewContext');
const { useView } = await import('../viewContextState');

function Harness() {
  const { view, setView } = useView();
  return (
    <div>
      <p data-testid="view">{view}</p>
      <button type="button" onClick={() => setView('profile')}>
        To profile
      </button>
      <button type="button" onClick={() => setView('workspace')}>
        To workspace
      </button>
    </div>
  );
}

function renderAt(search: string) {
  window.history.replaceState(null, '', `/${search}`);
  return render(
    <ViewProvider>
      <Harness />
    </ViewProvider>,
  );
}

beforeEach(() => {
  mocks.switchTo.mockReset().mockResolvedValue(undefined);
  mocks.toast.mockReset();
  mocks.documentId = 'doc-1';
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('ViewProvider routing', () => {
  it('opens the workspace when the URL says nothing', () => {
    renderAt('');
    expect(screen.getByTestId('view').textContent).toBe('workspace');
  });

  it('opens the profile from ?view=profile', () => {
    renderAt('?view=profile');
    expect(screen.getByTestId('view').textContent).toBe('profile');
  });

  it('writes the surface into the URL so the link can be shared', () => {
    renderAt('');

    fireEvent.click(screen.getByRole('button', { name: 'To profile' }));
    expect(new URLSearchParams(window.location.search).get('view')).toBe('profile');

    // The workspace is the default, so it is an absent parameter rather than an
    // explicit one — a clean URL for the common case. The open document stays,
    // because it is still open.
    fireEvent.click(screen.getByRole('button', { name: 'To workspace' }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBeNull();
    expect(params.get('doc')).toBe('doc-1');
  });

  it('reflects the open document in the URL', async () => {
    renderAt('');
    await waitFor(() => expect(window.location.search).toBe('?doc=doc-1'));
  });

  it('opens the document named by ?doc on load', async () => {
    mocks.documentId = null;
    renderAt('?doc=doc-9');

    await waitFor(() => expect(mocks.switchTo).toHaveBeenCalledWith('doc-9'));
  });

  it('does not re-open the document that is already open', () => {
    renderAt('?doc=doc-1');
    expect(mocks.switchTo).not.toHaveBeenCalled();
  });

  it('reports a document it cannot open instead of showing an empty editor', async () => {
    mocks.documentId = null;
    mocks.switchTo.mockRejectedValue(new Error('Not found'));

    renderAt('?doc=missing');

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not open that document', variant: 'error' }),
      ),
    );
  });

  it('follows the back button between surfaces', async () => {
    renderAt('');
    fireEvent.click(screen.getByRole('button', { name: 'To profile' }));
    expect(screen.getByTestId('view').textContent).toBe('profile');

    // jsdom does not run history navigation, so the pop is simulated the way a
    // browser would deliver it: URL first, then the event.
    window.history.replaceState(null, '', '/?doc=doc-1');
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByTestId('view').textContent).toBe('workspace');
  });
});
