import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthContext';
import { useAuth } from '../authContextState';
import { UNAUTHORIZED_EVENT, type UnauthorizedDetail } from '@/services';

/**
 * The body a real successful login returns. There is no token in it — the
 * access and refresh pair arrive as HttpOnly cookies and the API strips every
 * alias from the JSON. `message` is the auth service's success text; gating on
 * the absent token is what put "Root user login successful" in a red alert.
 */
const LOGIN_SUCCESS = {
  authenticated: true,
  success: true,
  message: 'Root user login successful',
  user: { username: 'root_admin', email: 'root@example.com', user_type: 'root' },
};

const PROFILE_SUCCESS = {
  success: true,
  username: 'root_admin',
  email: 'root@example.com',
  user_type: 'root',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

type Route = (url: string) => Response;

function mockRoutes(route: Route) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: RequestInfo | URL) => Promise.resolve(route(String(input))));
}

function Probe() {
  const { user, status, openAuth, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user ? user.name : 'none'}</span>
      <span data-testid="usertype">{user?.userType ?? 'none'}</span>
      <button type="button" onClick={openAuth}>
        probe-open
      </button>
      <button type="button" onClick={logout}>
        probe-logout
      </button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

async function signIn(username = 'root_admin', password = 'secret') {
  fireEvent.click(screen.getByRole('button', { name: 'probe-open' }));
  fireEvent.change(await screen.findByLabelText(/username or email/i), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

afterEach(cleanup);

describe('signing in', () => {
  it('signs the user in from a success body that carries no token', async () => {
    mockRoutes(() => json(LOGIN_SUCCESS));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));

    await signIn();

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('root_admin'));
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
    // The regression: the success message must never surface as an error.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(JSON.parse(localStorage.getItem('cw_user')!).name).toBe('root_admin');
  });

  it('keeps the account type the API reports', async () => {
    mockRoutes(() => json(LOGIN_SUCCESS));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));

    await signIn();

    await waitFor(() => expect(screen.getByTestId('usertype').textContent).toBe('root'));
  });

  it('shows the server message on a bad password and keeps the session', async () => {
    mockRoutes((url) =>
      url.includes('/auth/login')
        ? json({ detail: 'Invalid username or password' }, 401)
        : json(PROFILE_SUCCESS),
    );
    localStorage.setItem('cw_user', JSON.stringify({ name: 'root_admin', email: 'r@e.com' }));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    await signIn('root_admin', 'wrong');

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Invalid username or password',
    );
    // A mistyped password is not an expired session — it used to sign the
    // already-authenticated user out and drop them on the landing page.
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
  });
});

describe('boot-time session check', () => {
  it('confirms a cached user against the server before rendering as signed in', async () => {
    mockRoutes(() => json(PROFILE_SUCCESS));
    localStorage.setItem('cw_user', JSON.stringify({ name: 'stale', email: '' }));

    renderAuth();

    expect(screen.getByTestId('status').textContent).toBe('checking');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    // The server's identity wins over whatever localStorage was holding.
    expect(screen.getByTestId('user').textContent).toBe('root_admin');
  });

  it('never renders as signed in when the session is gone', async () => {
    mockRoutes(() => json({ detail: 'Missing session token' }, 401));
    localStorage.setItem('cw_user', JSON.stringify({ name: 'root_admin', email: '' }));
    localStorage.setItem('colwrite:lastDocId', 'previous-account-doc');
    localStorage.setItem(
      'colwrite:doc:previous-account-doc',
      JSON.stringify({ documentId: 'previous-account-doc', doc: { blocks: [] } }),
    );

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(localStorage.getItem('cw_user')).toBeNull();
    expect(localStorage.getItem('colwrite:lastDocId')).toBeNull();
    expect(localStorage.getItem('colwrite:doc:previous-account-doc')).toBeNull();
  });

  it('does not call the API for a visitor who never signed in', async () => {
    const fetchSpy = mockRoutes(() => json(PROFILE_SUCCESS));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('involuntary sign-out', () => {
  it('explains why the dialog reopened', async () => {
    mockRoutes(() => json(PROFILE_SUCCESS));
    localStorage.setItem('cw_user', JSON.stringify({ name: 'root_admin', email: '' }));
    localStorage.setItem('colwrite:lastDocId', 'previous-account-doc');
    localStorage.setItem(
      'colwrite:doc:previous-account-doc',
      JSON.stringify({ documentId: 'previous-account-doc', doc: { blocks: [] } }),
    );
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    act(() => {
      window.dispatchEvent(
        new CustomEvent<UnauthorizedDetail>(UNAUTHORIZED_EVENT, {
          detail: { reason: 'expired', message: 'Your session expired. Please sign in again.' },
        }),
      );
    });

    expect((await screen.findByRole('alert')).textContent).toContain('Your session expired');
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
    expect(localStorage.getItem('colwrite:lastDocId')).toBeNull();
    expect(localStorage.getItem('colwrite:doc:previous-account-doc')).toBeNull();
  });

  it('does not reopen the dialog when signing out on purpose', async () => {
    mockRoutes((url) =>
      url.includes('/auth/logout')
        ? json({ detail: 'Not authenticated' }, 401)
        : json(PROFILE_SUCCESS),
    );
    localStorage.setItem('cw_user', JSON.stringify({ name: 'root_admin', email: '' }));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    fireEvent.click(screen.getByRole('button', { name: 'probe-logout' }));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    // A failing logout still ends the session locally; popping the sign-in
    // dialog back open here read as "sign out is broken".
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByLabelText(/username or email/i)).toBeNull();
  });
});
