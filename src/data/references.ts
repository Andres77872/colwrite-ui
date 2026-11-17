import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { problemCode } from '@/api/errors';
import type {
  AiUseEntry as WireAiUseEntry,
  AiUseLogResponse,
  AiUseStatement as WireAiUseStatement,
  ReferenceAuditReport,
  ReferenceAuditResult,
  operations,
} from '@/api/schema';
import type { WorkspaceJob } from './trash';
import { workspaceScope } from './workspaces';

/* ----------------------------------------
   A page's reference audit and its AI-use log
   (`ColWrite-api/docs/citations.md#the-reference-audit`, `#the-ai-use-log`)

   "Check references" arms the page's `reference_audit` job (an editor's):
   every library reference looked up again, orphan citations, uncited
   entries, duplicates, preprints with a version of record and citations
   with no passage counted, and stale records proposed for refresh as one
   change set (`update_sources`, and `add_sources` for an orphan whose key
   resolves), which the author reviews like any other. The report is
   `GET …/references/status` until the next audit replaces it. It never
   deletes a reference, rewrites a citation or stops an export.

   The AI-use log lists what the assistant did to the page, oldest first,
   and writes a draft disclosure statement for a venue from it.
   ---------------------------------------- */

export type ReferenceAudit = ReferenceAuditReport;
export type AuditedReference = ReferenceAudit['references'][number];
export type AuditCounts = ReferenceAudit['counts'];
export type AuditSummary = ReferenceAuditResult;
export type AiUseEntry = WireAiUseEntry;
export type AiUseStatement = WireAiUseStatement;
export type VenueId = operations['references-ai_use_statement']['parameters']['query']['venue'];

export const referenceKeys = {
  all: (workspaceId: string) => [...workspaceScope(workspaceId), 'references'] as const,
  status: (workspaceId: string, documentId: string) => [...workspaceScope(workspaceId), 'references', documentId, 'status'] as const,
  aiUse: (workspaceId: string, documentId: string) => [...workspaceScope(workspaceId), 'references', documentId, 'ai-use'] as const,
  statement: (workspaceId: string, documentId: string, venue: VenueId) =>
    [...workspaceScope(workspaceId), 'references', documentId, 'ai-use', 'statement', venue] as const,
};

/** `POST …/references/check`: start the page's audit, as a `reference_audit` job. */
export async function checkReferences(workspaceId: string, documentId: string): Promise<WorkspaceJob> {
  const { job } = await unwrap(api.POST('/workspaces/{workspace_id}/documents/{document_id}/references/check', {
    params: { path: { workspace_id: workspaceId, document_id: documentId } },
  }));
  return job;
}

/** A finished `reference_audit` job's counts and the refresh it proposed, or `null`. */
export function auditSummaryOf(job: WorkspaceJob): AuditSummary | null {
  return job.progress?.result?.audit ?? null;
}

/** `GET …/references/status`: the page's last audit, or `null` before the first (`reference_audit_not_found`). */
export async function getReferenceStatus(
  workspaceId: string,
  documentId: string,
  init?: { signal?: AbortSignal },
): Promise<ReferenceAudit | null> {
  try {
    return await unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/references/status', {
      params: { path: { workspace_id: workspaceId, document_id: documentId } },
      signal: init?.signal,
    }));
  } catch (error) {
    if (problemCode(error) === 'reference_audit_not_found') return null;
    throw error;
  }
}

export function referenceStatusQuery(workspaceId: string, documentId: string) {
  return queryOptions({
    queryKey: referenceKeys.status(workspaceId, documentId),
    queryFn: ({ signal }) => getReferenceStatus(workspaceId, documentId, { signal }),
    staleTime: 60_000,
  });
}

/** `GET …/ai-use`: the page's AI-use log, oldest first, by cursor. */
export async function getAiUseLog(
  workspaceId: string,
  documentId: string,
  cursor: string | null,
  init?: { signal?: AbortSignal },
): Promise<AiUseLogResponse> {
  return unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/ai-use', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
    signal: init?.signal,
  }));
}

export function aiUseLogQuery(workspaceId: string, documentId: string) {
  return infiniteQueryOptions({
    queryKey: referenceKeys.aiUse(workspaceId, documentId),
    queryFn: ({ pageParam, signal }) => getAiUseLog(workspaceId, documentId, pageParam, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: AiUseLogResponse) => last.next_cursor ?? undefined,
  });
}

/** `GET …/ai-use/statement?venue=`: a draft disclosure for one venue, from the log. */
export async function getAiUseStatement(
  workspaceId: string,
  documentId: string,
  venue: VenueId,
  init?: { signal?: AbortSignal },
): Promise<AiUseStatement> {
  return unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/ai-use/statement', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, query: { venue } },
    signal: init?.signal,
  }));
}

export function aiUseStatementQuery(workspaceId: string, documentId: string, venue: VenueId) {
  return queryOptions({
    queryKey: referenceKeys.statement(workspaceId, documentId, venue),
    queryFn: ({ signal }) => getAiUseStatement(workspaceId, documentId, venue, { signal }),
  });
}

/**
 * The venue profiles the API writes a statement for, in its order, by the
 * names the profiles carry. `satisfies` holds the list to the contract's
 * `venue` values, and the record below to every one of them.
 */
const VENUE_NAMES = {
  elsevier: 'Elsevier journals',
  taylor_and_francis: 'Taylor & Francis',
  ieee: 'IEEE',
  plos: 'PLOS',
  science: 'Science journals',
  acm: 'ACM',
  neurips: 'NeurIPS',
  iclr: 'ICLR',
} as const satisfies Record<VenueId, string>;

export const VENUES: ReadonlyArray<{ id: VenueId; name: string }> = (Object.keys(VENUE_NAMES) as VenueId[]).map((id) => ({
  id,
  name: VENUE_NAMES[id],
}));

/** Why the audit or the log could not be read, for the author. */
export function referenceFailure(error: unknown, fallback: string): string {
  switch (problemCode(error)) {
    case 'workspace_role_required':
      return 'Checking references needs the editor role.';
    case 'document_in_trash':
      return 'This page is in the Trash.';
    case 'reference_audit_not_found':
      return 'The references have not been checked yet.';
    default:
      return error instanceof Error && error.message ? error.message : fallback;
  }
}
