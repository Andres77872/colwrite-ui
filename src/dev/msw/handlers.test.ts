import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSocket, type AgentSessionEvent } from '@/api/assistant/agentSocket';
import {
  decideChangeSetOperations,
  decisionRefusal,
  fetchDocumentHead,
  getChangeSet,
  listPendingChangeSets,
  listRevisions,
  rejectChangeSet,
  restoreRevision,
} from '@/data/documentHistory';
import {
  createDocument,
  getDocument,
  listDocuments,
  movePage,
  reorderPage,
  restoreDocument,
  saveDocument,
  trashDocument,
} from '@/data/documents';
import {
  getCollection,
  listCollections,
  listPdfGrants,
  listResources,
  moveCollection,
  previewCollectionTrash,
  reorderCollection,
  restoreCollection,
  restoreResource,
  trashCollection,
  trashResource,
  updateCollection,
} from '@/data/resources';
import { deleteForever, emptyTrash, getJob, listTrash } from '@/data/trash';
import {
  OWNED_WORKSPACE_LIMIT,
  copyPageToWorkspace,
  createWorkspace,
  deleteWorkspace,
  downloadWorkspaceExport,
  exportWorkspace,
  getAccountUsage,
  getWorkspace,
  listWorkspaces,
  locateDocument,
  restoreWorkspace,
  setLastWorkspace,
  updateWorkspace,
} from '@/data/workspaces';
import { deleteAccount } from '@/data/userProfile';
import { problemBody } from '@/api/errors';
import { problemCode } from '@/api/errors';
import { takeItems } from '@/lib/itemAt';
import {
  DELETED_WORKSPACE_ID,
  FIXTURE_DOCUMENT_ID,
  INVITED_WORKSPACE_ID,
  LAB_DOCUMENT_ID,
  LAB_WORKSPACE_ID,
  OWNED_WORKSPACE_ID,
  PERSONAL_WORKSPACE_ID,
  REVIEW_DOCUMENT_ID,
  TRASHED,
  TREE,
  TREE_PAGES,
  VIEWER_WORKSPACE_ID,
  documentsIn,
  editElsewhere,
  fixtures,
  moveElsewhere,
  seedSizeFixture,
  trashElsewhere,
  trashPage,
} from './fixtures';

/**
 * The mock API keeps the rules the editor relies on, read through the same
 * request functions the app uses. Each test starts from the fixture state.
 */

const WS = PERSONAL_WORKSPACE_ID;

async function saveBlock(id: string, html: string): Promise<void> {
  const { doc, etag } = await getDocument(WS, REVIEW_DOCUMENT_ID);
  await saveDocument(WS, REVIEW_DOCUMENT_ID, {
    ...doc,
    blocks: doc.blocks.map((block) => (block.id === id && block.type === 'paragraph' ? { ...block, html } : block)),
  }, etag);
}

async function reviewChangeSetId(): Promise<string> {
  const [changeSet] = takeItems(await listPendingChangeSets(WS, REVIEW_DOCUMENT_ID), 1);
  return changeSet.changeSetId;
}

describe('the workspaces', () => {
  it('lists the live workspaces, most recently opened first, with the deleted ones it can restore', async () => {
    const list = await listWorkspaces();
    expect(list.items.map((workspace) => [workspace.id, workspace.kind])).toEqual([
      [PERSONAL_WORKSPACE_ID, 'personal'],
      [LAB_WORKSPACE_ID, 'shared'],
      [OWNED_WORKSPACE_ID, 'shared'],
      [VIEWER_WORKSPACE_ID, 'shared'],
    ]);
    // A workspace the account was invited to but has not joined is not listed.
    expect(list.items.some((workspace) => workspace.id === INVITED_WORKSPACE_ID)).toBe(false);
    expect(list.items.map((workspace) => [workspace.role, workspace.member_count])).toEqual([
      ['owner', 1], ['editor', 4], ['owner', 2], ['viewer', 3],
    ]);
    expect(list.capabilities.multi_workspace).toBe(true);
    expect(list.deleted.map((workspace) => workspace.id)).toEqual([DELETED_WORKSPACE_ID]);
    // Nothing opened yet: the app falls back to the personal workspace.
    expect(list.last_workspace_id).toBeNull();

    await setLastWorkspace(LAB_WORKSPACE_ID);
    expect((await listWorkspaces()).last_workspace_id).toBe(LAB_WORKSPACE_ID);
    // A deleted workspace answers nothing.
    expect(await refusal(getWorkspace(DELETED_WORKSPACE_ID))).toBe('workspace_not_found');
  });

  it('counts each workspace’s own pages', async () => {
    expect((await getWorkspace(PERSONAL_WORKSPACE_ID)).counts.pages).toBe(documentsIn(PERSONAL_WORKSPACE_ID).length);
    expect(documentsIn(PERSONAL_WORKSPACE_ID).length).toBeGreaterThan(60);
    expect((await getWorkspace(LAB_WORKSPACE_ID)).counts.pages).toBe(1);
  });

  it('locates a bare page link in its workspace, and keeps pages to their own workspace', async () => {
    expect(await locateDocument(LAB_DOCUMENT_ID)).toMatchObject({ workspace_id: LAB_WORKSPACE_ID });
    await expect(locateDocument('66f0c0ffee000000000000ff')).rejects.toMatchObject({ status: 404 });
    // A page is not found through another workspace's routes.
    await expect(getDocument(WS, LAB_DOCUMENT_ID)).rejects.toMatchObject({ status: 404 });
    expect((await listDocuments(LAB_WORKSPACE_ID, { limit: 10 })).documents.map((row) => row.id)).toEqual([LAB_DOCUMENT_ID]);
  });
});

