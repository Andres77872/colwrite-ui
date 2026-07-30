import { buildUrl, del, get, post, put } from './api';

/** Where a PDF is in the upload-to-readable-text pipeline. */
export type ExtractionStatus = 'pending' | 'running' | 'ready' | 'failed' | 'unsupported';

export type ResourceItem = {
  id: number;
  filename: string;
  title: string | null;
  content_type: string;
  byte_size: number;
  checksum_sha256: string;
  extraction_status: ExtractionStatus;
  extraction_provider: string | null;
  extraction_chars: number | null;
  extraction_pages: number | null;
  extraction_error: string | null;
  extracted_at: string | null;
  document_id: string | null;
  document_name: string | null;
  collection_id: number | null;
  collection_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** True when the assistant can actually read this resource. */
export function isReadable(resource: ResourceItem): boolean {
  return resource.extraction_status === 'ready';
}

/** True while the text is still on its way and the row is worth re-polling. */
export function isSettling(resource: ResourceItem): boolean {
  return resource.extraction_status === 'pending' || resource.extraction_status === 'running';
}

/** All scopes accepted by the current resource list and search endpoints. */
export type ResourceScope =
  | 'library'
  | 'document'
  | 'context'
  | 'collection'
  | 'collection_recursive'
  | 'unfiled';

export type SmartResourceScope = Extract<ResourceScope, 'library' | 'document' | 'context'>;
export type CollectionResourceScope = Extract<ResourceScope, 'collection' | 'collection_recursive'>;

/**
 * A library location is deliberately more specific than a bare API scope.
 * Document views carry their document, folder views carry their folder, and
 * Unfiled cannot accidentally inherit either identifier.
 */
export type ResourceLibraryLocation =
  | { kind: 'smart'; scope: 'library'; documentId?: null }
  | { kind: 'smart'; scope: 'document' | 'context'; documentId: string }
  | { kind: 'collection'; collectionId: number; recursive?: boolean }
  | { kind: 'unfiled' };

export type ResourceScopeOptions = {
  scope: ResourceScope;
  documentId?: string | null;
  collectionId?: number | null;
};

/** Serialize a discriminated UI location into the API's scope parameters. */
export function resourceScopeOptions(location: ResourceLibraryLocation): ResourceScopeOptions {
  switch (location.kind) {
    case 'smart':
      return { scope: location.scope, documentId: location.documentId ?? null };
    case 'collection':
      return {
        scope: location.recursive ? 'collection_recursive' : 'collection',
        collectionId: location.collectionId,
      };
    case 'unfiled':
      return { scope: 'unfiled' };
  }
}

/** Stable key for request-generation and cache boundaries. */
export function resourceLocationKey(location: ResourceLibraryLocation): string {
  const options = resourceScopeOptions(location);
  return [options.scope, options.documentId ?? '', options.collectionId ?? ''].join(':');
}

export type ResourceListResponse = {
  resources: ResourceItem[];
  /** Number returned in this page, not a total across all pages. */
  count: number;
  scope: ResourceScope;
  limit: number;
  offset: number;
};

export type ResourceSearchMatch = {
  resource_id: number;
  filename: string;
  title: string | null;
  offset: number;
  excerpt: string;
};

export type ResourceSearchSkipped = {
  resource_id: number;
  filename: string;
  extraction_status: ExtractionStatus | null;
};

export type ResourceSearchResponse = {
  query: string;
  scope: ResourceScope;
  matches: ResourceSearchMatch[];
  match_count: number;
  resources_searched: number;
  resources_skipped: ResourceSearchSkipped[];
  truncated: boolean;
  next_offset: number | null;
};

export type ResourceReadResponse = {
  resource: ResourceItem;
  text: string;
  offset: number;
  returned_chars: number;
  total_chars: number;
  next_offset: number | null;
  truncated: boolean;
};

export type ResourceAttachmentTarget = {
  documentId?: string | null;
  collectionId?: number | null;
};

export type CollectionAttachmentState = {
  collection_id: number;
  /** The document has an edge to this exact folder. */
  direct: boolean;
  /** The document can use this folder through this edge or an ancestor edge. */
  effective: boolean;
  nearest_direct_collection_id: number | null;
  nearest_direct_collection_name: string | null;
};

export type CollectionItem = {
  id: number;
  name: string;
  description: string | null;
  /** Direct document memberships on this folder. */
  document_count: number;
  /** Resources filed directly in this folder. */
  resource_count: number;
  parent_id: number | null;
  /** One-based depth. Legacy list rows can report null. */
  depth: number | null;
  child_count: number;
  descendant_count: number;
  subtree_document_count: number;
  subtree_resource_count: number;
  attachment: CollectionAttachmentState | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CollectionBreadcrumbItem = {
  id: number;
  parent_id: number | null;
  name: string;
  depth: number;
};

export type CollectionDocumentItem = {
  document_id: string;
  name: string;
  version: number;
  created_at: string | null;
  updated_at: string | null;
  added_at: string | null;
};

export type CollectionListResponse = {
  collections: CollectionItem[];
  /** Number returned in this page, not a total across all pages. */
  count: number;
  limit: number;
  offset: number;
};

export type CollectionTreeResponse = {
  collections: CollectionItem[];
  /** Number returned in this page. */
  count: number;
  parent_id: number | null;
  limit: number;
  offset: number;
  next_offset: number | null;
};

export type CollectionPathResponse = {
  collection_id: number;
  path: CollectionBreadcrumbItem[];
};

export type CollectionDetailResponse = {
  collection: CollectionItem;
  path: CollectionBreadcrumbItem[];
  attachment: CollectionAttachmentState | null;
};

export type CollectionDeletePreview = {
  collection_id: number;
  status: string;
  collection_count: number;
  membership_count: number;
  resource_count: number;
  resource_bytes: number;
};

export type CollectionDeletePreviewResponse = {
  preview: CollectionDeletePreview;
};

export type CollectionRecursiveDeleteResponse = {
  status: string;
  message: string;
  collection_count: number;
  membership_count: number;
  resource_count: number;
  resource_bytes: number;
  cleanup_pending_count: number;
};

export type CollectionDocumentsResponse = {
  collection: CollectionItem;
  documents: CollectionDocumentItem[];
  /** Number returned in this page, not a total across all pages. */
  count: number;
  limit: number;
  offset: number;
};

export type CollectionMembershipResponse = {
  status: string;
  message: string;
  attachment: CollectionAttachmentState | null;
};

type ResourceEnvelope = { resource: ResourceItem; status: string; message: string };
type CollectionEnvelope = { collection: CollectionItem; status: string; message: string };
type CollectionMoveEnvelope = { collection: CollectionItem; status: string; message: string };

/** MySQL/Pydantic ceiling for a collection folder name. */
export const MAX_COLLECTION_NAME = 191;
/** MySQL/Pydantic ceiling for a collection folder description. */
export const MAX_COLLECTION_DESCRIPTION = 1_000;
/** Server-side ceiling for a resource-search query. */
export const MAX_SEARCH_QUERY_CHARS = 200;
/** Server-side ceiling for one `readResourceMarkdown` window. */
export const MAX_READ_CHARS = 120_000;
/** Server-side ceiling for `searchResources`. */
export const MAX_SEARCH_MATCHES = 40;

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export type ListResourcesOptions = Partial<ResourceScopeOptions> & {
  limit?: number;
  offset?: number;
};

export async function listResources(
  options: ListResourcesOptions = {},
): Promise<ResourceListResponse> {
  const {
    scope = 'library',
    documentId,
    collectionId,
    limit = 20,
    offset = 0,
  } = options;
  return get<ResourceListResponse>(
    `/users/me/resources${query({
      scope,
      document_id: documentId,
      collection_id: collectionId,
      limit,
      offset,
    })}`,
  );
}

/** Store a PDF in a document, in an exact folder, or in Unfiled. */
export async function uploadResource(
  file: File,
  options: ResourceAttachmentTarget = {},
): Promise<ResourceItem> {
  const form = new FormData();
  form.append('file', file);
  if (options.documentId) form.append('document_id', options.documentId);
  else if (options.collectionId != null) form.append('collection_id', String(options.collectionId));
  const response = await post<ResourceEnvelope>('/users/me/resources', form);
  return response.resource;
}

export async function getResource(resourceId: number): Promise<ResourceItem> {
  const response = await get<ResourceEnvelope>(`/users/me/resources/${resourceId}`);
  return response.resource;
}

export type SearchResourcesOptions = Partial<ResourceScopeOptions> & {
  query: string;
  resourceId?: number | null;
  maxMatches?: number;
  offset?: number;
};

export async function searchResources(
  options: SearchResourcesOptions,
): Promise<ResourceSearchResponse> {
  const {
    scope = 'library',
    documentId,
    collectionId,
    resourceId,
    maxMatches = 12,
    offset = 0,
  } = options;
  return get<ResourceSearchResponse>(
    `/users/me/resources/search${query({
      query: options.query,
      scope,
      document_id: documentId,
      collection_id: collectionId,
      resource_id: resourceId,
      max_matches: Math.min(maxMatches, MAX_SEARCH_MATCHES),
      offset,
    })}`,
  );
}

export async function readResourceMarkdown(
  resourceId: number,
  options: { offset?: number; limit?: number } = {},
): Promise<ResourceReadResponse> {
  const { offset = 0, limit = 20_000 } = options;
  return get<ResourceReadResponse>(
    `/users/me/resources/${resourceId}/markdown${query({
      offset,
      limit: Math.min(limit, MAX_READ_CHARS),
    })}`,
  );
}

export async function extractResource(
  resourceId: number,
  options: { force?: boolean } = {},
): Promise<ResourceItem> {
  const response = await post<ResourceEnvelope>(
    `/users/me/resources/${resourceId}/extract${query({ force: options.force || null })}`,
  );
  return response.resource;
}

/** Move a resource to a document, to an exact folder, or to Unfiled. */
export async function attachResource(
  resourceId: number,
  target: ResourceAttachmentTarget = {},
): Promise<ResourceItem> {
  const response = await put<ResourceEnvelope>(`/users/me/resources/${resourceId}/attachment`, {
    document_id: target.documentId ?? null,
    collection_id: target.documentId ? null : (target.collectionId ?? null),
  });
  return response.resource;
}

export async function deleteResource(resourceId: number): Promise<void> {
  await del<{ status: string; message: string }>(`/users/me/resources/${resourceId}`);
}

/** Same-origin URL for a resource's original bytes. */
export function resourceContentUrl(resourceId: number): string {
  return buildUrl(`/users/me/resources/${resourceId}/content`);
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export async function listCollections(
  options: { limit?: number; offset?: number } = {},
): Promise<CollectionListResponse> {
  const { limit = 50, offset = 0 } = options;
  return get<CollectionListResponse>(`/users/me/collections${query({ limit, offset })}`);
}

/** List root folders or one folder's immediate children. */
export async function listCollectionTree(
  options: {
    parentId?: number | null;
    documentId?: string | null;
    limit?: number;
    offset?: number;
  } = {},
): Promise<CollectionTreeResponse> {
  const { parentId, documentId, limit = 100, offset = 0 } = options;
  return get<CollectionTreeResponse>(
    `/users/me/collections/tree${query({
      parent_id: parentId,
      document_id: documentId,
      limit,
      offset,
    })}`,
  );
}

export async function createCollection(
  name: string,
  description?: string | null,
  parentId?: number | null,
): Promise<CollectionItem> {
  const response = await post<CollectionEnvelope>('/users/me/collections', {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(parentId !== undefined ? { parent_id: parentId } : {}),
  });
  return response.collection;
}

/** Use the explicit child route when the parent is already known. */
export async function createChildCollection(
  parentId: number,
  name: string,
  description?: string | null,
): Promise<CollectionItem> {
  const response = await post<CollectionEnvelope>(`/users/me/collections/${parentId}/children`, {
    name,
    ...(description !== undefined ? { description } : {}),
  });
  return response.collection;
}

export async function getCollection(collectionId: number): Promise<CollectionItem> {
  const response = await get<CollectionEnvelope>(`/users/me/collections/${collectionId}`);
  return response.collection;
}

export async function getCollectionDetail(
  collectionId: number,
  options: { documentId?: string | null } = {},
): Promise<CollectionDetailResponse> {
  return get<CollectionDetailResponse>(
    `/users/me/collections/${collectionId}/detail${query({ document_id: options.documentId })}`,
  );
}

export async function getCollectionPath(collectionId: number): Promise<CollectionPathResponse> {
  return get<CollectionPathResponse>(`/users/me/collections/${collectionId}/path`);
}

export async function updateCollection(
  collectionId: number,
  changes: { name?: string; description?: string | null },
): Promise<CollectionItem> {
  const response = await put<CollectionEnvelope>(
    `/users/me/collections/${collectionId}`,
    changes,
  );
  return response.collection;
}

export async function moveCollectionParent(
  collectionId: number,
  parentId: number | null,
): Promise<CollectionItem> {
  const response = await put<CollectionMoveEnvelope>(
    `/users/me/collections/${collectionId}/parent`,
    { parent_id: parentId },
  );
  return response.collection;
}

export async function previewCollectionDelete(
  collectionId: number,
): Promise<CollectionDeletePreview> {
  const response = await get<CollectionDeletePreviewResponse>(
    `/users/me/collections/${collectionId}/delete-preview`,
  );
  return response.preview;
}

export async function deleteCollectionRecursive(
  collectionId: number,
  expected: CollectionDeletePreview,
): Promise<CollectionRecursiveDeleteResponse> {
  return del<CollectionRecursiveDeleteResponse>(
    `/users/me/collections/${collectionId}/recursive${query({
      expected_collection_count: expected.collection_count,
      expected_membership_count: expected.membership_count,
      expected_resource_count: expected.resource_count,
      expected_resource_bytes: expected.resource_bytes,
    })}`,
  );
}

/** Compatibility helper that still uses the server's atomic preview guard. */
export async function deleteCollection(collectionId: number): Promise<void> {
  const expected = await previewCollectionDelete(collectionId);
  await deleteCollectionRecursive(collectionId, expected);
}

export async function listCollectionDocuments(
  collectionId: number,
  options: { limit?: number; offset?: number } = {},
): Promise<CollectionDocumentsResponse> {
  const { limit = 50, offset = 0 } = options;
  return get<CollectionDocumentsResponse>(
    `/users/me/collections/${collectionId}/documents${query({ limit, offset })}`,
  );
}

/** Directly attach a document to this exact folder. Descendants inherit access. */
export async function attachCollectionDocument(
  collectionId: number,
  documentId: string,
): Promise<CollectionAttachmentState | null> {
  const response = await put<CollectionMembershipResponse>(
    `/users/me/collections/${collectionId}/documents/${encodeURIComponent(documentId)}`,
  );
  return response.attachment;
}

/** Remove only this exact folder's direct edge; an ancestor can keep it effective. */
export async function detachCollectionDocument(
  collectionId: number,
  documentId: string,
): Promise<CollectionAttachmentState | null> {
  const response = await del<CollectionMembershipResponse>(
    `/users/me/collections/${collectionId}/documents/${encodeURIComponent(documentId)}`,
  );
  return response.attachment;
}

/** Compatibility alias for the former body-based client. */
export const addCollectionDocument = attachCollectionDocument;
/** Compatibility alias for the former remove client. */
export const removeCollectionDocument = detachCollectionDocument;
