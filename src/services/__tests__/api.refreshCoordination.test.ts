import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

async function newTab() {
  vi.resetModules();
  return import('../api');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
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
    let refreshCalls = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(init?.credentials).toBe('include');
      if (String(url).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await release.promise;
        refreshed = true;
        return json({ authenticated: true });
      }
      return refreshed ? json({ ok: true }) : json({ detail: 'expired' }, 401);
    });
    const requests = Promise.all([first.get('/one'), second.get('/two')]);
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    release.resolve();
    await expect(requests).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(first.getRefreshGeneration()).toBe(second.getRefreshGeneration());
    const marker = JSON.parse(localStorage.getItem(localStorage.key(0)!)!);
    expect(Object.keys(marker).sort()).toEqual(['completedAt', 'generation', 'ok']);
    expect(marker.ok).toBe(true);
  });

  it('replays a late stale 401 using a peer generation even beyond the freshness window', async () => {
    const first = await newTab();
    const second = await newTab();
    const slowResponse = deferred<Response>();
    let slowCalls = 0;
    let refreshCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/auth/refresh')) { refreshCalls += 1; return json({ authenticated: true }); }
      slowCalls += 1;
      return slowCalls === 1 ? slowResponse.promise : json({ recovered: true });
    });
    const request = first.get('/slow');
    await expect(second.ensureRefreshed()).resolves.toBe(true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
    slowResponse.resolve(json({ detail: 'expired before peer refresh' }, 401));
    await expect(request).resolves.toEqual({ recovered: true });
    expect(refreshCalls).toBe(1);
  });

  it('shares a failed attempt with waiting peers without replaying the spent cookie', async () => {
    const first = await newTab();
    const second = await newTab();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'invalid' }, 401));
    expect(await Promise.all([first.ensureRefreshed(), second.ensureRefreshed()])).toEqual([false, false]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps rotations exclusive when storage is blocked', async () => {
    const first = await newTab();
    const second = await newTab();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    let active = 0;
    let maximum = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return json({ authenticated: true });
    });
    expect(await Promise.all([first.ensureRefreshed(), second.ensureRefreshed()])).toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no shared marker available
    expect(maximum).toBe(1);
  });

  it('does not rotate outside the lock when lock acquisition fails', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    } });
    const api = await newTab();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(api.ensureRefreshed()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires sign-in instead of unsafe automatic rotation without Web Locks in production', async () => {
    vi.stubEnv('PROD', true);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const api = await newTab();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ authenticated: true }));
    await expect(api.ensureRefreshed()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // Explicit sign-in still works on such browsers.
    await expect(api.post('/auth/login', { username: 'writer', password: 'test' })).resolves.toEqual({ authenticated: true });
  });

  it('serializes logout after refresh and prevents a waiting old-generation refresh from restoring it', async () => {
    const first = await newTab();
    const second = await newTab();
    const third = await newTab();
    const release = deferred<void>();
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/refresh')) await release.promise;
      return json({ ok: true });
    });
    const refresh = first.ensureRefreshed();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const logout = second.post('/auth/logout');
    const waitingRefresh = third.ensureRefreshed();
    expect(calls).toHaveLength(1);
    release.resolve();
    await expect(refresh).resolves.toBe(true);
    await logout;
    await expect(waitingRefresh).resolves.toBe(false);
    expect(calls.map((url) => url.split('/').pop())).toEqual(['refresh', 'logout']);
  });

  it('a successful explicit sign-in replaces an earlier failed refresh generation', async () => {
    const first = await newTab();
    const second = await newTab();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ detail: 'expired' }, 401))
      .mockResolvedValueOnce(json({ authenticated: true }));
    await expect(first.ensureRefreshed()).resolves.toBe(false);
    const beforeLogin = first.getRefreshGeneration();
    await second.post('/auth/login', { username: 'writer', password: 'test' });
    await expect(first.ensureRefreshed(beforeLogin)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
