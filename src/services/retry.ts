import { problemDetails } from './contracts';

/**
 * One backoff policy for everything that talks to the API.
 *
 * The document's numeric MySQL identity — which chats, threads and resource
 * attachments are all keyed on — is projected asynchronously from the
 * authoritative Mongo head. Between a save and that projection landing, every
 * endpoint that needs the identity fails closed with a typed, retryable
 * problem. That window is normally about a second, so the honest client
 * behaviour is to wait it out rather than report a failure the author cannot
 * act on.
 */

/**
 * Problem codes the API marks `retryable: true`.
 *
 * Deliberately not a status-code test: `history_not_ready` is a 409 and
 * `document_rate_limit_exceeded` is a 429, while plenty of unrelated 503s
 * (health, PDF compile, upstream search) are not retryable at all.
 */
export const RETRYABLE_PROBLEM_CODES = new Set([
  'projection_pending',
  'history_not_ready',
  'document_rate_limit_exceeded',
]);

/** SSE error codes that mean "the save is still propagating — ask again". */
export const RETRYABLE_STREAM_CODES = new Set([
  'PROJECTION_PENDING',
  'DOCUMENT_REFERENCE_NOT_READY',
]);

/**
 * Projection states that no amount of waiting will fix. Mirrors the server's
 * own terminal set; anything else — including `ready` on a projection that is
 * merely behind — is worth asking again for.
 */
export const TERMINAL_READINESS_STATUSES = new Set([
  'deleted',
  'deleting',
  'failed',
  'scope_mismatch',
  'conflicting',
]);

export function isTerminalReadiness(status: string | null | undefined): boolean {
  return status != null && TERMINAL_READINESS_STATUSES.has(status);
}

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
 * future retryable problem never gets retried on a guess. A terminal readiness
 * status vetoes it: the projection for that document is gone or broken.
 */
export function isRetryableProblem(error: unknown): boolean {
  const problem = problemDetails(error);
  if (!problem || !problem.retryable) return false;
  if (!problem.code || !RETRYABLE_PROBLEM_CODES.has(problem.code)) return false;
  return !isTerminalReadiness(problem.readinessStatus);
}
