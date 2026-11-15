import { vi } from 'vitest';
import { HttpResponse, http, server } from '@/__tests__/server';
import type { DocumentListResponse } from '@/api/schema';
import type { DocumentListResult, DocumentSummary } from '../documents';

/** One row of the page lists. */
export function makeDocumentSummary(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'doc-1',
    name: 'Untitled page',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    collectionId: null,
    sortKey: 'V',
    placementEtag: '"cwp:1"',
    ...overrides,
  };
}

/** What `listDocuments` returns; a test names only what it is about. */
export type DocumentListAnswer = Partial<Omit<DocumentListResult, 'documents'>> & { documents?: Partial<DocumentSummary>[] };

/** `GET /workspaces/{w}/documents`'s answer as the API sends it, for the list `listDocuments` should read from it. */
export function documentListBody(answer: DocumentListAnswer = {}): DocumentListResponse {
  const items = (answer.documents ?? []).map((partial) => {
    const row = makeDocumentSummary(partial);
    return {
      id: row.id, name: row.name, collection_id: row.collectionId, sort_key: row.sortKey, placement_etag: row.placementEtag,
      tags: row.tags, created_at: row.createdAt, updated_at: row.updatedAt, activity: null,
    };
  });
  return { items, next_cursor: answer.nextCursor ?? null };
}

/** The query of a page-list request, as the client sends it. */
export type DocumentListBody = {
  limit?: number;
  query?: string;
  tags?: string[];
  sort_by?: string;
  sort_order?: string;
  cursor?: string;
  /** `root` or a collection id for one home's pages (the tree); absent for the whole workspace. */
  collection_id?: string;
};

function listQuery(request: Request): DocumentListBody {
  const params = new URL(request.url).searchParams;
  const body: DocumentListBody = {};
  if (params.has('limit')) body.limit = Number(params.get('limit'));
  for (const name of ['query', 'sort_by', 'sort_order', 'cursor', 'collection_id'] as const) {
    const value = params.get(name);
    if (value !== null) body[name] = value;
  }
  const tags = params.getAll('tags');
  if (tags.length) body.tags = tags;
  return body;
}

/**
 * Answer the page lists' request (`GET /workspaces/{w}/documents`) with
 * `list(query)` for the rest of the test; every other request goes to the
 * mock API. A `list` that throws is the network failing.
 */
export function mockDocumentList(
  list: (body: DocumentListBody, request: Request) => DocumentListAnswer | Promise<DocumentListAnswer> = () => ({}),
): void {
  server.use(http.get('/workspaces/{workspace_id}/documents', async ({ request, response }) => {
    try {
      return response(200).json(documentListBody(await list(listQuery(request), request)));
    } catch {
      return response.untyped(HttpResponse.error());
    }
  }));
}

/** A `vi.fn` standing in for the server's page list, for `mockDocumentList`. */
export function documentList(answer: DocumentListAnswer = {}) {
  return vi.fn(async (_body: DocumentListBody, _request?: Request): Promise<DocumentListAnswer> => answer);
}
