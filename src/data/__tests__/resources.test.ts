import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCollection,
  extractResource,
  getCollection,
  grantPdfs,
  grantStateOf,
  isSettling,
  listCollections,
  listPdfGrants,
  listResources,
  moveCollection,
  moveResource,
  previewCollectionTrash,
  readResourceMarkdown,
  renameResource,
  resourceContentUrl,
  resourceScopeOptions,
  restoreCollection,
  restoreResource,
  revokePdfs,
  searchResources,
  trashCollection,
  trashResource,
  uploadResource,
  type ResourceLibraryLocation,
  type ResourceScope,
} from '../resources';
import { http, multipartFields, recordRequests, server } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { FIXTURE_DOCUMENT_ID, LAB_WORKSPACE_ID, fixtures } from '@/dev/msw/fixtures';
import { makeCollectionDetail, makeResource } from './resourceFixtures';

const WS = TEST_WORKSPACE_ID;
const BASE = `/api/workspaces/${WS}`;

let sent: Request[] = [];
beforeEach(() => {
  sent = recordRequests();
});

function lastRequest(): { url: URL; request: Request } {
  const request = sent.at(-1);
  if (!request) throw new Error('No request was sent');
  return { url: new URL(request.url), request };
}

const lastJsonBody = () => lastRequest().request.clone().json() as Promise<unknown>;

const SEARCH = { items: [], resources_searched: 0, resources_skipped: [], truncated: false, next_cursor: null };