describe('the half-reviewed change set', () => {
  it('is listed as pending with the decisions already made on it', async () => {
    const [changeSet, ...others] = takeItems(await listPendingChangeSets(WS, REVIEW_DOCUMENT_ID), 1);

    expect(others).toEqual([]);
    expect(changeSet.unmappableOperations).toEqual([]);
    expect(changeSet.operations.map((operation) => operation.op)).toEqual([
      'replace_text',
      'write_blocks',
      'write_blocks',
      'delete_blocks',
      'write_blocks',
    ]);
    // The server's flag, on the rewrite that brings a number the page lacks.
    expect(changeSet.operations.map((operation) => operation.newInformation)).toEqual([false, false, true, false, false]);
    expect(changeSet.operationDecisions).toEqual([
      { opIndex: 1, decision: 'accepted' },
      { opIndex: 3, decision: 'rejected' },
    ]);
  });

  it('says which target the author changed after the proposal', async () => {
    const { operationTargets } = await getChangeSet(WS, REVIEW_DOCUMENT_ID, await reviewChangeSetId());
    const current = (operationTargets ?? []).map((entry) => entry.map((target) => target.headFingerprint === target.fingerprint));

    // The abstract and the thanks are as the assistant read them; the
    // results paragraph is not. Inserts have no target.
    expect(current).toEqual([[true], [], [false], [true], []]);
  });

  it('follows the saved document, and ignores how a block is shown', async () => {
    const changeSetId = await reviewChangeSetId();
    await saveBlock('cr-abstract', 'Rewritten by the author.');
    const edited = await getChangeSet(WS, REVIEW_DOCUMENT_ID, changeSetId);
    expect(edited.operationTargets?.[0]?.[0]?.headFingerprint).not.toBe(edited.operationTargets?.[0]?.[0]?.fingerprint);

    await saveBlock('cr-abstract', 'We study sparse routing at long context lengths and find that it scales well.');
    const back = await getChangeSet(WS, REVIEW_DOCUMENT_ID, changeSetId);
    expect(back.operationTargets?.[0]?.[0]?.headFingerprint).toBe(back.operationTargets?.[0]?.[0]?.fingerprint);
  });

  it('records a decision once, and answers a repeat without changing anything', async () => {
    const changeSetId = await reviewChangeSetId();
    const first = await decideChangeSetOperations(WS, REVIEW_DOCUMENT_ID, changeSetId, [{ opIndex: 2, decision: 'rejected' }]);
    expect(first.status).toBe('pending');
    expect(first.operationDecisions?.at(-1)).toEqual({ opIndex: 2, decision: 'rejected' });

    const repeat = await decideChangeSetOperations(WS, REVIEW_DOCUMENT_ID, changeSetId, [{ opIndex: 2, decision: 'rejected' }]);
    expect(repeat.operationDecisions).toEqual(first.operationDecisions);
  });

  it('refuses to change a recorded decision, naming the operation, and records nothing of the request', async () => {
    const changeSetId = await reviewChangeSetId();
    const refusal = await decideChangeSetOperations(WS, REVIEW_DOCUMENT_ID, changeSetId, [
      { opIndex: 0, decision: 'accepted' },
      { opIndex: 3, decision: 'accepted' },
    ]).then(() => null, (cause: unknown) => decisionRefusal(cause));

    expect(refusal).toEqual({ kind: 'contradicted', opIndex: 3 });
    const { operationDecisions } = await getChangeSet(WS, REVIEW_DOCUMENT_ID, changeSetId);
    expect(operationDecisions?.some((decision) => decision.opIndex === 0)).toBe(false);
  });

  it('refuses an operation the change set does not have', async () => {
    await expect(
      decideChangeSetOperations(WS, REVIEW_DOCUMENT_ID, await reviewChangeSetId(), [{ opIndex: 9, decision: 'accepted' }]),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses an automatic decision on a set stored for review', async () => {
    const refusal = await decideChangeSetOperations(
      WS, REVIEW_DOCUMENT_ID, await reviewChangeSetId(), [{ opIndex: 0, decision: 'accepted' }], 'auto',
    ).then(() => null, (cause: unknown) => cause);
    expect(refusal).toMatchObject({ status: 409, data: { conflict_reason: 'auto_not_allowed' } });
  });

  it('takes the set out of pending when the last operation is decided, applying nothing, and still answers that request', async () => {
    const changeSetId = await reviewChangeSetId();
    const before = await getDocument(WS, REVIEW_DOCUMENT_ID);
    await decideChangeSetOperations(WS, REVIEW_DOCUMENT_ID, changeSetId, [{ opIndex: 2, decision: 'rejected' }]);

    const resolved = await decideChangeSetOperations(WS, REVIEW_DOCUMENT_ID, changeSetId, [
      { opIndex: 0, decision: 'accepted' },
      { opIndex: 4, decision: 'rejected' },
    ]);

    expect(resolved.status).toBe('superseded');
    expect(await listPendingChangeSets(WS, REVIEW_DOCUMENT_ID)).toEqual([]);
    expect(await getDocument(WS, REVIEW_DOCUMENT_ID)).toEqual(before);

    const retried = await decideChangeSetOperations(WS, REVIEW_DOCUMENT_ID, changeSetId, [{ opIndex: 4, decision: 'rejected' }]);
    expect(retried.status).toBe('superseded');
    await expect(rejectChangeSet(WS, REVIEW_DOCUMENT_ID, changeSetId)).rejects.toMatchObject({ status: 409 });
  });

  it('has nothing stored for the other documents', async () => {
    expect(await listPendingChangeSets(WS, '66f0c0ffee0000000000d0c2')).toEqual([]);
  });
});

describe('an assistant turn that improves the page', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The turn's `tool_action`, once the preview's paced run has sent it. */
  async function improve(request: { apply_mode?: 'auto' | 'propose' }): Promise<Record<string, unknown>> {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const events: AgentSessionEvent[] = [];
    const client = new AgentSocket((event) => events.push(event));
    try {
      await client.connect();
      const session = await client.request('sessions.create', { workspace_id: WS, document_id: FIXTURE_DOCUMENT_ID });
      await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id, after_seq: 0 });
      await client.request('runs.start', {
        workspace_id: WS,
        session_id: session.id,
        request_id: `improve-${request.apply_mode ?? 'propose'}`,
        request: { document_id: FIXTURE_DOCUMENT_ID, message: 'improve the introduction', ...request },
      });
      for (let waited = 0; waited < 30_000 && !events.some((event) => event.event === 'tool_action'); waited += 500) {
        await vi.advanceTimersByTimeAsync(500);
      }
      const action = events.find((event) => event.event === 'tool_action');
      if (!action) throw new Error('The turn sent no tool_action');
      return action.data;
    } finally {
      client.close();
    }
  }

  it('stores its edits as a change set and names it, for review by default', async () => {
    const action = await improve({});

    expect(action).toMatchObject({ status: 'proposed', actions: [], apply_policy: 'review' });
    const changeSet = await getChangeSet(WS, FIXTURE_DOCUMENT_ID, String(action.change_set_id));
    expect(changeSet).toMatchObject({ status: 'pending', applyPolicy: 'review' });
    // Every operation kind, in the stored form the editor maps whole.
    expect(changeSet.unmappableOperations).toEqual([]);
    expect(changeSet.operations.map((operation) => operation.op)).toEqual([
      'replace_text', 'write_blocks', 'write_blocks', 'delete_blocks', 'move_block', 'set_meta', 'add_sources', 'remove_sources', 'write_blocks',
    ]);
    // The tool action names the set, as the API's proposal summary does.
    expect(action.proposal).toMatchObject({ change_set_id: action.change_set_id, operation_count: 9 });
  });

  it('stores an Auto turn’s set as `auto`, so the open editor applies it', async () => {
    const action = await improve({ apply_mode: 'auto' });

    expect(action).toMatchObject({ status: 'proposed', apply_policy: 'auto' });
    expect(await getChangeSet(WS, FIXTURE_DOCUMENT_ID, String(action.change_set_id))).toMatchObject({ applyPolicy: 'auto' });
  });
});

