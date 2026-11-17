import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDocumentActions, useDocumentId } from '@/editor';
import { ProposalsContext } from '@/editor/proposalsContextState';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useWorkspaceAccess } from '@/components/workspace/workspaceAccess';
import { settledJob } from '@/actions/trashJobs';
import { auditSummaryOf, checkReferences, referenceFailure, referenceKeys, referenceStatusQuery } from '@/data/references';
import { ReferenceHealthContext, findingsOf, type ReferenceHealth } from './referenceHealth';

/**
 * Reads the page's last reference audit and runs "Check references"
 * (`referenceHealth.ts`), inside the editor and the review layer.
 */
export function ReferenceHealthProvider({ children }: { children: ReactNode }) {
  const workspaceId = useWorkspaceId();
  const documentId = useDocumentId();
  const { canEdit } = useWorkspaceAccess();
  const { ensureRemoteDocument } = useDocumentActions();
  const queryClient = useQueryClient();
  const proposals = useContext(ProposalsContext);
  const status = useQuery({
    ...referenceStatusQuery(workspaceId, documentId ?? ''),
    enabled: Boolean(documentId),
  });
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      // The audit reads the stored page: save it first.
      const id = await ensureRemoteDocument();
      if (!id) throw new Error('The page could not be saved, so its references were not checked.');
      const job = await settledJob(workspaceId, await checkReferences(workspaceId, id), { label: 'Checking references', unit: 'references' });
      if (job.status === 'failed') throw new Error(job.last_error || 'The references could not be checked.');
      await queryClient.invalidateQueries({ queryKey: referenceKeys.status(workspaceId, id) });
      await queryClient.invalidateQueries({ queryKey: referenceKeys.aiUse(workspaceId, id) });
      // The refresh it proposed is reviewed like any change set.
      const changeSetId = auditSummaryOf(job)?.change_set_id;
      if (changeSetId) {
        proposals?.receive({
          tool: 'reference_audit', toolCallId: '', actions: [], documentId: id, status: 'proposed',
          changeSetId, applyPolicy: 'review', autoBlockedReason: null,
        });
      }
    } catch (cause) {
      setError(referenceFailure(cause, 'The references could not be checked. Try again.'));
    } finally {
      setChecking(false);
    }
  }, [ensureRemoteDocument, proposals, queryClient, workspaceId]);

  const report = status.data ?? null;
  const findings = useMemo(() => findingsOf(report), [report]);
  const value = useMemo<ReferenceHealth>(
    () => ({ report, findings, check: canEdit ? run : null, checking, error }),
    [canEdit, checking, error, findings, report, run],
  );
  return <ReferenceHealthContext.Provider value={value}>{children}</ReferenceHealthContext.Provider>;
}

