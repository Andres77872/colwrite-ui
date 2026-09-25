import { useEffect, useState } from 'react';

/**
 * What a running assistant turn is doing, in the terms an author waits on.
 *
 * A turn used to show "Thinking…" until the first word and then nothing at
 * all: a model reasoning for thirty seconds, a CLI engine starting up, an
 * overloaded API being retried and a long edit being drafted all looked the
 * same, and all looked stuck. Every surface that runs the agent (the chat,
 * Ask AI, AI beats) now names the phase and how long it has lasted.
 */
export type AgentPhase =
  /** Saving the document so the assistant reads what is on screen. */
  | 'preparing'
  /** The durable run is waiting for a free slot on the server. */
  | 'queued'
  /** A local engine (Claude Code, Codex) is launching. */
  | 'starting'
  /** The model is working and has nothing to show yet. */
  | 'thinking'
  /** A tool call is being written or is running. */
  | 'tool'
  /** Answer text is arriving. */
  | 'writing'
  /** The engine is retrying a failed or overloaded API call. */
  | 'retrying'
  /** The browser lost the connection and is resuming the saved run. */
  | 'reconnecting';

export type AgentProgress = {
  phase: AgentPhase;
  /** One line for the author, ending in "…" while it lasts. */
  label: string;
  /** When this phase began (`Date.now()`), for the elapsed counter. */
  since: number;
};

/**
 * The phase a server `status` event announces, or `null` when other events
 * describe it better (`executing_tool`: the tool events name the tool).
 */
export function progressForStatus(
  status: string,
  detail: string,
): Pick<AgentProgress, 'phase' | 'label'> | null {
  const text = detail.trim();
  switch (status) {
    case 'attaching':
    case 'saving':
      return { phase: 'preparing', label: text || 'Saving…' };
    case 'queued':
      return { phase: 'queued', label: text || 'Waiting to start…' };
    case 'starting':
      return { phase: 'starting', label: text || 'Starting…' };
    case 'retrying':
      return { phase: 'retrying', label: text || 'Retrying…' };
    case 'reconnecting':
      return { phase: 'reconnecting', label: text || 'Reconnecting…' };
    case 'executing_tool':
      return null;
    default:
      // `thinking`, the durable run's `running`, and anything newer. The
      // engines' own copy ends in "…" and is shown as sent; older wording
      // ("Processing tool results...") named the wrong step, so it reads as
      // plain thinking.
      return { phase: 'thinking', label: text.endsWith('…') ? text : 'Thinking…' };
  }
}

/** Move to `next`, keeping the start time when nothing visible changed. */
export function advanceProgress(
  current: AgentProgress | null,
  next: Pick<AgentProgress, 'phase' | 'label'>,
  now = Date.now(),
): AgentProgress {
  if (current && current.phase === next.phase && current.label === next.label) return current;
  return { ...next, since: now };
}

/** "8s", "1m 05s": how long a phase or a step has been going. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
}

/** "2,410 characters" / "12.4k characters": how much of an edit is drafted. */
export function formatDraftSize(chars: number): string {
  if (chars < 10_000) return `${chars.toLocaleString()} characters`;
  return `${(chars / 1000).toFixed(1)}k characters`;
}

/** The current time, refreshed every `intervalMs` while `active`. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNow(Date.now());
    // The first tick lands at once, so a counter that becomes visible after
    // a pause does not show the time from when it was last active.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, intervalMs]);
  return now;
}
