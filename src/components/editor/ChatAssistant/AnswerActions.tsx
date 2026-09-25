import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, FileInput, RotateCcw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEditorActions, type Block } from '@/editor';
import type { AgentSource } from '@/services/streamParser';
import { rememberedBlockId, useEditorFocus } from '@/components/editor/References';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToastContext } from '@/components/ui/toastContext';
import { formatTokens } from './AgentActivity/toolMeta';
import { replyToBlocks } from './replyToBlocks';
import { copyAnswer } from './answerClipboard';
import { scrollBehavior } from '@/lib/motion';

const isListItem = (block: Block | undefined) =>
  block?.type === 'paragraph' &&
  (block.variant === 'bullet' || block.variant === 'numbered' || block.variant === 'todo');

function ActionButton({
  label,
  tooltip,
  onClick,
  children,
}: {
  label: string;
  tooltip: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-120 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** A confirmation that lasts long enough to read, then goes back. */
function useFlag(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setOn(false), 1600);
    return () => clearTimeout(timer);
  }, [on]);
  return [on, () => setOn(true)];
}

/**
 * What can be done with a finished answer: copy it, put it into the page with
 * its citations, ask again, and — when it proposed edits — go review them.
 *
 * Shown on hover for older answers and always for the latest one; always on
 * touch screens, which have no hover to reveal them.
 */
export function AnswerActions({
  text,
  sources,
  openChangeCount,
  onReviewChanges,
  onRetry,
  usage,
  pinned,
}: {
  text: string;
  sources: readonly AgentSource[];
  openChangeCount: number;
  onReviewChanges: () => void;
  /** Ask the same question again; absent where that is not on offer. */
  onRetry?: () => void;
  usage?: { promptTokens: number; completionTokens: number };
  /** Keep the row visible without hover (the latest answer). */
  pinned: boolean;
}) {
  const { insertBlocksAfter, getBlockIds, getBlock, markRecentlyChanged, upsertSources } = useEditorActions();
  const focus = useEditorFocus();
  // Optional: the panel also renders outside the app shell (tests, previews).
  const toaster = useContext(ToastContext);
  const [copied, flagCopied] = useFlag();
  const [inserted, flagInserted] = useFlag();
  const [placed, setPlaced] = useState('');

  const copy = async () => {
    try {
      // The numbers the answer shows, with the list they point to — not the
      // chat's internal [S1] handles.
      await copyAnswer(text, sources);
      flagCopied();
    } catch {
      /* a clipboard the browser refuses is not worth an error banner */
    }
  };

  // Below where the author was writing, or at the end of the page.
  const insert = () => {
    const blocks = replyToBlocks(text, sources);
    if (blocks.length === 0) return;
    const ids = getBlockIds();
    const remembered = rememberedBlockId();
    let anchor = remembered ?? ids[ids.length - 1] ?? null;
    let where = remembered ? 'Below where you were writing' : 'At the end of the page';
    // A reply that opens with prose does not belong inside a list: it goes
    // after the list the caret was in instead of splitting it in two.
    if (remembered && isListItem(getBlock(remembered)) && !isListItem(blocks[0])) {
      let index = ids.indexOf(remembered);
      while (index + 1 < ids.length && isListItem(getBlock(ids[index + 1]))) index++;
      anchor = ids[index];
      where = 'Below the list you were writing in';
    }
    const added = insertBlocksAfter(anchor, blocks);
    // Sources the inserted text cites join the library with it.
    const citedKeys = new Set(
      blocks.flatMap((block) =>
        block.type === 'paragraph'
          ? (block.children ?? []).flatMap((child) => (child.type === 'citation' ? child.keys : []))
          : [],
      ),
    );
    upsertSources(
      sources
        .filter((source) => citedKeys.has(source.key))
        .map(({ id: _id, origin: _origin, ...record }) => record),
    );
    markRecentlyChanged(added);
    setPlaced(where);
    flagInserted();
    // The tooltip closes on click, so where the reply went is said here.
    toaster?.toast({ title: 'Inserted into page', description: where });
    // Show where it went when that is off screen.
    requestAnimationFrame(() => {
      const first = added[0] && document.querySelector(`[data-block-id="${CSS.escape(added[0])}"]`);
      if (first instanceof HTMLElement) first.scrollIntoView?.({ block: 'nearest', behavior: scrollBehavior() });
    });
  };

  const hasUsage = usage && (usage.promptTokens > 0 || usage.completionTokens > 0);
  // What the reply cost is for the curious, not part of the answer: it
  // rides in the Copy tooltip instead of a line of telemetry under every reply.
  const copyTooltip = copied ? (
    'Copied'
  ) : hasUsage ? (
    <span className="flex flex-col">
      <span>Copy</span>
      <span className="text-xs tabular-nums opacity-70">
        {formatTokens(usage.promptTokens)} tokens in · {formatTokens(usage.completionTokens)} out
      </span>
    </span>
  ) : (
    'Copy'
  );
  const insertTooltip = inserted
    ? `Inserted · ${placed.toLowerCase()}`
    : focus
      ? 'Insert below where you were writing'
      : 'Insert at the end of the page';

  // Proposed edits are the one thing on this row that cannot wait for a
  // hover: it stays in view, and the quiet icons fade in beside it.
  const faded = cn(
    'flex items-center gap-0.5 transition-opacity duration-120',
    !pinned &&
      'opacity-0 focus-within:opacity-100 group-hover/message:opacity-100 [@media(hover:none)]:opacity-100',
  );

  return (
    <div className="-ml-1.5 flex min-h-7 flex-wrap items-center gap-x-1 gap-y-1">
      {openChangeCount > 0 && (
        <button
          type="button"
          onClick={onReviewChanges}
          className="ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-md bg-ai/10 px-2 text-sm font-medium text-ai outline-none transition-colors duration-120 hover:bg-ai/15 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
          Review {openChangeCount} {openChangeCount === 1 ? 'change' : 'changes'}
        </button>
      )}
      {text && (
        <div className={faded}>
          <ActionButton label={copied ? 'Copied' : 'Copy'} tooltip={copyTooltip} onClick={copy}>
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </ActionButton>
          <ActionButton
            label={inserted ? 'Inserted into page' : 'Insert into page'}
            tooltip={insertTooltip}
            onClick={insert}
          >
            {inserted ? <Check className="h-4 w-4 text-success" /> : <FileInput className="h-4 w-4" />}
          </ActionButton>
          {onRetry && (
            <ActionButton label="Retry" tooltip="Ask again" onClick={onRetry}>
              <RotateCcw className="h-4 w-4" />
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}
