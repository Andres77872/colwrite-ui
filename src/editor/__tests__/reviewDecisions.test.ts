import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_RECORD_MAX_AGE_MS,
  forgetDecisions,
  forgetReview,
  loadReview,
  pruneReviews,
  saveReview,
} from '../reviewDecisions';

/**
 * The browser-side record of decisions on durable change sets. It is the
 * fallback for an API that does not record a decision per operation, and the
 * waiting room for a decision that could not be sent, so the one thing it
 * must never do is get in the author's way.
 */

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the decision record', () => {
  it('keeps decisions in the order they were made, the first one per operation winning', () => {
    saveReview('doc-1', 'cs-1', { decisions: [[2, 'rejected']] });
    saveReview('doc-1', 'cs-1', { decisions: [[0, 'accepted'], [2, 'accepted']] });

    expect(loadReview('doc-1', 'cs-1')?.decisions).toEqual([
      [2, 'rejected'],
      [0, 'accepted'],
    ]);
  });

  it('overwrites fingerprints, which move when an accept rebases them', () => {
    saveReview('doc-1', 'cs-1', { bases: { 0: 'a', 1: 'b' } });
    saveReview('doc-1', 'cs-1', { bases: { 1: 'c' } });
    expect(loadReview('doc-1', 'cs-1')?.bases).toEqual({ 0: 'a', 1: 'c' });
  });

  it('is kept per document and change set', () => {
    saveReview('doc-1', 'cs-1', { decisions: [[0, 'accepted']] });
    expect(loadReview('doc-2', 'cs-1')).toBeNull();
    expect(loadReview('doc-1', 'cs-2')).toBeNull();
  });

  it('ignores a record it cannot read', () => {
    saveReview('doc-1', 'cs-1', { decisions: [[0, 'accepted']] });
    const key = Object.keys(localStorage).find((candidate) => candidate.includes('cs-1'))!;
    localStorage.setItem(key, '{not json');
    expect(loadReview('doc-1', 'cs-1')).toBeNull();

    localStorage.setItem(
      key,
      JSON.stringify({ documentId: 'doc-1', changeSetId: 'cs-1', at: 1, decisions: [[0, 'maybe'], ['x', 'accepted'], [1, 'rejected']] }),
    );
    expect(loadReview('doc-1', 'cs-1')?.decisions).toEqual([[1, 'rejected']]);
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

    expect(() => saveReview('doc-1', 'cs-1', { decisions: [[0, 'accepted']] })).not.toThrow();
    expect(loadReview('doc-1', 'cs-1')).toBeNull();
    expect(() => forgetReview('doc-1', 'cs-1')).not.toThrow();
    expect(() => pruneReviews('doc-1', new Set())).not.toThrow();
  });

  it('is forgotten once the batch is retired', () => {
    saveReview('doc-1', 'cs-1', { decisions: [[0, 'accepted']] });
    forgetReview('doc-1', 'cs-1');
    expect(loadReview('doc-1', 'cs-1')).toBeNull();
  });

  it('gives up the decisions the server has taken, and keeps the rest', () => {
    saveReview('doc-1', 'cs-1', {
      decisions: [[0, 'accepted'], [1, 'rejected'], [2, 'accepted']],
      bases: { 3: 'abc' },
    });

    forgetDecisions('doc-1', 'cs-1', [0, 2]);

    expect(loadReview('doc-1', 'cs-1')).toMatchObject({
      decisions: [[1, 'rejected']],
      bases: { 3: 'abc' },
    });
    // Another batch's record is not this one's to change.
    saveReview('doc-1', 'cs-2', { decisions: [[0, 'accepted']] });
    forgetDecisions('doc-1', 'cs-1', [0]);
    expect(loadReview('doc-1', 'cs-2')?.decisions).toEqual([[0, 'accepted']]);
  });

  it('removes a record left with neither decisions nor fingerprints', () => {
    saveReview('doc-1', 'cs-1', { decisions: [[0, 'accepted']] });
    forgetDecisions('doc-1', 'cs-1', [0]);
    expect(Object.keys(localStorage)).toEqual([]);

    saveReview('doc-1', 'cs-1', { decisions: [[0, 'accepted']], bases: { 1: 'abc' } });
    forgetDecisions('doc-1', 'cs-1', [0]);
    expect(loadReview('doc-1', 'cs-1')).toMatchObject({ decisions: [], bases: { 1: 'abc' } });
  });

  it('leaves the record alone when it has none of those decisions', () => {
    saveReview('doc-1', 'cs-1', { decisions: [[0, 'accepted']] }, 1000);
    forgetDecisions('doc-1', 'cs-1', [5]);
    forgetDecisions('doc-1', 'cs-1', []);
    expect(loadReview('doc-1', 'cs-1')).toMatchObject({ at: 1000, decisions: [[0, 'accepted']] });
    expect(() => forgetDecisions('doc-1', 'missing', [0])).not.toThrow();
  });
});

describe('pruning', () => {
  it('drops this document’s records for batches the server no longer lists', () => {
    saveReview('doc-1', 'cs-gone', { decisions: [[0, 'accepted']] }, 1_000);
    saveReview('doc-1', 'cs-open', { decisions: [[0, 'accepted']] }, 1_000);
    saveReview('doc-2', 'cs-other', { decisions: [[0, 'accepted']] }, 1_000);

    pruneReviews('doc-1', new Set(['cs-open']), 2_000, 2_000);

    expect(loadReview('doc-1', 'cs-gone')).toBeNull();
    expect(loadReview('doc-1', 'cs-open')).not.toBeNull();
    // Another document's pending list says nothing about this one.
    expect(loadReview('doc-2', 'cs-other')).not.toBeNull();
  });

  it('keeps a record written after the list was requested', () => {
    // A batch proposed while the list was in flight cannot be in it.
    saveReview('doc-1', 'cs-new', { bases: { 0: 'a' } }, 3_000);
    pruneReviews('doc-1', new Set(), 2_000, 3_500);
    expect(loadReview('doc-1', 'cs-new')).not.toBeNull();
  });

  it('drops anyone’s record older than a change set can live', () => {
    const now = 10 * REVIEW_RECORD_MAX_AGE_MS;
    saveReview('doc-2', 'cs-old', { decisions: [[0, 'accepted']] }, now - REVIEW_RECORD_MAX_AGE_MS - 1);
    pruneReviews('doc-1', new Set(), now, now);
    expect(loadReview('doc-2', 'cs-old')).toBeNull();
  });
});
