import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, unwrap, unwrapWithHeaders } from '@/api/client';
import { referenceRecordOf, toEditorDoc } from '@/api/content';
import { isCitationStyle } from '@/editor/csl/styles';
import { ApiError, problemBody, problemCode } from '@/api/errors';
import type {
  ChangeSetOperationDecisionRequest,
  ChangeSetResponse,
  DocumentStateResponse,
  RevisionMetadataResponse,
  SemanticDiffEntry,
} from '@/api/schema';
import { isRetryableProblem } from '@/api/retry';
import type { Doc, OperationBasis, ToolOperation } from '@/editor/types';
import { isUnknownRecord } from '@/lib/json';
import { uid } from '@/lib/uid';
import { workspaceScope } from './workspaces';

/**
 * A page's history and review, under its workspace
 * (`/workspaces/{w}/documents/{d}/revisions…`, `…/change-sets…`).
 *
 * Every accepted save produces one immutable, independently restorable
 * snapshot on the server. These calls read that timeline and restore from it.
 * A restore is locked on the page's strong `ETag` (`If-Match`) and carries an
 * `Idempotency-Key`.
 */

/** Revision kinds the backend writes today. The contract types `kind` as a string. */
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

/** Current server state of a page. */
export interface DocumentHead {
  documentId: string;
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
  entity: SemanticDiffEntry['entity'];
  change: SemanticDiffEntry['change'];
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
  changes: RevisionChange[];
}

export function isStaleHead(error: unknown): boolean {
  return problemCode(error) === 'stale_head';
}

function revisionSummary(value: RevisionMetadataResponse): RevisionSummary {
  return {
    revisionId: value.revision_id,
    revisionNo: value.revision_no,
    parentRevisionId: value.parent_revision_id,
    kind: value.kind,
    actorType: value.actor_type,
    origin: value.origin,
    createdAt: value.created_at,
    byteSize: value.byte_size,
    contentHash: value.content_hash,
    restoredFromRevisionId: value.restored_from_revision_id ?? null,
    summary: value.summary ?? null,
  };
}

function documentHead(payload: DocumentStateResponse, etag: string | null): DocumentHead {
  return {
    documentId: payload.document_id,
    revisionNo: payload.revision_no,
    revisionId: payload.revision_id,
    currentRevisionId: payload.current_revision_id,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    deletedAt: payload.deleted_at ?? null,
    content: toEditorDoc(payload.content),
    etag,
  };
}

function revisionChange(value: SemanticDiffEntry): RevisionChange {
  return {
    entity: value.entity,
    change: value.change,
    entityId: value.entity_id,
    entityType: value.entity_type,
    parentId: value.parent_id ?? null,
    previousParentId: value.previous_parent_id ?? null,
    fromIndex: value.from_index ?? null,
    toIndex: value.to_index ?? null,
    fields: value.fields,
  };
}

/** Current head state plus the ETag later writes must present. */
export async function fetchDocumentHead(
  workspaceId: string,
  documentId: string,
  init?: { signal?: AbortSignal },
): Promise<DocumentHead> {
  const { data, headers } = await unwrapWithHeaders(api.GET('/workspaces/{workspace_id}/documents/{document_id}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId } },
    signal: init?.signal,
  }));
  return documentHead(data, headers.get('ETag'));
}

export interface ListRevisionsOptions {
  limit?: number;
  cursor?: string | null;
  signal?: AbortSignal;
}

/** One page of the timeline, newest first. */
export async function listRevisions(
  workspaceId: string,
  documentId: string,
  options: ListRevisionsOptions = {},
): Promise<RevisionPage> {
  const payload = await unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/revisions', {
    params: {
      path: { workspace_id: workspaceId, document_id: documentId },
      query: {
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.cursor ? { cursor: options.cursor } : {}),
      },
    },
    signal: options.signal,
  }));
  return {
    revisions: payload.revisions.map(revisionSummary),
    nextCursor: payload.next_cursor ?? null,
  };
}

export async function getRevision(
  workspaceId: string,
  documentId: string,
  revisionId: string,
  init?: { signal?: AbortSignal },
): Promise<RevisionDetail> {
  const payload = await unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, revision_id: revisionId } },
    signal: init?.signal,
  }));
  return { ...revisionSummary(payload), content: toEditorDoc(payload.content) };
}

/**
 * Structural changes between a revision and `against` — another revision id,
 * or `'current'` for the live document head.
 */
