import type { ReviewDecision } from './proposals';
import { keysWithPrefix, readItem, removeItem, reviewKey, reviewPrefix, writeJson } from '@/lib/storageKeys';

/**
 * Decisions made on a durable change set that could not be sent, remembered
 * in this browser under the workspace the page is in.
 *
 * The API records a decision per operation and says whether each target
 * block is still the one the operation was written for
 * (`operation_decisions`, `operation_targets`). What is left for this record
 * is a decision the request could not deliver: it waits here, in the order
 * it was made, and is sent again when the change set is next staged.
 *
 * Nothing here is authoritative. A record that is missing, unreadable or
 * blocked by the browser only means the batch is staged as the server has
 * it.
 */


/**
 * Change sets expire within seven days of being proposed (the API caps
 * `expires_in_seconds` at 604,800), so a record older than that describes a
 * batch that can no longer come back.
 */
export const REVIEW_RECORD_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

export type StoredReview = {
  documentId: string;
  changeSetId: string;
  /** Last write, ms since the epoch. */
  at: number;
  decisions: ReviewDecision[];
};

function isDecision(value: unknown): value is ReviewDecision {
  return (
    Array.isArray(value)
    && value.length === 2
    && Number.isInteger(value[0])
    && (value[1] === 'accepted' || value[1] === 'rejected')
  );
}

function parse(raw: string | null): StoredReview | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredReview> | null;
    if (!value || typeof value !== 'object') return null;
    if (typeof value.documentId !== 'string' || typeof value.changeSetId !== 'string') return null;
    return {
      documentId: value.documentId,
      changeSetId: value.changeSetId,
      at: typeof value.at === 'number' ? value.at : 0,
      decisions: Array.isArray(value.decisions) ? value.decisions.filter(isDecision) : [],
    };
  } catch {
    return null;
  }
}

export function loadReview(workspaceId: string, documentId: string, changeSetId: string): StoredReview | null {
  try {
    const record = parse(readItem(reviewKey(workspaceId, documentId, changeSetId)));
    // Keyed by both ids and carrying both, so a record can never be read back
    // for a different batch.
    if (!record || record.documentId !== documentId || record.changeSetId !== changeSetId) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

/**
 * Add to a change set's record. Decisions are appended, and the first
 * decision on an operation wins: a change is decided once.
 */
export function saveReview(
  workspaceId: string,
  documentId: string,
  changeSetId: string,
  update: { decisions: readonly ReviewDecision[] },
  now: number = Date.now(),
): void {
  const decisions = update.decisions;
  if (decisions.length === 0) return;
  try {
    const key = reviewKey(workspaceId, documentId, changeSetId);
    const current = parse(readItem(key));
    const record: StoredReview = current && current.documentId === documentId && current.changeSetId === changeSetId
      ? current
      : { documentId, changeSetId, at: now, decisions: [] };
    const decided = new Set(record.decisions.map(([opIndex]) => opIndex));
    for (const decision of decisions) {
      if (decided.has(decision[0])) continue;
      decided.add(decision[0]);
      record.decisions.push([decision[0], decision[1]]);
    }
    record.at = now;
    writeJson(key, record);
  } catch {
    // Storage full, blocked or unavailable: the review carries on, and a
    // reload stages the batch as the server has it.
  }
}

/**
 * Take decisions back out of a change set's record: the server has them now,
 * or has refused them for good. A record left with none is removed.
 */
export function forgetDecisions(
  workspaceId: string,
  documentId: string,
  changeSetId: string,
  opIndexes: readonly number[],
): void {
  if (opIndexes.length === 0) return;
  try {
    const key = reviewKey(workspaceId, documentId, changeSetId);
    const record = parse(readItem(key));
    if (!record || record.documentId !== documentId || record.changeSetId !== changeSetId) return;
    const sent = new Set(opIndexes);
    const decisions = record.decisions.filter(([opIndex]) => !sent.has(opIndex));
    if (decisions.length === record.decisions.length) return;
    if (decisions.length === 0) {
      removeItem(key);
      return;
    }
    writeJson(key, { ...record, decisions });
  } catch {
    /* storage unavailable — nothing to clean up */
  }
}

/** Drop a change set's record once the server no longer holds it as pending. */
export function forgetReview(workspaceId: string, documentId: string, changeSetId: string): void {
  try {
    removeItem(reviewKey(workspaceId, documentId, changeSetId));
  } catch {
    /* storage unavailable — nothing to clean up */
  }
}

/**
 * Remove records that can no longer be used: this document's records for
 * change sets the server no longer lists as pending (decided in another tab
 * or browser, or expired), and anyone's records older than any change set
 * lives.
 *
 * `listedAt` is when the pending list was requested. A record written after
 * that belongs to a batch that may have been proposed since, which the list
 * could not have included, so it is kept.
 */
export function pruneReviews(
  workspaceId: string,
  documentId: string,
  pendingChangeSetIds: ReadonlySet<string>,
  listedAt: number = Date.now(),
  now: number = Date.now(),
): void {
  try {
    const doomed: string[] = [];
    for (const key of keysWithPrefix(reviewPrefix(workspaceId))) {
      const record = parse(readItem(key));
      if (!record || now - record.at > REVIEW_RECORD_MAX_AGE_MS) {
        doomed.push(key);
        continue;
      }
      if (
        record.documentId === documentId
        && record.at < listedAt
        && !pendingChangeSetIds.has(record.changeSetId)
      ) {
        doomed.push(key);
      }
    }
    for (const key of doomed) removeItem(key);
  } catch {
    /* storage unavailable — nothing to prune */
  }
}
