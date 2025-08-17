import type { Doc } from './types';

export const STORAGE_KEY = 'colwrite:doc';
export const ID_STORAGE_KEY = 'colwrite:docId';

export function loadDoc(): Doc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.blocks)) return parsed as Doc;
  } catch {}
  return null;
}

export function saveDoc(doc: Doc): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {}
}

export function loadDocumentId(): string | null {
  try {
    const raw = localStorage.getItem(ID_STORAGE_KEY);
    if (!raw) return null;
    return raw || null;
  } catch {
    return null;
  }
}

export function saveDocumentId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ID_STORAGE_KEY, id);
    else localStorage.removeItem(ID_STORAGE_KEY);
  } catch {}
}
