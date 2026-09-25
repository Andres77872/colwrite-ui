import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatElapsed, useNow, type AgentProgress } from './agentProgress';

/** Below this the counter would only flicker past on quick steps. */
const SHOW_ELAPSED_AFTER_MS = 2000;
/** A reply that has gone this long without a new word is shown as still at work. */
const WRITING_IDLE_MS = 1500;

type Tone = 'muted' | 'ai';

/**
 * One quiet line saying what the assistant is doing and for how long:
 * "Starting Claude Code… · 4s".
 *
 * The label is a polite live region, so a screen reader hears each new phase
 * once; the ticking counter is hidden from it, or it would be read out every
 * second.
 */
export function AgentProgressLine({
  label,
  since,
  tone = 'muted',
  as: Element = 'p',
  className,
}: {
  label: string;
  since: number;
  /** `ai` for the Ask AI bar, where the line sits in the accent colour. */
  tone?: Tone;
  /** `span` inside inline widgets, where a paragraph may not nest. */
  as?: 'p' | 'span';
  className?: string;
}) {
  const now = useNow(true);
  const elapsed = now - since;
  return (
    <Element
      role="status"
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-[13px]',
        tone === 'ai' ? 'text-ai' : 'text-muted-foreground',
        className,
      )}
    >
      <span className="min-w-0 truncate animate-shimmer">{label}</span>
      {elapsed >= SHOW_ELAPSED_AFTER_MS && (
        <span aria-hidden="true" className="shrink-0 tabular-nums opacity-80">
          · {formatElapsed(elapsed)}
        </span>
      )}
    </Element>
  );
}

/**
 * The status line for a running turn, from its {@link AgentProgress}.
 *
 * While words are arriving the text itself is the progress, so it renders
 * `whileWriting` (nothing, by default). Once they stop for a moment — the
 * model went back to thinking, or is writing a tool call it has not announced
 * yet — it says "Working…" with the time since the last word, instead of
 * leaving a reply that looks finished.
 */
export function AgentStatusLine({
  progress,
  whileWriting = null,
  debounceMs = 0,
  tone,
  as,
  className,
}: {
  progress: AgentProgress;
  whileWriting?: ReactNode;
  /** Hide a step for its first moments, so quick hand-offs do not flash. */
  debounceMs?: number;
  tone?: Tone;
  as?: 'p' | 'span';
  className?: string;
}) {
  const now = useNow(true, 250);
  // `now` is the last tick, so a phase that began since then reads as just
  // begun rather than as a negative stretch that hides the line.
  const idle = Math.max(0, now - progress.since);
  if (progress.phase === 'writing') {
    if (idle < WRITING_IDLE_MS) return whileWriting;
    return (
      <AgentProgressLine label="Working…" since={progress.since} tone={tone} as={as} className={className} />
    );
  }
  if (idle < debounceMs) return null;
  return (
    <AgentProgressLine label={progress.label} since={progress.since} tone={tone} as={as} className={className} />
  );
}
