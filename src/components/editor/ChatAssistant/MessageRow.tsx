import { MessageAttachments } from './ChatAttachments';
import { useMemo, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEditorActions, type Block } from '@/editor';
import type { AutoAppliedSet } from '@/editor/proposalsContextState';
import { AutoAppliedNote } from './AutoAppliedNote';
import {
  AgentProgressLine,
  AgentStatusLine,
  type AgentProgress,
} from '@/components/editor/AgentProgress';
import { ChatRefTags, messageForClipboard } from './ChatRefTags';
import { ChatMarkdown } from './ChatMarkdown';
import type { SourceMarkers } from './ChatMarkdown/ChatMarkdown';
import { AgentActivity } from './AgentActivity';
import { AnswerActions } from './AnswerActions';
import { CopyButton, REVEAL_ON_HOVER } from './MessageActions';
import { replyMetaOf } from './replyMeta';
import { AnswerSources, SourceHoverCard } from './AnswerSources';
import { ReasoningBlock } from './ReasoningBlock';
import { ReplyClaims } from './ReplyClaims';
import { budgetNote } from './replyMeta';
import { TaskList } from './TaskList';
import { QuestionCard, type AnswerQuestion } from './QuestionCard';
import { ImageGenerationCard } from '../ImageGeneration/ImageGenerationCard';
import { useSourceMarkers } from './answerSourceMarkers';
import type { ChatMessage } from './chatUtils';
import type { AgentSource } from '@/api/assistant/streamParser';

/** Below the answer, a step shorter than this never shows, so quick hand-offs do not flash. */
const STEP_DEBOUNCE_MS = 300;

/* ----------------------------------------
   One turn of the conversation
   ---------------------------------------- */