describe('the page list', () => {
  it('lists the workspace’s live pages newest first, and says when there are more', async () => {
    const all = await listDocuments(WS, { limit: 10, home: 'root' });
    const first = await listDocuments(WS, { limit: 2, home: 'root' });

    expect(all.documents).toHaveLength(5);
    expect(all.nextCursor).toBeNull();
    expect(all.documents.map((row) => row.updatedAt)).toEqual([...all.documents.map((row) => row.updatedAt)].sort().reverse());
    expect(first.documents.map((row) => row.id)).toEqual(all.documents.slice(0, 2).map((row) => row.id));
    expect(first.nextCursor).not.toBeNull();
  });

  it('sorts by name either way', async () => {
    const ascending = (await listDocuments(WS, { sortBy: 'name', sortOrder: 'asc', limit: 10, home: 'root' })).documents.map((row) => row.name);
    const descending = (await listDocuments(WS, { sortBy: 'name', sortOrder: 'desc', limit: 10, home: 'root' })).documents.map((row) => row.name);

    expect(ascending).toEqual([...ascending].sort());
    expect(descending).toEqual([...ascending].reverse());
  });

  it('searches the names and the text of the pages', async () => {
    const byName = await listDocuments(WS, { query: 'rebuttal' });
    const byText = await listDocuments(WS, { query: 'Hoffmann' });

    expect(byName.documents.map((row) => row.name)).toEqual(['Rebuttal notes — ICLR']);
    expect(byText.documents.map((row) => row.name)).toEqual(['Scaling laws reading list']);
  });
});

