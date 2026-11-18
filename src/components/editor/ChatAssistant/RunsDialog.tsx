import type { UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query';
import type { AssistantRunListResponse } from '@/api/schema';
import type { AssistantRun } from '@/data/assistantRuns';
import { describeApiError } from '@/api/errors';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/text';
import { formatSpan } from './replyMeta';

const STATES: Record<AssistantRun['status'], string> = {
  queued: 'Waiting', running: 'Running', cancelling: 'Stopping', completed: 'Completed',
  failed: 'Failed', cancelled: 'Stopped', interrupted: 'Interrupted',
};

export function RunsDialog({ open, onOpenChange, query, runs, onOpen, error, opening }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: UseInfiniteQueryResult<InfiniteData<AssistantRunListResponse>, Error>;
  runs: readonly AssistantRun[];
  onOpen: (run: AssistantRun, resume: boolean) => void;
  error: string | null;
  opening: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>Runs</DialogTitle>
          <DialogDescription>Your assistant runs in this workspace. Resume continues an interrupted Deep run from its saved checkpoint.</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {query.isError && <div role="alert" className="text-sm">
          <p>{describeApiError(query.error, 'Could not load runs.')}</p>
          <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Try again</Button>
        </div>}
        <div className="min-h-0 overflow-y-auto">
          {query.isPending && <p role="status" className="py-3 text-sm text-muted-foreground">Loading runs…</p>}
          {!query.isPending && !query.isError && !runs.length && <p className="py-3 text-sm text-muted-foreground">No runs yet.</p>}
          <ul className="divide-y divide-border">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{run.request?.message.trim() || run.preset || (run.request?.plan_id ? 'Write the approved plan' : 'Inline passage')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {STATES[run.status]} · {run.effort[0]?.toUpperCase()}{run.effort.slice(1)} · {run.profile === 'chat' ? 'Chat' : 'Inline'} · {run.engine === 'gateway' ? 'Gateway' : run.engine === 'claude' ? 'Claude Code' : 'Codex'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(run.created_at)}
                    {run.duration_ms !== null ? ` · ${formatSpan(run.duration_ms)}` : ''}
                    {run.cost !== null ? ` · $${run.cost.toFixed(4)}` : ' · Cost not reported'}
                  </p>
                  {run.resumed_from && <p className="mt-1 text-xs text-muted-foreground">Continued from a checkpoint</p>}
                  {run.status === 'interrupted' && !run.resumable && <p className="mt-1 text-xs text-muted-foreground">No checkpoint available. Open the plan to continue.</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" disabled={opening} onClick={() => onOpen(run, false)}>{run.chat_id ? 'Open chat' : 'Open page'}</Button>
                  {run.resumable && run.session_id && run.request && (
                    <Button size="sm" disabled={opening} onClick={() => onOpen(run, true)}>
                      {run.request.web ? 'Resume with Web on' : 'Resume'}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {query.hasNextPage && <Button variant="ghost" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? 'Loading…' : 'Show older runs'}
          </Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