export function MessageRow({
  message,
  knownSources,
  live,
  progress,
  latest,
  openChangeIds,
  onFocusChange,
  onRetry,
  autoApplied,
  onAnswerQuestion,
  planCard,
}: {
  message: ChatMessage;
  /**
   * The conversation's sources (`conversationSources`): a handle lasts for
   * the conversation, so this reply's markers are read against them all.
   */
  knownSources: readonly AgentSource[];
  live: boolean;
  /** What the running turn is doing, and since when (set only while live). */
  progress?: AgentProgress | null;
  /** The last answer in the conversation: its actions stay in view. */
  latest: boolean;
  openChangeIds: string[];
  onFocusChange: (changeId: string) => void;
  onRetry?: () => void;
  /** Only the branch's latest unanswered card is actionable. */
  onAnswerQuestion?: AnswerQuestion;
  /** The current plan, supplied once per id rather than a historical snapshot. */
  planCard?: ReactNode;
  /** The change sets the editor applied from this reply, with Auto on. */
  autoApplied?: {
    sets: readonly AutoAppliedSet[];
    onUndo: (id: string) => void;
    onReview: (id: string) => void;
  };
}) {
  const isUser = message.role === 'user';
  const { markers } = useSourceMarkers(message.id, message.content, knownSources);

  // Each marker opens a preview of its source on hover or focus.
  const previewMarkers = useMemo<SourceMarkers>(() => ({
    ...markers,
    wrap: (handle, marker) => {
      const source = knownSources.find((candidate) => candidate.handle === handle);
      const number = markers.numberOf(handle);
      if (!source || number === undefined) return marker;
      return (
        <SourceHoverCard source={source} number={number}>
          {marker}
        </SourceHoverCard>
      );
    },
  }), [markers, knownSources]);

  if (isUser) {
    return (
      <div className="group/message relative mb-1.5 flex justify-end" data-run-id={message.runId} tabIndex={-1}>
        <div className="min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-subtle px-3 py-2 text-[14.5px] leading-[1.6] text-foreground">
          <MessageAttachments attachments={message.attachments} />
          <ChatRefTags text={message.content} />
        </div>
        {message.content && <UserMessageActions text={message.content} />}
      </div>
    );
  }

  const toolRunning = message.runs.some((run) => run.state === 'running');
  const reasoningLive = live && message.thinkingSince !== undefined;
  // Before the first word, the step above already moves while a tool runs or
  // the model reasons; otherwise this line is the only sign of life.
  const waiting = live && !message.content && !toolRunning && !reasoningLive;
  const waitingProgress: AgentProgress | null = progress
    ? progress.phase === 'tool' || progress.phase === 'writing'
      ? { phase: 'thinking', label: 'Thinking…', since: progress.since }
      : progress
    : null;

  return (
    <div className="group/message flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-ai" />
        ColWrite AI
      </p>

      {message.reasoning && (
        <ReasoningBlock
          text={message.reasoning}
          live={live}
          thinkingMs={message.thinkingMs}
          thinkingSince={message.thinkingSince}
        />
      )}

      {(message.runs.length > 0 || !!message.workers?.length) && (
        <AgentActivity runs={message.runs} live={live} workers={message.workers} />
      )}

      {/* While the turn runs the list is pinned above the composer, where it
          stays in view; afterwards it is part of the reply. */}
      {!live && !!message.todos?.length && <TaskList items={message.todos} />}

      {/* Before the first word: what it is doing, in a quiet shimmer. */}
      {waiting &&
        (waitingProgress ? (
          <AgentProgressLine label={waitingProgress.label} since={waitingProgress.since} />
        ) : (
          <p role="status" className="animate-shimmer text-[13px] text-muted-foreground">
            Thinking…
          </p>
        ))}

      {message.content && <ChatMarkdown text={message.content} sources={previewMarkers} />}
      {planCard}
      {message.question && <QuestionCard question={message.question} onAnswer={onAnswerQuestion} />}
      {message.artifacts?.map((artifact) => <ImageGenerationCard key={artifact.generation_id}
        generationId={artifact.generation_id} allowInsert={artifact.kind === 'image_request'} />)}

      {/* How a reply that did not complete ended, as its record keeps it: a
          stopped one used to look finished, and one stopped before its
          first word showed nothing at all. */}
      {!live && message.ended === 'failed' && message.failure && (
        <p className="text-[13px] text-destructive">
          This reply did not finish: {message.failure.message || message.failure.code}
        </p>
      )}
      {!live && message.ended === 'stopped' && !message.content && (
        <p className="text-[13px] text-muted-foreground">Stopped before it wrote an answer.</p>
      )}

      {/* At the foot of a reply that is still running, where the reader's eye
          already is. The steps above can be scrolled away by a long answer,
          and a reply that paused after a paragraph used to look finished
          while the assistant went on searching or drafting. */}
      {live && message.content && progress && (
        <AgentStatusLine progress={progress} debounceMs={STEP_DEBOUNCE_MS} />
      )}
      {/* How far into its limits the run is, once a counter crossed two thirds (`budget`). */}
      {live && message.ledger && budgetNote(message.ledger) && (
        <p className="text-xs text-muted-foreground">{budgetNote(message.ledger)}</p>
      )}

      {/* Each claim check, with the passages it was judged against. */}
      {!!message.claims?.length && <ReplyClaims claims={message.claims} sources={knownSources} />}

      {/* With Auto on, the editor applies the reply's edits as they arrive.
          Without this line the only evidence was a highlight that faded. */}
      {autoApplied && (
        <AutoAppliedNote
          sets={autoApplied.sets}
          // Said only when the reply proposed something that then waited.
          paused={message.changeSetIds.length > 0 ? message.autoPaused : null}
          onUndo={autoApplied.onUndo}
          onReview={autoApplied.onReview}
        />
      )}

      {/* What it cites, whichever turn found it, and what it consulted. */}
      {message.content && (
        <AnswerSources messageId={message.id} text={message.content} sources={message.sources ?? []} known={knownSources} />
      )}

      {!live && (message.content || openChangeIds.length > 0 || message.ended) && (
        <AnswerActions
          text={message.content}
          // Copy and Insert turn its markers into the sources they name.
          sources={knownSources}
          openChangeCount={openChangeIds.length}
          onReviewChanges={() => {
            const [first] = openChangeIds;
            if (first) onFocusChange(first);
          }}
          onRetry={onRetry}
          meta={replyMetaOf(message)}
          pinned={latest}
        />
      )}
    </div>
  );
}

/**
 * Under a question: Copy, on hover or focus like the reply's actions.
 *
 * It hangs below the bubble in the gap before the reply instead of adding a
 * row: on the right, where the reply's first line ("ColWrite AI") leaves
 * room. A row of its own pushed every answer half a line away from its
 * question. Its top padding keeps the pointer inside the turn on the way
 * from bubble to button, so the button does not blink out between them.
 *
 * The page's blocks name the message's references, read at the click rather
 * than kept in step with every keystroke in the page.
 */
function UserMessageActions({ text }: { text: string }) {
  const { getBlockIds, getBlock } = useEditorActions();
  const read = () =>
    messageForClipboard(
      text,
      getBlockIds()
        .map((id) => getBlock(id))
        .filter((block): block is Block => block !== undefined),
    );
  return (
    <div
      className={cn(
        'absolute -right-1.5 top-full z-[1] flex items-center pt-0.5 transition-opacity duration-120',
        REVEAL_ON_HOVER,
      )}
    >
      <CopyButton label="Copy message" read={read} className="flex-row-reverse" />
    </div>
  );
}