describe('the Trash', () => {
  const ID = '66f0c0ffee0000000000d0c3';

  it('hides a trashed page everywhere, refuses to read it, lists it, and restores it with its ETag', async () => {
    const { etag } = await getDocument(WS, ID);
    const before = (await getWorkspace(WS)).counts;

    const trashed = await trashDocument(WS, ID);

    expect(trashed.trashRoot).toEqual({ kind: 'document', id: ID });
    await expect(getDocument(WS, ID)).rejects.toMatchObject({
      status: 409,
      data: { code: 'document_in_trash', trash_root: { kind: 'document', id: ID } },
    });
    expect((await listDocuments(WS, { limit: 100 })).documents.map((row) => row.id)).not.toContain(ID);
    expect((await listTrash(WS)).items[0]).toMatchObject({ kind: 'document', id: ID, original_path: [] });
    expect((await getWorkspace(WS)).counts).toMatchObject({ pages: before.pages - 1, trash: before.trash + 1 });

    await restoreDocument(WS, ID);
    expect((await getDocument(WS, ID)).etag).toBe(etag);
    expect((await getWorkspace(WS)).counts).toEqual(before);
  });

  it('seeds a trashed collection and a trashed page, newest first, with where they were and when they go', async () => {
    const { items, next_cursor: next } = await listTrash(WS);

    expect(next).toBeNull();
    expect(items.map((item) => [item.kind, item.name])).toEqual([
      ['document', 'Discarded abstract'],
      ['collection', 'Old drafts'],
    ]);
    expect(items[0]).toMatchObject({ original_path: [{ id: TREE.thesis, name: 'Thesis' }], counts: null });
    expect(items[1]?.counts).toEqual({ collection_count: 2, page_count: 2, pdf_count: 1, pdf_bytes: expect.any(Number) });
    const days = (Date.parse(items[1]?.purge_after ?? '') - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(27);
    // What they hold is hidden.
    await expect(getDocument(WS, TRASHED.collectionPages[0])).rejects.toMatchObject({
      data: { code: 'document_in_trash', trash_root: { kind: 'collection', id: String(TRASHED.collection) } },
    });
    expect((await listCollections(WS)).items.map((item) => item.id)).not.toContain(TRASHED.collection);
  });

  it('trashes a collection with its pages and PDFs as one root, with a job that reports done after a delay', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const chapter2 = await getCollection(WS, TREE.chapter2);
      const preview = await previewCollectionTrash(WS, TREE.chapter2);
      expect(preview).toMatchObject({ collection_count: 1, page_count: 2, pdf_count: 1 });

      const result = await trashCollection(WS, TREE.chapter2, chapter2.etag, preview);

      expect(result.job).toMatchObject({ kind: 'collection_trash', progress: { done: 0, total: 2 } });
      // Hidden at once, while the job is still running.
      expect((await listCollections(WS, { parentId: TREE.thesis })).items.map((item) => item.name)).toEqual(['Chapter 1']);
      expect((await listDocuments(WS, { limit: 100 })).documents.map((row) => row.id)).not.toContain(TREE_PAGES.methods);
      expect((await listResources(WS)).items.map((pdf) => pdf.id)).not.toContain(64);
      // A page that went with it comes back only with it.
      expect(await refusal(restoreDocument(WS, TREE_PAGES.methods))).toBe('document_in_trash');

      vi.setSystemTime(Date.now() + fixtures.jobDurationMs / 2);
      expect((await getJob(WS, result.job?.id ?? 0)).status).toBe('running');
      vi.setSystemTime(Date.now() + fixtures.jobDurationMs);
      expect(await getJob(WS, result.job?.id ?? 0)).toMatchObject({ status: 'done', progress: { done: 2, total: 2 } });

      const restored = await restoreCollection(WS, TREE.chapter2);
      expect(restored.moved_to_root).toBe(false);
      expect((await getDocument(WS, TREE_PAGES.methods)).placement.collectionId).toBe(TREE.chapter2);
      expect((await listResources(WS)).items.map((pdf) => pdf.id)).toContain(64);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a trash whose preview changed under it, and moves nothing', async () => {
    const chapter2 = await getCollection(WS, TREE.chapter2);
    const preview = await previewCollectionTrash(WS, TREE.chapter2);
    await createDocument(WS, { name: 'Discussion', blocks: [] }, { collectionId: TREE.chapter2 });

    expect(await refusal(trashCollection(WS, TREE.chapter2, chapter2.etag, preview))).toBe('preview_changed');
    expect(await refusal(trashCollection(WS, TREE.chapter2, '"cwc:0"', preview))).toBe('stale_collection');
    expect((await listCollections(WS, { parentId: TREE.thesis })).items.map((item) => item.name)).toContain('Chapter 2');
  });

  it('restores a page to the top level when its collection is gone', async () => {
    await trashDocument(WS, TREE_PAGES.outline);
    const thesis = await getCollection(WS, TREE.thesis);
    await trashCollection(WS, TREE.thesis, thesis.etag, await previewCollectionTrash(WS, TREE.thesis));

    const placement = await restoreDocument(WS, TREE_PAGES.outline);

    expect(placement.collectionId).toBeNull();
  });

  it('trashes and restores a PDF on its own', async () => {
    await trashResource(WS, 42);
    expect((await listResources(WS)).items.map((pdf) => pdf.id)).not.toContain(42);
    expect((await listTrash(WS)).items[0]).toMatchObject({ kind: 'resource', id: '42' });
    expect((await restoreResource(WS, 42)).location).toEqual({ kind: 'unfiled' });
  });

  it('deletes a root forever only with the counts the Trash shows, and moves a page’s PDFs to Unfiled', async () => {
    const collection = (await listTrash(WS)).items.find((item) => item.kind === 'collection');
    if (!collection?.counts) throw new Error('The seeded collection root is missing');
    expect(await refusal(deleteForever(WS, { ...collection, counts: { ...collection.counts, page_count: 9 } }))).toBe('preview_changed');
    expect((await deleteForever(WS, collection)).kind).toBe('collection_purge');
    expect(fixtures.collections.has(TRASHED.collection)).toBe(false);
    expect(fixtures.pdfs.some((pdf) => pdf.id === TRASHED.collectionPdf)).toBe(false);

    // A page's PDFs are never deleted with it.
    fixtures.pdfs.find((pdf) => pdf.id === 41)!.document_id = ID;
    await trashDocument(WS, ID);
    await deleteForever(WS, { kind: 'document', id: ID, counts: null });
    expect(fixtures.documents.has(ID)).toBe(false);
    expect((await listResources(WS, { scope: 'unfiled' })).items.map((pdf) => pdf.id)).toContain(41);

    const job = await emptyTrash(WS);
    expect(job.kind).toBe('trash_empty');
    expect((await listTrash(WS)).items).toEqual([]);
    expect((await getWorkspace(WS)).counts.trash).toBe(0);
  });

  it('keeps deleting forever and emptying to admins, and restoring to whoever trashed it', async () => {
    trashPage(fixtures.documents.get(LAB_DOCUMENT_ID)!, 'u-another-member');

    expect(await refusal(emptyTrash(LAB_WORKSPACE_ID))).toBe('workspace_role_required');
    expect(await refusal(deleteForever(LAB_WORKSPACE_ID, { kind: 'document', id: LAB_DOCUMENT_ID, counts: null }))).toBe('workspace_role_required');
    expect(await refusal(restoreDocument(LAB_WORKSPACE_ID, LAB_DOCUMENT_ID))).toBe('workspace_role_required');
    // Another workspace's job is not found.
    const job = await emptyTrash(WS);
    expect(await refusal(getJob(LAB_WORKSPACE_ID, job.id))).toBe('job_not_found');
  });
});

