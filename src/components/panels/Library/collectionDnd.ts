import { isFileDrag } from '@/lib/fileDrop';

export const COLLECTION_DRAG_MIME = 'application/x-colwrite-collection+json';
export const RESOURCE_DRAG_MIME = 'application/x-colwrite-resource+json';
/** A page row of the sidebar tree, with the placement ETag a move sends. */
export const DOCUMENT_DRAG_MIME = 'application/x-colwrite-document+json';

/**
 * What a row drag carries: a collection (with its ETag when the tree knows
 * it), a PDF, or a page with its placement ETag. The Library and the sidebar
 * tree read the same payloads, so a PDF dragged from the Library can land on
 * a tree row.
 */
export type LibraryDragPayload =
  | { kind: 'collection'; id: number; etag?: string }
  | { kind: 'resource'; id: number }
  | { kind: 'document'; id: string; placementEtag: string };

const INTERNAL_TYPES = [COLLECTION_DRAG_MIME, RESOURCE_DRAG_MIME, DOCUMENT_DRAG_MIME];

function typesOf(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.types ?? []);
}

export function hasInternalLibraryDrag(dataTransfer: DataTransfer): boolean {
  const types = typesOf(dataTransfer);
  return INTERNAL_TYPES.some((type) => types.includes(type));
}

/** Which kind of row is being dragged; readable during the drag, unlike its data. */
export function dragKind(dataTransfer: DataTransfer): LibraryDragPayload['kind'] | null {
  const types = typesOf(dataTransfer);
  if (types.includes(DOCUMENT_DRAG_MIME)) return 'document';
  if (types.includes(COLLECTION_DRAG_MIME)) return 'collection';
  if (types.includes(RESOURCE_DRAG_MIME)) return 'resource';
  return null;
}

/**
 * A file drag from outside the app — the upload target's cue.
 *
 * Internal row drags are excluded explicitly: they also travel on the
 * DataTransfer, and lighting up the upload zone while the user is only moving
 * a PDF between folders suggests the wrong drop is about to happen.
 */
export function isExternalFileDrag(dataTransfer: DataTransfer): boolean {
  if (hasInternalLibraryDrag(dataTransfer)) return false;
  return isFileDrag(dataTransfer);
}

export function setLibraryDragPayload(
  dataTransfer: DataTransfer,
  payload: LibraryDragPayload,
): void {
  dataTransfer.effectAllowed = 'move';
  switch (payload.kind) {
    case 'collection':
      dataTransfer.setData(COLLECTION_DRAG_MIME, JSON.stringify({ version: 1, id: payload.id, ...(payload.etag ? { etag: payload.etag } : {}) }));
      return;
    case 'resource':
      dataTransfer.setData(RESOURCE_DRAG_MIME, JSON.stringify({ version: 1, id: payload.id }));
      return;
    case 'document':
      dataTransfer.setData(DOCUMENT_DRAG_MIME, JSON.stringify({ version: 1, id: payload.id, placementEtag: payload.placementEtag }));
  }
}

function readJson(dataTransfer: DataTransfer, mime: string): Record<string, unknown> | null {
  if (!typesOf(dataTransfer).includes(mime)) return null;
  try {
    const value: unknown = JSON.parse(dataTransfer.getData(mime));
    if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The one payload of a drop, or null when it carries none, or more than one. */
export function readLibraryDragPayload(dataTransfer: DataTransfer): LibraryDragPayload | null {
  const collection = readJson(dataTransfer, COLLECTION_DRAG_MIME);
  const resource = readJson(dataTransfer, RESOURCE_DRAG_MIME);
  const document = readJson(dataTransfer, DOCUMENT_DRAG_MIME);
  if ([collection, resource, document].filter(Boolean).length !== 1) return null;
  if (collection) {
    const id = positiveId(collection.id);
    if (id === null) return null;
    return typeof collection.etag === 'string' ? { kind: 'collection', id, etag: collection.etag } : { kind: 'collection', id };
  }
  if (resource) {
    const id = positiveId(resource.id);
    return id === null ? null : { kind: 'resource', id };
  }
  const page = document as Record<string, unknown>;
  if (typeof page.id !== 'string' || !page.id || typeof page.placementEtag !== 'string') return null;
  return { kind: 'document', id: page.id, placementEtag: page.placementEtag };
}
