import { get, post, put, del, type ApiRequestInit } from './api';
import type { Block, Doc } from '../editor/types';
import { coerceBlock } from '../editor/docOps';
import {
  type DocumentInput,
  type DocumentListOptions,
  type DocumentListResult,
  type DocumentSortBy,
  type DocumentSortOrder,
  type DocumentSummary,
  type UnknownRecord,
  isUnknownRecord,
} from './contracts';

// The backend expects { document: { ... } } where document is an object, not a raw array.
// Convert our internal Doc or a blocks array to an object with a blocks property while
// preserving any extra metadata like name/title if provided by callers.
type BackendDocument = UnknownRecord & {
  version: number;
  blocks: Block[];
  name?: string;
  title?: string;
};

function normalizeBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeBlock).filter((block): block is Block => block !== null);
}

function normalizeBlock(value: unknown): Block | null {
  if (isUnknownRecord(value) && typeof value.id === 'string') {
    if (value.type === 'divider') return value as Block;
    if (
      value.type === 'heading' &&
      typeof value.html === 'string' &&
      (value.level === 1 || value.level === 2 || value.level === 3)
    ) {
      return value as Block;
    }
    if (
      value.type === 'paragraph' &&
      typeof value.html === 'string' &&
      (value.children === undefined || Array.isArray(value.children)) &&
      (value.columns === undefined || typeof value.columns === 'number')
    ) {
      return value as Block;
    }
  }
  return coerceBlock(value);
}

function toBackendDocument(input: unknown): BackendDocument {
  if (Array.isArray(input)) return { version: 1, blocks: input };
  if (isUnknownRecord(input)) {
    const { version: rawVersion, blocks: rawBlocks, ...rest } = input;
    const version = typeof rawVersion === 'number' ? rawVersion : 1;
    const blocks = normalizeBlocks(rawBlocks);
    const name = typeof rest.name === 'string' ? rest.name : undefined;
    const title = typeof rest.title === 'string' ? rest.title : name;
    // Ensure both name and title are present when possible for backend compatibility
    const out: BackendDocument = { ...rest, version, blocks };
    if (name !== undefined) out.name = name;
    if (title !== undefined) out.title = title;
    return out;
  }
  return { version: 1, blocks: [] };
}

// Normalize backend payload to our internal Doc shape.
function toEditorDoc(payload: unknown): Doc {
  // The backend may return either an object with a blocks array or the array itself.
  if (Array.isArray(payload)) {
    return { version: 1, blocks: normalizeBlocks(payload) };
  }
  if (isUnknownRecord(payload) && Array.isArray(payload.blocks)) {
    const name =
      (typeof payload.name === 'string' && payload.name) ||
      (typeof payload.title === 'string' && payload.title) ||
      undefined;
    const version = typeof payload.version === 'number' ? payload.version : 1;
    return { version, blocks: normalizeBlocks(payload.blocks), name };
  }
  // An empty blocks array is a valid blank document. A payload with no blocks
  // field at all is not: treating a malformed success as a blank document made
  // a failed load indistinguishable from an intentional empty file.
  throw new Error('The server returned an invalid document.');
}

/** HTTP status the backend uses for an optimistic-concurrency failure. */
export const VERSION_CONFLICT_STATUS = 409;

export function isVersionConflict(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === VERSION_CONFLICT_STATUS;
}

// Create a new document, returns generated document_id
export async function createDocument(
  doc: DocumentInput,
): Promise<{ document_id: string; version?: number }> {
  const payload = toBackendDocument(doc);
  return post<{ document_id: string; version?: number }>('/document/create', { document: payload });
}

/**
 * Update an existing document by ID.
 *
 * The response carries the post-save `version`. Saves are optimistically
 * locked on that number, so the caller MUST adopt it — otherwise it keeps
 * resending the version it loaded with and every save after the first is
 * rejected.
 */
export async function saveDocument(
  documentId: string,
  doc: DocumentInput,
): Promise<{ status: string; message: string; version?: number }> {
  const payload = toBackendDocument(doc);
  return put<{ status: string; message: string; version?: number }>(
    `/document/save/${encodeURIComponent(documentId)}`,
    { document: payload },
  );
}