describe('saving and history', () => {
  it('saves over the ETag it was read at, and answers the next one', async () => {
    const { doc, etag } = await getDocument(WS, FIXTURE_DOCUMENT_ID);
    const saved = await saveDocument(WS, FIXTURE_DOCUMENT_ID, { ...doc, name: 'Renamed' }, etag);

    expect(saved.etag).not.toBe(etag);
    expect((await getDocument(WS, FIXTURE_DOCUMENT_ID)).etag).toBe(saved.etag);
  });

  it('refuses a save over a head that moved, as 412 stale_head', async () => {
    const { doc, etag } = await getDocument(WS, FIXTURE_DOCUMENT_ID);
    editElsewhere(FIXTURE_DOCUMENT_ID);

    await expect(saveDocument(WS, FIXTURE_DOCUMENT_ID, doc, etag)).rejects.toMatchObject({
      status: 412,
      data: { code: 'stale_head', expected_head: etag },
    });
  });

  it('restores an older version by moving the pointer, without writing a revision', async () => {
    const before = await listRevisions(WS, FIXTURE_DOCUMENT_ID);
    const head = await restoreRevision(WS, FIXTURE_DOCUMENT_ID, 'rev-1');

    expect(head.revisionId).toBe('rev-1');
    expect((await listRevisions(WS, FIXTURE_DOCUMENT_ID)).revisions).toEqual(before.revisions);
    expect((await fetchDocumentHead(WS, FIXTURE_DOCUMENT_ID)).etag).toBe(head.etag);
  });

  it('refuses a restore against a head that has moved', async () => {
    const { etag } = await fetchDocumentHead(WS, FIXTURE_DOCUMENT_ID);
    editElsewhere(FIXTURE_DOCUMENT_ID);

    await expect(restoreRevision(WS, FIXTURE_DOCUMENT_ID, 'rev-1', { etag: etag ?? '' })).rejects.toMatchObject({ status: 412 });
  });

  it('pages the timeline with a cursor', async () => {
    const first = await listRevisions(WS, FIXTURE_DOCUMENT_ID, { limit: 2 });
    const rest = await listRevisions(WS, FIXTURE_DOCUMENT_ID, { limit: 2, cursor: first.nextCursor });

    expect(first.revisions.map((revision) => revision.revisionId)).toEqual(['rev-3', 'rev-2']);
    expect(rest).toMatchObject({ nextCursor: null });
    expect(rest.revisions.map((revision) => revision.revisionId)).toEqual(['rev-1']);
  });

  it('finds a page another tab moved to the Trash in the Trash', async () => {
    expect(trashElsewhere(FIXTURE_DOCUMENT_ID)).toBe(true);
    await expect(getDocument(WS, FIXTURE_DOCUMENT_ID)).rejects.toMatchObject({ status: 409, data: { code: 'document_in_trash' } });
  });
});

/** The code a refused request answered. */
async function refusal(request: Promise<unknown>): Promise<string | null> {
  try {
    await request;
    return null;
  } catch (error) {
    return problemCode(error);
  }
}