export async function diffRevision(
  workspaceId: string,
  documentId: string,
  revisionId: string,
  against: string = 'current',
  init?: { signal?: AbortSignal },
): Promise<RevisionDiff> {
  const payload = await unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/diff', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, revision_id: revisionId }, query: { against } },
    signal: init?.signal,
  }));
  return {
    baseRevisionId: payload.base_revision_id,
    targetRevisionId: payload.target_revision_id ?? null,
    changes: payload.diff.changes.map(revisionChange),
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
  status: ChangeSetResponse['status'];
  operations: ToolOperation[];
  /**
   * Names of stored operations with no editor mapping: an operation a newer
   * server added, a field it added to one, a name this app does not know (one
   * the API retired, on a set stored before), or a malformed entry. A
   * non-empty list means the review flow must refuse to stage the set:
   * deciding the mappable subset would retire the whole server record and
   * silently lose these.
   */
  unmappableOperations: string[];
  baseEtag: string;
  toolCallId: string | null;
  summary: string | null;
  expiresAt: string;
  proposedAt: string;
  /** The earlier batch of the same run this one was written on top of. */
  dependsOnChangeSetId: string | null;
  /**
   * Who accepts it (D18): `auto` when the author had Auto on and the server
   * granted it for the run, so the open editor applies its current
   * operations at once; `review` otherwise.
   */
  applyPolicy: ChangeSetResponse['apply_policy'];
  /** Why a run that asked for Auto got `review`. */
  autoBlockedReason: ChangeSetResponse['auto_blocked_reason'];
  /** The author's decisions on single operations, in the order they were made. */
  operationDecisions: ChangeSetOperationDecision[];
  /**
   * One list per stored operation: the server's fingerprints of the blocks it
   * rewrites or deletes, as the operation found them and as the saved
   * document holds them now (`[]` for an insert, a move, a metadata or
   * library edit). `null` as a whole for a change set stored before targets
   * were recorded.
   */
  operationTargets: ChangeSetOperationTarget[][] | null;
  /** Authoritative intent groups, addressed by stored operation index. */
  groups: ChangeSetResponse['groups'];
}

/** One recorded decision, by the operation's position in the stored batch. */
export interface ChangeSetOperationDecision {
  opIndex: number;
  decision: ChangeSetOperationDecisionRequest['decision'];
}

/**
 * Who made a decision: `manual`, the author; `auto`, the editor applying an
 * `apply_policy: "auto"` set (refused on any other set).
 */
export type DecisionOrigin = NonNullable<ChangeSetOperationDecisionRequest['origin']>;

/**
 * Server fingerprints of one operation's target block. They are only
 * comparable with each other: the editor cannot rebuild one from its own
 * block, because the stored html is the server sanitizer's output.
 */
export interface ChangeSetOperationTarget {
  blockId: string;
  /** The block as the operation found it when the batch was computed. */
  fingerprint: string;
  /** The same block in the saved document, or `null` when it is gone. */
  headFingerprint: string | null;
}


/** Each stored operation's fields (`ColWrite-api/src/documents/domain/operations.py`). */
const STORED_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(
  Object.entries({
    replace_text: ['block_id', 'find', 'replace', 'block'],
    write_blocks: ['position', 'block_id', 'blocks'],
    delete_blocks: ['block_ids'],
    move_block: ['block_id', 'position', 'target_block_id'],
    set_meta: ['name', 'citation_style'],
    add_sources: ['sources'],
    remove_sources: ['keys'],
    update_sources: ['sources'],
  }).map(([op, fields]) => [op, new Set(['op', 'basis', 'new_information', ...fields])]),
);

/** The operation names a stored change set may use, which the editor applies. */
export const STORED_OPERATION_NAMES: readonly string[] = Object.keys(STORED_FIELDS);

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.length > 0 && value.every(isString) && new Set(value).size === value.length
    ? value
    : null;
}

function records(value: unknown): Record<string, unknown>[] | null {
  return Array.isArray(value) && value.length > 0 && value.every(isUnknownRecord) ? value : null;
}

/** `basis` and `new_information`, which every stored operation may carry. */
function basisOf(value: Record<string, unknown>): OperationBasis | null {
  const out: OperationBasis = {};
  if (value.basis != null) {
    // Always sent, and empty for an operation that rests on nothing named.
    const basis = Array.isArray(value.basis) && value.basis.length === 0 ? [] : strings(value.basis);
    if (!basis) return null;
    out.basis = basis;
  }
  if (value.new_information != null) {
    if (typeof value.new_information !== 'boolean') return null;
    out.newInformation = value.new_information;
  }
  return out;
}

