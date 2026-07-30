import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachCollectionDocument,
  attachResource,
  createChildCollection,
  createCollection,
  deleteCollectionRecursive,
  deleteResource,
  detachCollectionDocument,
  extractResource,
  getCollectionDetail,
  getCollectionPath,
  isReadable,
  isSettling,
  listCollectionTree,
  listResources,
  moveCollectionParent,
  previewCollectionDelete,
  readResourceMarkdown,
  resourceContentUrl,
  resourceScopeOptions,
  searchResources,
  uploadResource,
  type ResourceLibraryLocation,
  type ResourceScope,
} from '../resources';
import { makeCollection, makeResource } from './resourceFixtures';

const fetchMock = vi.fn();

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function lastRequest(): { url: URL; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url: new URL(url, 'https://app.test'), init };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resource scopes', () => {
  it.each<[ResourceScope, Record<string, string>]>([
    ['library', {}],
    ['document', { document_id: 'doc-1' }],
    ['context', { document_id: 'doc-1' }],
    ['collection', { collection_id: '7' }],
    ['collection_recursive', { collection_id: '7' }],
    ['unfiled', {}],
  ])('serializes the %s list scope', async (scope, required) => {
    fetchMock.mockResolvedValue(
      response({ resources: [], count: 0, scope, limit: 5, offset: 10 }),
    );

    await listResources({
      scope,
      documentId: required.document_id,
      collectionId: required.collection_id ? Number(required.collection_id) : undefined,
      limit: 5,
      offset: 10,
    });

    const { url } = lastRequest();
    expect(url.pathname).toBe('/api/users/me/resources');
    expect(url.searchParams.get('scope')).toBe(scope);
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('offset')).toBe('10');
    for (const [key, value] of Object.entries(required)) {
      expect(url.searchParams.get(key)).toBe(value);
    }
  });

  it.each<[ResourceScope, Record<string, string>]>([
    ['library', {}],
    ['document', { document_id: 'doc-1' }],
    ['context', { document_id: 'doc-1' }],
    ['collection', { collection_id: '7' }],
    ['collection_recursive', { collection_id: '7' }],
    ['unfiled', {}],
  ])('serializes the %s search scope', async (scope, required) => {
    fetchMock.mockResolvedValue(
      response({
        query: 'term',
        scope,
        matches: [],
        match_count: 0,
        resources_searched: 0,
        resources_skipped: [],
        truncated: false,
        next_offset: null,
      }),
    );

    await searchResources({
      query: 'term',
      scope,
      documentId: required.document_id,
      collectionId: required.collection_id ? Number(required.collection_id) : undefined,
    });

    const { url } = lastRequest();
    expect(url.pathname).toBe('/api/users/me/resources/search');
    expect(url.searchParams.get('scope')).toBe(scope);
    for (const [key, value] of Object.entries(required)) {
      expect(url.searchParams.get(key)).toBe(value);
    }
  });

  it('omits absent identifiers rather than sending "null"', async () => {
    fetchMock.mockResolvedValue(
      response({ resources: [], count: 0, scope: 'library', limit: 20, offset: 0 }),
    );

    await listResources({ scope: 'library', documentId: null, collectionId: null });

    expect(lastRequest().url.searchParams.has('document_id')).toBe(false);
    expect(lastRequest().url.searchParams.has('collection_id')).toBe(false);
  });

  it.each<[ResourceLibraryLocation, ResourceScope, string | null]>([
    [{ kind: 'smart', scope: 'library' }, 'library', null],
    [{ kind: 'smart', scope: 'context', documentId: 'doc-1' }, 'context', 'doc-1'],
    [{ kind: 'collection', collectionId: 4 }, 'collection', null],
    [{ kind: 'collection', collectionId: 4, recursive: true }, 'collection_recursive', null],
    [{ kind: 'unfiled' }, 'unfiled', null],
  ])('maps a discriminated location to %s', (location, scope, documentId) => {
    expect(resourceScopeOptions(location)).toMatchObject({ scope });
    expect(resourceScopeOptions(location).documentId ?? null).toBe(documentId);
  });
});

