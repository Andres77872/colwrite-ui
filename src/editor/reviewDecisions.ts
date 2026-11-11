import type { ReviewDecision } from './proposals';

/**
 * Decisions made on a durable change set, remembered in this browser.
 *
 * The API records a decision per operation and says whether each target
 * block is still the one the operation was written for
 * (`operation_decisions`, `operation_targets`). This record is what is left
 * for when it does not:
 *
 * - **An API without those fields.** The decisions are kept here, in the
 *   order they were made, with the fingerprints of the blocks the batch was
 *   staged against. Without them a review left half-done came back whole on
 *   the next load.
 * - **A change set stored before targets were recorded.** Its decisions are
 *   on the server; only the staging fingerprints are kept here.
 * - **A decision that could not be sent.** It waits here and is sent again
 *   when the change set is next staged.
 *
 * Nothing here is authoritative. A record that is missing, unreadable or
 * blocked by the browser only means the batch is staged as the server has
 * it.
 */

const PREFIX = 'colwrite:review:v1:';

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
  /** Staging fingerprint per operation index (see `ProposedChange.base`). */
  bases: Record<string, string>;
};

function keyFor(documentId: string, changeSetId: string): string {
  return `${PREFIX}${encodeURIComponent(documentId)}:${encodeURIComponent(changeSetId)}`;
}

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
    const bases: Record<string, string> = {};
    if (value.bases && typeof value.bases === 'object') {
      for (const [key, base] of Object.entries(value.bases)) {
        if (typeof base === 'string') bases[key] = base;
      }
    }
    return {
      documentId: value.documentId,
      changeSetId: value.changeSetId,
      at: typeof value.at === 'number' ? value.at : 0,
      decisions: Array.isArray(value.decisions) ? value.decisions.filter(isDecision) : [],
      bases,
    };
  } catch {
    return null;
  }
}

export function loadReview(documentId: string, changeSetId: string): StoredReview | null {
  try {
    const record = parse(localStorage.getItem(keyFor(documentId, changeSetId)));
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
 * Add to a change set's record.
 *
 * Decisions are appended, and the first decision on an operation wins: a
 * change is decided once. Fingerprints overwrite the ones for the same
 * operation, because accepting a change moves the baseline of the changes
 * after it (see `rebaseAfterAccept`).
 */
export function saveReview(
  documentId: string,
  changeSetId: string,
  update: { decisions?: readonly ReviewDecision[]; bases?: Readonly<Record<string, string>> },
  now: number = Date.now(),
): void {
  const decisions = update.decisions ?? [];
  const bases = update.bases ?? {};
  if (decisions.length === 0 && Object.keys(bases).length === 0) return;
  try {
    const key = keyFor(documentId, changeSetId);
    const current = parse(localStorage.getItem(key));
    const record: StoredReview = current && current.documentId === documentId && current.changeSetId === changeSetId
      ? current
      : { documentId, changeSetId, at: now, decisions: [], bases: {} };
    const decided = new Set(record.decisions.map(([opIndex]) => opIndex));
    for (const decision of decisions) {
      if (decided.has(decision[0])) continue;
      decided.add(decision[0]);
      record.decisions.push([decision[0], decision[1]]);
    }
    record.bases = { ...record.bases, ...bases };
    record.at = now;
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Storage full, blocked or unavailable: the review carries on, and a
    // reload stages the batch as the server has it.
  }
}

/**
 * Take decisions back out of a change set's record: the server has them now,
 * or has refused them for good. The staging fingerprints stay; a record left
 * with neither is removed.
 */
export function forgetDecisions(
  documentId: string,
  changeSetId: string,
  opIndexes: readonly number[],
): void {
  if (opIndexes.length === 0) return;
  try {
    const key = keyFor(documentId, changeSetId);
    const record = parse(localStorage.getItem(key));
    if (!record || record.documentId !== documentId || record.changeSetId !== changeSetId) return;
    const sent = new Set(opIndexes);
    const decisions = record.decisions.filter(([opIndex]) => !sent.has(opIndex));
    if (decisions.length === record.decisions.length) return;
    if (decisions.length === 0 && Object.keys(record.bases).length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ ...record, decisions }));
  } catch {
    /* storage unavailable — nothing to clean up */
  }
}

/** Drop a change set's record once the server no longer holds it as pending. */
export function forgetReview(documentId: string, changeSetId: string): void {
  try {
    localStorage.removeItem(keyFor(documentId, changeSetId));
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
  documentId: string,
  pendingChangeSetIds: ReadonlySet<string>,
  listedAt: number = Date.now(),
  now: number = Date.now(),
): void {
  try {
    const doomed: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const record = parse(localStorage.getItem(key));
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
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to prune */
  }
}
