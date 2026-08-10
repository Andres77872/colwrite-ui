import { problemDetails } from './contracts';

/**
 * One backoff policy for everything that talks to the API.
 *
 * A handful of endpoints fail closed on work the server is still doing — the
 * history backfill for a document that has never been read this way before,
 * and the per-document rate limiter shedding a burst. Both clear on their own,
 * usually within a second or two, so the honest client behaviour is to wait
 * them out rather than report a failure the author cannot act on.
 */

/**
 * Problem codes the API marks `retryable: true`.
 *
 * Deliberately not a status-code test: `history_not_ready` is a 409 and
 * `document_rate_limit_exceeded` is a 429, while plenty of unrelated 503s
 * (health, PDF compile, upstream search) are not retryable at all.
 */
export const RETRYABLE_PROBLEM_CODES = new Set([
  'history_not_ready',
  'document_rate_limit_exceeded',
]);

export const MIN_RETRY_DELAY_MS = 500;
export const MAX_RETRY_DELAY_MS = 5000;

/** The server's hint if it gave one, otherwise tripling backoff with jitter. */
export function retryDelayMs(
  attempt: number,
  baseDelayMs: number,
  retryAfterSeconds: number | null,
): number {
  if (retryAfterSeconds !== null) {
    return Math.min(
      MAX_RETRY_DELAY_MS,
      Math.max(MIN_RETRY_DELAY_MS, retryAfterSeconds * 1000),
    );
  }
  const backoff = baseDelayMs * 3 ** (attempt - 1);
  const jitter = 1 + (Math.random() - 0.5) * 0.5;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(MIN_RETRY_DELAY_MS, backoff * jitter));
}

/**
 * How long to hold a request before replaying it, or null to give up now.
 *
 * A server asking for longer than {@link MAX_RETRY_DELAY_MS} is saying it will
 * not be ready inside the window we are willing to keep the caller waiting.
 * Clamping that down would come back too early — and against a rate limit,
 * would make the situation worse rather than better.
 */
export function retryWaitMs(
  attempt: number,
  baseDelayMs: number,
  retryAfterSeconds: number | null,
): number | null {
  if (retryAfterSeconds !== null && retryAfterSeconds * 1000 > MAX_RETRY_DELAY_MS) {
    return null;
  }
  return retryDelayMs(attempt, baseDelayMs, retryAfterSeconds);
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Whether replaying this request could plausibly succeed.
 *
 * Requires the server's own `retryable` flag *and* a code we understand, so a
 * future retryable problem never gets retried on a guess.
 */
export function isRetryableProblem(error: unknown): boolean {
  const problem = problemDetails(error);
  if (!problem || !problem.retryable) return false;
  return problem.code != null && RETRYABLE_PROBLEM_CODES.has(problem.code);
}