describe('resource clients', () => {
  it('posts multipart and never sends both attachment targets', async () => {
    const stored = makeResource({ filename: 'paper.pdf' });
    fetchMock.mockResolvedValue(response({ resource: stored, status: 'success', message: 'ok' }));
    const file = new File(['%PDF-'], 'paper.pdf', { type: 'application/pdf' });

    const result = await uploadResource(file, { documentId: 'doc-1', collectionId: 3 });

    const form = lastRequest().init.body as FormData;
    expect(form.get('document_id')).toBe('doc-1');
    expect(form.has('collection_id')).toBe(false);
    expect(result.filename).toBe('paper.pdf');
  });

  it('caps search matches at the server ceiling and preserves encoded text', async () => {
    fetchMock.mockResolvedValue(
      response({
        query: 'a&b=c',
        scope: 'library',
        matches: [],
        match_count: 0,
        resources_searched: 0,
        resources_skipped: [],
        truncated: false,
        next_offset: null,
      }),
    );

    await searchResources({
      query: 'a&b=c',
      scope: 'library',
      maxMatches: 500,
      offset: 25,
    });

    expect(lastRequest().url.searchParams.get('query')).toBe('a&b=c');
    expect(lastRequest().url.searchParams.get('max_matches')).toBe('40');
    expect(lastRequest().url.searchParams.get('offset')).toBe('25');
  });

  it('caps Markdown windows at the server ceiling', async () => {
    fetchMock.mockResolvedValue(
      response({ resource: makeResource(), text: '', offset: 0, total_chars: 0 }),
    );

    await readResourceMarkdown(7, { offset: 100, limit: 999_999 });

    const { url } = lastRequest();
    expect(url.pathname).toBe('/api/users/me/resources/7/markdown');
    expect(url.searchParams.get('offset')).toBe('100');
    expect(url.searchParams.get('limit')).toBe('120000');
  });

  it('omits force unless it was asked for', async () => {
    fetchMock.mockImplementation(async () =>
      response({ resource: makeResource(), status: 'ok', message: '' }),
    );

    await extractResource(3);
    expect(lastRequest().url.searchParams.has('force')).toBe(false);

    await extractResource(3, { force: true });
    expect(lastRequest().url.searchParams.get('force')).toBe('true');
  });

  it('sends both attachment keys so empty means Unfiled', async () => {
    fetchMock.mockImplementation(async () =>
      response({ resource: makeResource(), status: 'ok', message: '' }),
    );

    await attachResource(4);
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({
      document_id: null,
      collection_id: null,
    });

    await attachResource(4, { documentId: 'doc-1', collectionId: 9 });
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({
      document_id: 'doc-1',
      collection_id: null,
    });
  });
});

