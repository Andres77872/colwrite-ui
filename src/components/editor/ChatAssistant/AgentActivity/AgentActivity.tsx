import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Check, ChevronRight, CircleSlash, Network, TriangleAlert } from 'lucide-react';
import { formatDraftSize, formatElapsed, useNow } from '@/components/editor/AgentProgress';
import type { AgentWorker } from '@/api/assistant/streamParser';
import { failureLead, formatDuration, metaFor } from './toolMeta';
import type { ToolRun } from './toolMeta';

/** A running step shows its clock only once it has taken a noticeable while. */
const SHOW_RUNNING_TIME_AFTER_MS = 2000;

/**
 * How long a running call has been going, and how much of its input has been
 * drafted: "· 2,410 characters · 12s". A minute-long edit used to be one
 * unchanging spinner.
 */
function RunningMeta({ run }: { run: ToolRun }) {
  const now = useNow(true);
  const elapsed = run.startedAt === undefined ? 0 : now - run.startedAt;
  const drafted = run.argumentsChars ? formatDraftSize(run.argumentsChars) : null;
  if (!drafted && elapsed < SHOW_RUNNING_TIME_AFTER_MS) return null;
  return (
    <span aria-hidden="true" className="shrink-0 tabular-nums">
      {drafted && `· ${drafted} `}
      {elapsed >= SHOW_RUNNING_TIME_AFTER_MS && `· ${formatElapsed(elapsed)}`}
    </span>
  );
}

/** Past this many steps a finished turn folds them under one summary line. */
const FOLD_AFTER = 3;

type Entry =
  | { kind: 'run'; run: ToolRun }
  | { kind: 'worker'; worker: AgentWorker; number: number; runs: ToolRun[] };

/**
 * The turn's steps in order, with each research worker's own steps gathered
 * under it. A worker's tool calls arrive as `<worker id>:<call id>`, in
 * between the assistant's own and those of a worker running beside it.
 */
function entriesFor(runs: ToolRun[], workers: AgentWorker[]): Entry[] {
  const entries: Entry[] = [];
  const groups = new Map<string, ToolRun[]>();
  const group = (worker: AgentWorker) => {
    let owned = groups.get(worker.id);
    if (!owned) {
      owned = [];
      groups.set(worker.id, owned);
      entries.push({ kind: 'worker', worker, number: workers.indexOf(worker) + 1, runs: owned });
    }
    return owned;
  };
  for (const run of runs) {
    const worker = workers.find((candidate) => run.id.startsWith(`${candidate.id}:`));
    if (worker) group(worker).push(run);
    else entries.push({ kind: 'run', run });
  }
  // A worker that has not called a tool yet is still at work.
  for (const worker of workers) group(worker);
  return entries;
}

/**
 * What the agent did on this turn, one quiet line per tool call:
 * "✓ Searched Semantic Scholar · 0.8s". Each line opens onto its query, input
 * and output. A long finished run folds under "Used N tools"; a failure's
 * cause is always on screen, never behind a click. A research worker gets one
 * line of its own with its steps beneath it.
 */
export function AgentActivity({
  runs,
  live,
  workers = [],
}: {
  runs: ToolRun[];
  live: boolean;
  workers?: AgentWorker[];
}) {
  // null = the author hasn't touched it; follow the live default.
  const [expanded, setExpanded] = useState<boolean | null>(null);

  if (runs.length === 0 && workers.length === 0) return null;

  const failed = runs.filter((run) => run.state === 'error').length;
  const interrupted = runs.filter((run) => run.state === 'interrupted').length;
  const folds = !live && runs.length > FOLD_AFTER;
  const open = !folds || (expanded ?? false);

  const list = (
    <ol className="flex flex-col" aria-label="What the assistant did">
      {entriesFor(runs, workers).map((entry) =>
        entry.kind === 'run' ? (
          <ActivityRun key={entry.run.id} run={entry.run} />
        ) : (
          <WorkerGroup key={`worker-${entry.worker.id}`} entry={entry} live={live} />
        ),
      )}
    </ol>
  );

  if (!folds) return list;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!open)}
        aria-expanded={open}
        className="group/line -mx-1 flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] text-muted-foreground transition-colors duration-120 hover:bg-hover hover:text-foreground"
      >
        <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Used {runs.length} tools</span>
        {workers.length > 0 && (
          <span className="shrink-0">
            · {workers.length} research {workers.length === 1 ? 'worker' : 'workers'}
          </span>
        )}
        {failed > 0 && <span className="shrink-0 text-destructive">· {failed} failed</span>}
        {interrupted > 0 && <span className="shrink-0">· {interrupted} interrupted</span>}
        <ChevronRight
          aria-hidden="true"
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
      </button>
      {open && <div className="mt-0.5 border-l border-border pl-3">{list}</div>}
    </div>
  );
}

/** How a worker ended, or that it has not: the words after its name. */
function workerOutcome(status: string, live: boolean): { text: string; tone: 'working' | 'done' | 'stopped' | 'failed' } {
  switch (status) {
    case 'completed':
      return { text: 'reported back', tone: 'done' };
    case 'failed':
      return { text: 'could not finish', tone: 'failed' };
    case 'budget_exceeded':
      return { text: 'stopped at its limit', tone: 'stopped' };
    case 'cancelled':
      return { text: 'stopped', tone: 'stopped' };
    default:
      // Still `running` in a turn that is over: the turn ended around it.
      return live ? { text: 'working', tone: 'working' } : { text: 'interrupted', tone: 'stopped' };
  }
}

