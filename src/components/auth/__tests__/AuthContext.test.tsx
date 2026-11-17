import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthContext';
import { useAuth } from '../authContextState';
import { UNAUTHORIZED_EVENT, type UnauthorizedDetail } from '@/api/authEvents';
import {
  AGENT_ENGINE_KEY,
  LAST_WORKSPACE_KEY,
  PAGE_SETTINGS_KEY,
  THEME_KEY,
  USER_PROFILE_KEY,
  chatSelectionKey,
  draftKey,
  lastPageKey,
  panelKey,
  reviewKey,
  unsavedKey,
} from '@/lib/storageKeys';
import type { UserMe } from '@/data/userProfile';
import type { AuthSessionResponse } from '@/api/schema';
import { registerModuleReset } from '@/lib/moduleState';
import { registerPendingSave } from '@/lib/pendingSaves';
import { http, problem, recordRequests, server } from '@/__tests__/server';

/**
 * The body a real successful login returns. There is no token in it — the
 * access and refresh pair arrive as HttpOnly cookies and the API strips every
 * alias from the JSON. `message` is the auth service's success text; gating on
 * the absent token is what put "Root user login successful" in a red alert.
 */
const LOGIN_SUCCESS: AuthSessionResponse = {
  authenticated: true,
  success: true,
  remember_me: false,
  token_type: 'Bearer',
  message: 'Root user login successful',
  user_id: 'root',
  project: { project_hash: 'colwrite' },
  accessible_projects: [{ project_hash: 'colwrite' }],
  user_groups: [],
  plan: null,
  user: { username: 'root_admin', email: 'root@example.com', user_type: 'root' },
  expires_at: null,
  expires_in: null,
  refresh_expires_at: null,
  refresh_expires_in: null,
};

const ME: UserMe = {
  identity: { user_id: 'root', username: 'root_admin', email: 'root@example.com', user_type: 'root' },
  profile: {
    user_id: 'root',
    username: 'root_admin',
    display_name: null,
    headline: null,
    affiliation: null,
    bio: null,
    locale: 'en',
    timezone: 'UTC',
    avatar_url: null,
    preferences: null,
    last_seen_at: null,
    created_at: null,
    updated_at: null,
  },
};

/** Keys a previous account left behind: its last workspace, and a page and draft in one. */
const PREVIOUS_WORKSPACE = 'wsp-previous';
function leaveAccountKeys() {
  localStorage.setItem(LAST_WORKSPACE_KEY, PREVIOUS_WORKSPACE);
  localStorage.setItem(lastPageKey(PREVIOUS_WORKSPACE), 'previous-account-doc');
  localStorage.setItem(
    draftKey(PREVIOUS_WORKSPACE, 'previous-account-doc'),
    JSON.stringify({ documentId: 'previous-account-doc', doc: { blocks: [] } }),
  );
}
function expectAccountKeysGone() {
  expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBeNull();
  expect(localStorage.getItem(lastPageKey(PREVIOUS_WORKSPACE))).toBeNull();
  expect(localStorage.getItem(draftKey(PREVIOUS_WORKSPACE, 'previous-account-doc'))).toBeNull();
}

/** The server knows this account: the profile check and a sign-in both succeed. */
function knownAccount() {
  server.use(
    http.get('/users/me', ({ response }) => response(200).json(ME)),
    http.post('/auth/login', ({ response }) => response(200).json(LOGIN_SUCCESS)),
  );
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
    knownAccount();
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));

    await signIn();

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('root_admin'));
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
    // The regression: the success message must never surface as an error.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(JSON.parse(localStorage.getItem('colwrite:user:profile')!).name).toBe('root_admin');
  });

  it('keeps the account type the API reports', async () => {
    knownAccount();
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));

    await signIn();

    await waitFor(() => expect(screen.getByTestId('usertype').textContent).toBe('root'));
  });

  it('shows the server message on a bad password and keeps the session', async () => {
    knownAccount();
    server.use(http.post('/auth/login', () => problem('invalid_credentials', 'Invalid username or password')));
    localStorage.setItem('colwrite:user:profile', JSON.stringify({ name: 'root_admin', email: 'r@e.com' }));
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
    knownAccount();
    localStorage.setItem('colwrite:user:profile', JSON.stringify({ name: 'stale', email: '' }));

    renderAuth();

    expect(screen.getByTestId('status').textContent).toBe('checking');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    // The server's identity wins over whatever localStorage was holding.
    expect(screen.getByTestId('user').textContent).toBe('root_admin');
  });

  it('never renders as signed in when the session is gone', async () => {
    server.use(
      http.get('/users/me', () => problem('unauthorized', 'Missing session token')),
      http.post('/auth/refresh', () => problem('unauthorized', 'Missing refresh token')),
    );
    localStorage.setItem('colwrite:user:profile', JSON.stringify({ name: 'root_admin', email: '' }));
    leaveAccountKeys();

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(localStorage.getItem('colwrite:user:profile')).toBeNull();
    expectAccountKeysGone();
  });

  it('does not call the API for a visitor who never signed in', async () => {
    const sent = recordRequests();

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(sent).toEqual([]);
  });
});

