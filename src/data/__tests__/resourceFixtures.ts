import type { ResourceExtraction } from '@/api/schema';
import type { CollectionDetail, CollectionItem, ResourceItem, ResourceLocation } from '../resources';

/** What a test sets on a PDF: any field, and only the parts of its extraction it is about. */
export type ResourceOverrides = Partial<Omit<ResourceItem, 'extraction'>> & { extraction?: Partial<ResourceExtraction> };

/**
 * A stored PDF with every field the server actually sends.
 *
 * Hand-built literals were how `UploadItem` drifted away from the wire shape
 * in the first place: a fixture that omits the extraction fields typechecks
 * against a type that also omits them, and neither is ever compared to the
 * API. Overrides carry what a test is about; the rest is realistic filler.
 */
export function makeResource(overrides: ResourceOverrides = {}): ResourceItem {
  const { extraction, ...rest } = overrides;
  return {
    id: 1,
    filename: 'reference.pdf',
    title: null,
    content_type: 'application/pdf',
    byte_size: 1_048_576,
    checksum_sha256: 'a'.repeat(64),
    extraction: {
      status: 'ready',
      provider: 'jina',
      chars: 42_000,
      pages: 12,
      error: null,
      extracted_at: '2026-07-18T12:00:05Z',
      ...extraction,
    },
    location: { kind: 'unfiled' },
    created_at: '2026-07-18T12:00:00Z',
    updated_at: '2026-07-18T12:00:00Z',
    ...rest,
  };
}

/** On a page. */
export const onPage = (documentId: string, documentName: string | null = null): ResourceLocation =>
  ({ kind: 'document', document_id: documentId, document_name: documentName });

/** In a collection. */
export const inCollection = (collectionId: number, collectionName: string | null = null): ResourceLocation =>
  ({ kind: 'collection', collection_id: collectionId, collection_name: collectionName });

export function makeCollection(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: 1,
    name: 'Sources',
    description: null,
    parent_id: null,
    child_collection_count: 0,
    page_count: 0,
    pdf_count: 0,
    grant_count: 0,
    grant_state: null,
    sort_key: 'V',
    sort_mode: 'name',
    grant_new_pages: false,
    etag: '"cwc:1"',
    created_at: '2026-07-18T12:00:00Z',
    updated_at: '2026-07-18T12:00:00Z',
    ...overrides,
  };
}

/** A collection's detail; its path ends at itself unless the test names one. */
export function makeCollectionDetail(overrides: Partial<CollectionDetail> = {}): CollectionDetail {
  const id = overrides.id ?? 1;
  const name = overrides.name ?? 'Sources';
  return {
    id,
    name,
    description: null,
    parent_id: null,
    depth: 1,
    child_collection_count: 0,
    descendant_collection_count: 0,
    page_count: 0,
    pdf_count: 0,
    subtree_pdf_count: 0,
    grant_count: 0,
    path: [{ id, name }],
    sort_key: 'V',
    sort_mode: 'name',
    grant_new_pages: false,
    etag: '"cwc:1"',
    tree_version: 1,
    created_at: '2026-07-18T12:00:00Z',
    updated_at: '2026-07-18T12:00:00Z',
    ...overrides,
  };
}