describe('resource scopes', () => {
  it.each<[ResourceScope, Record<string, string>]>([
    ['library', {}],
    ['document', { document_id: 'doc-1' }],
    ['context', { document_id: 'doc-1' }],
    ['collection', { collection_id: '7' }],
    ['collection_recursive', { collection_id: '7' }],
    ['unfiled', {}],
  ])('serializes the %s list scope', async (scope, required) => {
    server.use(http.get('/workspaces/{workspace_id}/resources', ({ response }) => response(200).json({ items: [], next_cursor: null })));

    await listResources(WS, {
      scope,
      documentId: required.document_id,
      collectionId: required.collection_id ? Number(required.collection_id) : undefined,
      limit: 5,
      cursor: 'next',
    });

    const { url } = lastRequest();
    expect(url.pathname).toBe(`${BASE}/resources`);
    expect(url.searchParams.get('scope')).toBe(scope);
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('cursor')).toBe('next');
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
    server.use(http.get('/workspaces/{workspace_id}/resources/search', ({ response }) => response(200).json({ query: 'term', scope, ...SEARCH })));

    await searchResources(WS, {
      query: 'term',
      scope,
      documentId: required.document_id,
      collectionId: required.collection_id ? Number(required.collection_id) : undefined,
    });

    const { url } = lastRequest();
    expect(url.pathname).toBe(`${BASE}/resources/search`);
    expect(url.searchParams.get('scope')).toBe(scope);
    for (const [key, value] of Object.entries(required)) {
      expect(url.searchParams.get(key)).toBe(value);
    }
  });

  it('omits absent identifiers rather than sending "null"', async () => {
    await listResources(WS, { scope: 'library', documentId: null, collectionId: null });

    expect(lastRequest().url.searchParams.has('document_id')).toBe(false);
    expect(lastRequest().url.searchParams.has('collection_id')).toBe(false);
  });

  it('lists only the workspace’s own PDFs', async () => {
    const personal = await listResources(WS, { limit: 100 });
    const lab = await listResources(LAB_WORKSPACE_ID, { limit: 100 });
    expect(personal.items.map((item) => item.id)).not.toContain(51);
    expect(lab.items.map((item) => item.id)).toEqual([51]);
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
  it('posts multipart with the location it goes to, and never both targets', async () => {
    const stored = makeResource({ filename: 'paper.pdf' });
    server.use(http.post('/workspaces/{workspace_id}/resources', ({ response }) => response(201).json(stored)));
    const file = new File(['%PDF-'], 'paper.pdf', { type: 'application/pdf' });

    const result = await uploadResource(WS, file, { documentId: 'doc-1', collectionId: 3 });

    const { request } = lastRequest();
    expect(request.headers.get('Idempotency-Key')).toBeTruthy();
    const form = await multipartFields(request);
    expect(Object.keys(form).sort()).toEqual(['document_id', 'file', 'location']);
    expect(form).toMatchObject({ location: 'document', document_id: 'doc-1' });
    expect(result.filename).toBe('paper.pdf');
  });

  it.each<[string, { documentId?: string; collectionId?: number }, Record<string, string>]>([
    ['a collection', { collectionId: 3 }, { location: 'collection', collection_id: '3' }],
    ['Unfiled', {}, { location: 'unfiled' }],
  ])('says when a PDF goes to %s', async (_label, target, fields) => {
    server.use(http.post('/workspaces/{workspace_id}/resources', ({ response }) => response(201).json(makeResource())));
    await uploadResource(WS, new File(['%PDF-'], 'paper.pdf', { type: 'application/pdf' }), target);
    const form = await multipartFields(lastRequest().request);
    expect(form).toMatchObject(fields);
  });

  it('caps search matches at the server ceiling and preserves encoded text', async () => {
    await searchResources(WS, {
      query: 'a&b=c',
      scope: 'library',
      maxMatches: 500,
      cursor: 'more',
    });

    expect(lastRequest().url.searchParams.get('query')).toBe('a&b=c');
    expect(lastRequest().url.searchParams.get('max_matches')).toBe('40');
    expect(lastRequest().url.searchParams.get('cursor')).toBe('more');
  });

  it('caps Markdown windows at the server ceiling', async () => {
    server.use(http.get('/workspaces/{workspace_id}/resources/{resource_id}/markdown', ({ response }) =>
      response(200).json({ resource: makeResource(), text: '', offset: 0, total_chars: 0, returned_chars: 0, next_offset: null, truncated: false })));

    await readResourceMarkdown(WS, 7, { offset: 100, limit: 999_999 });

    const { url } = lastRequest();
    expect(url.pathname).toBe(`${BASE}/resources/7/markdown`);
    expect(url.searchParams.get('offset')).toBe('100');
    expect(url.searchParams.get('limit')).toBe('120000');
  });

  it('omits force unless it was asked for', async () => {
    server.use(http.post('/workspaces/{workspace_id}/resources/{resource_id}/extract', ({ response }) =>
      response(200).json(makeResource())));

    await extractResource(WS, 3);
    expect(lastRequest().url.searchParams.has('force')).toBe(false);

    await extractResource(WS, 3, { force: true });
    expect(lastRequest().url.searchParams.get('force')).toBe('true');
  });

  it('moves a PDF by naming the kind of place it goes to', async () => {
    server.use(http.put('/workspaces/{workspace_id}/resources/{resource_id}/location', ({ response }) =>
      response(200).json(makeResource())));

    await moveResource(WS, 4);
    expect(lastRequest().url.pathname).toBe(`${BASE}/resources/4/location`);
    expect(await lastJsonBody()).toEqual({ kind: 'unfiled' });

    await moveResource(WS, 4, { documentId: 'doc-1', collectionId: 9 });
    expect(await lastJsonBody()).toEqual({ kind: 'document', document_id: 'doc-1' });

    await moveResource(WS, 4, { collectionId: 9 });
    expect(await lastJsonBody()).toEqual({ kind: 'collection', collection_id: 9 });
  });

  it('renames a PDF', async () => {
    const renamed = await renameResource(WS, 42, 'moe.pdf');
    expect(lastRequest().request.method).toBe('PATCH');
    expect(lastRequest().url.pathname).toBe(`${BASE}/resources/42`);
    expect(await lastJsonBody()).toEqual({ filename: 'moe.pdf' });
    expect(renamed.filename).toBe('moe.pdf');
  });
});

describe('collection clients', () => {
  it('lists the top level and paged children with a page’s grant state', async () => {
    server.use(http.get('/workspaces/{workspace_id}/collections', ({ response }) =>
      response(200).json({ items: [], next_cursor: null })));

    await listCollections(WS, { limit: 25 });
    expect(lastRequest().url.pathname).toBe(`${BASE}/collections`);
    expect(lastRequest().url.searchParams.get('parent_id')).toBe('root');

    await listCollections(WS, { parentId: 6, grantStateFor: 'doc-1', limit: 10, cursor: 'c2' });
    const { url } = lastRequest();
    expect(url.searchParams.get('parent_id')).toBe('6');
    expect(url.searchParams.get('grant_state_for')).toBe('doc-1');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('cursor')).toBe('c2');
  });

  it('creates roots or nested collections through the one create route', async () => {
    server.use(http.post('/workspaces/{workspace_id}/collections', ({ response }) => response(201).json(makeCollectionDetail())));

    await createCollection(WS, { name: 'Root', description: null, parentId: null });
    expect(lastRequest().url.pathname).toBe(`${BASE}/collections`);
    expect(lastRequest().request.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await lastJsonBody()).toEqual({ name: 'Root', description: null });

    await createCollection(WS, { name: 'Child', description: 'Nested', parentId: 7 });
    expect(await lastJsonBody()).toEqual({ name: 'Child', description: 'Nested', parent_id: 7 });
  });

  it('reads a collection’s detail with its path', async () => {
    server.use(http.get('/workspaces/{workspace_id}/collections/{collection_id}', ({ response }) =>
      response(200).json(makeCollectionDetail({ id: 8 }))));

    const detail = await getCollection(WS, 8);
    expect(lastRequest().url.pathname).toBe(`${BASE}/collections/8`);
    expect(detail.path).toEqual([{ id: 8, name: 'Sources' }]);
  });

  it('moves a subtree to a parent or the root with an explicit null, locked on its ETag', async () => {
    server.use(http.post('/workspaces/{workspace_id}/collections/{collection_id}/move', ({ response }) =>
      response(200).json(makeCollectionDetail())));

    await moveCollection(WS, 5, '"cwc:3"', { parentId: null });

    expect(lastRequest().url.pathname).toBe(`${BASE}/collections/5/move`);
    expect(lastRequest().request.method).toBe('POST');
    expect(lastRequest().request.headers.get('If-Match')).toBe('"cwc:3"');
    expect(await lastJsonBody()).toEqual({ parent_id: null });
  });

  it('previews, then trashes with the counts it showed and the ETag; a 202 carries the job', async () => {
    const preview = await previewCollectionTrash(WS, 4);
    expect(lastRequest().url.pathname).toBe(`${BASE}/collections/4/trash-preview`);
    // Chapter 2: itself, its two pages and its PDF.
    expect(preview).toEqual({ collection_count: 1, page_count: 2, pdf_count: 1, pdf_bytes: expect.any(Number) });

    const trashed = await trashCollection(WS, 4, '"cwc:1"', preview);
    expect(lastRequest().url.pathname).toBe(`${BASE}/collections/4/trash`);
    expect(lastRequest().request.method).toBe('POST');
    expect(lastRequest().request.headers.get('If-Match')).toBe('"cwc:1"');
    expect(await lastJsonBody()).toEqual({
      expected_collection_count: 1,
      expected_page_count: 2,
      expected_pdf_count: 1,
      expected_pdf_bytes: preview.pdf_bytes,
    });
    expect(trashed).toMatchObject({ collection_id: 4, page_count: 2, job: { kind: 'collection_trash', progress: { total: 2 } } });

    const restored = await restoreCollection(WS, 4);
    expect(lastRequest().url.pathname).toBe(`${BASE}/collections/4/restore`);
    expect(restored).toMatchObject({ collection: { id: 4 }, moved_to_root: false, job: { kind: 'collection_restore' } });
  });

  it('refuses a trash whose counts no longer match (preview_changed) and moves nothing', async () => {
    const preview = await previewCollectionTrash(WS, 4);
    await expect(trashCollection(WS, 4, '"cwc:1"', { ...preview, page_count: preview.page_count + 1 }))
      .rejects.toMatchObject({ status: 409, data: { code: 'preview_changed' } });
    expect(fixtures.collections.get(4)?.trashed_at).toBeNull();
  });

  it('grants and revokes a collection’s PDFs on a page', async () => {
    fixtures.collections.set(40, {
      id: 40, workspace_id: WS, name: 'Sources', description: null, parent_id: null, sort_key: 'z', sort_mode: 'name',
      grant_new_pages: false, row_version: 1, grants: new Map(), created_at: '2026-07-18T12:00:00Z', updated_at: '2026-07-18T12:00:00Z',
      trashed_at: null, trash_root_id: null, trashed_by: null,
    });

    expect(await grantPdfs(WS, FIXTURE_DOCUMENT_ID, 40)).toMatchObject({ collection_id: 40, direct: true, effective: true });
    expect(lastRequest().url.pathname).toBe(`${BASE}/documents/${FIXTURE_DOCUMENT_ID}/pdf-grants/40`);
    expect(lastRequest().request.method).toBe('PUT');
    expect(await listPdfGrants(WS, FIXTURE_DOCUMENT_ID)).toEqual([
      { collection_id: 40, name: 'Sources', origin: 'manual', path: [{ id: 40, name: 'Sources' }] },
    ]);

    expect((await revokePdfs(WS, FIXTURE_DOCUMENT_ID, 40)).direct).toBe(false);
    expect(lastRequest().request.method).toBe('DELETE');
  });

  it('reads a page’s grant on a collection from its grants and the collection’s path', () => {
    const path = [{ id: 1, name: 'Thesis' }, { id: 2, name: 'Reading' }];
    expect(grantStateOf(path, [])).toEqual({ direct: false, effective: false, via_collection_id: null, via_collection_name: null });
    expect(grantStateOf(path, [{ collection_id: 1, name: 'Thesis', origin: 'manual', path: [path[0]!] }]))
      .toEqual({ direct: false, effective: true, via_collection_id: 1, via_collection_name: 'Thesis' });
    expect(grantStateOf(path, [{ collection_id: 2, name: 'Reading', origin: 'setting', path }]))
      .toEqual({ direct: true, effective: true, via_collection_id: 2, via_collection_name: 'Reading' });
  });
});

