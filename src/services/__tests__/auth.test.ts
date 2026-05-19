import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, logout } from '../auth';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('login', () => {
  it('sends POST /auth/login with credentials: include', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, session_token: 'tok_abc', user: { username: 'test' }, message: 'ok' }), { status: 200 }),
    );

    const result = await login({ username: 'testuser', password: 'secret' });

    expect(result.session_token).toBe('tok_abc');
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/auth/login');
    expect(opts!.credentials).toBe('include');
    expect(JSON.parse(opts!.body as string)).toEqual({ username: 'testuser', password: 'secret' });
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
});
