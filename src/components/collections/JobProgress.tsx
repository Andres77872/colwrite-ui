import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { dismissJob, useWorkspaceJobs, type FollowedJob } from '@/actions/trashJobs';

/** "4 of 12 pages", once the job knows its size. */
function progressText(item: FollowedJob): string | null {
  const progress = item.job.progress;
  if (!progress || progress.total <= 0) return null;
  return `${Math.min(progress.done, progress.total).toLocaleString()} of ${progress.total.toLocaleString()} ${item.unit}`;
}

/**
 * Trash work the server is still finishing (a collection's pages moving to
 * or from the Trash, a purge): one line each, with how far it is. The lines
 * are a polite live region, so their progress is announced without taking
 * focus; one that failed stays, saying why, until it is dismissed.
 */
export function JobProgress({ workspaceId, className }: { workspaceId: string; className?: string }) {
  const jobs = useWorkspaceJobs(workspaceId);
  return (
    <div role="status" aria-live="polite" className={cn(jobs.length === 0 && 'sr-only', className)}>
      {jobs.map((item) => {
        const progress = item.job.progress;
        const fraction = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : null;
        const text = progressText(item);
        if (item.error) {
          return (
            <div key={item.key} className="flex items-start gap-2 rounded-md bg-tint-red px-2 py-1.5 text-xs text-tint-red-fg">
              <p className="min-w-0 flex-1">
                <span className="font-medium">Could not finish: {item.label}.</span> {item.error}
              </p>
              <button
                type="button"
                className="grid size-5 shrink-0 place-items-center rounded-sm hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Dismiss: ${item.label}`}
                onClick={() => dismissJob(item.key)}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          );
        }
        return (
          <div key={item.key} className="space-y-1 px-2 py-1.5 text-xs text-muted-foreground">
            <p className="flex items-center gap-2">
              <Spinner className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{item.label}…</span>
              {text && <span className="shrink-0 tabular-nums">{text}</span>}
            </p>
            {fraction !== null && (
              <div
                role="progressbar"
                aria-label={item.label}
                aria-valuemin={0}
                aria-valuemax={progress?.total ?? 0}
                aria-valuenow={progress?.done ?? 0}
                aria-valuetext={text ?? undefined}
                className="h-1 overflow-hidden rounded-full bg-subtle"
              >
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(fraction * 100)}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
