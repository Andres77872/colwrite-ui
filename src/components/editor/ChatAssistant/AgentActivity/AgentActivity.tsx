import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Check, ChevronRight, TriangleAlert } from 'lucide-react';
import { formatDuration, metaFor } from './toolMeta';
import type { ToolRun } from './toolMeta';

/**
 * What the agent did on this turn, in the order it did it.
 *
 * Collapsed to a single line once the turn finishes: the detail matters while
 * you are waiting, and becomes noise once the answer is there.
 */
export function AgentActivity({ runs, live }: { runs: ToolRun[]; live: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (runs.length === 0) return null;

  const open = live || expanded;
  const failed = runs.filter((run) => run.state === 'error').length;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate">
          {live
            ? metaFor(runs[runs.length - 1].tool).running + '…'
            : `${runs.length} ${runs.length === 1 ? 'step' : 'steps'}`}
        </span>
        {failed > 0 && (
          <span className="shrink-0 text-destructive">
            {failed} failed
          </span>
        )}
      </button>

      {open && (
        <ol className="space-y-1 border-t border-border/60 px-2.5 py-1.5">
          {runs.map((run) => {
            const meta = metaFor(run.tool);
            const Icon = meta.icon;
            const duration = formatDuration(run.durationMs);
            return (
              <li key={run.id} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0">
                  {run.state === 'running' ? (
                    <Spinner className="h-3 w-3" />
                  ) : run.state === 'error' ? (
                    <TriangleAlert aria-hidden="true" className="h-3 w-3 text-destructive" />
                  ) : (
                    <Check aria-hidden="true" className="h-3 w-3 text-diff-add-fg" />
                  )}
                </span>
                <Icon aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className={cn(run.state === 'error' ? 'text-destructive' : 'text-foreground')}>
                    {run.state === 'running' ? meta.running : meta.label}
                  </span>
                  {run.detail && (
                    <span className="block text-muted-foreground">{run.detail}</span>
                  )}
                </span>
                {duration && <span className="shrink-0 text-muted-foreground">{duration}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
