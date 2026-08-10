import { get, getWithHeaders, postWithHeaders } from './api';
import type { Doc, ToolOperation } from '../editor/types';
import { documentTransforms } from './documents';
import { isUnknownRecord, problemCode } from './contracts';

/**
 * Document history — the v2 revision timeline.
 *
 * Every accepted save produces one immutable, independently restorable
 * snapshot on the server. These calls read that timeline and restore from it.
 * Unlike the legacy `/document/*` endpoints, the v2 surface is optimistically
 * locked with a strong `ETag` response header that writes must echo back as
 * `If-Match`, and every write requires an `Idempotency-Key`.
 */

/** Revision kinds the backend writes today; unknown values pass through. */
export type RevisionKind =
  | 'create'
  | 'save'
  | 'semantic_edit'
  | 'restore'
  | 'delete'
  | 'migration'
  | 'history_backfill';

export type RevisionOrigin =
  | 'human'
  | 'agent'
  | 'import'
  | 'migration'
  | 'restore'
  | 'history_backfill';

/** One timeline entry — metadata only, never the snapshot body. */
export interface RevisionSummary {
  revisionId: string;
  revisionNo: number;
  parentRevisionId: string | null;
  kind: RevisionKind | (string & {});
  actorType: string;
  origin: RevisionOrigin | (string & {});
  createdAt: string;
  byteSize: number;
  contentHash: string;
  restoredFromRevisionId: string | null;
  summary: string | null;
}

export interface RevisionPage {
  revisions: RevisionSummary[];
  nextCursor: string | null;
}

/** A full revision: timeline metadata plus the stored snapshot. */
export interface RevisionDetail extends RevisionSummary {
  content: Doc;
}

/** Current server state of a document on the v2 surface. */
export interface DocumentHead {
  documentId: string;
  headSeq: number;
  revisionNo: number;
  /** Newest revision ever created (the top of the timeline). */
  revisionId: string;
  /**
   * The tree node the working document sits on. After a restore this points
   * at the restored revision — not the newest one — and the next save
   * branches from it.
   */
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  content: Doc;
  /** Strong validator for `If-Match`; null only if the server omits it. */
  etag: string | null;
}

export interface RevisionChange {
  entity: 'block' | 'child';
  change: 'inserted' | 'deleted' | 'moved' | 'changed';
  entityId: string;
  entityType: string;
  parentId: string | null;
  previousParentId: string | null;
  fromIndex: number | null;
  toIndex: number | null;
  fields: string[];
}

export interface RevisionDiff {
  baseRevisionId: string;
  /** Set when diffing against another revision. */
  targetRevisionId: string | null;
  /** Set when diffing against the current document head. */
  targetHeadSeq: number | null;
  changes: RevisionChange[];
}

/** Machine-readable code from a v2 `application/problem+json` error body. */
export function historyErrorCode(error: unknown): string | null {
  return problemCode(error);
}

