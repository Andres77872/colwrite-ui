import { useEffect, useState } from 'react';
import { SearchCheck } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/inline-error';
import { AgentProgressLine } from '@/components/editor/AgentProgress';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { settledJob } from '@/actions/trashJobs';
import { checkClaim, claimCheckOf, claimFailure, type ClaimCheck } from '@/data/claims';
import { ClaimCard } from '../shared/ClaimCard';

/** One claim to check, and the works to judge it against (none: passages are found for it). */
export type ClaimRequest = { id: number; claim: string; sources: string[]; /** When it was asked, for the elapsed counter. */ at: number };

type Outcome = { status: 'done'; check: ClaimCheck } | { status: 'failed'; message: string };

/**
 * The Research panel's claim check (P2.UI-3): `POST …/claims/check` arms a
 * `claim_check` job, followed like any workspace job until it is done, and
 * its verdict is shown as the claim card, with each passage's text and its
 * work's Cite and Add to sources. Asking again checks again.
 */
export function ClaimCheckResults({ request }: { request: ClaimRequest | null }) {
  const workspaceId = useWorkspaceId();
  // The outcome of the request it answers; a newer request is running until its own arrives.
  const [outcome, setOutcome] = useState<{ id: number; outcome: Outcome } | null>(null);

  useEffect(() => {
    if (!request) return;
    let current = true;
    const settle = (next: Outcome) => {
      if (current) setOutcome({ id: request.id, outcome: next });
    };
    checkClaim(workspaceId, request.claim, request.sources)
      .then((job) => settledJob(workspaceId, job, { label: 'Checking a claim', unit: 'claims' }))
      .then((job) => {
        const check = job.status === 'done' ? claimCheckOf(job) : null;
        settle(check ? { status: 'done', check } : { status: 'failed', message: job.last_error || 'The claim could not be checked. Try again.' });
      })
      .catch((error: unknown) => settle({ status: 'failed', message: claimFailure(error) }));
    return () => {
      current = false;
    };
  }, [request, workspaceId]);

  if (!request) {
    return (
      <EmptyState
        icon={SearchCheck}
        title="Check a claim"
        description="Write one claim. It is judged against papers’ passages, each shown with how much of the paper was read; on abstracts alone the honest answer is that it cannot be assessed."
      />
    );
  }
  const state = outcome?.id === request.id ? outcome.outcome : null;
  if (!state) {
    return <AgentProgressLine label="Checking the claim…" since={request.at} className="px-2 py-3" />;
  }
  if (state.status === 'failed') {
    return <InlineError className="mx-2 my-3" title="The claim was not checked." detail={state.message} />;
  }
  const { check } = state;
  return (
    <div className="px-1.5 py-2" aria-live="polite">
      <ClaimCard
        claim={check.claim}
        verdict={check.verdict}
        evidenceLevel={check.evidenceLevel}
        cannotAssess={check.cannotAssess}
        summary={check.summary}
        note={check.note}
        howToGet={check.howToGet}
        passages={check.passages}
        notFound={check.notFound}
      />
      {check.notes.map((note) => (
        <p key={note} className="mt-2 px-1 text-xs text-muted-foreground">{note}</p>
      ))}
    </div>
  );
}
