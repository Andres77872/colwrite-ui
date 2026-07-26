import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, logout, getProfile } from '../auth';
import * as session from '../session';

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
  message: 'Root user login successful',
  user: { username: 'root_admin', email: 'root@example.com', user_type: 'root' },
};

describe('login', () => {
  it('sends POST /auth/login with credentials: include', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }),
    );

    const result = await login({ username: 'testuser', password: 'secret' });

    expect(result.authenticated).toBe(true);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/auth/login');
    expect(opts!.credentials).toBe('include');
    expect(JSON.parse(opts!.body as string)).toEqual({ username: 'testuser', password: 'secret' });
  });

  it('resolves on a success body that carries no token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }),
    );

    const result = await login({ username: 'root_admin', password: 'secret' });

    expect('session_token' in result).toBe(false);
    expect(result.user?.username).toBe('root_admin');
  });

  it('rejects with the server message and does not sign the user out', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Invalid username or password' }), { status: 401 }),
    );

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
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, message: 'ok' }), { status: 200 }),
    );

    await logout();

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/auth/logout');
    expect(opts!.method).toBe('POST');
    expect(opts!.credentials).toBe('include');
  });

  it('throws on 401 since api layer treats !res.ok as error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: 'Not authenticated' }), { status: 401 }),
    );

    await expect(logout()).rejects.toThrow();
  });

  it('does not reopen the sign-in dialog when it 401s', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not authenticated' }), { status: 401 }),
    );

    await expect(logout()).rejects.toThrow();

    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('getProfile', () => {
  it('reads the identity fields flat, not nested under `user`', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          username: 'root_admin',
          email: 'root@example.com',
          user_type: 'root',
        }),
        { status: 200 },
      ),
    );

    const profile = await getProfile();

    expect(profile.username).toBe('root_admin');
    expect(profile.user_type).toBe('root');
  });

  it('resolves its own 401 rather than signing the user out', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Missing session token' }), { status: 401 }),
    );

    await expect(getProfile()).rejects.toThrow();

    // The boot check expects failure as a normal outcome and clears the
    // session itself; a second teardown from the event layer is noise.
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