export function isStaleHead(error: unknown): boolean {
  return historyErrorCode(error) === 'stale_head';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberField(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeRevisionSummary(value: unknown): RevisionSummary | null {
  if (!isUnknownRecord(value)) return null;
  if (typeof value.revision_id !== 'string' || !value.revision_id) return null;
  return {
    revisionId: value.revision_id,
    revisionNo: numberField(value.revision_no),
    parentRevisionId: stringOrNull(value.parent_revision_id),
    kind: typeof value.kind === 'string' ? value.kind : 'save',
    actorType: typeof value.actor_type === 'string' ? value.actor_type : 'human',
    origin: typeof value.origin === 'string' ? value.origin : 'human',
    createdAt: typeof value.created_at === 'string' ? value.created_at : '',
    byteSize: numberField(value.byte_size),
    contentHash: typeof value.content_hash === 'string' ? value.content_hash : '',
    restoredFromRevisionId: stringOrNull(value.restored_from_revision_id),
    summary: stringOrNull(value.summary),
  };
}

/**
 * The v2 snapshot is the canonical `{schema_version, name, tags, blocks}`
 * shape, which is a superset of the editor's `Doc` — the shared block
 * normalizer both sanitizes it and drops fields the editor cannot render.
 */
function normalizeSnapshot(value: unknown): Doc {
  return documentTransforms.toEditorDoc(value);
}

function normalizeHead(payload: unknown, etag: string | null): DocumentHead {
  if (!isUnknownRecord(payload) || typeof payload.document_id !== 'string') {
    throw new Error('The server returned an invalid document state.');
  }
  const revisionId = typeof payload.revision_id === 'string' ? payload.revision_id : '';
  return {
    documentId: payload.document_id,
    headSeq: numberField(payload.head_seq),
    revisionNo: numberField(payload.revision_no),
    revisionId,
    currentRevisionId:
      typeof payload.current_revision_id === 'string' && payload.current_revision_id
        ? payload.current_revision_id
        : revisionId,
    createdAt: typeof payload.created_at === 'string' ? payload.created_at : '',
    updatedAt: typeof payload.updated_at === 'string' ? payload.updated_at : '',
    deletedAt: stringOrNull(payload.deleted_at),
    content: normalizeSnapshot(payload.content),
    etag,
  };
}

function normalizeChange(value: unknown): RevisionChange | null {
  if (!isUnknownRecord(value)) return null;
  const entity = value.entity === 'child' ? 'child' : 'block';
  const change = value.change;
  if (
    change !== 'inserted'
    && change !== 'deleted'
    && change !== 'moved'
    && change !== 'changed'
  ) {
    return null;
  }
  if (typeof value.entity_id !== 'string') return null;
  return {
    entity,
    change,
    entityId: value.entity_id,
    entityType: typeof value.entity_type === 'string' ? value.entity_type : '',
    parentId: stringOrNull(value.parent_id),
    previousParentId: stringOrNull(value.previous_parent_id),
    fromIndex: typeof value.from_index === 'number' ? value.from_index : null,
    toIndex: typeof value.to_index === 'number' ? value.to_index : null,
    fields: Array.isArray(value.fields)
      ? value.fields.filter((field): field is string => typeof field === 'string')
      : [],
  };
}

function encodeId(value: string): string {
  return encodeURIComponent(value);
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Current head state plus the ETag later writes must present. */
export async function fetchDocumentHead(
  documentId: string,
  init?: { signal?: AbortSignal },
): Promise<DocumentHead> {
  const { data, headers } = await getWithHeaders<unknown>(
    `/v2/documents/${encodeId(documentId)}`,
    init,
  );
  return normalizeHead(data, headers.get('ETag'));
}

export interface ListRevisionsOptions {
  limit?: number;
  cursor?: string | null;
  signal?: AbortSignal;
}

/** One page of the timeline, newest first. */
export async function listRevisions(
  documentId: string,
  options: ListRevisionsOptions = {},
): Promise<RevisionPage> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  const payload = await get<unknown>(
    `/v2/documents/${encodeId(documentId)}/revisions${query}`,
    { signal: options.signal },
  );
  if (!isUnknownRecord(payload) || !Array.isArray(payload.revisions)) {
    throw new Error('The server returned an invalid revision list.');
  }
  return {
    revisions: payload.revisions
      .map(normalizeRevisionSummary)
      .filter((revision): revision is RevisionSummary => revision !== null),
    nextCursor: stringOrNull(payload.next_cursor),
  };
}

export async function getRevision(
  documentId: string,
  revisionId: string,
  init?: { signal?: AbortSignal },
): Promise<RevisionDetail> {
  const payload = await get<unknown>(
    `/v2/documents/${encodeId(documentId)}/revisions/${encodeId(revisionId)}`,
    init,
  );
  const metadata = normalizeRevisionSummary(payload);
  if (!metadata || !isUnknownRecord(payload)) {
    throw new Error('The server returned an invalid revision.');
  }
  return { ...metadata, content: normalizeSnapshot(payload.content) };
}

/**
 * Structural changes between a revision and `against` — another revision id,
 * or `'current'` for the live document head.
 */
export async function diffRevision(
  documentId: string,
  revisionId: string,
  against: string = 'current',
  init?: { signal?: AbortSignal },
): Promise<RevisionDiff> {
  const payload = await get<unknown>(
    `/v2/documents/${encodeId(documentId)}/revisions/${encodeId(revisionId)}/diff`
      + `?against=${encodeURIComponent(against)}`,
    init,
  );
  if (!isUnknownRecord(payload)) {
    throw new Error('The server returned an invalid revision diff.');
  }
  const diff = isUnknownRecord(payload.diff) ? payload.diff : {};
  return {
    baseRevisionId: typeof payload.base_revision_id === 'string' ? payload.base_revision_id : revisionId,
    targetRevisionId: stringOrNull(payload.target_revision_id),
    targetHeadSeq: typeof payload.target_head_seq === 'number' ? payload.target_head_seq : null,
    changes: Array.isArray(diff.changes)
      ? diff.changes
          .map(normalizeChange)
          .filter((change): change is RevisionChange => change !== null)
      : [],
  };
}

export interface RestoreRevisionOptions {
  /**
   * Strong ETag to present as `If-Match`. When omitted the current head is
   * fetched first — the freshest token the client can hold, so a 412 after
   * that is a genuine concurrent write, not staleness of the panel.
   */
  etag?: string;
  /**
   * Note recorded on the restore's audit event (max 500 chars server-side).
   * A restore writes no revision, so this never appears in the timeline.
   */
  summary?: string;
}

/* ----------------------------------------
   Agent change sets (durable review workflow)
   ---------------------------------------- */

/**
 * A durable agent proposal. `doc_edit` never moves the document head — it
 * stores one of these, and the stream only carries its id. The operations
 * here are the authoritative, server-normalized batch, and accepting or
 * rejecting is a server decision recorded on this object.
 */
export interface AgentChangeSet {
  changeSetId: string;
  documentId: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'conflicting' | (string & {});
  operations: ToolOperation[];
  /**
   * Names of stored operations with no editor mapping (`move_block`, future
   * operations, malformed entries). A non-empty list means the review flow
   * must refuse to stage the set: deciding the mappable subset would retire
   * the whole server record and silently lose these. A server-side accept
   * still applies them faithfully.
   */
  unmappableOperations: string[];
  baseHeadSeq: number;
  baseEtag: string;
  toolCallId: string | null;
  summary: string | null;
  expiresAt: string | null;
}

/** Map one stored snake_case operation dict onto the editor's ToolOperation. */
function normalizeChangeSetOperation(value: unknown): ToolOperation | null {
  if (!isUnknownRecord(value) || typeof value.op !== 'string') return null;
  const blockId = typeof value.block_id === 'string' ? value.block_id : null;
  const referenceId = typeof value.reference_id === 'string' ? value.reference_id : null;
  const block = isUnknownRecord(value.block) ? value.block : null;
  switch (value.op) {
    case 'replace_block':
      return blockId && block ? { op: 'replace_block', blockId, block } : null;
    case 'insert_block_after':
      return referenceId && block
        ? { op: 'insert_block_after', referenceId, block }
        : null;
    case 'insert_block_before':
      return referenceId && block
        ? { op: 'insert_block_before', referenceId, block }
        : null;
    case 'insert_block_at_start':
      return block ? { op: 'insert_block_at_start', block } : null;
    case 'append_block':
      return block ? { op: 'append_block', block } : null;
    case 'delete_block':
      return blockId ? { op: 'delete_block', blockId } : null;
    case 'reorder_block':
      return blockId && typeof value.to_index === 'number'
        ? { op: 'reorder_block', blockId, toIndex: value.to_index }
        : null;
    case 'update_meta':
      return isUnknownRecord(value.meta)
        ? { op: 'update_meta', meta: value.meta as { name?: string } }
        : null;
    default:
      // move_block and future server operations have no editor mapping yet;
      // the server-side accept still applies them faithfully.
      return null;
  }
}

function normalizeChangeSet(payload: unknown): AgentChangeSet {
  if (!isUnknownRecord(payload) || typeof payload.change_set_id !== 'string') {
    throw new Error('The server returned an invalid change set.');
  }
  const operations: ToolOperation[] = [];
  const unmappableOperations: string[] = [];
  if (Array.isArray(payload.operations)) {
    for (const value of payload.operations) {
      const operation = normalizeChangeSetOperation(value);
      if (operation) {
        operations.push(operation);
      } else {
        // Kept visible rather than dropped: the caller decides whether the
        // set is still reviewable (it is not — see `unmappableOperations`).
        unmappableOperations.push(
          isUnknownRecord(value) && typeof value.op === 'string' ? value.op : 'unknown',
        );
      }
    }
  }
  return {
    changeSetId: payload.change_set_id,
    documentId: typeof payload.document_id === 'string' ? payload.document_id : '',
    status: typeof payload.status === 'string' ? payload.status : 'pending',
    operations,
    unmappableOperations,
    baseHeadSeq: numberField(payload.base_head_seq),
    baseEtag: typeof payload.base_etag === 'string' ? payload.base_etag : '',
    toolCallId: stringOrNull(payload.tool_call_id),
    summary: stringOrNull(payload.summary),
    expiresAt: stringOrNull(payload.expires_at),
  };
}

/** The authoritative operations and status of one durable agent proposal. */
export async function getChangeSet(
  documentId: string,
  changeSetId: string,
  init?: { signal?: AbortSignal },
): Promise<AgentChangeSet> {
  const payload = await get<unknown>(
    `/v2/documents/${encodeId(documentId)}/change-sets/${encodeId(changeSetId)}`,
    init,
  );
  return normalizeChangeSet(payload);
}

/**
 * Accept the whole change set server-side. The server applies the stored
 * operations to the current head and returns the post-accept state, which the
 * caller must adopt. `If-Match` uses the freshest head ETag so a 412 is a
 * genuine concurrent write.
 */
export async function acceptChangeSet(
  documentId: string,
  changeSetId: string,
): Promise<{ changeSet: AgentChangeSet; head: DocumentHead }> {
  const current = await fetchDocumentHead(documentId);
  if (!current.etag) throw new Error('The server did not provide a concurrency token.');
  const { data, headers } = await postWithHeaders<unknown>(
    `/v2/documents/${encodeId(documentId)}/change-sets/${encodeId(changeSetId)}/accept`,
    undefined,
    {
      headers: {
        'If-Match': current.etag,
        'Idempotency-Key': newIdempotencyKey(),
      },
    },
  );
  if (!isUnknownRecord(data)) {
    throw new Error('The server returned an invalid acceptance.');
  }
  return {
    changeSet: normalizeChangeSet(data.change_set),
    head: normalizeHead(data.document, headers.get('ETag')),
  };
}

/** Reject the whole change set server-side; the document is untouched. */
export async function rejectChangeSet(
  documentId: string,
  changeSetId: string,
  reason?: string,
): Promise<AgentChangeSet> {
  const payload = await postWithHeaders<unknown>(
    `/v2/documents/${encodeId(documentId)}/change-sets/${encodeId(changeSetId)}/reject`,
    reason !== undefined ? { reason } : {},
  );
  return normalizeChangeSet(payload.data);
}

/** Pending durable proposals for a document, oldest first. */
export async function listPendingChangeSets(
  documentId: string,
  init?: { signal?: AbortSignal },
): Promise<AgentChangeSet[]> {
  const payload = await get<unknown>(
    `/v2/documents/${encodeId(documentId)}/change-sets?status=pending`,
    init,
  );
  if (!isUnknownRecord(payload) || !Array.isArray(payload.change_sets)) {
    throw new Error('The server returned an invalid change set list.');
  }
  return payload.change_sets
    .filter(isUnknownRecord)
    .map((entry) => normalizeChangeSet(entry));
}

/**
 * Restore moves the document's current-version pointer to an existing
 * revision — it does NOT create a revision. The head's working content
 * becomes the restored snapshot (with a fresh `headSeq`/ETag, since the
 * concurrency position stays monotonic), and the next save writes a revision
 * whose parent is the restored node, starting a new branch in the version
 * tree. The returned head is the post-restore state; the caller must adopt
 * it (or reload) so autosave doesn't fight the restore.
 */
export async function restoreRevision(
  documentId: string,
  revisionId: string,
  options: RestoreRevisionOptions = {},
): Promise<DocumentHead> {
  let etag = options.etag;
  if (!etag) {
    const head = await fetchDocumentHead(documentId);
    if (!head.etag) throw new Error('The server did not provide a concurrency token.');
    etag = head.etag;
  }
  const body = options.summary !== undefined ? { summary: options.summary } : undefined;
  const { data, headers } = await postWithHeaders<unknown>(
    `/v2/documents/${encodeId(documentId)}/revisions/${encodeId(revisionId)}/restore`,
    body,
    {
      headers: {
        'If-Match': etag,
        'Idempotency-Key': newIdempotencyKey(),
      },
    },
  );
  return normalizeHead(data, headers.get('ETag'));
}
