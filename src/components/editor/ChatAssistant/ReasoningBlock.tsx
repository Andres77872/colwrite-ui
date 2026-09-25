import { useState, type ReactNode } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatElapsed, useNow } from '@/components/editor/AgentProgress';

/** Short enough to fit two lines of the narrowest panel, so its end shows. */
const PREVIEW_CHARS = 90;

/**
 * The end of the newest line of reasoning, for the preview while it streams.
 * It is the end that moves, so that is what stays visible; the start is cut
 * at a word boundary rather than mid-word.
 */
function latestLine(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\*\*/g, '').trim())
    .filter(Boolean);
  const last = lines.at(-1) ?? '';
  if (last.length <= PREVIEW_CHARS) return last;
  const tail = last.slice(-PREVIEW_CHARS);
  const space = tail.indexOf(' ');
  return `…${space > 0 && space < 24 ? tail.slice(space + 1) : tail}`;
}

/** Paragraphs, with the `**headline**` markup Codex's summaries use. */
function renderReasoning(text: string): ReactNode {
  return text.split(/\n{2,}/).map((paragraph, index) => (
    <p key={index} className="whitespace-pre-wrap">
      {paragraph.split(/(\*\*[^*\n]+\*\*)/g).map((part, partIndex) =>
        /^\*\*[^*\n]+\*\*$/.test(part) ? (
          <strong key={partIndex} className="font-medium text-foreground/80">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </p>
  ));
}

/**
 * What the model reasoned before and between its answers.
 *
 * While it thinks: "Thinking · 12s" with the newest line underneath, so a
 * long silence reads as work. Afterwards it folds to "Thought for 12s", one
 * click from the full text. It is never part of the answer, and the answer's
 * copy and insert actions leave it out.
 */
export function ReasoningBlock({
  text,
  live,
  thinkingMs = 0,
  thinkingSince,
}: {
  text: string;
  /** The turn is still running. */
  live: boolean;
  thinkingMs?: number;
  /** Set while a stretch of reasoning is under way. */
  thinkingSince?: number;
}) {
  const [open, setOpen] = useState(false);
  const thinking = live && thinkingSince !== undefined;
  const now = useNow(thinking);
  const totalMs = thinkingMs + (thinking ? Math.max(0, now - thinkingSince) : 0);

  const title = thinking
    ? 'Thinking'
    : totalMs >= 1000
      ? `Thought for ${formatElapsed(totalMs)}`
      : 'Thoughts';
  const preview = thinking && !open ? latestLine(text) : '';

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group/line -mx-1 flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] text-muted-foreground transition-colors duration-120 hover:bg-hover hover:text-foreground"
      >
        <Brain aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className={cn('truncate', thinking && 'animate-shimmer text-foreground')}>{title}</span>
        {thinking && totalMs >= 2000 && (
          <span aria-hidden="true" className="shrink-0 tabular-nums">
            · {formatElapsed(totalMs)}
          </span>
        )}
        <ChevronRight
          aria-hidden="true"
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
      </button>
      {preview && (
        <p aria-hidden="true" className="ml-5 line-clamp-2 break-words text-xs text-muted-foreground/80">
          {preview}
        </p>
      )}
      {open && (
        <div className="mb-1 ml-1.5 mt-1 max-h-64 space-y-2 overflow-y-auto border-l border-border pl-3 text-xs leading-relaxed text-muted-foreground">
          {renderReasoning(text)}
        </div>
      )}
    </div>
  );
}
