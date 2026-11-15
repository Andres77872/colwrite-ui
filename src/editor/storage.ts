import type { Doc } from './types';
import {
  draftKey,
  lastPageKey,
  readItem,
  readJson,
  removeItem,
  unsavedKey,
  writeItem,
  writeJson,
} from '@/lib/storageKeys';

/**
 * Local copies of pages, under the workspace they belong to.
 *
 * Records are keyed by workspace and page id and carry the page id inside
 * them, so a body cached under one page can never be adopted under another
 * (a crash mid-switch, two tabs on different pages, a second account signing
 * in). Sign-out removes them with every other workspace key
 * (`clearUserStorage`).
 */

export type CachedDoc = {
  documentId: string | null;
  doc: Doc;
  /**
   * The head the body was based on, so edits made while the server could not
   * be read are saved over that head, and refused (412) if it moved since.
   */
  etag: string | null;
};

function isDoc(value: unknown): value is Doc {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { blocks?: unknown }).blocks)
  );
}

export function loadDocumentId(workspaceId: string): string | null {
  return readItem(lastPageKey(workspaceId)) || null;
}

export function saveDocumentId(workspaceId: string, id: string | null): void {
  if (id) writeItem(lastPageKey(workspaceId), id);
  else removeItem(lastPageKey(workspaceId));
}

/**
 * Read the cached copy of *documentId*.
 *
 * Returns null when nothing is cached for that id, so a stale body can never
 * be adopted under the wrong page.
 */
export function loadDoc(workspaceId: string, documentId: string | null): CachedDoc | null {
  const parsed = readJson(draftKey(workspaceId, documentId)) as Partial<CachedDoc> | undefined;
  if (!parsed || !isDoc(parsed.doc) || (parsed.documentId ?? null) !== documentId) return null;
  return { documentId, doc: parsed.doc, etag: typeof parsed.etag === 'string' ? parsed.etag : null };
}

export function saveDoc(workspaceId: string, doc: Doc, documentId: string | null, etag: string | null): void {
  const record: CachedDoc = { documentId, doc, etag: documentId === null ? null : etag };
  writeJson(draftKey(workspaceId, documentId), record);
}

/** Edits of a page that never reached the server, kept on this device. */
export type UnsavedDraft = {
  documentId: string;
  doc: Doc;
  /** When the copy was taken (ms since the epoch). */
  savedAt: number;
};

/**
 * Keep the body of a page whose save failed.
 *
 * The cached copy above is not enough for this: it follows the editor state,
 * so the next load of the page from the server overwrites it and the edits
 * the server never received are gone. This record is written only when
 * unsaved work is about to leave the screen, and stays until the author takes
 * it back or discards it.
 */
export function saveUnsavedDraft(workspaceId: string, documentId: string, doc: Doc, savedAt: number = Date.now()): void {
  const record: UnsavedDraft = { documentId, doc, savedAt };
  writeJson(unsavedKey(workspaceId, documentId), record);
}

export function loadUnsavedDraft(workspaceId: string, documentId: string): UnsavedDraft | null {
  const parsed = readJson(unsavedKey(workspaceId, documentId)) as Partial<UnsavedDraft> | undefined;
  if (parsed?.documentId !== documentId || !isDoc(parsed.doc)) return null;
  return {
    documentId,
    doc: parsed.doc,
    savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
  };
}

export function clearUnsavedDraft(workspaceId: string, documentId: string): void {
  removeItem(unsavedKey(workspaceId, documentId));
}
