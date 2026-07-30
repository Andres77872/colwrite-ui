import { isFileDrag } from '@/lib/fileDrop';

export const COLLECTION_DRAG_MIME = 'application/x-colwrite-collection+json';
export const RESOURCE_DRAG_MIME = 'application/x-colwrite-resource+json';

export type LibraryDragPayload =
  | { kind: 'collection'; id: number }
  | { kind: 'resource'; id: number };

function typesOf(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.types ?? []);
}

export function hasInternalLibraryDrag(dataTransfer: DataTransfer): boolean {
  const types = typesOf(dataTransfer);
  return types.includes(COLLECTION_DRAG_MIME) || types.includes(RESOURCE_DRAG_MIME);
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
  const mime = payload.kind === 'collection' ? COLLECTION_DRAG_MIME : RESOURCE_DRAG_MIME;
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(mime, JSON.stringify({ version: 1, id: payload.id }));
}

function readId(dataTransfer: DataTransfer, mime: string): number | null {
  if (!typesOf(dataTransfer).includes(mime)) return null;
  try {
    const value: unknown = JSON.parse(dataTransfer.getData(mime));
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('id' in value) ||
      typeof value.id !== 'number' ||
      !Number.isSafeInteger(value.id) ||
      value.id <= 0
    ) {
      return null;
    }
    return value.id;
  } catch {
    return null;
  }
}

export function readLibraryDragPayload(dataTransfer: DataTransfer): LibraryDragPayload | null {
  const collectionId = readId(dataTransfer, COLLECTION_DRAG_MIME);
  const resourceId = readId(dataTransfer, RESOURCE_DRAG_MIME);
  if ((collectionId === null) === (resourceId === null)) return null;
  return collectionId === null
    ? { kind: 'resource', id: resourceId as number }
    : { kind: 'collection', id: collectionId };
}
