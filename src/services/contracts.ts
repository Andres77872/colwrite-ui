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
 * Anything deciding whether to replay a request reads `code` and `retryable`;
 * `retryAfterSeconds` only says how long to hold it before doing so.
 */
export interface ProblemDetails {
  code: string | null
  retryable: boolean
  /** Positive seconds only; null when the server gave no hint. */
  retryAfterSeconds: number | null
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
 * Their `detail` strings describe the machinery — "History backfill has not
 * completed" — which tells the person writing the document nothing they can
 * act on.
 */
const RETRYABLE_PROBLEM_MESSAGES: Record<string, string> = {
  history_not_ready: 'The history for this document is still being prepared.',
  document_rate_limit_exceeded: 'Too many requests just now — wait a moment and try again.',
}

/** {@link errorMessage}, but preferring our copy for a known problem code. */
export function describeApiError(error: unknown, fallback: string): string {
  const code = problemCode(error)
  return (code && RETRYABLE_PROBLEM_MESSAGES[code]) || errorMessage(error, fallback)
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
