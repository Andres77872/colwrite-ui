import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_RECORD_MAX_AGE_MS,
  forgetDecisions,
  forgetReview,
  loadReview,
  pruneReviews,
  saveReview,
} from '../reviewDecisions';

const WS = 'wsp-6f1c0f5e-8a8b-4c4d-9e2f-1a2b3c4d5e6f';
const OTHER = 'wsp-2b7e9d10-4c3a-4f1e-8b2d-9a0c1e2f3a4b';

/**
 * The browser-side record of decisions on durable change sets that could not
 * be sent: the waiting room until the next staging sends them again, so the
 * one thing it must never do is get in the author's way.
 */

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the decision record', () => {
  it('keeps decisions in the order they were made, the first one per operation winning', () => {
    saveReview(WS, 'doc-1', 'cs-1', { decisions: [[2, 'rejected']] });
    saveReview(WS, 'doc-1', 'cs-1', { decisions: [[0, 'accepted'], [2, 'accepted']] });

    expect(loadReview(WS, 'doc-1', 'cs-1')?.decisions).toEqual([
      [2, 'rejected'],
      [0, 'accepted'],
    ]);
  });

  it('writes nothing for no decisions', () => {
    saveReview(WS, 'doc-1', 'cs-1', { decisions: [] });
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('is kept per workspace, document and change set', () => {
    saveReview(WS, 'doc-1', 'cs-1', { decisions: [[0, 'accepted']] });
    expect(Object.keys(localStorage)).toEqual([`colwrite:ws:${WS}:review:doc-1:cs-1`]);
    expect(loadReview(WS, 'doc-2', 'cs-1')).toBeNull();
    expect(loadReview(WS, 'doc-1', 'cs-2')).toBeNull();
    expect(loadReview(OTHER, 'doc-1', 'cs-1')).toBeNull();
  });

  it('ignores a record it cannot read', () => {
    saveReview(WS, 'doc-1', 'cs-1', { decisions: [[0, 'accepted']] });
    const key = Object.keys(localStorage).find((candidate) => candidate.includes('cs-1'))!;
    localStorage.setItem(key, '{not json');
    expect(loadReview(WS, 'doc-1', 'cs-1')).toBeNull();

    localStorage.setItem(
      key,
      JSON.stringify({ documentId: 'doc-1', changeSetId: 'cs-1', at: 1, decisions: [[0, 'maybe'], ['x', 'accepted'], [1, 'rejected']] }),
    );
    expect(loadReview(WS, 'doc-1', 'cs-1')?.decisions).toEqual([[1, 'rejected']]);
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => saveReview(WS, 'doc-1', 'cs-1', { decisions: [[0, 'accepted']] })).not.toThrow();
    expect(loadReview(WS, 'doc-1', 'cs-1')).toBeNull();
    expect(() => forgetReview(WS, 'doc-1', 'cs-1')).not.toThrow();
    expect(() => pruneReviews(WS, 'doc-1', new Set())).not.toThrow();
  });

  it('is forgotten once the batch is retired', () => {
    saveReview(WS, 'doc-1', 'cs-1', { decisions: [[0, 'accepted']] });
    forgetReview(WS, 'doc-1', 'cs-1');
    expect(loadReview(WS, 'doc-1', 'cs-1')).toBeNull();
  });

  it('gives up the decisions the server has taken, and keeps the rest', () => {
    saveReview(WS, 'doc-1', 'cs-1', { decisions: [[0, 'accepted'], [1, 'rejected'], [2, 'accepted']] });

    forgetDecisions(WS, 'doc-1', 'cs-1', [0, 2]);

    expect(loadReview(WS, 'doc-1', 'cs-1')).toMatchObject({ decisions: [[1, 'rejected']] });
    // Another batch's record is not this one's to change.
    saveReview(WS, 'doc-1', 'cs-2', { decisions: [[0, 'accepted']] });
    forgetDecisions(WS, 'doc-1', 'cs-1', [0]);
    expect(loadReview(WS, 'doc-1', 'cs-2')?.decisions).toEqual([[0, 'accepted']]);
  });

  it('removes a record left with no decisions', () => {
    saveReview(WS, 'doc-1', 'cs-1', { decisions: [[0, 'accepted']] });
    forgetDecisions(WS, 'doc-1', 'cs-1', [0]);
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('leaves the record alone when it has none of those decisions', () => {
    saveReview(WS, 'doc-1', 'cs-1', { decisions: [[0, 'accepted']] }, 1000);
    forgetDecisions(WS, 'doc-1', 'cs-1', [5]);
    forgetDecisions(WS, 'doc-1', 'cs-1', []);
    expect(loadReview(WS, 'doc-1', 'cs-1')).toMatchObject({ at: 1000, decisions: [[0, 'accepted']] });
    expect(() => forgetDecisions(WS, 'doc-1', 'missing', [0])).not.toThrow();
  });
});

describe('pruning', () => {
  it('drops this document’s records for batches the server no longer lists', () => {
    saveReview(WS, 'doc-1', 'cs-gone', { decisions: [[0, 'accepted']] }, 1_000);
    saveReview(WS, 'doc-1', 'cs-open', { decisions: [[0, 'accepted']] }, 1_000);
    saveReview(WS, 'doc-2', 'cs-other', { decisions: [[0, 'accepted']] }, 1_000);

    pruneReviews(WS, 'doc-1', new Set(['cs-open']), 2_000, 2_000);

    expect(loadReview(WS, 'doc-1', 'cs-gone')).toBeNull();
    expect(loadReview(WS, 'doc-1', 'cs-open')).not.toBeNull();
    // Another document's pending list says nothing about this one.
    expect(loadReview(WS, 'doc-2', 'cs-other')).not.toBeNull();
  });

  it('keeps a record written after the list was requested', () => {
    // A batch proposed while the list was in flight cannot be in it.
    saveReview(WS, 'doc-1', 'cs-new', { decisions: [[0, 'accepted']] }, 3_000);
    pruneReviews(WS, 'doc-1', new Set(), 2_000, 3_500);
    expect(loadReview(WS, 'doc-1', 'cs-new')).not.toBeNull();
  });

  it('drops anyone’s record older than a change set can live', () => {
    const now = 10 * REVIEW_RECORD_MAX_AGE_MS;
    saveReview(WS, 'doc-2', 'cs-old', { decisions: [[0, 'accepted']] }, now - REVIEW_RECORD_MAX_AGE_MS - 1);
    pruneReviews(WS, 'doc-1', new Set(), now, now);
    expect(loadReview(WS, 'doc-2', 'cs-old')).toBeNull();
  });

  it('leaves another workspace’s records alone', () => {
    saveReview(OTHER, 'doc-1', 'cs-gone', { decisions: [[0, 'accepted']] }, 1_000);
    pruneReviews(WS, 'doc-1', new Set(), 2_000, 2_000);
    expect(loadReview(OTHER, 'doc-1', 'cs-gone')).not.toBeNull();
  });
});
