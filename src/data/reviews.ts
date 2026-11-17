import { infiniteQueryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { DocumentComment, ReviewSummary } from '@/api/schema';
import { workspaceScope } from './workspaces';

export type ReviewComment = DocumentComment;
export type ReviewRun = ReviewSummary;
export type ReviewKind = ReviewRun['review'];

export const REVIEW_LABELS: Record<ReviewKind, string> = {
  proofread: 'Proofread', claims: 'Claims and evidence', sources: 'Sources',
  structure: 'Structure and guideline', peer_review: 'Peer review',
};
export const COMMENT_KINDS: Record<ReviewComment['kind'], string> = {
  claim: 'Claims', source: 'Sources', structure: 'Structure', clarity: 'Clarity',
  consistency: 'Consistency', language: 'Language', guideline: 'Reporting guideline',
};
export const COMMENT_SEVERITIES: Record<ReviewComment['severity'], string> = {
  must_fix: 'Must fix', should_fix: 'Should fix', consider: 'Consider',
};
export const reviewKeys = {
  page: (workspaceId: string, documentId: string) => [...workspaceScope(workspaceId), 'reviews', documentId] as const,
  comments: (workspaceId: string, documentId: string) => [...reviewKeys.page(workspaceId, documentId), 'comments'] as const,
  runs: (workspaceId: string, documentId: string) => [...reviewKeys.page(workspaceId, documentId), 'runs'] as const,
  admission: (workspaceId: string, documentId: string) => [...reviewKeys.page(workspaceId, documentId), 'admission'] as const,
};

export async function listReviewComments(workspaceId: string, documentId: string, cursor: string | null, signal?: AbortSignal) {
  return unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/comments', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, query: { limit: 100, ...(cursor ? { cursor } : {}) } }, signal,
  }));
}

export async function decideReviewComment(workspaceId: string, documentId: string, commentId: string, status: ReviewComment['status']) {
  return unwrap(api.PATCH('/workspaces/{workspace_id}/documents/{document_id}/comments/{comment_id}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, comment_id: commentId } }, body: { status },
  }));
}

export function reviewCommentsQuery(workspaceId: string, documentId: string) {
  return infiniteQueryOptions({
    queryKey: reviewKeys.comments(workspaceId, documentId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => listReviewComments(workspaceId, documentId, pageParam, signal),
    getNextPageParam: (page) => page.next_cursor,
    refetchInterval: 30_000,
  });
}

export function reviewRunsQuery(workspaceId: string, documentId: string) {
  return infiniteQueryOptions({
    queryKey: reviewKeys.runs(workspaceId, documentId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/reviews', {
      params: { path: { workspace_id: workspaceId, document_id: documentId }, query: { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } }, signal,
    })),
    getNextPageParam: (page) => page.next_cursor,
    refetchInterval: (query) => query.state.data?.pages.some((page) => page.items.some((run) => run.status === 'running')) ? 1_000 : false,
  });
}
