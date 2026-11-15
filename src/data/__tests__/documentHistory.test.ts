import { describe, it, expect } from 'vitest';
import {
  decideChangeSetOperations,
  decisionRefusal,
  diffRevision,
  fetchDocumentHead,
  getChangeSet,
  getRevision,
  isStaleHead,
  listPendingChangeSets,
  listRevisions,
  rejectChangeSet,
  restoreRevision,
} from '../documentHistory';
import { ApiError } from '@/api/errors';
import type { ChangeSetResponse, DocumentContentOutput, DocumentStateResponse, RevisionResponse } from '@/api/schema';
import { http, pathOf, recordRequests, server } from '@/__tests__/server';
import { wireBlock } from '@/dev/msw/fixtures';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

const WS = TEST_WORKSPACE_ID;

/** `METHOD /path?query` of a request, as the API sees it behind the proxy. */
const line = (request: Request) => {
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}${url.search}`;
};

const DOC_ID = 'doc-1';
const REV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ETAG = 'cw:v1:1:7:abc123';

const snapshot: DocumentContentOutput = {
  schema_version: 1,
  name: 'Findings',
  tags: [],
  blocks: [wireBlock({ id: 'p1', type: 'paragraph', html: 'Hello world' })],
};

function revisionPayload(overrides: Partial<RevisionResponse> = {}): RevisionResponse {
  return {
    content: snapshot,
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
    semantic_operations: null,
    ...overrides,
  };
}

function headPayload(overrides: Partial<DocumentStateResponse> = {}): DocumentStateResponse {
  return {
    document_id: DOC_ID,
    workspace_id: WS,
    collection_id: null,
    sort_key: 'V',
    placement_etag: '"cwp:1"',
    content: snapshot,
    head_seq: 7,
    revision_no: 7,
    revision_id: REV_A,
    current_revision_id: REV_A,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-08-01T12:00:00Z',
    deleted_at: null,
    purge_after: null,
    trash_root: null,
    duplicate: false,
    ...overrides,
  };
}

describe('fetchDocumentHead', () => {
  it('parses the page state and captures the ETag header', async () => {
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}', ({ response }) => response(200).json(headPayload(), { headers: { ETag: ETAG } })));

    const head = await fetchDocumentHead(WS, DOC_ID);

    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${DOC_ID}`);
    expect(head.documentId).toBe(DOC_ID);
    expect(head.currentRevisionId).toBe(REV_A);
    expect(head.etag).toBe(ETAG);
    expect(head.content.name).toBe('Findings');
    expect(head.content).not.toHaveProperty('version');
    expect(head.content.blocks).toHaveLength(1);
  });
});