describe('the collection fixture', () => {
  it('seeds Thesis › Chapter 1, Chapter 2 › Methods and Results, PDFs only, a deep chain and a long list', async () => {
    const roots = await listCollections(WS, { parentId: null });
    expect(roots.items.map((item) => item.name)).toEqual(['Archive', 'Lecture notes', 'Reading notes', 'Thesis']);
    const thesis = await listCollections(WS, { parentId: TREE.thesis });
    expect(thesis.items.map((item) => item.name)).toEqual(['Chapter 1', 'Chapter 2']);
    const chapter2 = await listDocuments(WS, { home: TREE.chapter2, sortBy: 'name', sortOrder: 'asc' });
    expect(chapter2.documents.map((row) => row.name)).toEqual(['Methods', 'Results']);

    const reading = roots.items.find((item) => item.id === TREE.readingNotes);
    expect(reading).toMatchObject({ page_count: 0, child_collection_count: 0, pdf_count: 3 });
    expect((await getCollection(WS, TREE.drafts)).depth).toBe(5);
    const lectures = await listDocuments(WS, { home: TREE.lectures, limit: 50, sortBy: 'custom', sortOrder: 'asc' });
    expect(lectures.documents).toHaveLength(50);
    expect(lectures.nextCursor).not.toBeNull();
  });

  it('lists a home’s pages in custom order, which needs a home', async () => {
    const pages = await listDocuments(WS, { home: TREE.lectures, limit: 3, sortBy: 'custom', sortOrder: 'asc' });
    expect(pages.documents.map((row) => row.name)).toEqual(['Lecture 1', 'Lecture 2', 'Lecture 3']);
    expect(await refusal(listDocuments(WS, { sortBy: 'custom' }))).toBe('bad_request');
  });

  it('seeds the size fixture only when asked', () => {
    const before = documentsIn(WS).length;
    seedSizeFixture();
    expect(documentsIn(WS).length).toBe(before + 2000);
  });
});

describe('page placement', () => {
  it('moves a page on its placement ETag and never touches the content ETag (I-8)', async () => {
    const opened = await getDocument(WS, TREE_PAGES.methods);
    const before = (await getWorkspace(WS)).tree_version;

    const placed = await movePage(WS, TREE_PAGES.methods, opened.placement.placementEtag, { collectionId: TREE.chapter1 });

    expect(placed).toMatchObject({ collectionId: TREE.chapter1, treeVersion: before + 1 });
    expect(placed.placementEtag).not.toBe(opened.placement.placementEtag);
    expect(await locateDocument(TREE_PAGES.methods)).toMatchObject({ collection_id: TREE.chapter1 });
    // The open page's next save, on the ETag it held, still lands.
    await expect(saveDocument(WS, TREE_PAGES.methods, opened.doc, opened.etag)).resolves.toMatchObject({ etag: expect.any(String) });
  });

  it('refuses a stale, a missing and a content ETag, and a move to where it is', async () => {
    const opened = await getDocument(WS, TREE_PAGES.methods);
    moveElsewhere(TREE_PAGES.methods, TREE.thesis);

    expect(await refusal(movePage(WS, TREE_PAGES.methods, opened.placement.placementEtag, { collectionId: null }))).toBe('stale_placement');
    expect(await refusal(movePage(WS, TREE_PAGES.methods, opened.etag, { collectionId: null }))).toBe('precondition_required');
    const now = await getDocument(WS, TREE_PAGES.methods);
    expect(await refusal(movePage(WS, TREE_PAGES.methods, now.placement.placementEtag, { collectionId: TREE.thesis }))).toBe('unchanged');
  });

  it('reorders only in a home ordered by hand, among its own pages', async () => {
    const [first, second] = takeItems((await listDocuments(WS, { home: TREE.lectures, limit: 2, sortBy: 'custom', sortOrder: 'asc' })).documents, 2);
    const placed = await reorderPage(WS, second.id, second.placementEtag, { before_id: first.id });
    expect(placed.collectionId).toBe(TREE.lectures);
    const order = (await listDocuments(WS, { home: TREE.lectures, limit: 2, sortBy: 'custom', sortOrder: 'asc' })).documents.map((row) => row.id);
    expect(order).toEqual([second.id, first.id]);

    const methods = await getDocument(WS, TREE_PAGES.methods);
    expect(await refusal(reorderPage(WS, TREE_PAGES.methods, methods.placement.placementEtag, 'last'))).toBe('not_custom_order');
    expect(await refusal(reorderPage(WS, second.id, placed.placementEtag, { after_id: TREE_PAGES.methods }))).toBe('invalid_position');
  });

  it('creates a page in a collection, after its last page', async () => {
    const created = await createDocument(WS, { name: 'Discussion', blocks: [] }, { collectionId: TREE.chapter2 });
    expect(created.placement.collectionId).toBe(TREE.chapter2);
    const names = (await listDocuments(WS, { home: TREE.chapter2, sortBy: 'name', sortOrder: 'asc' })).documents.map((row) => row.name);
    expect(names).toEqual(['Discussion', 'Methods', 'Results']);
  });

  it('gives a page the "Pages here can use these PDFs" grant in, and takes it away out, keeping grants by hand', async () => {
    const thesis = await getCollection(WS, TREE.thesis);
    await updateCollection(WS, TREE.thesis, thesis.etag, { grant_new_pages: true });

    const created = await createDocument(WS, { name: 'Appendix', blocks: [] }, { collectionId: TREE.chapter2 });
    expect(await listPdfGrants(WS, created.id)).toEqual([
      expect.objectContaining({ collection_id: TREE.thesis, origin: 'setting' }),
    ]);

    const moved = await movePage(WS, created.id, created.placement.placementEtag, { collectionId: null });
    expect(await listPdfGrants(WS, created.id)).toEqual([]);
    expect(moved.collectionId).toBeNull();
  });
});

