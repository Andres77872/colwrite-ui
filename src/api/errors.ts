import { isUnknownRecord } from '@/lib/json';
import type { ProblemDetails as ProblemBody } from './schema';

/**
 * Errors from the API, in one shape.
 *
 * Every failure the API returns is `application/problem+json`
 * (`ColWrite-api/docs/errors.md`): a string `detail`, a machine-readable
 * `code`, `retryable`, and for a refused request body (422 `invalid_request`)
 * the field errors in `errors[]` (`loc`, `msg`, `type`). The client turns each
 * into an {@link ApiError} that keeps the parsed body.
 */

/** HTTP error with the parsed response body retained for callers and tests. */
export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  /** The API's `X-Request-Id` for this request, for reports. */
  readonly requestId: string | null;

  constructor(message: string, status: number, data: unknown, requestId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.requestId = requestId;
  }
}

/** The message a problem body carries: its `detail`, then its field errors. */
function problemMessage(body: unknown, fallback: string): string {
  if (!isUnknownRecord(body)) return fallback;
  const fields = Array.isArray(body.errors)
    ? body.errors
        .map((entry) => (isUnknownRecord(entry) && typeof entry.msg === 'string' ? entry.msg : null))
        .filter((message): message is string => Boolean(message))
    : [];
  if (fields.length) return fields.join('; ');
  if (typeof body.detail === 'string' && body.detail) return body.detail;
  if (typeof body.title === 'string' && body.title) return body.title;
  return fallback;
}

/** The {@link ApiError} for a failed response whose body has been read. */
export function apiErrorFrom(response: Response, body: unknown): ApiError {
  return new ApiError(
    problemMessage(body, response.statusText || `Request failed (${response.status})`),
    response.status,
    body,
    response.headers.get('X-Request-Id'),
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The machine-readable half of a problem body.
 *
 * Anything deciding whether to replay a request reads `code` and `retryable`;
 * `retryAfterSeconds` only says how long to hold it before doing so.
 */
export interface ProblemDetails {
  code: string | null;
  retryable: boolean;
  /** Positive seconds only; null when the server gave no hint. */
  retryAfterSeconds: number | null;
}

/**
 * The problem body an {@link ApiError} carries, with its extension members
 * (`conflict_reason`, `operation_index`, `provider`, …). Every member is
 * optional here: the body came over the network.
 */
export function problemBody(error: unknown): Partial<ProblemBody> | null {
  const data = error instanceof ApiError ? error.data : null;
  return isUnknownRecord(data) ? (data as Partial<ProblemBody>) : null;
}

/**
 * Read the problem body carried on an {@link ApiError}. Null for plain errors
 * and for bodies that are not problem documents.
 */
export function problemDetails(error: unknown): ProblemDetails | null {
  const data = (error as { data?: unknown } | null)?.data;
  if (!isUnknownRecord(data)) return null;
  const retryAfter = typeof data.retry_after === 'number' && Number.isFinite(data.retry_after) ? data.retry_after : null;
  return {
    code: typeof data.code === 'string' ? data.code : null,
    retryable: data.retryable === true,
    retryAfterSeconds: retryAfter !== null && retryAfter > 0 ? retryAfter : null,
  };
}

/** The problem's `code`, or null for plain errors and bodies without one. */
export function problemCode(error: unknown): string | null {
  return problemDetails(error)?.code ?? null;
}

/** Server retry hint in seconds from a problem body, if present and positive. */
export function problemRetryAfter(error: unknown): number | null {
  return problemDetails(error)?.retryAfterSeconds ?? null;
}

/**
 * Our own words for the problems the server calls retryable. Their `detail`
 * strings describe the machinery, which tells the author nothing they can
 * act on.
 */
const RETRYABLE_PROBLEM_MESSAGES: Record<string, string> = {
  document_rate_limit_exceeded: 'Too many requests just now — wait a moment and try again.',
};

/** {@link errorMessage}, but preferring our copy for a known problem code. */
export function describeApiError(error: unknown, fallback: string): string {
  const code = problemCode(error);
  return (code && RETRYABLE_PROBLEM_MESSAGES[code]) || errorMessage(error, fallback);
}
