import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  acceptChangeSet,
  diffRevision,
  fetchDocumentHead,
  getChangeSet,
  getRevision,
  historyErrorCode,
  isStaleHead,
  listRevisions,
  rejectChangeSet,
  restoreRevision,
} from '../documentHistory';
import { ApiError } from '../contracts';

beforeEach(() => {
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockRoutes(route: Route) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(route(String(input), init)),
    );
}

const DOC_ID = 'doc-1';
const REV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ETAG = 'cw:v1:1:7:abc123';

const snapshot = {
  schema_version: 1,
  name: 'Findings',
  tags: [],
  blocks: [{ id: 'p1', type: 'paragraph', html: 'Hello world' }],
};

function revisionPayload(overrides: Record<string, unknown> = {}) {
  return {
    revision_id: REV_A,
    revision_no: 7,
    through_seq: 7,
    parent_revision_id: REV_B,
    kind: 'save',
    actor_type: 'human',
    origin: 'human',
    created_at: '2026-08-01T12:00:00Z',
    schema_version: 1,
    serializer_version: 'v1',
    content_hash: 'abc123',
    byte_size: 512,
    restored_from_revision_id: null,
    summary: 'Edited intro',
    ...overrides,
  };
}

function headPayload(overrides: Record<string, unknown> = {}) {
  return {
    document_id: DOC_ID,
    content: snapshot,
    head_seq: 7,
    revision_no: 7,
    revision_id: REV_A,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-08-01T12:00:00Z',
    deleted_at: null,
    purge_after: null,
    duplicate: false,
    ...overrides,
  };
}

describe('fetchDocumentHead', () => {
  it('parses the v2 state and captures the ETag header', async () => {
    const fetchSpy = mockRoutes(() => json(headPayload(), 200, { ETag: ETAG }));

    const head = await fetchDocumentHead(DOC_ID);

    expect(String(fetchSpy.mock.calls[0][0])).toBe(`/api/v2/documents/${DOC_ID}`);
    expect(head.documentId).toBe(DOC_ID);
    expect(head.headSeq).toBe(7);
    expect(head.etag).toBe(ETAG);
    expect(head.content.name).toBe('Findings');
    expect(head.content.blocks).toHaveLength(1);
  });

  it('throws on a body without document_id', async () => {
    mockRoutes(() => json({ nope: true }));
    await expect(fetchDocumentHead(DOC_ID)).rejects.toThrow(/invalid document state/i);
  });
});

describe('listRevisions', () => {
  it('normalizes entries and passes limit and cursor through', async () => {
    const fetchSpy = mockRoutes(() =>
      json({
        revisions: [revisionPayload(), { garbage: true }],
        next_cursor: 'cursor-2',
      }),
    );

    const page = await listRevisions(DOC_ID, { limit: 20, cursor: 'cursor-1' });

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `/api/v2/documents/${DOC_ID}/revisions?limit=20&cursor=cursor-1`,
    );
    expect(page.revisions).toHaveLength(1);
    expect(page.revisions[0]).toMatchObject({
      revisionId: REV_A,
      revisionNo: 7,
      kind: 'save',
      origin: 'human',
      summary: 'Edited intro',
      byteSize: 512,
    });
    expect(page.nextCursor).toBe('cursor-2');
  });

  it('omits the query string when no options are set', async () => {
    const fetchSpy = mockRoutes(() => json({ revisions: [], next_cursor: null }));
    const page = await listRevisions(DOC_ID);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`/api/v2/documents/${DOC_ID}/revisions`);
    expect(page.revisions).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects a payload without a revisions array', async () => {
    mockRoutes(() => json({ unexpected: true }));
    await expect(listRevisions(DOC_ID)).rejects.toThrow(/invalid revision list/i);
  });
});

describe('getRevision', () => {
  it('returns metadata plus the snapshot normalized to a Doc', async () => {
    mockRoutes(() => json(revisionPayload({ content: snapshot })));

    const revision = await getRevision(DOC_ID, REV_A);

    expect(revision.revisionId).toBe(REV_A);
    expect(revision.content.name).toBe('Findings');
    expect(revision.content.blocks[0]).toMatchObject({ id: 'p1', type: 'paragraph' });
  });
});

