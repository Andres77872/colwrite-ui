import { afterEach, describe, expect, it, vi } from 'vitest';
import { listDocuments } from '../documents';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listDocuments', () => {
  it('sends trimmed filters, the selected sort, and the abort signal', async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      documents: [],
      count: 0,
      page: 2,
      limit: 25,
      total_pages: 0,
      sort_by: 'name',
      sort_order: 'asc',
      status: 'ok',
      message: 'listed',
    }));

    const result = await listDocuments(
      {
        page: 2,
        limit: 25,
        query: '  research notes  ',
        tags: [' draft ', '', 'reviewed'],
        sortBy: 'name',
        sortOrder: 'asc',
      },
      { signal: controller.signal },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/api/document/list');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      page: 2,
      limit: 25,
      query: 'research notes',
      tags: ['draft', 'reviewed'],
      sort_by: 'name',
      sort_order: 'asc',
    });
    expect(result).toMatchObject({
      count: 0,
      page: 2,
      limit: 25,
      totalPages: 0,
      sortBy: 'name',
      sortOrder: 'asc',
      status: 'ok',
      message: 'listed',
    });
  });

  it('uses last-updated descending defaults and normalizes wire summaries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      documents: [
        {
          _id: 'doc-1',
          name: '  First draft  ',
          version: 4,
          tags: ['draft', 42, 'reviewed'],
          created_at: '2026-01-02T03:04:05Z',
          updated_at: '2026-02-03T04:05:06Z',
          content_plain: 'must not escape normalization',
        },
        {
          id: 'doc-2',
          title: 'Legacy title',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
        },
        { name: 'missing id' },
        null,
      ],
      count: 2,
      page: 1,
      limit: 10,
      total_pages: 1,
      sort_by: 'updated_at',
      sort_order: 'desc',
    }));

    const result = await listDocuments();

    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      page: 1,
      limit: 10,
      sort_by: 'updated_at',
      sort_order: 'desc',
    });
    expect(result.documents).toEqual([
      {
        id: 'doc-1',
        name: 'First draft',
        version: 4,
        tags: ['draft', 'reviewed'],
        createdAt: '2026-01-02T03:04:05Z',
        updatedAt: '2026-02-03T04:05:06Z',
      },
      {
        id: 'doc-2',
        name: 'Legacy title',
        version: 1,
        tags: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      },
    ]);
    expect(result).toMatchObject({
      count: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
      sortBy: 'updated_at',
      sortOrder: 'desc',
    });
  });

  it('derives safe metadata when an older response omits pagination fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      documents: [{ document_id: 'doc-3', name: '   ' }],
      count: 21,
    }));

    const result = await listDocuments({ limit: 10, query: '   ' });

    expect(result.documents[0]).toEqual({
      id: 'doc-3',
      name: 'Untitled document',
      version: 1,
      tags: [],
      createdAt: '',
      updatedAt: '',
    });
    expect(result.totalPages).toBe(3);
    expect(result.sortBy).toBe('updated_at');
    expect(result.sortOrder).toBe('desc');
  });
});
