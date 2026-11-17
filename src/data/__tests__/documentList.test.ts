import { describe, expect, it } from 'vitest';
import { http, pathOf, recordRequests, server } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { listDocuments } from '../documents';

const WS = TEST_WORKSPACE_ID;

describe('listDocuments', () => {
  it('sends trimmed filters, the selected sort, and the abort signal', async () => {
    const controller = new AbortController();
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/documents', ({ response }) => response(200).json({ items: [], next_cursor: null })));

    const result = await listDocuments(
      WS,
      {
        limit: 25,
        query: '  research notes  ',
        tags: [' draft ', '', 'reviewed'],
        sortBy: 'name',
        sortOrder: 'asc',
      },
      { signal: controller.signal },
    );

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.method).toBe('GET');
    expect(request?.credentials).toBe('include');
    controller.abort();
    expect(request?.signal.aborted).toBe(true);
    const url = new URL(request?.url ?? '');
    expect(url.pathname).toBe(`/api/workspaces/${WS}/documents`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      limit: '25',
      query: 'research notes',
      sort_by: 'name',
      sort_order: 'asc',
    });
    expect(url.searchParams.getAll('tags')).toEqual(['draft', 'reviewed']);
    expect(result).toEqual({ documents: [], nextCursor: null });
  });

  it('uses last-updated descending defaults and maps the wire summaries', async () => {
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/documents', ({ response }) => response(200).json({
      items: [
        {
          id: 'doc-1',
          name: 'First draft',
          collection_id: null,
          sort_key: 'V',
          placement_etag: '"cwp:1"',
          tags: ['draft', 'reviewed'],
          created_at: '2026-01-02T03:04:05Z',
          updated_at: '2026-02-03T04:05:06Z',
          activity: null,
        },
        { id: 'doc-2', name: 'Untitled page', collection_id: 3, sort_key: 'W', placement_etag: '"cwp:2"', tags: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', activity: null },
      ],
      next_cursor: 'next',
    })));

    const result = await listDocuments(WS);

    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents?limit=10&sort_by=updated_at&sort_order=desc`);
    expect(result).toEqual({
      documents: [
        {
          id: 'doc-1', name: 'First draft', tags: ['draft', 'reviewed'], createdAt: '2026-01-02T03:04:05Z', updatedAt: '2026-02-03T04:05:06Z',
          collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"',
        },
        {
          id: 'doc-2', name: 'Untitled page', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          collectionId: 3, sortKey: 'W', placementEtag: '"cwp:2"',
        },
      ],
      nextCursor: 'next',
    });
  });

  it('searches on the server: only the pages whose words match', async () => {
    const result = await listDocuments(WS, { query: 'rebuttal', limit: 50 });
    expect(result.documents.map((row) => row.name)).toEqual(['Rebuttal notes — ICLR']);
  });
});
