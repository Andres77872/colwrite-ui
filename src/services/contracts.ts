import type { Block, Doc } from '../editor/types'

export type UnknownRecord = Record<string, unknown>

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonMetadata = { [key: string]: JsonValue }

/** Shapes accepted by the document create/save endpoints. */
export type DocumentInput =
  | Doc
  | Block[]
  | (Partial<Doc> & { title?: string } & UnknownRecord)

export type DocumentSortBy = 'updated_at' | 'created_at' | 'name'
export type DocumentSortOrder = 'asc' | 'desc'

export interface DocumentListOptions {
  page?: number
  limit?: number
  query?: string
  tags?: string[]
  sortBy?: DocumentSortBy
  sortOrder?: DocumentSortOrder
}

/** Canonical document metadata returned to all UI consumers. */
export interface DocumentSummary {
  id: string
  name: string
  version: number
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface DocumentListResult {
  documents: DocumentSummary[]
  count: number
  page: number
  limit: number
  totalPages: number
  sortBy: DocumentSortBy
  sortOrder: DocumentSortOrder
  status: string
  message: string
}

export function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * The machine-readable half of an `application/problem+json` body.
 *
 * `readinessStatus` is a lifecycle flag, not a freshness one: once a document
 * has been projected the server reports `ready` for the rest of its life, even
 * while `appliedHeadSeq` trails `expectedHeadSeq`. Anything deciding whether to
 * retry must read `code` and `retryable` — never that string.
 */
export interface ProblemDetails {
  code: string | null
  retryable: boolean
  /** Positive seconds only; null when the server gave no hint. */
  retryAfterSeconds: number | null
  readinessStatus: string | null
  expectedHeadSeq: number | null
  appliedHeadSeq: number | null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Read the problem body carried on an {@link ApiError}. Null for plain errors
 * and for bodies that are not problem documents.
 */
export function problemDetails(error: unknown): ProblemDetails | null {
  const data = (error as { data?: unknown } | null)?.data
  if (!isUnknownRecord(data)) return null
  const retryAfter = finiteNumber(data.retry_after)
  return {
    code: typeof data.code === 'string' ? data.code : null,
    retryable: data.retryable === true,
    retryAfterSeconds: retryAfter !== null && retryAfter > 0 ? retryAfter : null,
    readinessStatus: typeof data.readiness_status === 'string' ? data.readiness_status : null,
    expectedHeadSeq: finiteNumber(data.expected_head_seq),
    appliedHeadSeq: finiteNumber(data.applied_head_seq),
  }
}

/**
 * Machine-readable `code` from an `application/problem+json` error body kept
 * on an {@link ApiError}. Null for plain errors or bodies without a code.
 */
export function problemCode(error: unknown): string | null {
  return problemDetails(error)?.code ?? null
}

/** Server retry hint in seconds from a problem body, if present and positive. */
export function problemRetryAfter(error: unknown): number | null {
  return problemDetails(error)?.retryAfterSeconds ?? null
}

/**
 * Our own words for the problems the server calls retryable.
 *
 * Their `detail` strings describe the machinery — "Document reference
 * projection is not ready" — which tells the person writing the document
 * nothing they can act on.
 */
const RETRYABLE_PROBLEM_MESSAGES: Record<string, string> = {
  projection_pending: 'This document is still syncing on the server.',
  history_not_ready: 'The history for this document is still being prepared.',
  document_rate_limit_exceeded: 'Too many requests just now — wait a moment and try again.',
}

/** {@link errorMessage}, but preferring our copy for a known problem code. */
export function describeApiError(error: unknown, fallback: string): string {
  const code = problemCode(error)
  return (code && RETRYABLE_PROBLEM_MESSAGES[code]) || errorMessage(error, fallback)
}

/**
 * The same words, for a readiness verdict that never became an `ApiError`.
 *
 * Gating a read on the readiness probe means the common "not ready yet" case
 * arrives as a status string rather than a rejected request, and it should not
 * read differently to the author for having taken the quieter path.
 */
export function describeReadiness(status: string | null | undefined): string {
  if (status === 'deleted' || status === 'deleting') {
    return 'This document has been deleted.'
  }
  if (status === 'scope_mismatch' || status === 'conflicting' || status === 'failed') {
    return 'This document could not be prepared on the server.'
  }
  return RETRYABLE_PROBLEM_MESSAGES.projection_pending
}

/** HTTP error with the parsed response body retained for callers and tests. */
export class ApiError extends Error {
  readonly status: number
  readonly data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}