describe('involuntary sign-out', () => {
  it('explains why the dialog reopened', async () => {
    knownAccount();
    localStorage.setItem('colwrite:user:profile', JSON.stringify({ name: 'root_admin', email: '' }));
    leaveAccountKeys();
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
    expectAccountKeysGone();
  });

  it('does not reopen the dialog when signing out on purpose', async () => {
    knownAccount();
    server.use(http.post('/auth/logout', () => problem('unauthorized', 'Not authenticated')));
    localStorage.setItem('colwrite:user:profile', JSON.stringify({ name: 'root_admin', email: '' }));
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

describe('sign-out', () => {
  it('removes every key of the account and its workspaces, keeps the device ones, and resets module state', async () => {
    knownAccount();
    // The account's own keys, and every workspace's, whichever it was.
    const userKeys = [
      USER_PROFILE_KEY,
      LAST_WORKSPACE_KEY,
      ...['wsp-a', 'wsp-b'].flatMap((workspace) => [
        lastPageKey(workspace),
        draftKey(workspace, null),
        draftKey(workspace, 'doc-1'),
        unsavedKey(workspace, 'doc-1'),
        reviewKey(workspace, 'doc-1', 'cs-1'),
        chatSelectionKey(workspace, 'doc-1'),
      ]),
    ];
    const deviceKeys = [THEME_KEY, PAGE_SETTINGS_KEY, AGENT_ENGINE_KEY, panelKey('leftWidth')];
    for (const key of [...userKeys, ...deviceKeys]) localStorage.setItem(key, '"x"');
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify({ name: 'root_admin', email: '' }));
    const reset = vi.fn();
    registerModuleReset(reset);

    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    fireEvent.click(screen.getByRole('button', { name: 'probe-logout' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));

    for (const key of userKeys) expect(localStorage.getItem(key), key).toBeNull();
    for (const key of deviceKeys) expect(localStorage.getItem(key), key).toBe('"x"');
    expect(reset).toHaveBeenCalled();
  });

  // B-13: the open page's edits inside the autosave window are sent while the
  // session can still save them, and the page's session is ended before the
  // account's keys go, so nothing writes them back afterwards.
  it('sends the open page\'s pending edits first, and ends its session before clearing the account', async () => {
    const steps: string[] = [];
    const signedIn = () => localStorage.getItem(USER_PROFILE_KEY) !== null;
    knownAccount();
    server.use(http.post('/auth/logout', ({ response }) => {
      steps.push('logout');
      return response(200).json({ success: true });
    }));
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify({ name: 'root_admin', email: '' }));
    const unregister = registerPendingSave({
      flush: async () => {
        steps.push(signedIn() ? 'flush' : 'flush after clearing');
      },
      end: () => {
        steps.push(signedIn() ? 'end' : 'end after clearing');
      },
    });
    try {
      renderAuth();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
      fireEvent.click(screen.getByRole('button', { name: 'probe-logout' }));
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
      await waitFor(() => expect(steps).toContain('logout'));

      expect(steps[0]).toBe('flush');
      expect(steps.indexOf('flush')).toBeLessThan(steps.indexOf('logout'));
      expect(steps).toContain('end');
      expect(localStorage.getItem(USER_PROFILE_KEY)).toBeNull();
    } finally {
      unregister();
    }
  });

  it('does not try to save when the session is already gone, but still ends the page\'s session', async () => {
    knownAccount();
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify({ name: 'root_admin', email: '' }));
    const flush = vi.fn(async () => {});
    const end = vi.fn();
    const unregister = registerPendingSave({ flush, end });
    try {
      renderAuth();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
      act(() => {
        window.dispatchEvent(
          new CustomEvent<UnauthorizedDetail>(UNAUTHORIZED_EVENT, {
            detail: { reason: 'expired', message: 'Your session expired. Please sign in again.' },
          }),
        );
      });
      expect(screen.getByTestId('status').textContent).toBe('anonymous');
      expect(flush).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });
});