describe('listRevisions', () => {
  it('maps entries and passes limit and cursor through', async () => {
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions', ({ response }) => {
      const { content: _content, semantic_operations: _operations, ...metadata } = revisionPayload();
      return response(200).json({ revisions: [metadata], next_cursor: 'cursor-2' });
    }));

    const page = await listRevisions(WS, DOC_ID, { limit: 20, cursor: 'cursor-1' });

    expect(pathOf(sent[0])).toBe(
      `/api/workspaces/${WS}/documents/${DOC_ID}/revisions?limit=20&cursor=cursor-1`,
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
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions', ({ response }) => response(200).json({ revisions: [], next_cursor: null })));
    const page = await listRevisions(WS, DOC_ID);
    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${DOC_ID}/revisions`);
    expect(page.revisions).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe('getRevision', () => {
  it('returns metadata plus the snapshot normalized to a Doc', async () => {
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}', ({ response }) => response(200).json(revisionPayload())));

    const revision = await getRevision(WS, DOC_ID, REV_A);

    expect(revision.revisionId).toBe(REV_A);
    expect(revision.content.name).toBe('Findings');
    expect(revision.content.blocks[0]).toMatchObject({ id: 'p1', type: 'paragraph' });
  });
});

describe('diffRevision', () => {
  it('defaults to against=current and maps the changes', async () => {
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/diff', ({ response }) => response(200).json({
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
              from_index: null,
              to_index: null,
              parent_id: null,
              previous_parent_id: null,
            },
          ],
        },
      })));

    const diff = await diffRevision(WS, DOC_ID, REV_A);

    expect(pathOf(sent[0])).toBe(
      `/api/workspaces/${WS}/documents/${DOC_ID}/revisions/${REV_A}/diff?against=current`,
    );
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
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/diff', ({ response }) => response(200).json({
      base_revision_id: REV_A,
      target_revision_id: REV_B,
      target_head_seq: null,
      diff: { algorithm_version: 'stable-id-v1', base_hash: 'x', target_hash: 'y', changes: [] },
    })));

    const diff = await diffRevision(WS, DOC_ID, REV_A, REV_B);

    expect(pathOf(sent[0])).toContain(`?against=${REV_B}`);
    expect(diff.targetRevisionId).toBe(REV_B);
    expect(diff.changes).toEqual([]);
  });
});

describe('restoreRevision', () => {
  it('sends If-Match and a generated Idempotency-Key with the provided etag', async () => {
    const sent: Array<{ line: string; headers: Headers; body: unknown }> = [];
    server.use(http.post('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', async ({ request, response }) => {
      sent.push({ line: line(request), headers: request.headers, body: await request.json() });
      return response(200).json(headPayload({ head_seq: 8 }), { headers: { ETag: 'cw:next' } });
    }));

    const head = await restoreRevision(WS, DOC_ID, REV_A, { etag: ETAG, summary: 'Bring back v7' });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.line).toBe(`POST /api/workspaces/${WS}/documents/${DOC_ID}/revisions/${REV_A}/restore`);
    expect(sent[0]?.headers.get('If-Match')).toBe(ETAG);
    expect(sent[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]?.body).toEqual({ summary: 'Bring back v7' });
    expect(head.etag).toBe('cw:next');
  });

  it('fetches a fresh head first when no etag is provided and omits the body without a summary', async () => {
    const sent = recordRequests();
    server.use(
      http.get('/workspaces/{workspace_id}/documents/{document_id}', ({ response }) => response(200).json(headPayload(), { headers: { ETag: ETAG } })),
      http.post('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', async ({ request, response }) => {
        expect(request.headers.get('If-Match')).toBe(ETAG);
        expect(await request.text()).toBe('');
        return response(200).json(headPayload({ head_seq: 8 }), { headers: { ETag: 'cw:next' } });
      }),
    );

    const head = await restoreRevision(WS, DOC_ID, REV_A);

    expect(sent.map(line)).toEqual([
      `GET /api/workspaces/${WS}/documents/${DOC_ID}`,
      `POST /api/workspaces/${WS}/documents/${DOC_ID}/revisions/${REV_A}/restore`,
    ]);
    expect(head.etag).toBe('cw:next');
  });
});

describe('agent change sets', () => {
  const CS_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const changeSetPayload = (over: Partial<ChangeSetResponse> = {}): ChangeSetResponse => ({
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
    proposed_at: '2026-08-02T12:00:00Z',
    apply_policy: 'review',
    auto_blocked_reason: null,
    operation_decisions: [],
    operation_targets: null,
    compared_head_seq: null,
    duplicate: false,
    decided_at: null,
    decided_by: null,
    conflict_reason: null,
    rejection_reason: null,
    depends_on_change_set_id: null,
    run_uuid: null,
    accepted_revision_id: null,
    accepted_head_seq: null,
    ...over,
  });
  const answerChangeSet = (body: ChangeSetResponse) =>
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/change-sets/{change_set_id}', ({ response }) => response(200).json(body)));

  it('getChangeSet maps stored snake_case operations onto editor operations', async () => {
    answerChangeSet(changeSetPayload());

    const changeSet = await getChangeSet(WS, DOC_ID, CS_ID);

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
    answerChangeSet(changeSetPayload());

    const changeSet = await getChangeSet(WS, DOC_ID, CS_ID);

    // The review flow fails closed on these: staging only the mappable
    // operations and retiring the record would silently lose the rest.
    expect(changeSet.unmappableOperations).toEqual(['move_block', 'unknown_future_op']);
  });

  it('rejectChangeSet posts to the reject action', async () => {
    const sent = recordRequests();
    server.use(http.post('/workspaces/{workspace_id}/documents/{document_id}/change-sets/{change_set_id}/reject', ({ response }) =>
      response(200).json(changeSetPayload({ status: 'rejected' }))));

    const changeSet = await rejectChangeSet(WS, DOC_ID, CS_ID);

    expect(sent.map(line)).toEqual([
      `POST /api/workspaces/${WS}/documents/${DOC_ID}/change-sets/${CS_ID}/reject`,
    ]);
    expect(changeSet.status).toBe('rejected');
  });

  describe('per-operation review', () => {
    const reviewable = (over: Partial<ChangeSetResponse> = {}) =>
      changeSetPayload({
        operations: [
          { op: 'replace_block', block_id: 'p1', block: { html: 'rewritten' } },
          { op: 'insert_block_after', reference_id: 'p1', block: { id: 'n1', type: 'divider' } },
        ],
        proposed_at: '2026-08-02T12:00:00Z',
        depends_on_change_set_id: null,
        operation_targets: [
          { block_id: 'p1', fingerprint: 'aaa', head_fingerprint: 'bbb' },
          null,
        ],
        compared_head_seq: 9,
        operation_decisions: [
          { index: 1, decision: 'rejected', decided_at: '2026-08-02T12:05:00Z', decided_by: 'usr-1', origin: 'manual' },
        ],
        ...over,
      });

    it('reads the decisions and the target fingerprints the server recorded', async () => {
      answerChangeSet(reviewable({ depends_on_change_set_id: 'parent-1' }));

      const changeSet = await getChangeSet(WS, DOC_ID, CS_ID);

      expect(changeSet.operationDecisions).toEqual([{ opIndex: 1, decision: 'rejected' }]);
      expect(changeSet.operationTargets).toEqual([
        { blockId: 'p1', fingerprint: 'aaa', headFingerprint: 'bbb' },
        null,
      ]);
      expect(changeSet.dependsOnChangeSetId).toBe('parent-1');
      expect(changeSet.proposedAt).toBe('2026-08-02T12:00:00Z');
    });

    it('reads a set with no decisions yet as an empty record', async () => {
      answerChangeSet(reviewable({ operation_decisions: [] }));
      expect((await getChangeSet(WS, DOC_ID, CS_ID)).operationDecisions).toEqual([]);
    });

    it('reads a change set stored before targets were recorded as having none', async () => {
      answerChangeSet(reviewable({ operation_targets: null }));
      expect((await getChangeSet(WS, DOC_ID, CS_ID)).operationTargets).toBeNull();
    });

    it('does not trust targets that do not line up with the operations', async () => {
      answerChangeSet(reviewable({ operation_targets: [{ block_id: 'p1', fingerprint: 'aaa', head_fingerprint: null }] }));
      expect((await getChangeSet(WS, DOC_ID, CS_ID)).operationTargets).toBeNull();
    });

    it('reads a target whose block is gone from the saved document', async () => {
      answerChangeSet(reviewable({
        operation_targets: [{ block_id: 'p1', fingerprint: 'aaa', head_fingerprint: null }, null],
      }));
      expect((await getChangeSet(WS, DOC_ID, CS_ID)).operationTargets?.[0]).toEqual({
        blockId: 'p1',
        fingerprint: 'aaa',
        headFingerprint: null,
      });
    });

    it('decideChangeSetOperations posts the decisions by operation index, with no precondition', async () => {
      const requests: Array<{ path: string; body: unknown; headers: Headers }> = [];
      server.use(http.post('/workspaces/{workspace_id}/documents/{document_id}/change-sets/{change_set_id}/decisions', async ({ request, response }) => {
        requests.push({ path: line(request), body: await request.json(), headers: request.headers });
        const decided = { decided_at: '2026-08-02T12:05:00Z', decided_by: 'usr-1', origin: 'manual' } as const;
        return response(200).json(reviewable({
          status: 'superseded',
          operation_decisions: [
            { index: 1, decision: 'rejected', ...decided },
            { index: 0, decision: 'accepted', ...decided },
          ],
        }));
      }));

      const changeSet = await decideChangeSetOperations(WS, DOC_ID, CS_ID, [
        { opIndex: 0, decision: 'accepted' },
      ]);

      expect(requests).toHaveLength(1);
      expect(requests[0]?.path).toBe(
        `POST /api/workspaces/${WS}/documents/${DOC_ID}/change-sets/${CS_ID}/decisions`,
      );
      // The author decided these in the editor, so they are manual.
      expect(requests[0]?.body).toEqual({ decisions: [{ index: 0, decision: 'accepted', origin: 'manual' }] });
      // The record is its own idempotency, and the head has usually moved.
      expect(requests[0]?.headers.get('If-Match')).toBeNull();
      expect(requests[0]?.headers.get('Idempotency-Key')).toBeNull();
      expect(changeSet.status).toBe('superseded');
      expect(changeSet.operationDecisions).toEqual([
        { opIndex: 1, decision: 'rejected' },
        { opIndex: 0, decision: 'accepted' },
      ]);
    });

    it('lists pending change sets oldest first, whatever order the API returns', async () => {
      server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/change-sets', ({ response }) => response(200).json({
        change_sets: [
          reviewable({ change_set_id: 'newest', proposed_at: '2026-08-02T12:10:00Z' }),
          reviewable({ change_set_id: 'tie-b', proposed_at: '2026-08-02T12:05:00Z' }),
          reviewable({ change_set_id: 'tie-a', proposed_at: '2026-08-02T12:05:00Z' }),
          reviewable({ change_set_id: 'oldest', proposed_at: '2026-08-02T12:00:00Z' }),
        ],
        next_cursor: null,
      })));

      const pending = await listPendingChangeSets(WS, DOC_ID);

      // A later batch of a run builds on the earlier ones, and they are
      // staged in this order.
      expect(pending.map((changeSet) => changeSet.changeSetId)).toEqual([
        'oldest',
        'tie-a',
        'tie-b',
        'newest',
      ]);
    });

    it('asks for the pending sets only', async () => {
      const sent = recordRequests();
      server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/change-sets', ({ response }) => response(200).json({ change_sets: [], next_cursor: null })));
      await listPendingChangeSets(WS, DOC_ID);
      expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${DOC_ID}/change-sets?status=pending`);
    });

    it('sorts refused decisions into what the caller can do about them', () => {
      const conflict = (context: Record<string, unknown>) =>
        new ApiError('conflict', 409, { code: 'change_set_conflict', retryable: false, ...context });

      expect(
        decisionRefusal(conflict({ conflict_reason: 'operation_already_decided', operation_index: 2 })),
      ).toEqual({ kind: 'contradicted', opIndex: 2 });
      expect(decisionRefusal(conflict({ conflict_reason: 'terminal_state' }))).toEqual({ kind: 'final' });
      expect(decisionRefusal(conflict({ conflict_reason: 'expired' }))).toEqual({ kind: 'final' });
      expect(decisionRefusal(conflict({ conflict_reason: 'lifecycle_race' }))).toEqual({ kind: 'transient' });
      expect(
        decisionRefusal(new ApiError('gone', 404, { code: 'change_set_not_found' })),
      ).toEqual({ kind: 'final' });
      // A server still catching up, a dropped connection, an expired session.
      expect(
        decisionRefusal(new ApiError('wait', 429, { code: 'document_rate_limit_exceeded', retryable: true })),
      ).toEqual({ kind: 'transient' });
      expect(decisionRefusal(new TypeError('Failed to fetch'))).toEqual({ kind: 'transient' });
      expect(decisionRefusal(new ApiError('sign in', 401, null))).toEqual({ kind: 'transient' });
      expect(decisionRefusal(new ApiError('down', 503, null))).toEqual({ kind: 'transient' });
    });
  });
});

describe('problem+json helpers', () => {
  it('reads the machine code from an ApiError body', () => {
    const error = new ApiError('The document head changed', 412, {
      type: 'https://colwrite.com/problems/stale_head',
      code: 'stale_head',
      retryable: false,
    });
    expect(isStaleHead(error)).toBe(true);
  });

  it('returns null for non-problem errors', () => {
    expect(isStaleHead(new Error('boom'))).toBe(false);
    expect(isStaleHead(new ApiError('nope', 404, { detail: 'missing' }))).toBe(false);
  });
});