describe('diffRevision', () => {
  it('defaults to against=current and normalizes changes', async () => {
    const fetchSpy = mockRoutes(() =>
      json({
        base_revision_id: REV_A,
        target_revision_id: null,
        target_head_seq: 9,
        diff: {
          algorithm_version: 'stable-id-v1',
          base_hash: 'x',
          target_hash: 'y',
          changes: [
            {
              entity: 'block',
              change: 'changed',
              entity_id: 'p1',
              entity_type: 'paragraph',
              fields: ['html'],
            },
            { entity: 'block', change: 'not-a-change', entity_id: 'p2' },
          ],
        },
      }),
    );

    const diff = await diffRevision(DOC_ID, REV_A);

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `/api/v2/documents/${DOC_ID}/revisions/${REV_A}/diff?against=current`,
    );
    expect(diff.targetHeadSeq).toBe(9);
    expect(diff.targetRevisionId).toBeNull();
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({
      entity: 'block',
      change: 'changed',
      entityId: 'p1',
      fields: ['html'],
    });
  });

  it('diffs against a specific revision when given', async () => {
    const fetchSpy = mockRoutes(() =>
      json({
        base_revision_id: REV_A,
        target_revision_id: REV_B,
        target_head_seq: null,
        diff: { algorithm_version: 'stable-id-v1', base_hash: 'x', target_hash: 'y', changes: [] },
      }),
    );

    const diff = await diffRevision(DOC_ID, REV_A, REV_B);

    expect(String(fetchSpy.mock.calls[0][0])).toContain(`?against=${REV_B}`);
    expect(diff.targetRevisionId).toBe(REV_B);
    expect(diff.changes).toEqual([]);
  });
});

describe('restoreRevision', () => {
  it('sends If-Match and a generated Idempotency-Key with the provided etag', async () => {
    const fetchSpy = mockRoutes(() => json(headPayload({ head_seq: 8 }), 200, { ETag: 'cw:next' }));

    const head = await restoreRevision(DOC_ID, REV_A, { etag: ETAG, summary: 'Bring back v7' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`/api/v2/documents/${DOC_ID}/revisions/${REV_A}/restore`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBe(ETAG);
    expect(headers['Idempotency-Key']).toBeTruthy();
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ summary: 'Bring back v7' });
    expect(head.headSeq).toBe(8);
    expect(head.etag).toBe('cw:next');
  });

  it('fetches a fresh head first when no etag is provided and omits the body without a summary', async () => {
    const calls: string[] = [];
    mockRoutes((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (!init?.method || init.method === 'GET') {
        return json(headPayload(), 200, { ETag: ETAG });
      }
      const headers = init.headers as Record<string, string>;
      expect(headers['If-Match']).toBe(ETAG);
      expect(init.body).toBeUndefined();
      return json(headPayload({ head_seq: 8 }), 200, { ETag: 'cw:next' });
    });

    const head = await restoreRevision(DOC_ID, REV_A);

    expect(calls).toEqual([
      `GET /api/v2/documents/${DOC_ID}`,
      `POST /api/v2/documents/${DOC_ID}/revisions/${REV_A}/restore`,
    ]);
    expect(head.headSeq).toBe(8);
  });
});

