import type { CollectionItem, ResourceItem } from '@/services/resources';

/**
 * A stored PDF with every field the server actually sends.
 *
 * Hand-built literals were how `UploadItem` drifted away from the wire shape
 * in the first place: a fixture that omits the extraction fields typechecks
 * against a type that also omits them, and neither is ever compared to the
 * API. Overrides carry what a test is about; the rest is realistic filler.
 */
export function makeResource(overrides: Partial<ResourceItem> = {}): ResourceItem {
  return {
    id: 1,
    filename: 'reference.pdf',
    title: null,
    content_type: 'application/pdf',
    byte_size: 1_048_576,
    checksum_sha256: 'a'.repeat(64),
    extraction_status: 'ready',
    extraction_provider: 'jina',
    extraction_chars: 42_000,
    extraction_pages: 12,
    extraction_error: null,
    extracted_at: '2026-07-18T12:00:05',
    document_id: null,
    document_name: null,
    collection_id: null,
    collection_name: null,
    created_at: '2026-07-18T12:00:00',
    updated_at: '2026-07-18T12:00:00',
    ...overrides,
  };
}

export function makeCollection(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: 1,
    name: 'Sources',
    description: null,
    document_count: 0,
    resource_count: 0,
    parent_id: null,
    depth: 1,
    child_count: 0,
    descendant_count: 0,
    subtree_document_count: 0,
    subtree_resource_count: 0,
    attachment: null,
    created_at: '2026-07-18T12:00:00',
    updated_at: '2026-07-18T12:00:00',
    ...overrides,
  };
}
