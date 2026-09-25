import type { DocumentSummary } from '@/services';

/**
 * The last "updated at" the document lists reported, by document id.
 *
 * The editor only learns an edit time once it saves in this session, so the
 * page menu's footer had no "Edited Sep 20" line on a freshly opened page.
 * The sidebar list and the palette already fetch that time for every row;
 * they note it here and the footer falls back to it.
 */
const updatedAtById = new Map<string, string>();

export function rememberDocumentSummaries(documents: readonly DocumentSummary[]) {
  for (const doc of documents) {
    if (doc.id && doc.updatedAt) updatedAtById.set(doc.id, doc.updatedAt);
  }
}

export function knownUpdatedAt(documentId: string | null | undefined): string | null {
  return documentId ? (updatedAtById.get(documentId) ?? null) : null;
}
