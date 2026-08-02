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
 * Machine-readable `code` from an `application/problem+json` error body kept
 * on an {@link ApiError}. Null for plain errors or bodies without a code.
 */
export function problemCode(error: unknown): string | null {
  const data = (error as { data?: unknown } | null)?.data
  if (!isUnknownRecord(data)) return null
  return typeof data.code === 'string' ? data.code : null
}

/** Server retry hint in seconds from a problem body, if present and positive. */
export function problemRetryAfter(error: unknown): number | null {
  const data = (error as { data?: unknown } | null)?.data
  if (!isUnknownRecord(data)) return null
  const value = data.retry_after
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
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
