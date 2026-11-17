import { beforeEach, describe, expect, it } from 'vitest';
import { problem } from '@/dev/msw/handlers';
import { server } from '@/__tests__/server';
import { http } from '@/dev/msw/handlers';
import { FIXTURE_DOCUMENT_ID, LAB_DOCUMENT_ID, LAB_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, changeSetsOf, fixtures } from '@/dev/msw/fixtures';
import { FEDUS, LEPIKHIN, OKAFOR, VASWANI, VASWANI_DOI, ZOPH } from '@/dev/fixtureReferences';
import { getJob } from '../trash';
import {
  VENUES,
  auditSummaryOf,
  checkReferences,
  getAiUseLog,
  getAiUseStatement,
  getReferenceStatus,
  referenceFailure,
} from '../references';
import { checkClaim, claimCheckOf, claimFailure } from '../claims';

const WS = PERSONAL_WORKSPACE_ID;

/** A job read once it is done, as `followJob` would find it, without the waits. */
function settled(workspaceId: string, jobId: number) {
  return getJob(workspaceId, jobId);
}

// Jobs report done at once here; the fixtures are reset after each test.
beforeEach(() => {
  fixtures.jobDurationMs = 0;
});

describe('the reference audit (P2.API-6, against the mock)', () => {
  it('has no report before the first check', async () => {
    await expect(getReferenceStatus(WS, FIXTURE_DOCUMENT_ID)).resolves.toBeNull();
  });

  it('reports the fixture page’s retracted work, its duplicate and its stale record, and proposes the refresh', async () => {
    const job = await checkReferences(WS, FIXTURE_DOCUMENT_ID);
    expect(job.kind).toBe('reference_audit');
    const done = await settled(WS, job.id);
    const summary = auditSummaryOf(done);
    expect(summary).toMatchObject({ references: 6, cited: 5, uncited: 1, retracted: 1, stale: 2, duplicates: 1, orphans: 0 });

    const report = await getReferenceStatus(WS, FIXTURE_DOCUMENT_ID);
    expect(report?.change_set_id).toBe(summary?.change_set_id);
    const byKey = new Map(report?.references.map((reference) => [reference.key, reference]));
    expect(byKey.get(OKAFOR.key)).toMatchObject({ flags: ['retracted'], cited: 1, outcome: 'checked', stale: false });
    // GShard had a correction since the page cited it; the entry typed by hand is verified now.
    expect(byKey.get(LEPIKHIN.key)).toMatchObject({ stale: true, changes: ['flags', 'notices'] });
    expect(byKey.get(VASWANI_DOI.key)).toMatchObject({ stale: true, state: 'verified', changes: ['state'] });
    expect(report?.duplicates).toEqual([{ keys: [VASWANI.key, VASWANI_DOI.key], reason: 'identifier' }]);
    expect(report?.uncited).toEqual(['arxiv:1701.06538']);
    // Only the first citation records the passage it rests on.
    expect(report?.without_passage.map((item) => item.citation_id)).toEqual(['c-2', 'c-3', 'c-4']);

    // The refresh is a change set of the newer record, for the author to review.
    const refresh = changeSetsOf(FIXTURE_DOCUMENT_ID).find((set) => set.change_set_id === report?.change_set_id);
    expect(refresh).toMatchObject({ origin: 'reference_audit', status: 'pending' });
    expect(refresh?.operations).toMatchObject([{
      op: 'update_sources', sources: [{ key: LEPIKHIN.key, flags: ['corrected'] }, { key: VASWANI_DOI.key, state: 'verified' }],
    }]);
  });

  it('looks nothing up where the workspace turned outside research off, and refreshes nothing', async () => {
    const job = await checkReferences(LAB_WORKSPACE_ID, LAB_DOCUMENT_ID);
    await settled(LAB_WORKSPACE_ID, job.id);
    const report = await getReferenceStatus(LAB_WORKSPACE_ID, LAB_DOCUMENT_ID);
    expect(report).toMatchObject({ outside_lookups: false, change_set_id: null });
    expect(report?.references.every((reference) => reference.outcome === 'not_checked')).toBe(true);
  });

  it('words a viewer’s refusal and a page in the Trash', () => {
    expect(referenceFailure(new Error('x'), 'fallback')).toBe('x');
    server.use(http.post('/workspaces/{workspace_id}/documents/{document_id}/references/check', () => problem('workspace_role_required', 'Needs the editor role.', { required_role: 'editor' })));
    return checkReferences(WS, FIXTURE_DOCUMENT_ID).then(
      () => { throw new Error('expected a refusal'); },
      (error: unknown) => expect(referenceFailure(error, 'fallback')).toBe('Checking references needs the editor role.'),
    );
  });
});