/**
 * Map one stored operation onto the editor's `ToolOperation`, or `null` when
 * the editor cannot apply it as stored: a name it does not know, a field it
 * does not know, or a malformed entry. The contract types a stored operation
 * as an open object.
 */
export function normalizeChangeSetOperation(value: Record<string, unknown>): ToolOperation | null {
  const fields = typeof value.op === 'string' ? STORED_FIELDS[value.op] : undefined;
  if (!fields || Object.keys(value).some((key) => !fields.has(key))) return null;
  const basis = basisOf(value);
  if (!basis) return null;
  const operation = storedOperation(value);
  return operation && { ...operation, ...basis };
}

function storedOperation(value: Record<string, unknown>): ToolOperation | null {
  switch (value.op) {
    case 'replace_text':
      return isString(value.block_id) && isString(value.find) && typeof value.replace === 'string' && isUnknownRecord(value.block)
        ? { op: 'replace_text', blockId: value.block_id, find: value.find, replace: value.replace, block: value.block }
        : null;
    case 'write_blocks': {
      const blocks = records(value.blocks);
      const position = value.position;
      if (!blocks) return null;
      if (position === 'append') {
        return value.block_id == null ? { op: 'write_blocks', position, blockId: null, blocks } : null;
      }
      if (position !== 'before' && position !== 'after' && position !== 'replace') return null;
      if (!isString(value.block_id)) return null;
      // The first block of a replace keeps the replaced block's id.
      if (position === 'replace' && blocks[0]?.id !== value.block_id) return null;
      return { op: 'write_blocks', position, blockId: value.block_id, blocks };
    }
    case 'delete_blocks': {
      const blockIds = strings(value.block_ids);
      return blockIds ? { op: 'delete_blocks', blockIds } : null;
    }
    case 'move_block':
      return isString(value.block_id) && isString(value.target_block_id) && value.block_id !== value.target_block_id
        && (value.position === 'before' || value.position === 'after')
        ? { op: 'move_block', blockId: value.block_id, position: value.position, targetBlockId: value.target_block_id }
        : null;
    case 'set_meta': {
      const name = value.name == null ? undefined : isString(value.name) ? value.name : null;
      const style = value.citation_style == null
        ? undefined
        : isCitationStyle(value.citation_style)
          ? value.citation_style
          : null;
      if (name === null || style === null || (name === undefined && style === undefined)) return null;
      return { op: 'set_meta', ...(name !== undefined ? { name } : {}), ...(style !== undefined ? { citationStyle: style } : {}) };
    }
    case 'add_sources': {
      // Each a reference record; an operation holding anything else is not staged.
      const sources = records(value.sources)?.map(referenceRecordOf);
      if (!sources || sources.length === 0 || sources.some((source) => source === null)) return null;
      return { op: 'add_sources', sources: sources as NonNullable<(typeof sources)[number]>[] };
    }
    case 'remove_sources': {
      const keys = strings(value.keys);
      return keys ? { op: 'remove_sources', keys } : null;
    }
    case 'update_sources': {
      // Each a reference record, each key once, as the server stores it.
      const sources = records(value.sources)?.map(referenceRecordOf);
      if (!sources || sources.length === 0 || sources.some((source) => source === null)) return null;
      const held = sources as NonNullable<(typeof sources)[number]>[];
      return new Set(held.map((source) => source.key)).size === held.length ? { op: 'update_sources', sources: held } : null;
    }
    default:
      return null;
  }
}

function operationTargets(changeSet: ChangeSetResponse): ChangeSetOperationTarget[][] | null {
  const targets = changeSet.operation_targets;
  // Entries are addressed by operation index, so a list that does not line
  // up with the operations says nothing reliable.
  if (!targets || targets.length !== changeSet.operations.length) return null;
  return targets.map((entry) => entry.map((target) => ({
    blockId: target.block_id,
    fingerprint: target.fingerprint,
    headFingerprint: target.head_fingerprint ?? null,
  })));
}

