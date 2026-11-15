import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, logout, getMe } from '../auth';
import { me } from '@/dev/msw/fixtures';
import * as session from '@/api/authEvents';
import { HttpResponse, http, jsonOf, pathOf, problem, recordRequests, server } from '@/__tests__/server';

beforeEach(() => {
  vi.restoreAllMocks();
});

/**
 * The real success body. No token of any kind: the API writes the access and
 * refresh pair as HttpOnly cookies and strips every alias before responding.
 * `message` is the auth service's own success text, which is why gating on a
 * missing token surfaced "Root user login successful" as a red error.
 */
const SUCCESS_BODY = {
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
  expires_at: null,
  expires_in: null,
  refresh_expires_at: null,
  refresh_expires_in: null,
  user: { username: 'root_admin', email: 'root@example.com', user_type: 'root' },
};

describe('login', () => {
  it('sends POST /auth/login with credentials: include', async () => {
    const sent = recordRequests();
    server.use(http.post('/auth/login', ({ response }) => response(200).json(SUCCESS_BODY)));

    const result = await login({ username: 'testuser', password: 'secret' });

    expect(result.authenticated).toBe(true);
    expect(pathOf(sent[0])).toBe('/api/auth/login');
    expect(sent[0]?.credentials).toBe('include');
    expect(await jsonOf(sent[0])).toEqual({ username: 'testuser', password: 'secret', remember_me: false });
  });

  it('resolves on a success body that carries no token', async () => {
    server.use(http.post('/auth/login', ({ response }) => response(200).json(SUCCESS_BODY)));

    const result = await login({ username: 'root_admin', password: 'secret' });

    expect('session_token' in result).toBe(false);
    expect(result.user?.username).toBe('root_admin');
  });

  it('rejects with the server message and does not sign the user out', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    server.use(http.post('/auth/login', () => problem('invalid_credentials', 'Invalid username or password')));

    await expect(login({ username: 'testuser', password: 'wrong' })).rejects.toThrow(
      'Invalid username or password',
    );

    // A bad password is not an expired session. Bouncing here used to wipe the
    // session of a user who was already signed in.
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('logout', () => {
  it('sends POST /auth/logout with credentials: include', async () => {
    const sent = recordRequests();

    await logout();

    expect(pathOf(sent[0])).toBe('/api/auth/logout');
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.credentials).toBe('include');
  });

  it('throws on 401, since the client rejects every non-2xx', async () => {
    // The auth service's own failure body, which is not a problem.
    server.use(http.post('/auth/logout', ({ response }) =>
      response.untyped(HttpResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 }))));

    await expect(logout()).rejects.toThrow();
  });

  it('does not reopen the sign-in dialog when it 401s', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    server.use(http.post('/auth/logout', () => problem('unauthorized', 'Not authenticated')));

    await expect(logout()).rejects.toThrow();

    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('getMe', () => {
  it('reads the identity under `identity`, beside the profile', async () => {
    const sent = recordRequests();
    server.use(http.get('/users/me', ({ response }) => response(200).json({
      ...me(),
      identity: { user_id: 'root', username: 'root_admin', email: 'root@example.com', user_type: 'root' },
    })));

    const { identity } = await getMe();

    expect(pathOf(sent[0])).toBe('/api/users/me');
    expect(identity.username).toBe('root_admin');
    expect(identity.user_type).toBe('root');
  });

  it('resolves its own 401 rather than signing the user out', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    server.use(http.get('/users/me', () => problem('unauthorized', 'Missing session token')));

    await expect(getMe()).rejects.toThrow();

    // The boot check expects failure as a normal outcome and clears the
    // session itself; a second teardown from the event layer is noise.
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