describe('collection order and freshness', () => {
  it('locks a collection’s writes on its ETag and advances tree_version', async () => {
    const chapter1 = await getCollection(WS, TREE.chapter1);
    const renamed = await updateCollection(WS, TREE.chapter1, chapter1.etag, { name: 'Introduction' });
    expect(renamed.tree_version).toBe(chapter1.tree_version + 1);
    expect(await refusal(updateCollection(WS, TREE.chapter1, chapter1.etag, { name: 'Again' }))).toBe('stale_collection');
  });

  it('moves a collection, but not into itself, nor to where it is', async () => {
    const thesis = await getCollection(WS, TREE.thesis);
    expect(await refusal(moveCollection(WS, TREE.thesis, thesis.etag, { parentId: TREE.chapter2 }))).toBe('cycle');
    const chapter1 = await getCollection(WS, TREE.chapter1);
    expect(await refusal(moveCollection(WS, TREE.chapter1, chapter1.etag, { parentId: TREE.thesis }))).toBe('unchanged');
    const moved = await moveCollection(WS, TREE.chapter1, chapter1.etag, { parentId: null, position: { before_id: TREE.archive } });
    expect(moved.parent_id).toBeNull();
  });

  it('reorders in a parent ordered by hand', async () => {
    const chapter2 = await getCollection(WS, TREE.chapter2);
    await reorderCollection(WS, TREE.chapter2, chapter2.etag, { before_id: TREE.chapter1 });
    expect((await listCollections(WS, { parentId: TREE.thesis })).items.map((item) => item.name)).toEqual(['Chapter 2', 'Chapter 1']);
    const archive = await getCollection(WS, TREE.archive);
    expect(await refusal(reorderCollection(WS, TREE.archive, archive.etag, 'last'))).toBe('not_custom_order');
  });

  it('changes the order of the top level on the workspace’s ETag', async () => {
    const workspace = await getWorkspace(WS);
    const changed = await updateWorkspace(WS, workspace.etag, { root_sort_mode: 'custom' });
    expect(changed).toMatchObject({ root_sort_mode: 'custom', tree_version: workspace.tree_version + 1 });
    expect(await refusal(updateWorkspace(WS, workspace.etag, { root_sort_mode: 'name' }))).toBe('stale_workspace');
  });
});

