import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deleteUpload,
  getOverview,
  listUploads,
  listUserDocuments,
  updateProfile,
  uploadContentUrl,
  uploadPdf,
} from '../userProfile';

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

  it('pages uploads by limit and offset', async () => {
    const fetchSpy = mockFetch(() => json({ uploads: [], count: 0 }));

    await listUploads(3, 6);

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      '/api/users/me/uploads?limit=3&offset=6',
    );
  });
});

describe('uploads', () => {
  it('posts multipart form data without a hand-set content type', async () => {
    const fetchSpy = mockFetch(() => json({ upload: { id: 1 } }));
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'paper.pdf', {
      type: 'application/pdf',
    });

    await uploadPdf(file);

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    // A hand-set Content-Type would omit the generated multipart boundary and
    // the server would fail to parse the body.
    expect(init.headers).toBeUndefined();
    expect((init.body as FormData).get('file')).toBe(file);
  });

  it('attaches the document id when one is given', async () => {
    const fetchSpy = mockFetch(() => json({ upload: { id: 1 } }));
    const file = new File(['%PDF-'], 'paper.pdf', { type: 'application/pdf' });

    await uploadPdf(file, '507f1f77bcf86cd799439011');

    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get('document_id')).toBe('507f1f77bcf86cd799439011');
  });

  it('omits the document id when none is given', async () => {
    const fetchSpy = mockFetch(() => json({ upload: { id: 1 } }));
    const file = new File(['%PDF-'], 'paper.pdf', { type: 'application/pdf' });

    await uploadPdf(file);

    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.has('document_id')).toBe(false);
  });

  it('deletes by id', async () => {
    const fetchSpy = mockFetch(() => json({ status: 'success' }));

    await deleteUpload(7);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/api/users/me/uploads/7');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('builds a same-origin content URL usable as an href', () => {
    expect(uploadContentUrl(42)).toBe('/api/users/me/uploads/42/content');
  });
});
