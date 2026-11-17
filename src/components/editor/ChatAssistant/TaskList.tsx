import { useState } from 'react';
import { ChevronRight, Circle, CircleCheck, CircleDot, ListChecks, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentTodo } from '@/api/assistant/streamParser';

/** What a task's state reads as, for the accessible name of its row. */
function statusText(status: AgentTodo['status'], live: boolean): string {
  if (status === 'completed') return 'Done';
  if (status === 'in_progress') return live ? 'In progress' : 'Not finished';
  return 'To do';
}

function TaskItems({ items, live }: { items: AgentTodo[]; live: boolean }) {
  return (
    <ol className="space-y-1.5" aria-label="Assistant task list">
      {items.map((item) => {
        const current = item.status === 'in_progress';
        return (
          <li key={item.id} className="flex items-start gap-2">
            {item.status === 'completed' ? (
              <CircleCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
            ) : current && live ? (
              <LoaderCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin text-ai" />
            ) : current ? (
              // The turn ended with this one started: neither done nor untouched.
              <CircleDot aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Circle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                'min-w-0 break-words',
                item.status === 'completed' && 'text-muted-foreground',
                current && live && 'font-medium text-foreground',
              )}
            >
              <span className="sr-only">{statusText(item.status, live)}: </span>
              {item.content}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function doneCount(items: AgentTodo[]): number {
  return items.filter((item) => item.status === 'completed').length;
}

/**
 * The task list a finished reply leaves behind: what was planned and how far
 * it got. While the turn runs, `LiveTaskBar` shows the same list where it
 * stays in view.
 */
export function TaskList({ items }: { items: AgentTodo[] }) {
  if (items.length === 0) return null;
  const done = doneCount(items);
  const unfinished = items.length - done;
  return (
    <details className="rounded-lg border border-border px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">
        Tasks · {done} of {items.length} done
        {unfinished > 0 && <span className="font-normal text-muted-foreground"> · {unfinished} left</span>}
      </summary>
      <div className="mt-2">
        <TaskItems items={items} live={false} />
      </div>
    </details>
  );
}

/**
 * The running turn's task list, pinned above the composer.
 *
 * Inside the reply it scrolled out of view as soon as the reply grew, which is
 * exactly when the author wants to know how far a long request has got. One
 * line says how many tasks are done and which one is being worked on; it
 * opens onto the whole list.
 */
export function LiveTaskBar({ items }: { items: AgentTodo[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const done = doneCount(items);
  const current =
    items.find((item) => item.status === 'in_progress') ?? items.find((item) => item.status === 'pending');
  const headline = current ? current.content : 'All tasks done';
  return (
    <section aria-label="Task progress" className="mb-2 rounded-lg border border-border bg-popover text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors duration-120 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ListChecks aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {done}/{items.length}
          <span className="sr-only"> tasks done.</span>
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{headline}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && '-rotate-90')}
        />
      </button>
      {/* Announced when the assistant moves on: a handful of times in a run. */}
      <p role="status" className="sr-only">
        {current ? `Working on: ${current.content}` : 'All tasks done'}
      </p>
      {open && (
        <div className="max-h-48 overflow-y-auto border-t border-border px-3 py-2">
          <TaskItems items={items} live />
        </div>
      )}
    </section>
  );
}
