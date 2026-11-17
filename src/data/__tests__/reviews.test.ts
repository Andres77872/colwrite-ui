import { describe, expect, it } from 'vitest';
import { jsonOf, pathOf, recordRequests } from '@/__tests__/server';
import { PERSONAL_WORKSPACE_ID, VIEWER_WORKSPACE_ID, fixtures } from '@/dev/msw/fixtures';
import { beginReview, finishReview, scriptedReviewFindings, seedReviewFixture } from '@/dev/msw/reviews';
import { decideReviewComment, listReviewComments, reviewRunsQuery } from '../reviews';

describe('shared review records', () => {
  it('keeps exact anchors, decisions and terminal summaries beside the page, without a content write', async () => {
    const doc = seedReviewFixture();
    const original = structuredClone(doc);
    const run = beginReview(doc._id, 'run-review', 'peer_review', 'session-review', 17);
    scriptedReviewFindings(doc, run);
    finishReview(doc._id, run.run_id, 'completed');
    const sent = recordRequests();
    const listed = await listReviewComments(doc.workspace_id, doc._id, null);
    expect(new Set(listed.items.map((comment) => comment.kind))).toEqual(new Set(['claim', 'source', 'consistency']));
    const comment = listed.items[0];
    if (!comment) throw new Error('Missing seeded finding');
    const first = await decideReviewComment(doc.workspace_id, doc._id, comment.comment_id, 'resolved');
    const repeated = await decideReviewComment(doc.workspace_id, doc._id, comment.comment_id, 'resolved');
    expect(repeated).toEqual(first);
    expect(await jsonOf(sent[1])).toEqual({ status: 'resolved' });
    expect(pathOf(sent[1])).toContain(`/comments/${comment.comment_id}`);
    expect(sent.some((request) => request.method === 'PUT')).toBe(false);
    expect(fixtures.documents.get(doc._id)).toEqual(original);
    expect(run.counts.total).toBe(3);
    expect(run.counts.by_kind).toEqual({ source: 1, claim: 1, consistency: 1 });
    expect(reviewRunsQuery(doc.workspace_id, doc._id).queryKey).toEqual(['ws', doc.workspace_id, 'reviews', doc._id, 'runs']);
  });

  it('marks a missing quote outdated rather than moving it, and scopes each read to the path workspace', async () => {
    const doc = seedReviewFixture();
    const run = beginReview(doc._id, 'review', 'claims', null, null);
    scriptedReviewFindings(doc, run);
    const source = doc.blocks.find((block) => block.id === 'review-claim');
    if (source?.type !== 'paragraph') throw new Error('Missing claim');
    source.html = 'An unrelated sentence.';
    const page = await listReviewComments(PERSONAL_WORKSPACE_ID, doc._id, null);
    expect(page.items.filter((comment) => comment.block_id === 'review-claim').every((comment) => comment.outdated)).toBe(true);
    await expect(listReviewComments(VIEWER_WORKSPACE_ID, doc._id, null)).rejects.toMatchObject({ status: 404 });
  });

  it('a viewer can read shared notes but the API refuses decisions', async () => {
    const doc = seedReviewFixture();
    doc.workspace_id = VIEWER_WORKSPACE_ID;
    const run = beginReview(doc._id, 'review', 'claims', null, null);
    scriptedReviewFindings(doc, run);
    const page = await listReviewComments(VIEWER_WORKSPACE_ID, doc._id, null);
    const comment = page.items[0];
    if (!comment) throw new Error('Missing finding');
    await expect(decideReviewComment(VIEWER_WORKSPACE_ID, doc._id, comment.comment_id, 'dismissed'))
      .rejects.toMatchObject({ status: 403 });
    expect(fixtures.comments.get(doc._id)?.find((item) => item.comment_id === comment.comment_id)?.status).toBe('open');
  });
});