describe('agent change sets', () => {
  const CS_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const changeSetPayload = (over: Record<string, unknown> = {}) => ({
    change_set_id: CS_ID,
    document_id: DOC_ID,
    status: 'pending',
    base_head_seq: 3,
    base_content_hash: 'hash',
    base_etag: ETAG,
    base_revision_id: REV_A,
    operations: [
      { op: 'replace_block', block_id: 'p1', block: { html: 'rewritten' } },
      { op: 'insert_block_after', reference_id: 'p1', block: { id: 'n1', type: 'divider' } },
      { op: 'reorder_block', block_id: 'p1', to_index: 2 },
      { op: 'update_meta', meta: { name: 'Renamed' } },
      { op: 'move_block', block_id: 'p1', to_index: 1 },
      { op: 'unknown_future_op', payload: 'ignored' },
    ],
    proposer_id: 'usr-1',
    proposer_type: 'agent',
    origin: 'agent',
    tool_call_id: 'call_1',
    summary: null,
    expires_at: '2026-08-03T12:00:00Z',
    ...over,
  });

  it('getChangeSet maps stored snake_case operations onto editor operations', async () => {
    mockRoutes(() => json(changeSetPayload()));

    const changeSet = await getChangeSet(DOC_ID, CS_ID);

    expect(changeSet.changeSetId).toBe(CS_ID);
    expect(changeSet.status).toBe('pending');
    expect(changeSet.baseEtag).toBe(ETAG);
    expect(changeSet.operations).toEqual([
      { op: 'replace_block', blockId: 'p1', block: { html: 'rewritten' } },
      { op: 'insert_block_after', referenceId: 'p1', block: { id: 'n1', type: 'divider' } },
      { op: 'reorder_block', blockId: 'p1', toIndex: 2 },
      { op: 'update_meta', meta: { name: 'Renamed' } },
    ]);
  });

  it('getChangeSet flags operations with no editor mapping instead of dropping them', async () => {
    mockRoutes(() => json(changeSetPayload()));

    const changeSet = await getChangeSet(DOC_ID, CS_ID);

    // The review flow fails closed on these: staging only the mappable
    // operations and retiring the record would silently lose the rest.
    expect(changeSet.unmappableOperations).toEqual(['move_block', 'unknown_future_op']);
  });

  it('acceptChangeSet presents the freshest head ETag and adopts the response', async () => {
    const calls: string[] = [];
    mockRoutes((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(url, 'http://x').pathname}`);
      if (!init?.method || init.method === 'GET') {
        return json(
          { document_id: DOC_ID, head_seq: 3, content: snapshot },
          200,
          { ETag: ETAG },
        );
      }
      const headers = new Headers(init.headers);
      expect(headers.get('If-Match')).toBe(ETAG);
      expect(headers.get('Idempotency-Key')).toBeTruthy();
      return json(
        {
          change_set: changeSetPayload({ status: 'accepted' }),
          document: { document_id: DOC_ID, head_seq: 4, content: snapshot },
        },
        200,
        { ETag: 'cw:v1:1:8:def' },
      );
    });

    const { changeSet, head } = await acceptChangeSet(DOC_ID, CS_ID);

    expect(calls).toEqual([
      `GET /api/v2/documents/${DOC_ID}`,
      `POST /api/v2/documents/${DOC_ID}/change-sets/${CS_ID}/accept`,
    ]);
    expect(changeSet.status).toBe('accepted');
    expect(head.headSeq).toBe(4);
    expect(head.etag).toBe('cw:v1:1:8:def');
  });

  it('rejectChangeSet posts to the reject action', async () => {
    const calls: string[] = [];
    mockRoutes((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(url, 'http://x').pathname}`);
      return json(changeSetPayload({ status: 'rejected' }));
    });

    const changeSet = await rejectChangeSet(DOC_ID, CS_ID);

    expect(calls).toEqual([
      `POST /api/v2/documents/${DOC_ID}/change-sets/${CS_ID}/reject`,
    ]);
    expect(changeSet.status).toBe('rejected');
  });
});

describe('problem+json helpers', () => {
  it('reads the machine code from an ApiError body', () => {
    const error = new ApiError('The document head changed', 412, {
      type: 'https://colwrite.com/problems/stale_head',
      code: 'stale_head',
      retryable: false,
    });
    expect(historyErrorCode(error)).toBe('stale_head');
    expect(isStaleHead(error)).toBe(true);
  });

  it('returns null for non-problem errors', () => {
    expect(historyErrorCode(new Error('boom'))).toBeNull();
    expect(isStaleHead(new ApiError('nope', 404, { detail: 'missing' }))).toBe(false);
  });
});
