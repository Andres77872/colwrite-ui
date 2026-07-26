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

/**
 * The list endpoint has used several identifier and title keys over time.
 * Keep those wire fields typed while retaining unknown backend metadata.
 */
export type DocumentSummary = UnknownRecord & {
  _id?: string
  id?: string
  document_id?: string
  name?: string
  title?: string
  version?: number
  created_at?: string
  updated_at?: string
}

export function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
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
