import { describe, expect, it } from 'vitest';
import { http, jsonOf, pathOf, recordRequests, server } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { FIXTURE_DOCUMENT_ID, LAB_DOCUMENT_ID, LAB_WORKSPACE_ID, fixtures } from '@/dev/msw/fixtures';
import type { Block } from '../../editor/types';
import { createDocument, getDocument, listDocuments, restoreDocument, saveDocument, trashDocument } from '../documents';

const sampleBlocks: Block[] = [
  { id: 'b1', type: 'paragraph', html: '<p>Hello</p>' },
  { id: 'b2', type: 'heading', level: 2, html: '<h2>World</h2>' },
];

const WS = TEST_WORKSPACE_ID;

describe('getDocument', () => {
  it('returns the page, the ETag a save is locked on, and when it was saved', async () => {
    const opened = await getDocument(WS, FIXTURE_DOCUMENT_ID);
    expect(opened.etag).toBe('"cw:canonical-json-v1:1:3:preview"');
    expect(opened.doc.name).toBe('Sparse Routing for Long-Context Pretraining');
    expect(opened.doc).not.toHaveProperty('version');
    expect(opened.updatedAt).toBe(fixtures.documents.get(FIXTURE_DOCUMENT_ID)?.updated_at);
  });

  it('reads the page under its workspace', async () => {
    const sent = recordRequests();
    await getDocument(WS, FIXTURE_DOCUMENT_ID);
    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${FIXTURE_DOCUMENT_ID}`);
  });

  it('does not find a page of another workspace', async () => {
    await expect(getDocument(WS, LAB_DOCUMENT_ID)).rejects.toMatchObject({ status: 404 });
    await expect(getDocument(LAB_WORKSPACE_ID, LAB_DOCUMENT_ID)).resolves.toMatchObject({ doc: { name: 'Lab meeting notes' } });
  });

  it('refuses an answer without an ETag', async () => {
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}', ({ response }) =>
      response(200).json({
        document_id: 'doc-1', workspace_id: WS, collection_id: null, sort_key: 'V', placement_etag: '"cwp:1"', head_seq: 1, revision_no: 1, revision_id: 'r', current_revision_id: 'r',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null, purge_after: null, trash_root: null, duplicate: false,
        content: { schema_version: 1, name: 'x', blocks: [] },
      })));
    await expect(getDocument(WS, 'doc-1')).rejects.toThrow(/concurrency token/);
  });

  it('passes the caller’s signal to the request', async () => {
    const sent = recordRequests();
    const controller = new AbortController();
    await getDocument(WS, FIXTURE_DOCUMENT_ID, { signal: controller.signal });
    controller.abort();
    expect(sent[0]?.signal.aborted).toBe(true);
  });
});

describe('saveDocument and createDocument', () => {
  it('save the whole content over the ETag, with an Idempotency-Key, and answer the next ETag', async () => {
    const sent = recordRequests();
    const { etag } = await getDocument(WS, FIXTURE_DOCUMENT_ID);

    const saved = await saveDocument(WS, FIXTURE_DOCUMENT_ID, { blocks: sampleBlocks, name: 'My Doc' }, etag);

    const put = sent.find((request) => request.method === 'PUT');
    expect(pathOf(put)).toBe(`/api/workspaces/${WS}/documents/${FIXTURE_DOCUMENT_ID}`);
    expect(put?.headers.get('If-Match')).toBe(etag);
    expect(put?.headers.get('Idempotency-Key')).toBeTruthy();
    const body = await jsonOf(put) as { content: Record<string, unknown> };
    expect(Object.keys(body.content).sort()).toEqual(['blocks', 'citationStyle', 'documentType', 'instructions', 'name', 'schema_version', 'sources']);
    expect(body.content).toMatchObject({ name: 'My Doc', schema_version: 1, sources: null, citationStyle: null });
    expect(saved.etag).toBe('"cw:canonical-json-v1:1:4:preview"');
  });

  it('a stale ETag is 412 stale_head', async () => {
    await expect(saveDocument(WS, FIXTURE_DOCUMENT_ID, { blocks: [] }, '"cw:canonical-json-v1:1:1:preview"'))
      .rejects.toMatchObject({ status: 412, data: { code: 'stale_head' } });
  });

  it('create a page in the workspace', async () => {
    const sent = recordRequests();

    const created = await createDocument(WS, { blocks: [] });

    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents`);
    expect(sent[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await jsonOf(sent[0])).toMatchObject({ content: { name: 'Untitled page', blocks: [] } });
    expect(created.id).toBeTruthy();
    expect(created.etag).toBe('"cw:canonical-json-v1:1:1:preview"');
    expect(fixtures.documents.get(created.id)?.workspace_id).toBe(WS);
  });
});

describe('trashDocument and restoreDocument', () => {
  // A trash can be undone, so it takes no content precondition, and neither
  // it nor a restore changes the content ETag.
  it('trash with an Idempotency-Key and no If-Match, and say what took the page there', async () => {
    const { etag } = await getDocument(WS, FIXTURE_DOCUMENT_ID);
    const sent = recordRequests();

    const trashed = await trashDocument(WS, FIXTURE_DOCUMENT_ID);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('POST');
    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents/${FIXTURE_DOCUMENT_ID}/trash`);
    expect(sent[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]?.headers.get('If-Match')).toBeNull();
    expect(trashed).toMatchObject({ documentId: FIXTURE_DOCUMENT_ID, trashRoot: { kind: 'document', id: FIXTURE_DOCUMENT_ID } });
    expect(trashed.purgeAfter).toBeTruthy();
    await expect(getDocument(WS, FIXTURE_DOCUMENT_ID)).rejects.toMatchObject({ status: 409, data: { code: 'document_in_trash' } });

    const placement = await restoreDocument(WS, FIXTURE_DOCUMENT_ID);
    expect(placement).toMatchObject({ documentId: FIXTURE_DOCUMENT_ID, collectionId: null });
    expect((await getDocument(WS, FIXTURE_DOCUMENT_ID)).etag).toBe(etag);
  });

  it('a page already in the Trash is document_in_trash; one that is not is not_in_trash', async () => {
    await trashDocument(WS, FIXTURE_DOCUMENT_ID);
    await expect(trashDocument(WS, FIXTURE_DOCUMENT_ID)).rejects.toMatchObject({ status: 409, data: { code: 'document_in_trash' } });
    await restoreDocument(WS, FIXTURE_DOCUMENT_ID);
    await expect(restoreDocument(WS, FIXTURE_DOCUMENT_ID)).rejects.toMatchObject({ status: 409, data: { code: 'not_in_trash' } });
  });
});

describe('listDocuments', () => {
  it('lists the workspace’s pages by cursor, with no total', async () => {
    const sent = recordRequests();
    const first = await listDocuments(WS, { limit: 2 });
    expect(first.documents).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/documents?limit=2&sort_by=updated_at&sort_order=desc`);
    expect(first.documents[0]).not.toHaveProperty('version');
  });

  it('lists no page of another workspace', async () => {
    const all = await listDocuments(WS, { limit: 100 });
    expect(all.documents.map((row) => row.id)).not.toContain(LAB_DOCUMENT_ID);
    const lab = await listDocuments(LAB_WORKSPACE_ID, { limit: 100 });
    expect(lab.documents.map((row) => row.id)).toEqual([LAB_DOCUMENT_ID]);
  });
});