function agentChangeSet(payload: ChangeSetResponse): AgentChangeSet {
  const operations: ToolOperation[] = [];
  const unmappableOperations: string[] = [];
  for (const value of payload.operations) {
    const operation = normalizeChangeSetOperation(value);
    if (operation) {
      operations.push(operation);
    } else {
      // Kept visible rather than dropped: the caller decides whether the
      // set is still reviewable (it is not — see `unmappableOperations`).
      unmappableOperations.push(typeof value.op === 'string' ? value.op : 'unknown');
    }
  }
  return {
    changeSetId: payload.change_set_id,
    documentId: payload.document_id,
    status: payload.status,
    operations,
    unmappableOperations,
    baseEtag: payload.base_etag,
    toolCallId: payload.tool_call_id ?? null,
    summary: payload.summary ?? null,
    expiresAt: payload.expires_at,
    proposedAt: payload.proposed_at,
    dependsOnChangeSetId: payload.depends_on_change_set_id ?? null,
    applyPolicy: payload.apply_policy,
    autoBlockedReason: payload.auto_blocked_reason ?? null,
    operationDecisions: payload.operation_decisions.map(({ index, decision }) => ({ opIndex: index, decision })),
    operationTargets: operationTargets(payload),
    groups: payload.groups,
  };
}

/** The authoritative operations and status of one durable agent proposal. */
export async function getChangeSet(
  workspaceId: string,
  documentId: string,
  changeSetId: string,
  init?: { signal?: AbortSignal },
): Promise<AgentChangeSet> {
  return agentChangeSet(await unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/change-sets/{change_set_id}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, change_set_id: changeSetId } },
    signal: init?.signal,
  })));
}

/** Reject the whole change set server-side; the document is untouched. */
export async function rejectChangeSet(
  workspaceId: string,
  documentId: string,
  changeSetId: string,
  reason?: string,
): Promise<AgentChangeSet> {
  return agentChangeSet(await unwrap(api.POST('/workspaces/{workspace_id}/documents/{document_id}/change-sets/{change_set_id}/reject', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, change_set_id: changeSetId } },
    body: reason !== undefined ? { reason } : {},
  })));
}

/**
 * Record the author's decision on single operations of a pending change set.
 *
 * Nothing is applied by this: the editor has already applied what the author
 * accepted, as ordinary edits. The server remembers which operations are
 * decided, so a reload or another device offers only the rest, and it takes
 * the set out of `pending` itself when the last one is decided. Sending a
 * decision again is harmless; contradicting a recorded one is a 409.
 *
 * `origin` is `auto` only for operations the editor applied from an
 * `apply_policy: "auto"` set; on any other set the server refuses the whole
 * request (`auto_not_allowed`).
 */
export async function decideChangeSetOperations(
  workspaceId: string,
  documentId: string,
  changeSetId: string,
  decisions: readonly ChangeSetOperationDecision[],
  origin: DecisionOrigin = 'manual',
): Promise<AgentChangeSet> {
  return agentChangeSet(await unwrap(api.POST('/workspaces/{workspace_id}/documents/{document_id}/change-sets/{change_set_id}/decisions', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, change_set_id: changeSetId } },
    body: { decisions: decisions.map(({ opIndex, decision }) => ({ index: opIndex, decision, origin })) },
  })));
}

/**
 * What a refused per-operation decision means for the caller.
 *
 * - `contradicted`: that operation is already decided the other way, here or
 *   on another device. Nothing in the request was recorded; the rest can be
 *   sent again without it.
 * - `final`: the change set no longer takes decisions (it left `pending`, or
 *   is gone), so sending again cannot help.
 * - `transient`: the network, the session or a server still catching up.
 */
export type DecisionRefusal =
  | { kind: 'contradicted'; opIndex: number }
  | { kind: 'final' }
  | { kind: 'transient' };

export function decisionRefusal(error: unknown): DecisionRefusal {
  if (!(error instanceof ApiError) || isRetryableProblem(error)) return { kind: 'transient' };
  const problem = problemBody(error);
  if (error.status === 409) {
    if (problem?.conflict_reason === 'operation_already_decided' && Number.isInteger(problem.operation_index)) {
      return { kind: 'contradicted', opIndex: problem.operation_index as number };
    }
    // Two requests wrote the record at once and this one ran out of tries.
    if (problem?.conflict_reason === 'lifecycle_race') return { kind: 'transient' };
    return { kind: 'final' };
  }
  return error.status === 400 || error.status === 404 || error.status === 422
    ? { kind: 'final' }
    : { kind: 'transient' };
}

