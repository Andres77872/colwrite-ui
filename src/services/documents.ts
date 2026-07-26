import { get, post, put, del } from './api';
import type { Block, Doc } from '../editor/types';
import { coerceBlock } from '../editor/docOps';
import {
  type DocumentInput,
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
  // Fallback to empty doc if unexpected shape
  return { version: 1, blocks: [] };
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
export async function loadDocument(documentId: string): Promise<Doc> {
  const res = await get<{ document: unknown; status?: string; message?: string }>(`/document/load/${encodeURIComponent(documentId)}`);
  return toEditorDoc(res.document);
}

// List documents with pagination and optional search query
export async function listDocuments(
  page = 1,
  limit = 10,
  query?: string,
): Promise<{ documents: DocumentSummary[]; count: number; status: string; message: string }> {
  const body: { page: number; limit: number; query?: string } = { page, limit };
  // Only include query in payload if provided and non-empty after trimming
  if (typeof query === 'string' && query.trim() !== '') {
    body.query = query;
  }
  const response = await post<unknown>(
    '/document/list',
    body,
  );
  if (!isUnknownRecord(response)) {
    return { documents: [], count: 0, status: '', message: '' };
  }
  const documents = Array.isArray(response.documents)
    ? response.documents
        .filter(isUnknownRecord)
        .map((document) => document as DocumentSummary)
    : [];
  return {
    documents,
    count: typeof response.count === 'number' ? response.count : 0,
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
