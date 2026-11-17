import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delay, http, problem, recordRequests, server } from '@/__tests__/server';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** A shared FIFO lock manager, while each imported API has independent module state. */
function installSharedLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, options: LockOptions, callback: () => Promise<unknown>) => {
    const current = tail.then(() => {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return callback();
    });
    tail = current.catch(() => undefined);
    return current;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return request;
}

/** One tab: its own client and session module state, sharing storage and locks with the others. */
async function newTab() {
  vi.resetModules();
  const client = await import('../client');
  const session = await import('../session');
  return {
    ...session,
    read: (path: '/users/me') => client.unwrap(client.api.GET(path)),
    login: () => client.unwrap(client.authApi.POST('/auth/login', { body: { username: 'writer', password: 'test', remember_me: false } })),
    logout: () => client.unwrap(client.authApi.POST('/auth/logout')),
  };
}

const pathOf = (request: Request) => new URL(request.url).pathname;
const expired = () => problem('unauthorized', 'expired');

/** The refresh route: `answer` decides it, or the mock API's own answer when it returns nothing. */
function onRefresh(answer: () => Promise<ReturnType<typeof problem> | undefined> | ReturnType<typeof problem> | undefined) {
  let calls = 0;
  server.use(http.post('/auth/refresh', async () => {
    calls += 1;
    return answer();
  }));
  return () => calls;
}

beforeEach(() => {
  localStorage.clear();
  installSharedLocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  localStorage.clear();
});

describe('cross-tab session rotation', () => {
  it('uses one rotation for independent tabs receiving simultaneous 401s', async () => {
    const first = await newTab();
    const second = await newTab();
    const release = deferred<void>();
    let refreshed = false;
    const sent = recordRequests();
    const refreshCalls = onRefresh(async () => {
      await release.promise;
      refreshed = true;
      return undefined;
    });
    server.use(http.get('/users/me', () => (refreshed ? undefined : expired())));

    const requests = Promise.all([first.read('/users/me'), second.read('/users/me')]);
    await vi.waitFor(() => expect(refreshCalls()).toBe(1));
    release.resolve();

    const [one, two] = await requests;
    expect(one.identity.user_id).toBe('u-preview');
    expect(two.identity.user_id).toBe('u-preview');
    expect(refreshCalls()).toBe(1);
    expect(sent).toHaveLength(5);
    for (const request of sent) expect(request.credentials).toBe('include');
    expect(first.getRefreshGeneration()).toBe(second.getRefreshGeneration());
    const marker = JSON.parse(localStorage.getItem(localStorage.key(0)!)!);
    expect(Object.keys(marker).sort()).toEqual(['completedAt', 'generation', 'ok']);
    expect(marker.ok).toBe(true);
  });

  it('replays a late stale 401 using a peer generation even beyond the freshness window', async () => {
    const first = await newTab();
    const second = await newTab();
    const slowResponse = deferred<void>();
    let reads = 0;
    const refreshCalls = onRefresh(() => undefined);
    server.use(http.get('/users/me', async () => {
      reads += 1;
      if (reads > 1) return undefined;
      await slowResponse.promise;
      return problem('unauthorized', 'expired before peer refresh');
    }));

    const request = first.read('/users/me');
    await vi.waitFor(() => expect(reads).toBe(1));
    await expect(second.ensureRefreshed()).resolves.toBe(true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
    slowResponse.resolve();

    await expect(request).resolves.toMatchObject({ identity: { user_id: 'u-preview' } });
    expect(refreshCalls()).toBe(1);
  });

  it('shares a failed attempt with waiting peers without replaying the spent cookie', async () => {
    const first = await newTab();
    const second = await newTab();
    const sent = recordRequests();
    onRefresh(() => problem('unauthorized', 'invalid'));

    expect(await Promise.all([first.ensureRefreshed(), second.ensureRefreshed()])).toEqual([false, false]);
    expect(sent).toHaveLength(1);
  });

  it('keeps rotations exclusive when storage is blocked', async () => {
    const first = await newTab();
    const second = await newTab();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    let active = 0;
    let maximum = 0;
    const refreshCalls = onRefresh(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await delay(1);
      active -= 1;
      return undefined;
    });

    expect(await Promise.all([first.ensureRefreshed(), second.ensureRefreshed()])).toEqual([true, true]);
    expect(refreshCalls()).toBe(2); // no shared marker available
    expect(maximum).toBe(1);
  });

  it('does not rotate outside the lock when lock acquisition fails', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    } });
    const api = await newTab();
    const sent = recordRequests();

    await expect(api.ensureRefreshed()).resolves.toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('requires sign-in instead of unsafe automatic rotation without Web Locks in production', async () => {
    vi.stubEnv('PROD', true);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const api = await newTab();
    const sent = recordRequests();

    await expect(api.ensureRefreshed()).resolves.toBe(false);
    expect(sent).toHaveLength(0);
    // Explicit sign-in still works on such browsers.
    await expect(api.login()).resolves.toMatchObject({ authenticated: true });
  });

  it('serializes logout after refresh and prevents a waiting old-generation refresh from restoring it', async () => {
    const first = await newTab();
    const second = await newTab();
    const third = await newTab();
    const release = deferred<void>();
    const sent = recordRequests();
    onRefresh(async () => {
      await release.promise;
      return undefined;
    });
    const lockRequests = vi.mocked(navigator.locks.request);

    const refresh = first.ensureRefreshed();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const logout = second.logout();
    // The client asks for the lock once its middleware has run; the refresh
    // below is the one that waits behind the sign-out.
    await vi.waitFor(() => expect(lockRequests).toHaveBeenCalledTimes(2));
    const waitingRefresh = third.ensureRefreshed();
    expect(sent).toHaveLength(1);
    release.resolve();

    await expect(refresh).resolves.toBe(true);
    await logout;
    await expect(waitingRefresh).resolves.toBe(false);
    expect(sent.map((request) => pathOf(request).split('/').pop())).toEqual(['refresh', 'logout']);
  });

  it('a successful explicit sign-in replaces an earlier failed refresh generation', async () => {
    const first = await newTab();
    const second = await newTab();
    const sent = recordRequests();
    server.use(http.post('/auth/refresh', () => expired(), { once: true }));

    await expect(first.ensureRefreshed()).resolves.toBe(false);
    const beforeLogin = first.getRefreshGeneration();
    await second.login();
    await expect(first.ensureRefreshed(beforeLogin)).resolves.toBe(true);
    expect(sent).toHaveLength(2);
  });
});