/** Pending durable proposals for a document, oldest first. */
export async function listPendingChangeSets(
  workspaceId: string,
  documentId: string,
  init?: { signal?: AbortSignal },
): Promise<AgentChangeSet[]> {
  const payload = await unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/change-sets', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, query: { status: 'pending' } },
    signal: init?.signal,
  }));
  const changeSets = payload.change_sets.map(agentChangeSet);
  // The API lists newest first. Batches are staged in the order they are
  // returned here, and a later batch of a run builds on the earlier ones.
  const proposed = (changeSet: AgentChangeSet) => Date.parse(changeSet.proposedAt);
  return changeSets
    .map((changeSet, index) => ({ changeSet, index }))
    .sort((a, b) => proposed(a.changeSet) - proposed(b.changeSet) || b.index - a.index)
    .map(({ changeSet }) => changeSet);
}

/**
 * Restore moves the document's current-version pointer to an existing
 * revision — it does NOT create a revision. The head's working content
 * becomes the restored snapshot (with a fresh ETag, since the concurrency
 * position stays monotonic), and the next save writes a revision
 * whose parent is the restored node, starting a new branch in the version
 * tree. The returned head is the post-restore state; the caller must adopt
 * it (or reload) so autosave doesn't fight the restore.
 */
export async function restoreRevision(
  workspaceId: string,
  documentId: string,
  revisionId: string,
  options: RestoreRevisionOptions = {},
): Promise<DocumentHead> {
  let etag = options.etag;
  if (!etag) {
    const head = await fetchDocumentHead(workspaceId, documentId);
    if (!head.etag) throw new Error('The server did not provide a concurrency token.');
    etag = head.etag;
  }
  const { data, headers } = await unwrapWithHeaders(api.POST('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', {
    params: {
      path: { workspace_id: workspaceId, document_id: documentId, revision_id: revisionId },
      header: { 'If-Match': etag, 'Idempotency-Key': uid() },
    },
    ...(options.summary !== undefined ? { body: { summary: options.summary } } : {}),
  }));
  return documentHead(data, headers.get('ETag'));
}

/* ----------------------------------------
   Queries
   ---------------------------------------- */

export const historyKeys = {
  ofDocument: (workspaceId: string, documentId: string) => [...workspaceScope(workspaceId), 'history', documentId] as const,
  /** Which version the page is on: the head pointer, its ETag and content. */
  head: (workspaceId: string, documentId: string) => [...historyKeys.ofDocument(workspaceId, documentId), 'head'] as const,
  revisions: (workspaceId: string, documentId: string, pageSize: number) =>
    [...historyKeys.ofDocument(workspaceId, documentId), 'revisions', { pageSize }] as const,
  comparison: (workspaceId: string, documentId: string, base: string | null, target: string) =>
    [...historyKeys.ofDocument(workspaceId, documentId), 'comparison', { base, target }] as const,
};

/** The version the page sits on. */
export function documentHeadQuery(workspaceId: string, documentId: string) {
  return queryOptions({
    queryKey: historyKeys.head(workspaceId, documentId),
    queryFn: ({ signal }) => fetchDocumentHead(workspaceId, documentId, { signal }),
  });
}

/**
 * The version tree, newest first, a page at a time. Reading it again reads
 * every page shown so far, so rows the author paged in stay through a refresh.
 */
export function revisionsQuery(workspaceId: string, documentId: string, pageSize: number) {
  return infiniteQueryOptions({
    queryKey: historyKeys.revisions(workspaceId, documentId, pageSize),
    queryFn: ({ pageParam, signal }) => listRevisions(workspaceId, documentId, { limit: pageSize, cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: RevisionPage) => last.nextCursor ?? undefined,
  });
}

/**
 * The page has a new version (a save, an accepted change set, a restore):
 * the head and the timeline read again. An open comparison is between fixed
 * revisions and stays as it is.
 */
export function refreshHistory(queryClient: QueryClient, workspaceId: string, documentId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: historyKeys.head(workspaceId, documentId) }),
    queryClient.invalidateQueries({ queryKey: [...historyKeys.ofDocument(workspaceId, documentId), 'revisions'] }),
  ]);
}

/** Take the head a restore returned, without reading it again. */
export function adoptHead(queryClient: QueryClient, workspaceId: string, documentId: string, head: DocumentHead): void {
  queryClient.setQueryData(historyKeys.head(workspaceId, documentId), head);
}
