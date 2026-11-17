import { problemDetails } from '@/api/errors';
import type { ErrorCode } from '@/api/schema';

/**
 * One backoff policy for everything that talks to the API.
 *
 * A rate limit, a store that is briefly down or an upstream that timed out
 * usually clears within a few seconds, so the client waits it out (for as
 * long as `Retry-After` asks, up to {@link MAX_RETRY_DELAY_MS}) rather than
 * report a failure the author cannot act on.
 */

/**
 * The registry's retryable codes (`ColWrite-api/src/errors/registry.py`).
 *
 * Deliberately not a status-code test: `document_rate_limit_exceeded` is a
 * 429, while unrelated 503s (`export_unavailable`, `paper_source_unavailable`)
 * are not retryable at all. A new retryable code is added here on purpose.
 */
export const RETRYABLE_PROBLEM_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'rate_limited',
  'document_rate_limit_exceeded',
  'provider_rate_limited',
  'limit_exceeded',
  'unavailable',
  'auth_unavailable',
  'asset_storage_unavailable',
  'retrieval_unavailable',
  'provider_unavailable',
  'resolver_unavailable',
  'bad_gateway',
  'timeout',
]);

/**
 * The retryable codes the API answers before a request does any work: a rate
 * limit. Only these replay a write that carries no `Idempotency-Key` (a move
 * on `If-Match`, a role change), which a replay after a `timeout` might apply
 * twice.
 */
const REFUSED_BEFORE_WORK: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'rate_limited',
  'document_rate_limit_exceeded',
  'provider_rate_limited',
  'limit_exceeded',
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
  return problem.code != null && RETRYABLE_PROBLEM_CODES.has(problem.code as ErrorCode);
}

/**
 * Whether the client may send *request* again after *error*: a read, or a
 * write the server deduplicates by its `Idempotency-Key`, on any retryable
 * problem; any other write only on one refused before it did any work.
 */
export function mayReplay(request: Request, error: unknown): boolean {
  if (!isRetryableProblem(error)) return false;
  const safe = request.method === 'GET' || request.method === 'HEAD' || request.headers.has('Idempotency-Key');
  return safe || REFUSED_BEFORE_WORK.has(problemDetails(error)?.code as ErrorCode);
}
