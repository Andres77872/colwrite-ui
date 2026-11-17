import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ResumeAgentRun } from '@/api/assistant/agentSessionChat';
import { reviewKeys, type ReviewKind } from '@/data/reviews';

type Admission = { review: ReviewKind; locator: ResumeAgentRun; attemptId: string };

/**
 * An acknowledgement may precede the summary's first HTTP read. Keep its
 * locator across panel/page unmounts until that exact review is terminal,
 * observed through a summary or a completed terminal stream.
 * This cache is account/workspace scoped and removed with the other queries,
 * never browser storage. An uncertain acknowledgement keeps its action key.
 */
export function useReviewAdmission(workspaceId: string, documentId: string) {
  const client = useQueryClient();
  const queryKey = reviewKeys.admission(workspaceId, documentId);
  const { data } = useQuery<Admission | null>({
    queryKey, queryFn: skipToken, initialData: null, gcTime: Infinity,
  });
  const remember = useCallback((review: ReviewKind, locator: ResumeAgentRun, attemptId: string) => {
    client.setQueryData<Admission | null>(reviewKeys.admission(workspaceId, documentId), (previous) => ({
      review, attemptId,
      locator: previous?.locator.sessionId === locator.sessionId
        ? { ...previous.locator, ...locator } : locator,
    }));
  }, [client, workspaceId, documentId]);
  const forget = useCallback((runId: string) => {
    client.setQueryData<Admission | null>(reviewKeys.admission(workspaceId, documentId), (previous) =>
      previous?.locator.runId === runId ? null : previous);
  }, [client, workspaceId, documentId]);
  const forgetRefused = useCallback((locator: ResumeAgentRun, attemptId: string) => {
    client.setQueryData<Admission | null>(reviewKeys.admission(workspaceId, documentId), (previous) =>
      previous && previous.attemptId === attemptId && !previous.locator.runId && previous.locator.sessionId === locator.sessionId
        && previous.locator.requestId === locator.requestId ? null : previous);
  }, [client, workspaceId, documentId]);
  return { admission: data, remember, forget, forgetRefused };
}