/**
 * One research worker: a line that says how it is doing, over the steps it
 * took. The steps used to sit in the assistant's own list, indistinguishable
 * from it, and the workers were a sentence of counts under the reply.
 */
function WorkerGroup({ entry, live }: { entry: Extract<Entry, { kind: 'worker' }>; live: boolean }) {
  const outcome = workerOutcome(entry.worker.status, live);
  // Open while it works; a finished worker folds to its line.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? outcome.tone === 'working';
  const steps = entry.runs.length;

  const line = (
    <>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {outcome.tone === 'working' ? (
          <Spinner className="h-3 w-3" />
        ) : outcome.tone === 'failed' ? (
          <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 text-destructive" />
        ) : outcome.tone === 'stopped' ? (
          <CircleSlash aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Network aria-hidden="true" className="h-3.5 w-3.5 text-success" />
        )}
      </span>
      <span className={cn('min-w-0 truncate', outcome.tone === 'working' && 'animate-shimmer text-foreground')}>
        Research worker {entry.number}
        <span className="sr-only">: </span>
        <span aria-hidden="true"> · </span>
        {outcome.text}
        {outcome.tone === 'working' && '…'}
      </span>
      {steps > 0 && (
        <span className="shrink-0 tabular-nums">
          <span className="sr-only">, </span>· {steps} {steps === 1 ? 'step' : 'steps'}
        </span>
      )}
      {steps > 0 && (
        <ChevronRight
          aria-hidden="true"
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
      )}
    </>
  );

  const lineClass =
    'group/line -mx-1 flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] text-muted-foreground';

  return (
    <li>
      {steps > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(!open)}
          aria-expanded={open}
          className={cn(lineClass, 'transition-colors duration-120 hover:bg-hover hover:text-foreground')}
        >
          {line}
        </button>
      ) : (
        <div className={lineClass}>{line}</div>
      )}
      {open && steps > 0 && (
        <ol className="ml-[7px] flex flex-col border-l border-border pl-3" aria-label={`Research worker ${entry.number}'s steps`}>
          {entry.runs.map((run) => (
            <ActivityRun key={run.id} run={run} />
          ))}
        </ol>
      )}
    </li>
  );
}

/** One tool call: state, label, duration, the cause of a failure, and a
    disclosure onto whatever it was given and returned. */
function ActivityRun({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false);

  const meta = metaFor(run.tool);
  const duration = formatDuration(run.durationMs);
  const hasDetails = Boolean(
    run.detail || run.argsPreview || run.args || run.outputPreview || run.errorType || run.outputTruncated,
  );

  const stateText =
    run.state === 'running'
      ? 'running'
      : run.state === 'error'
        ? 'failed'
        : run.state === 'interrupted'
          ? 'interrupted'
          : 'finished';

  const label =
    run.state === 'running'
      ? `${meta.running}…`
      : run.state === 'interrupted'
        ? `${meta.running} — interrupted`
        : meta.label;

  const line = (
    <>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {run.state === 'running' ? (
          <Spinner className="h-3 w-3" />
        ) : run.state === 'error' ? (
          <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 text-destructive" />
        ) : run.state === 'interrupted' ? (
          <CircleSlash aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
        )}
        {/* Separators for the accessible name only: flex gaps are not text,
            so this line was read as "finishedSearched …· 812ms". */}
        <span className="sr-only">{stateText}</span>
        <span className="sr-only">: </span>
      </span>
      <span
        className={cn(
          'min-w-0 truncate',
          run.state === 'running' && 'animate-shimmer text-foreground',
          run.state === 'error' && 'text-destructive',
        )}
      >
        {label}
      </span>
      {run.state === 'running' && <RunningMeta run={run} />}
      {duration && (
        <span className="shrink-0 tabular-nums">
          <span className="sr-only">, </span>· {duration}
        </span>
      )}
      {hasDetails && (
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover/line:opacity-100 group-focus-visible/line:opacity-100',
            open && 'rotate-90 opacity-100',
          )}
        />
      )}
    </>
  );

  const lineClass =
    'group/line -mx-1 flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] text-muted-foreground';

  return (
    <li>
      {hasDetails ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cn(lineClass, 'transition-colors duration-120 hover:bg-hover hover:text-foreground')}
        >
          {line}
        </button>
      ) : (
        <div className={lineClass}>{line}</div>
      )}

      {/* The reason a call failed is the one thing the author needs from this
          list — it is never hidden behind another click. */}
      {run.state === 'error' && (
        <p className="ml-5 text-[13px] text-destructive">
          {failureLead(run.errorType)}
          {run.error ? ` — ${run.error}` : '.'}
        </p>
      )}

      {open && hasDetails && (
        <div className="mb-1.5 ml-5 mt-1 space-y-1.5 border-l border-border pl-3 text-xs text-muted-foreground">
          {run.detail && <p>{run.detail}</p>}
          {run.outputTruncated && run.state !== 'error' && (
            <p>The reply was cut at the size limit; the assistant saw only part of it.</p>
          )}
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
            <p>
              Error type: <code className="font-mono">{run.errorType}</code>
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
      <p className="font-medium">
        {label}
        {note && <span className="font-normal"> ({note})</span>}
      </p>
      <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-code-bg p-2 font-mono text-xs text-foreground">
        {text}
      </pre>
    </div>
  );
}