describe('nested collection clients', () => {
  it('lists roots and paged children with document attachment state', async () => {
    fetchMock.mockImplementation(async () =>
      response({
        collections: [],
        count: 0,
        parent_id: null,
        limit: 25,
        offset: 0,
        next_offset: null,
      }),
    );

    await listCollectionTree({ limit: 25 });
    expect(lastRequest().url.pathname).toBe('/api/users/me/collections/tree');
    expect(lastRequest().url.searchParams.has('parent_id')).toBe(false);

    await listCollectionTree({ parentId: 6, documentId: 'doc-1', limit: 10, offset: 20 });
    const { url } = lastRequest();
    expect(url.searchParams.get('parent_id')).toBe('6');
    expect(url.searchParams.get('document_id')).toBe('doc-1');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('offset')).toBe('20');
  });

  it('creates roots or nested folders with exact request bodies', async () => {
    fetchMock.mockImplementation(async () =>
      response({ collection: makeCollection(), status: 'success', message: 'ok' }),
    );

    await createCollection('Root', null, null);
    expect(lastRequest().url.pathname).toBe('/api/users/me/collections');
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({
      name: 'Root',
      description: null,
      parent_id: null,
    });

    await createChildCollection(7, 'Child', 'Nested');
    expect(lastRequest().url.pathname).toBe('/api/users/me/collections/7/children');
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({
      name: 'Child',
      description: 'Nested',
    });
  });

  it('loads detail and breadcrumb paths from their distinct endpoints', async () => {
    fetchMock.mockResolvedValue(
      response({ collection: makeCollection(), path: [], attachment: null }),
    );

    await getCollectionDetail(8, { documentId: 'doc/id' });
    expect(lastRequest().url.pathname).toBe('/api/users/me/collections/8/detail');
    expect(lastRequest().url.searchParams.get('document_id')).toBe('doc/id');

    fetchMock.mockResolvedValue(response({ collection_id: 8, path: [] }));
    await getCollectionPath(8);
    expect(lastRequest().url.pathname).toBe('/api/users/me/collections/8/path');
  });

  it('moves a subtree to a parent or the root with an explicit null', async () => {
    fetchMock.mockResolvedValue(
      response({ collection: makeCollection(), status: 'success', message: 'moved' }),
    );

    await moveCollectionParent(5, null);

    expect(lastRequest().url.pathname).toBe('/api/users/me/collections/5/parent');
    expect(lastRequest().init.method).toBe('PUT');
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({ parent_id: null });
  });

  it('previews and performs recursive destructive deletion', async () => {
    fetchMock.mockResolvedValue(
      response({
        preview: {
          collection_id: 3,
          status: 'ready',
          collection_count: 2,
          membership_count: 1,
          resource_count: 4,
          resource_bytes: 900,
        },
      }),
    );

    const preview = await previewCollectionDelete(3);
    expect(lastRequest().url.pathname).toBe('/api/users/me/collections/3/delete-preview');
    expect(preview.collection_count).toBe(2);

    fetchMock.mockResolvedValue(
      response({
        status: 'success',
        message: 'Collection subtree deleted',
        collection_count: 2,
        membership_count: 1,
        resource_count: 4,
        resource_bytes: 900,
        cleanup_pending_count: 0,
      }),
    );
    const deleted = await deleteCollectionRecursive(3, preview);
    expect(lastRequest().url.pathname).toBe('/api/users/me/collections/3/recursive');
    expect(lastRequest().url.searchParams.get('expected_collection_count')).toBe('2');
    expect(lastRequest().url.searchParams.get('expected_membership_count')).toBe('1');
    expect(lastRequest().url.searchParams.get('expected_resource_count')).toBe('4');
    expect(lastRequest().url.searchParams.get('expected_resource_bytes')).toBe('900');
    expect(lastRequest().init.method).toBe('DELETE');
    expect(deleted.cleanup_pending_count).toBe(0);
  });

  it('directly attaches and detaches an encoded document path', async () => {
    const attachment = {
      collection_id: 4,
      direct: true,
      effective: true,
      nearest_direct_collection_id: 4,
      nearest_direct_collection_name: 'Sources',
    };
    fetchMock.mockResolvedValue(
      response({ status: 'success', message: 'attached', attachment }),
    );

    expect(await attachCollectionDocument(4, 'doc/id')).toEqual(attachment);
    expect(lastRequest().url.pathname).toBe('/api/users/me/collections/4/documents/doc%2Fid');
    expect(lastRequest().init.method).toBe('PUT');
    expect(lastRequest().init.body).toBeUndefined();

    fetchMock.mockResolvedValue(
      response({
        status: 'success',
        message: 'detached',
        attachment: { ...attachment, direct: false },
      }),
    );
    expect((await detachCollectionDocument(4, 'doc/id'))?.direct).toBe(false);
    expect(lastRequest().url.pathname).toBe('/api/users/me/collections/4/documents/doc%2Fid');
    expect(lastRequest().init.method).toBe('DELETE');
  });
});

describe('status helpers and content URL', () => {
  it('treats only ready as readable and only in-flight states as settling', () => {
    expect(isReadable(makeResource({ extraction_status: 'ready' }))).toBe(true);
    expect(isSettling(makeResource({ extraction_status: 'pending' }))).toBe(true);
    expect(isSettling(makeResource({ extraction_status: 'running' }))).toBe(true);
    for (const status of ['failed', 'unsupported', 'ready'] as const) {
      expect(isSettling(makeResource({ extraction_status: status }))).toBe(false);
    }
  });

  it('builds a same-origin content path', () => {
    expect(resourceContentUrl(12)).toBe('/api/users/me/resources/12/content');
  });

  // Moved here from userProfile.test.ts, which covered this through the
  // `deleteUpload` alias that no longer exists.
  it('deletes a resource by id', async () => {
    fetchMock.mockResolvedValue(response({ status: 'success' }));

    await deleteResource(7);

    const { url, init } = lastRequest();
    expect(url.pathname).toBe('/api/users/me/resources/7');
    expect(init.method).toBe('DELETE');
  });
});