// Load a document by ID and return our Doc shape
export async function loadDocument(
  documentId: string,
  init?: { signal?: AbortSignal },
): Promise<Doc> {
  const res = await get<{ document: unknown; status?: string; message?: string }>(
    `/document/load/${encodeURIComponent(documentId)}`,
    init,
  );
  return toEditorDoc(res.document);
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const DEFAULT_SORT_BY: DocumentSortBy = 'updated_at';
const DEFAULT_SORT_ORDER: DocumentSortOrder = 'desc';

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeSortBy(value: unknown, fallback: DocumentSortBy): DocumentSortBy {
  return value === 'updated_at' || value === 'created_at' || value === 'name' ? value : fallback;
}

function normalizeSortOrder(value: unknown, fallback: DocumentSortOrder): DocumentSortOrder {
  return value === 'asc' || value === 'desc' ? value : fallback;
}

function stringField(record: UnknownRecord, snakeCase: string, camelCase: string): string {
  const value = record[snakeCase] ?? record[camelCase];
  return typeof value === 'string' ? value : '';
}

function normalizeDocumentSummary(value: unknown): DocumentSummary | null {
  if (!isUnknownRecord(value)) return null;
  const idValue = value._id ?? value.id ?? value.document_id;
  const id = typeof idValue === 'string' ? idValue : '';
  if (!id) return null;

  const rawName = typeof value.name === 'string'
    ? value.name
    : typeof value.title === 'string'
      ? value.title
      : '';
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  return {
    id,
    name: rawName.trim() || 'Untitled document',
    version: typeof value.version === 'number' ? value.version : 1,
    tags,
    createdAt: stringField(value, 'created_at', 'createdAt'),
    updatedAt: stringField(value, 'updated_at', 'updatedAt'),
  };
}

// List documents with pagination, filters, and an explicit deterministic sort.
export async function listDocuments(
  options: DocumentListOptions = {},
  init?: ApiRequestInit,
): Promise<DocumentListResult> {
  const page = positiveInteger(options.page, DEFAULT_PAGE);
  const limit = positiveInteger(options.limit, DEFAULT_LIMIT);
  const sortBy = normalizeSortBy(options.sortBy, DEFAULT_SORT_BY);
  const sortOrder = normalizeSortOrder(options.sortOrder, DEFAULT_SORT_ORDER);
  const body: {
    page: number;
    limit: number;
    query?: string;
    tags?: string[];
    sort_by: DocumentSortBy;
    sort_order: DocumentSortOrder;
  } = {
    page,
    limit,
    sort_by: sortBy,
    sort_order: sortOrder,
  };

  const query = options.query?.trim();
  if (query) body.query = query;
  const tags = options.tags?.map((tag) => tag.trim()).filter(Boolean);
  if (tags?.length) body.tags = tags;

  const response = await post<unknown>('/document/list', body, init);
  if (!isUnknownRecord(response)) {
    return {
      documents: [],
      count: 0,
      page,
      limit,
      totalPages: 0,
      sortBy,
      sortOrder,
      status: '',
      message: '',
    };
  }

  const documents = Array.isArray(response.documents)
    ? response.documents
        .map(normalizeDocumentSummary)
        .filter((document): document is DocumentSummary => document !== null)
    : [];
  const count = typeof response.count === 'number' && response.count >= 0 ? response.count : 0;
  const responsePage = positiveInteger(response.page, page);
  const responseLimit = positiveInteger(response.limit, limit);
  const totalPagesValue = response.total_pages ?? response.totalPages;
  const totalPages = typeof totalPagesValue === 'number'
    && Number.isInteger(totalPagesValue)
    && totalPagesValue >= 0
    ? totalPagesValue
    : Math.ceil(count / responseLimit);

  return {
    documents,
    count,
    page: responsePage,
    limit: responseLimit,
    totalPages,
    sortBy: normalizeSortBy(response.sort_by ?? response.sortBy, sortBy),
    sortOrder: normalizeSortOrder(response.sort_order ?? response.sortOrder, sortOrder),
    status: typeof response.status === 'string' ? response.status : '',
    message: typeof response.message === 'string' ? response.message : '',
  };
}

// Delete a document by ID
export async function deleteDocument(documentId: string): Promise<{ status: string; message: string }> {
  return del<{ status: string; message: string }>(`/document/delete/${encodeURIComponent(documentId)}`);
}

// Utility helpers to transform shapes if needed externally
export const documentTransforms = { toBackendDocument, toEditorDoc };
