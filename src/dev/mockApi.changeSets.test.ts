import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REVIEW_DOCUMENT_ID, installMockApi } from './mockApi';
import {
  decideChangeSetOperations,
  decisionRefusal,
  getChangeSet,
  listPendingChangeSets,
  rejectChangeSet,
} from '@/services/documentHistory';

/**
 * The preview's stored change set, read through the same service the editor
 * uses. The mock stands in for ColWrite-api, so what it answers has to keep
 * the API's rules for per-operation review: these are the ones the editor
 * relies on.
 *
 * The tests share the mock's state and run in order, as one review does.
 */

const realFetch = window.fetch;
beforeAll(() => installMockApi());
afterAll(() => {
  window.fetch = realFetch;
});

async function saveBlock(id: string, html: string): Promise<void> {
  const loaded = await (await fetch(`/api/document/load/${REVIEW_DOCUMENT_ID}`)).json();
  const document = loaded.document as { version: number; blocks: Array<{ id: string; html?: string }> };
  const blocks = document.blocks.map((block) => (block.id === id ? { ...block, html } : block));
  const response = await fetch(`/api/document/save/${REVIEW_DOCUMENT_ID}`, {
    method: 'PUT',
    body: JSON.stringify({ document: { ...document, blocks } }),
  });
  expect(response.status).toBe(200);
}

describe('the preview’s half-reviewed change set', () => {
  let changeSetId = '';

  it('is listed as pending with the decisions already made on it', async () => {
    const [changeSet, ...others] = await listPendingChangeSets(REVIEW_DOCUMENT_ID);
    changeSetId = changeSet.changeSetId;

    expect(others).toEqual([]);
    expect(changeSet.unmappableOperations).toEqual([]);
    expect(changeSet.operations.map((operation) => operation.op)).toEqual([
      'replace_block',
      'insert_block_after',
      'replace_block',
      'delete_block',
      'append_block',
    ]);
    expect(changeSet.operationDecisions).toEqual([
      { opIndex: 1, decision: 'accepted' },
      { opIndex: 3, decision: 'rejected' },
    ]);
  });

  it('says which target the author changed after the proposal', async () => {
    const { operationTargets } = await getChangeSet(REVIEW_DOCUMENT_ID, changeSetId);
    const current = (operationTargets ?? []).map(
      (target) => target && target.headFingerprint === target.fingerprint,
    );

    // The abstract and the thanks are as the assistant read them; the
    // results paragraph is not. Inserts have no target.
    expect(current).toEqual([true, null, false, true, null]);
  });

  it('follows the saved document, and ignores how a block is shown', async () => {
    await saveBlock('cr-abstract', 'Rewritten by the author.');
    const edited = await getChangeSet(REVIEW_DOCUMENT_ID, changeSetId);
    expect(edited.operationTargets?.[0]?.headFingerprint).not.toBe(
      edited.operationTargets?.[0]?.fingerprint,
    );

    await saveBlock('cr-abstract', 'We study sparse routing at long context lengths and find that it scales well.');
    const back = await getChangeSet(REVIEW_DOCUMENT_ID, changeSetId);
    expect(back.operationTargets?.[0]?.headFingerprint).toBe(back.operationTargets?.[0]?.fingerprint);
  });

  it('records a decision once, and answers a repeat without changing anything', async () => {
    const first = await decideChangeSetOperations(REVIEW_DOCUMENT_ID, changeSetId, [
      { opIndex: 2, decision: 'rejected' },
    ]);
    expect(first.status).toBe('pending');
    expect(first.operationDecisions?.at(-1)).toEqual({ opIndex: 2, decision: 'rejected' });

    const repeat = await decideChangeSetOperations(REVIEW_DOCUMENT_ID, changeSetId, [
      { opIndex: 2, decision: 'rejected' },
    ]);
    expect(repeat.operationDecisions).toEqual(first.operationDecisions);
  });

  it('refuses to change a recorded decision, naming the operation', async () => {
    const refusal = await decideChangeSetOperations(REVIEW_DOCUMENT_ID, changeSetId, [
      { opIndex: 0, decision: 'accepted' },
      { opIndex: 3, decision: 'accepted' },
    ]).then(
      () => null,
      (cause: unknown) => decisionRefusal(cause),
    );

    expect(refusal).toEqual({ kind: 'contradicted', opIndex: 3 });
    // Nothing in a refused request is recorded.
    const { operationDecisions } = await getChangeSet(REVIEW_DOCUMENT_ID, changeSetId);
    expect(operationDecisions?.some((decision) => decision.opIndex === 0)).toBe(false);
  });

  it('refuses an operation the change set does not have', async () => {
    await expect(
      decideChangeSetOperations(REVIEW_DOCUMENT_ID, changeSetId, [{ opIndex: 9, decision: 'accepted' }]),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('takes the set out of pending when the last operation is decided, applying nothing', async () => {
    const before = await (await fetch(`/api/document/load/${REVIEW_DOCUMENT_ID}`)).json();

    const resolved = await decideChangeSetOperations(REVIEW_DOCUMENT_ID, changeSetId, [
      { opIndex: 0, decision: 'accepted' },
      { opIndex: 4, decision: 'rejected' },
    ]);

    expect(resolved.status).toBe('superseded');
    expect(await listPendingChangeSets(REVIEW_DOCUMENT_ID)).toEqual([]);
    const after = await (await fetch(`/api/document/load/${REVIEW_DOCUMENT_ID}`)).json();
    expect(after.document).toEqual(before.document);
  });

  it('still answers the request that decided the last operation, and takes no new decision', async () => {
    const retried = await decideChangeSetOperations(REVIEW_DOCUMENT_ID, changeSetId, [
      { opIndex: 4, decision: 'rejected' },
    ]);
    expect(retried.status).toBe('superseded');

    await expect(rejectChangeSet(REVIEW_DOCUMENT_ID, changeSetId)).rejects.toMatchObject({ status: 409 });
  });

  it('has nothing stored for the other documents', async () => {
    expect(await listPendingChangeSets('66f0c0ffee0000000000d0c2')).toEqual([]);
  });
});
