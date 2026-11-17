import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ClipboardCopy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toastContext';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { shortDateTime } from '@/components/layout/editedLabel';
import { copyToClipboard } from '@/lib/clipboard';
import { useDocumentId } from '@/editor';
import {
  VENUES,
  aiUseLogQuery,
  aiUseStatementQuery,
  referenceFailure,
  type AiUseEntry,
  type VenueId,
} from '@/data/references';

/* ----------------------------------------
   AI use (P2.UI-4, 09 §8)

   The page's AI-use log: what the assistant did to it, with the models that
   served each action, the sections it touched and how its result was
   verified, read from the server; and a draft disclosure statement for a
   venue, written by the server from the log, to copy and edit. The log
   records what ColWrite's assistant did; the statement says it does not
   cover text pasted from elsewhere.
   ---------------------------------------- */

const PURPOSES: Record<AiUseEntry['purposes'][number], string> = {
  drafted: 'Drafted text',
  rewrote: 'Rewrote passages',
  edited: 'Edited wording',
  restructured: 'Reordered or removed parts',
  added_citations: 'Added citations',
  managed_sources: 'Changed the sources',
  refreshed_references: 'Refreshed references',
  set_metadata: 'Renamed the page or set its style',
  created_page: 'Created the page',
  suggested: 'Suggested a rewrite',
  checked_references: 'Checked the references',
  generated_images: 'Included AI-generated illustrations',
};

const VERIFIED: Record<AiUseEntry['verification']['method'], string> = {
  accepted_by_author: 'Accepted one change at a time',
  partly_accepted: 'Partly accepted',
  applied_by_auto: 'Applied by Auto',
  rejected: 'Rejected',
  pending: 'Still to review',
  not_applied: 'Not applied',
  created_on_request: 'Created when asked',
  not_recorded: 'Kept or discarded in the editor',
  reference_check: 'Reference check',
  unknown: 'Not known',
  image_present: 'Recorded in a saved revision; visual accuracy is not recorded',
};

export function AiUseDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const focusReturn = useReturnFocus(returnFocus);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        onOpenAutoFocus={focusReturn.onOpenAutoFocus}
        onCloseAutoFocus={focusReturn.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>AI use</DialogTitle>
          <DialogDescription>
            What the assistant did on this page, and a draft statement for where you submit it. It does not cover text
            pasted from other tools.
          </DialogDescription>
        </DialogHeader>
        {open && <AiUseBody />}
      </DialogContent>
    </Dialog>
  );
}

function AiUseBody() {
  const workspaceId = useWorkspaceId();
  const documentId = useDocumentId();
  const log = useInfiniteQuery({ ...aiUseLogQuery(workspaceId, documentId ?? ''), enabled: Boolean(documentId) });
  const entries = log.data?.pages.flatMap((page) => page.entries) ?? [];

  if (!documentId) return <p className="mt-4 text-sm text-muted-foreground">Nothing is recorded for a page that is not saved yet.</p>;
  return (
    <div className="mt-4 grid max-h-[65vh] gap-5 overflow-y-auto pr-1">
      <section aria-labelledby="ai-use-log">
        <h3 id="ai-use-log" className="text-sm font-medium">On this page</h3>
        {log.isPending ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Reading the log…</p>
        ) : log.isError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">{referenceFailure(log.error, 'The log could not be read.')}</p>
        ) : entries.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">The assistant has not changed this page.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {entries.map((entry) => <AiUseRow key={entry.id} entry={entry} />)}
          </ol>
        )}
        {log.hasNextPage && (
          <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage}>
            Show more
          </Button>
        )}
      </section>
      <Statement workspaceId={workspaceId} documentId={documentId} />
    </div>
  );
}

function AiUseRow({ entry }: { entry: AiUseEntry }) {
  const what = entry.purposes.map((purpose) => PURPOSES[purpose]).join(', ') || 'Used the assistant';
  const details = [
    entry.sections.length ? `In ${entry.sections.join(', ')}` : null,
    entry.models.length ? entry.models.join(', ') : null,
    VERIFIED[entry.verification.method],
  ].filter(Boolean).join(' · ');
  return (
    <li data-ai-use-kind={entry.kind} className="rounded-md bg-subtle/60 px-3 py-2 text-sm">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{what}</span>
        {entry.at && <span className="text-xs text-muted-foreground">{shortDateTime(Date.parse(entry.at))}</span>}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{details}</p>
      {entry.generation && <details className="mt-2 text-xs">
        <summary className="cursor-pointer">Image request and generator</summary>
        <p className="mt-1">{entry.generation.model ?? `Codex ${entry.generation.codex_version ?? '(version not reported)'}`}</p>
        <p className="whitespace-pre-wrap">{entry.generation.prompt}</p>
      </details>}
      {entry.references && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {entry.references.references} references: {entry.references.retracted} retracted, {entry.references.stale} out of date,{' '}
          {entry.references.duplicates} duplicate{entry.references.duplicates === 1 ? '' : 's'}
        </p>
      )}
    </li>
  );
}

function Statement({ workspaceId, documentId }: { workspaceId: string; documentId: string }) {
  const [venue, setVenue] = useState<VenueId>('elsevier');
  const statement = useQuery(aiUseStatementQuery(workspaceId, documentId, venue));
  const { toast } = useToast();
  const copy = async () => {
    if (!statement.data) return;
    const copied = await copyToClipboard({ plain: statement.data.statement });
    toast(copied ? { title: 'Statement copied' } : { title: 'Could not copy', description: 'Select the text and copy it instead.', variant: 'error' });
  };
  const profile = statement.data?.venue;
  return (
    <section aria-labelledby="ai-use-statement">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 id="ai-use-statement" className="text-sm font-medium">Statement for</h3>
        <label className="grid gap-1 text-xs">
          <span className="sr-only">Venue</span>
          <NativeSelect value={venue} onChange={(event) => setVenue(event.target.value as VenueId)} aria-label="Venue">
            {VENUES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </NativeSelect>
        </label>
      </div>
      {statement.isPending ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Writing the statement…</p>
      ) : statement.isError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">{referenceFailure(statement.error, 'The statement could not be written.')}</p>
      ) : (
        <>
          {profile && (
            <p className="mt-2 text-xs text-muted-foreground">
              {profile.placement}{' '}
              <a href={profile.policy_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-link hover:underline">
                Its policy<ExternalLink aria-hidden="true" className="h-3 w-3" /><span className="sr-only"> (opens in a new tab)</span>
              </a>
              , read {profile.read_on}.
            </p>
          )}
          <blockquote data-ai-use-statement className="mt-2 select-text whitespace-pre-wrap rounded-md border border-border px-3 py-2 text-sm">
            {statement.data.statement}
          </blockquote>
          <div className="mt-2 flex items-start justify-between gap-3">
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {statement.data.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
            <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => void copy()}>
              <ClipboardCopy aria-hidden="true" />
              Copy
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
