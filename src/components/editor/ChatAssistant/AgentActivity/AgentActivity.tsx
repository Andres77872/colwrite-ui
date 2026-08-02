import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import {
  Check,
  ChevronRight,
  CircleSlash,
  TriangleAlert,
} from 'lucide-react';
import {
  failureLead,
  formatDuration,
  formatTokens,
  metaFor,
} from './toolMeta';
import type { ToolRun } from './toolMeta';

export type ActivityUsage = { promptTokens: number; completionTokens: number };

/**
 * What the agent did on this turn, in the order it did it.
 *
 * Open by default while streaming, but the author stays in charge of the
 * disclosure — it used to be locked open during a run, with `aria-expanded`
 * claiming otherwise. Once the turn finishes it collapses to a single line;
 * failures stay visible in the summary either way.
 */
export function AgentActivity({
  runs,
  live,
  usage,
}: {
  runs: ToolRun[];
  live: boolean;
  usage?: ActivityUsage | null;
}) {
  // null = the author hasn't touched it; follow the live default.
  const [expanded, setExpanded] = useState<boolean | null>(null);

  if (runs.length === 0) return null;

  const open = expanded ?? live;
  const failed = runs.filter((run) => run.state === 'error').length;
  const interrupted = runs.filter((run) => run.state === 'interrupted').length;
  const running = [...runs].reverse().find((run) => run.state === 'running');

  const summary = live
    ? running
      ? metaFor(running.tool).running + '…'
      : 'Working…'
    : `${runs.length} ${runs.length === 1 ? 'step' : 'steps'}`;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {failed > 0 && (
          <span className="shrink-0 text-destructive">{failed} failed</span>
        )}
        {interrupted > 0 && (
          <span className="shrink-0">{interrupted} interrupted</span>
        )}
        {!live && usage && (usage.promptTokens > 0 || usage.completionTokens > 0) && (
          <span
            className="shrink-0 tabular-nums"
            title={`${usage.promptTokens} prompt tokens in, ${usage.completionTokens} completion tokens out`}
          >
            {formatTokens(usage.promptTokens)} in · {formatTokens(usage.completionTokens)} out
          </span>
        )}
      </button>

      {open && (
        <ol className="space-y-1 border-t border-border/60 px-2.5 py-1.5">
          {runs.map((run) => (
            <ActivityRun key={run.id} run={run} />
          ))}
        </ol>
      )}
    </div>
  );
}

/** One tool call: status, label, duration, failure cause, and its own
    input/output disclosure when there is anything to show. */
function ActivityRun({ run }: { run: ToolRun }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const meta = metaFor(run.tool);
  const Icon = meta.icon;
  const duration = formatDuration(run.durationMs);
  const hasDetails = Boolean(
    run.argsPreview || run.args || run.outputPreview || run.errorType,
  );

  const stateText =
    run.state === 'running'
      ? 'running'
      : run.state === 'error'
        ? 'failed'
        : run.state === 'interrupted'
          ? 'interrupted'
          : 'finished';

  return (
    <li className="text-xs">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          {run.state === 'running' ? (
            <Spinner className="h-3 w-3" />
          ) : run.state === 'error' ? (
            <TriangleAlert aria-hidden="true" className="h-3 w-3 text-destructive" />
          ) : run.state === 'interrupted' ? (
            <CircleSlash aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Check aria-hidden="true" className="h-3 w-3 text-diff-add-fg" />
          )}
          <span className="sr-only">{stateText}</span>
        </span>
        <Icon aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className={cn(run.state === 'error' ? 'text-destructive' : 'text-foreground')}>
            {run.state === 'running'
              ? meta.running
              : run.state === 'interrupted'
                ? `${meta.running} — interrupted`
                : meta.label}
          </span>
          {run.detail && (
            <span className="block text-muted-foreground">{run.detail}</span>
          )}
          {/* The reason a call failed is the one thing the author needs from
              this list — it is never hidden behind another click. */}
          {run.state === 'error' && (
            <span className="block text-destructive/90">
              {failureLead(run.errorType)}
              {run.error ? ` — ${run.error}` : '.'}
            </span>
          )}
          {run.outputTruncated && run.state !== 'error' && (
            <span className="block text-muted-foreground">
              The reply was cut at the size limit; the assistant saw only part of it.
            </span>
          )}
        </span>
        {duration && <span className="shrink-0 text-muted-foreground">{duration}</span>}
        {hasDetails && (
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            aria-expanded={detailsOpen}
            className="shrink-0 text-2xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            {detailsOpen ? 'Hide' : 'Details'}
          </button>
        )}
      </div>

      {detailsOpen && hasDetails && (
        <div className="ml-5 mt-1 space-y-1.5 border-l border-border/60 pl-2.5">
          {(run.args || run.argsPreview) && (
            <RunPayload
              label="Input"
              text={run.args ? JSON.stringify(run.args, null, 2) : run.argsPreview ?? ''}
              note={run.args ? undefined : 'shortened'}
            />
          )}
          {run.outputPreview && (
            <RunPayload
              label="Output"
              text={run.outputPreview}
              note={
                run.outputChars && run.outputChars > run.outputPreview.length
                  ? `first ${run.outputPreview.length.toLocaleString()} of ${run.outputChars.toLocaleString()} characters`
                  : undefined
              }
            />
          )}
          {run.errorType && (
            <p className="text-2xs text-muted-foreground">
              Error type: <code>{run.errorType}</code>
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function RunPayload({ label, text, note }: { label: string; text: string; note?: string }) {
  return (
    <div>
      <p className="text-2xs font-medium text-muted-foreground">
        {label}
        {note && <span className="font-normal"> ({note})</span>}
      </p>
      <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-1.5 text-2xs text-foreground/90">
        {text}
      </pre>
    </div>
  );
}
