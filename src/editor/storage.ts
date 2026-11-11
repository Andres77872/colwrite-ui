import type { Doc } from './types';

/**
 * Local draft cache.
 *
 * The body and the document id used to live in two independent, unkeyed slots
 * written by two separate effects. Any disagreement between them — a crash
 * mid-switch, two tabs on different documents, a second account signing in —
 * left one document's text cached under another's id, and the next boot would
 * happily save it there. Records are now keyed by document id and carry that
 * id inside them, so a mismatch is detectable instead of silent.
 */

const RECORD_PREFIX = 'colwrite:doc:';
const POINTER_KEY = 'colwrite:lastDocId';

/** Retained so drafts cached by older builds are not orphaned on upgrade. */
export const STORAGE_KEY = 'colwrite:doc';
export const ID_STORAGE_KEY = 'colwrite:docId';

/** Storage key for a document id, or for the not-yet-saved local draft. */
function recordKey(documentId: string | null): string {
  return `${RECORD_PREFIX}${documentId ?? 'local'}`;
}

export type CachedDoc = {
  documentId: string | null;
  doc: Doc;
};

function isDoc(value: unknown): value is Doc {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { blocks?: unknown }).blocks)
  );
}

export function loadDocumentId(): string | null {
  try {
    return localStorage.getItem(POINTER_KEY) || localStorage.getItem(ID_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function saveDocumentId(id: string | null): void {
  try {
    if (id) localStorage.setItem(POINTER_KEY, id);
    else localStorage.removeItem(POINTER_KEY);
    // The legacy slot is cleared, never written — nothing reads it except this
    // module's own migration path.
    localStorage.removeItem(ID_STORAGE_KEY);
  } catch { /* storage unavailable — fall through */ }
}

/**
 * Read the cached draft for *documentId*.
 *
 * Returns null when nothing is cached for that id, so a stale body can never
 * be adopted under the wrong document.
 */
export function loadDoc(documentId: string | null = loadDocumentId()): Doc | null {
  try {
    const raw = localStorage.getItem(recordKey(documentId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CachedDoc>;
      if (isDoc(parsed?.doc) && (parsed.documentId ?? null) === documentId) {
        return parsed.doc;
      }
      return null;
    }

    // Migration: a draft in the old single-slot format is only safe to adopt
    // if its id slot still agrees with the id being asked for.
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (!legacy) return null;
    const legacyId = localStorage.getItem(ID_STORAGE_KEY) || localStorage.getItem(POINTER_KEY);
    if ((legacyId || null) !== documentId) return null;
    const parsed = JSON.parse(legacy);
    return isDoc(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDoc(doc: Doc, documentId: string | null = loadDocumentId()): void {
  try {
    const record: CachedDoc = { documentId, doc };
    localStorage.setItem(recordKey(documentId), JSON.stringify(record));
    // Once a keyed record exists, the legacy slot would only be a second,
    // diverging copy of the same document.
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable — fall through */ }
}

const UNSAVED_PREFIX = 'colwrite:unsaved:';

/** Edits of a document that never reached the server, kept on this device. */
export type UnsavedDraft = {
  documentId: string;
  doc: Doc;
  /** When the copy was taken (ms since the epoch). */
  savedAt: number;
};

/**
 * Keep the body of a document whose save failed.
 *
 * The keyed draft record above is not enough for this: it follows the editor
 * state, so the next load of the document from the server overwrites it and
 * the edits the server never received are gone. This record is written only
 * when unsaved work is about to leave the screen, and stays until the author
 * takes it back or discards it.
 */
export function saveUnsavedDraft(documentId: string, doc: Doc, savedAt: number = Date.now()): void {
  try {
    const record: UnsavedDraft = { documentId, doc, savedAt };
    localStorage.setItem(`${UNSAVED_PREFIX}${documentId}`, JSON.stringify(record));
  } catch { /* storage unavailable or full — nothing more can be done here */ }
}

export function loadUnsavedDraft(documentId: string): UnsavedDraft | null {
  try {
    const raw = localStorage.getItem(`${UNSAVED_PREFIX}${documentId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UnsavedDraft>;
    if (parsed?.documentId !== documentId || !isDoc(parsed.doc)) return null;
    return {
      documentId,
      doc: parsed.doc,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearUnsavedDraft(documentId: string): void {
  try {
    localStorage.removeItem(`${UNSAVED_PREFIX}${documentId}`);
  } catch { /* storage unavailable — fall through */ }
}

/**
 * Everything this browser keeps about a document: its draft, edits that never
 * saved, and review decisions (`reviewDecisions.ts`, which holds no text but
 * names documents and change sets).
 */
const OWN_PREFIXES = [RECORD_PREFIX, UNSAVED_PREFIX, 'colwrite:review:'];

/** Drop every cached draft. Used on sign-out so drafts do not cross accounts. */
export function clearCachedDocs(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && OWN_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    for (const key of [...doomed, STORAGE_KEY, ID_STORAGE_KEY, POINTER_KEY]) {
      localStorage.removeItem(key);
    }
  } catch { /* storage unavailable — fall through */ }
}
