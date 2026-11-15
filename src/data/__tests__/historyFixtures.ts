import { toWireContent } from '@/api/content';
import type { DocumentStateResponse, RevisionListResponse, RevisionMetadataResponse } from '@/api/schema';
import type { DocumentHead, RevisionPage, RevisionSummary } from '../documentHistory';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

/** `GET /workspaces/{w}/documents/{id}` as the API sends it, for the head the client should read from it. */
export function documentStateBody(head: DocumentHead, headSeq = head.revisionNo, workspaceId = TEST_WORKSPACE_ID): DocumentStateResponse {
  return {
    document_id: head.documentId,
    workspace_id: workspaceId,
    collection_id: null,
    sort_key: 'V',
    placement_etag: '"cwp:1"',
    head_seq: headSeq,
    revision_no: head.revisionNo,
    revision_id: head.revisionId,
    current_revision_id: head.currentRevisionId,
    created_at: head.createdAt,
    updated_at: head.updatedAt,
    deleted_at: head.deletedAt,
    purge_after: null,
    trash_root: null,
    duplicate: false,
    content: toWireContent(head.content) as DocumentStateResponse['content'],
  };
}

/** One timeline entry as the API sends it. */
export function revisionBody(revision: RevisionSummary): RevisionMetadataResponse {
  return {
    revision_id: revision.revisionId,
    revision_no: revision.revisionNo,
    parent_revision_id: revision.parentRevisionId,
    kind: revision.kind,
    actor_type: revision.actorType,
    origin: revision.origin,
    created_at: revision.createdAt,
    byte_size: revision.byteSize,
    content_hash: revision.contentHash,
    restored_from_revision_id: revision.restoredFromRevisionId,
    summary: revision.summary,
    schema_version: 1,
    serializer_version: 'v1',
    through_seq: revision.revisionNo,
  };
}

/** `GET /workspaces/{w}/documents/{id}/revisions` as the API sends it. */
export function revisionPageBody(page: RevisionPage): Pick<RevisionListResponse, 'revisions' | 'next_cursor'> {
  return { revisions: page.revisions.map(revisionBody), next_cursor: page.nextCursor };
}
