import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOverview, listUserDocuments, updateProfile } from '../userProfile';

/*
 * The upload wrappers this file used to cover are gone: `listUploads`,
 * `uploadPdf`, `deleteUpload` and `uploadContentUrl` were one-line aliases over
 * `resources.ts`, and their tests were re-testing that module through a second
 * name. See `resources.test.ts` for the real coverage.
 */

beforeEach(() => {
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(handler(String(input), init)),
    );
}

describe('overview', () => {
  it('requests the composed dashboard payload with the day window', async () => {
    const fetchSpy = mockFetch(() => json({ identity: { user_id: 'usr-1' } }));

    await getOverview(14);

    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/api/users/me/overview?days=14');
  });

  it('defaults to a 30-day window', async () => {
    const fetchSpy = mockFetch(() => json({}));

    await getOverview();

    expect(String(fetchSpy.mock.calls[0][0])).toContain('days=30');
  });
});

describe('profile update', () => {
  it('PUTs only the supplied fields as JSON', async () => {
    const fetchSpy = mockFetch(() => json({ identity: {}, profile: {} }));

    await updateProfile({ display_name: 'Ada', bio: '' });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/api/users/me');
    expect((init as RequestInit).method).toBe('PUT');
    // An empty string is meaningful — it is how a field is cleared — so it
    // must survive serialisation rather than being dropped as falsy.
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      display_name: 'Ada',
      bio: '',
    });
  });

  it('sends the session cookie', async () => {
    const fetchSpy = mockFetch(() => json({ identity: {}, profile: {} }));

    await updateProfile({ headline: 'Researcher' });

    expect((fetchSpy.mock.calls[0][1] as RequestInit).credentials).toBe('include');
  });
});

describe('listings', () => {
  it('pages documents by limit and offset', async () => {
    const fetchSpy = mockFetch(() => json({ documents: [], count: 0 }));

    await listUserDocuments(5, 10);

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      '/api/users/me/documents?limit=5&offset=10',
    );
  });
});