describe('status helpers and content URL', () => {
  it('treats only in-flight states as settling', () => {
    expect(isSettling(makeResource({ extraction: { status: 'pending' } }))).toBe(true);
    expect(isSettling(makeResource({ extraction: { status: 'running' } }))).toBe(true);
    for (const status of ['failed', 'unsupported', 'ready'] as const) {
      expect(isSettling(makeResource({ extraction: { status } }))).toBe(false);
    }
  });

  it('builds a same-origin content path under the workspace', () => {
    expect(resourceContentUrl(WS, 12)).toBe(`${BASE}/resources/12/content`);
  });

  it('moves a PDF to the Trash and back, where it was', async () => {
    const trashed = await trashResource(WS, 61);
    expect(lastRequest().url.pathname).toBe(`${BASE}/resources/61/trash`);
    expect(lastRequest().request.method).toBe('POST');
    expect(trashed).toMatchObject({ id: 61, trashed_at: expect.any(String), purge_after: expect.any(String) });
    expect((await listResources(WS, { scope: 'collection', collectionId: 2 })).items.map((pdf) => pdf.id)).not.toContain(61);

    const restored = await restoreResource(WS, 61);
    expect(lastRequest().url.pathname).toBe(`${BASE}/resources/61/restore`);
    expect(restored.location).toMatchObject({ kind: 'collection', collection_id: 2 });
    await expect(restoreResource(WS, 61)).rejects.toMatchObject({ status: 409, data: { code: 'not_in_trash' } });
  });
});