describe('the workspace lifecycle (M5)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a shared workspace the caller owns, replays its key, and stops at the owned limit', async () => {
    const created = await createWorkspace({ name: '  Reading   group ', icon: '📚' }, 'key-1');
    expect(created).toMatchObject({ name: 'Reading group', icon: '📚', kind: 'shared', role: 'owner' });
    expect((await createWorkspace({ name: 'Reading group', icon: null }, 'key-1')).id).toBe(created.id);
    expect(await refusal(createWorkspace({ name: 'Another', icon: null }, 'key-1'))).toBe('idempotency_key_reused');

    // Personal and Side project are owned, plus this one: fill up to the limit.
    for (let index = 3; index < OWNED_WORKSPACE_LIMIT; index += 1) await createWorkspace({ name: `W${index}`, icon: null }, `fill-${index}`);
    const refused = await createWorkspace({ name: 'One too many', icon: null }, 'over').catch((error: unknown) => error);
    expect(problemCode(refused)).toBe('workspace_limit');
    expect(problemBody(refused)?.limit).toBe(OWNED_WORKSPACE_LIMIT);
  });

  it('changes the name, the icon and the policy on the workspace’s ETag, an admin’s write', async () => {
    const workspace = await getWorkspace(OWNED_WORKSPACE_ID);
    expect(workspace.policy).toEqual({ web_search: true, outside_research: true, auto: true, images: true });
    const changed = await updateWorkspace(OWNED_WORKSPACE_ID, workspace.etag, { name: 'Side quest', icon: null, policy: { web_search: false } });
    expect(changed).toMatchObject({ name: 'Side quest', icon: null, policy: { web_search: false, outside_research: true, auto: true } });
    expect(changed.etag).not.toBe(workspace.etag);
    expect(await refusal(updateWorkspace(OWNED_WORKSPACE_ID, workspace.etag, { name: 'Late' }))).toBe('stale_workspace');
    // An editor of the lab cannot.
    const lab = await getWorkspace(LAB_WORKSPACE_ID);
    expect(await refusal(updateWorkspace(LAB_WORKSPACE_ID, lab.etag, { name: 'Mine' }))).toBe('workspace_role_required');
  });

  it('deletes a shared workspace only for its owner, with its name typed, and restores it within 30 days', async () => {
    const personal = await getWorkspace(PERSONAL_WORKSPACE_ID);
    expect(await refusal(deleteWorkspace(PERSONAL_WORKSPACE_ID, personal.etag, personal.name))).toBe('personal_workspace_locked');
    const lab = await getWorkspace(LAB_WORKSPACE_ID);
    expect(await refusal(deleteWorkspace(LAB_WORKSPACE_ID, lab.etag, lab.name))).toBe('workspace_role_required');

    const side = await getWorkspace(OWNED_WORKSPACE_ID);
    expect(await refusal(deleteWorkspace(OWNED_WORKSPACE_ID, side.etag, 'side project'))).toBe('confirmation_mismatch');
    expect(await refusal(deleteWorkspace(OWNED_WORKSPACE_ID, '"cww:0"', side.name))).toBe('stale_workspace');
    const deleted = await deleteWorkspace(OWNED_WORKSPACE_ID, side.etag, side.name);
    expect(Date.parse(deleted.purge_after) - Date.parse(deleted.deleted_at)).toBe(30 * 24 * 3600 * 1000);
    const list = await listWorkspaces();
    expect(list.items.some((item) => item.id === OWNED_WORKSPACE_ID)).toBe(false);
    expect(list.deleted.map((item) => item.id)).toEqual([OWNED_WORKSPACE_ID, DELETED_WORKSPACE_ID]);

    expect(await refusal(restoreWorkspace(PERSONAL_WORKSPACE_ID))).toBe('workspace_not_deleted');
    expect(await refusal(restoreWorkspace('wsp-not-mine'))).toBe('workspace_not_found');
    const restored = await restoreWorkspace(OWNED_WORKSPACE_ID);
    expect(restored.name).toBe('Side project');
    expect((await listWorkspaces()).items.some((item) => item.id === OWNED_WORKSPACE_ID)).toBe(true);
  });

  it('exports a workspace as a job that reports what it made, and downloads it until it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect(await refusal(downloadWorkspaceExport(PERSONAL_WORKSPACE_ID))).toBe('export_not_found');
    const job = await exportWorkspace(PERSONAL_WORKSPACE_ID, true);
    expect(job.kind).toBe('workspace_export');
    vi.setSystemTime(Date.now() + fixtures.jobDurationMs);
    const done = await getJob(PERSONAL_WORKSPACE_ID, job.id);
    expect(done.status).toBe('done');
    expect(done.progress?.result?.page_count).toBe(documentsIn(PERSONAL_WORKSPACE_ID).length);
    expect(done.progress?.result?.pdf_count).toBeGreaterThan(0);
    const { blob, filename } = await downloadWorkspaceExport(PERSONAL_WORKSPACE_ID);
    expect(blob.size).toBeGreaterThan(0);
    expect(filename).toMatch(/^Personal .*\.zip$/);
    // Only an admin exports.
    expect(await refusal(exportWorkspace(LAB_WORKSPACE_ID, false))).toBe('workspace_role_required');
  });

  it('copies a page into another workspace as a job there, never into its own or one the caller is not in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const accepted = await copyPageToWorkspace(
      PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID, { workspaceId: LAB_WORKSPACE_ID, collectionId: null, includePdfs: 'located' }, 'copy-1',
    );
    expect(accepted).toMatchObject({ target_workspace_id: LAB_WORKSPACE_ID, job: { kind: 'workspace_copy' } });
    // The job is the target's.
    expect(await refusal(getJob(PERSONAL_WORKSPACE_ID, accepted.job.id))).toBe('job_not_found');
    vi.setSystemTime(Date.now() + fixtures.jobDurationMs);
    const done = await getJob(LAB_WORKSPACE_ID, accepted.job.id);
    const copyId = done.progress?.result?.document_id ?? '';
    expect(copyId).not.toBe('');
    const copy = await getDocument(LAB_WORKSPACE_ID, copyId);
    const original = await getDocument(PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID);
    expect(copy.doc.name).toBe(original.doc.name);
    expect(copy.doc.blocks.length).toBe(original.doc.blocks.length);
    expect(await locateDocument(copyId)).toMatchObject({ workspace_id: LAB_WORKSPACE_ID });
    // A replay answers the same job.
    const replay = await copyPageToWorkspace(
      PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID, { workspaceId: LAB_WORKSPACE_ID, collectionId: null, includePdfs: 'located' }, 'copy-1',
    );
    expect(replay.job.id).toBe(accepted.job.id);

    const into = (workspaceId: string) => copyPageToWorkspace(
      PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID, { workspaceId, collectionId: null, includePdfs: 'none' }, `copy-${workspaceId}`,
    );
    expect(await refusal(into(PERSONAL_WORKSPACE_ID))).toBe('bad_request');
    expect(await refusal(into('wsp-not-mine'))).toBe('workspace_not_found');
    expect(await refusal(into(DELETED_WORKSPACE_ID))).toBe('workspace_not_found');
  });

  it('sums usage over every live workspace, with each one’s share', async () => {
    const usage = await getAccountUsage(30);
    expect(usage.workspaces.map((item) => item.id)).toEqual([PERSONAL_WORKSPACE_ID, LAB_WORKSPACE_ID, OWNED_WORKSPACE_ID, VIEWER_WORKSPACE_ID]);
    expect(usage.storage.pdfs).toBe(usage.workspaces.reduce((total, item) => total + item.storage.pdfs, 0));
  });

  it('deletes the account only with its username, and not while it alone owns a live shared workspace', async () => {
    expect(await refusal(deleteAccount('ada author'))).toBe('confirmation_mismatch');
    const refused = await deleteAccount('Ada Author').catch((error: unknown) => error);
    expect(problemCode(refused)).toBe('sole_owner');
    expect(problemBody(refused)?.workspace_ids).toEqual([OWNED_WORKSPACE_ID]);

    const side = await getWorkspace(OWNED_WORKSPACE_ID);
    await deleteWorkspace(OWNED_WORKSPACE_ID, side.etag, side.name);
    const deleted = await deleteAccount('Ada Author');
    expect(deleted.workspace_ids).toContain(PERSONAL_WORKSPACE_ID);
  });
});