describe('the AI-use log and its statement (P2.API-6, against the mock)', () => {
  it('lists what the assistant did on the page, oldest first, with how each was verified', async () => {
    const log = await getAiUseLog(WS, FIXTURE_DOCUMENT_ID, null);
    expect(log.entries.map((entry) => [entry.kind, entry.purposes, entry.verification.method])).toEqual([
      ['change_set', ['added_citations'], 'accepted_by_author'],
      ['suggestion', ['suggested'], 'not_recorded'],
    ]);
  });

  it('writes a statement for three venues, each in its own terms, saying what the log cannot know', async () => {
    const statements = await Promise.all((['elsevier', 'ieee', 'neurips'] as const).map((venue) => getAiUseStatement(WS, FIXTURE_DOCUMENT_ID, venue)));
    const [elsevier, ieee, neurips] = statements;
    expect(elsevier?.statement).toMatch(/^During the preparation of this work the author\(s\) used the ColWrite assistant \(ColWrite .+, with anthropic\/claude-sonnet-5\.5 and openai\/gpt-6-luna\) in order to insert citations from checked records and suggest rewrites in the editor\./);
    expect(ieee?.statement).toContain('It was used in the sections “Introduction” and “Method”.');
    expect(neurips?.notes[0]).toBe('NeurIPS does not require disclosing writing assistance; the statement is there if you choose to.');
    for (const statement of statements) {
      expect(statement.statement).toContain('it does not cover text from other tools pasted into it');
    }
    expect(VENUES.map((venue) => venue.id)).toEqual(['elsevier', 'taylor_and_francis', 'ieee', 'plos', 'science', 'acm', 'neurips', 'iclr']);
  });
});

describe('the Research panel’s claim check (P2.API-5, against the mock)', () => {
  it('judges a claim against papers’ passages found for it, as a claim_check job', async () => {
    const job = await checkClaim(WS, 'Top-1 routing keeps per-token compute constant.');
    expect(job.kind).toBe('claim_check');
    const check = claimCheckOf(await settled(WS, job.id));
    expect(check).toMatchObject({ verdict: 'partly', evidenceLevel: 'full_text', cannotAssess: false });
    expect(check?.passages.map((passage) => [passage.record.key, passage.level, passage.stance])).toEqual([
      [FEDUS.key, 'full_text', 'supports'],
      [ZOPH.key, 'abstract', 'limits'],
    ]);
  });

  it('cannot assess a claim against abstracts alone, and says how to get the full text', async () => {
    const job = await checkClaim(WS, 'Router z-loss removes all instability.', [ZOPH.key, 'doi:10.9999/unknown']);
    const check = claimCheckOf(await settled(WS, job.id));
    expect(check).toMatchObject({ verdict: 'insufficient', cannotAssess: true, evidenceLevel: 'abstract', notFound: ['doi:10.9999/unknown'] });
    expect(check?.howToGet).toContain('PDF');
  });

  it('refuses a source that is not an identifier, and where outside research is off', async () => {
    await expect(checkClaim(WS, 'A claim.', ['not an id'])).rejects.toSatisfy(
      (error: unknown) => claimFailure(error).startsWith('Name each paper by an identifier'),
    );
    await expect(checkClaim(LAB_WORKSPACE_ID, 'A claim.')).rejects.toSatisfy(
      (error: unknown) => claimFailure(error) === 'Outside research is switched off in this workspace, so papers are not searched here.',
    );
  });
});
