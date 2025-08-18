import { get, post, put, del } from './api';
import type { Block, Doc } from '../editor/types';

// The backend expects { document: { ... } } where document is an object, not a raw array.
// Convert our internal Doc or a blocks array to an object with a blocks property while
// preserving any extra metadata like name/title if provided by callers.
type NewDocInput = Doc | Block[] | (Partial<Doc> & Record<string, any>);
function toBackendDocument(input: NewDocInput): Record<string, any> {
  if (Array.isArray(input)) return { version: 1, blocks: input };
  if (input && typeof input === 'object') {
    const { version = 1, blocks = [], ...rest } = input as any;
    const name = (rest as any).name;
    const title = (rest as any).title ?? (name !== undefined ? name : undefined);
    // Ensure both name and title are present when possible for backend compatibility
    const out: Record<string, any> = { version, blocks, ...rest };
    if (name !== undefined && out.name === undefined) out.name = name;
    if (title !== undefined && out.title === undefined) out.title = title;
    return out;
  }
  return { version: 1, blocks: [] };
}

// Normalize backend payload to our internal Doc shape.
function toEditorDoc(payload: unknown): Doc {
  // The backend may return either an object with a blocks array or the array itself.
  if (Array.isArray(payload)) {
    return { version: 1, blocks: payload as Block[] };
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).blocks)) {
    const obj = payload as Record<string, any>;
    const name: string | undefined = (obj.name as string) || (obj.title as string) || undefined;
    const version: number = typeof obj.version === 'number' ? obj.version : 1;
    return { version, blocks: obj.blocks as Block[], name };
  }
  // Fallback to empty doc if unexpected shape
  return { version: 1, blocks: [] };
}

// Create a new document, returns generated document_id
export async function createDocument(doc: NewDocInput): Promise<{ document_id: string }> {
  const payload = toBackendDocument(doc);
  return post<{ document_id: string }>('/document/create', { document: payload });
}

// Update an existing document by ID
export async function saveDocument(documentId: string, doc: NewDocInput): Promise<{ status: string; message: string }> {
  const payload = toBackendDocument(doc);
  return put<{ status: string; message: string }>(`/document/save/${encodeURIComponent(documentId)}`, { document: payload });
}

// Load a document by ID and return our Doc shape
export async function loadDocument(documentId: string): Promise<Doc> {
  const res = await get<{ document: unknown; status?: string; message?: string }>(`/document/load/${encodeURIComponent(documentId)}`);
  return toEditorDoc(res.document);
}

// List documents with pagination
export async function listDocuments(page = 1, limit = 10): Promise<{ documents: any[]; count: number; status: string; message: string }> {
  return post<{ documents: any[]; count: number; status: string; message: string }>(
    '/document/list',
    { page, limit },
  );
}

// Delete a document by ID
export async function deleteDocument(documentId: string): Promise<{ status: string; message: string }> {
  return del<{ status: string; message: string }>(`/document/delete/${encodeURIComponent(documentId)}`);
}

// Utility helpers to transform shapes if needed externally
export const documentTransforms = { toBackendDocument, toEditorDoc };
