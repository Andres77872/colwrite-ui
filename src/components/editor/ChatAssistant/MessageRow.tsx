import { MessageAttachments } from './ChatAttachments';
import { useMemo } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import {
  AgentProgressLine,
  AgentStatusLine,
  type AgentProgress,
} from '@/components/editor/AgentProgress';
import { ChatRefTags } from './ChatRefTags';
import { ChatMarkdown } from './ChatMarkdown';
import type { SourceMarkers } from './ChatMarkdown/ChatMarkdown';
import { AgentActivity } from './AgentActivity';
import { AnswerActions } from './AnswerActions';
import { AnswerSources, SourceHoverCard } from './AnswerSources';
import { ReasoningBlock } from './ReasoningBlock';
import { TaskList } from './TaskList';
import { useSourceMarkers } from './answerSourceMarkers';
import type { ChatMessage } from './chatUtils';

/** Below the answer, a step shorter than this never shows, so quick hand-offs do not flash. */
const STEP_DEBOUNCE_MS = 300;

/* ----------------------------------------
   One turn of the conversation
   ---------------------------------------- */

export function MessageRow({
  message,
  live,
  progress,
  latest,
  openChangeIds,
  onFocusChange,
  onRetry,
}: {
  message: ChatMessage;
  live: boolean;
  /** What the running turn is doing, and since when (set only while live). */
  progress?: AgentProgress | null;
  /** The last answer in the conversation: its actions stay in view. */
  latest: boolean;
  openChangeIds: string[];
  onFocusChange: (changeId: string) => void;
  onRetry?: () => void;
}) {
  const isUser = message.role === 'user';
  const { markers } = useSourceMarkers(message.id, message.content, message.sources);

  // Each marker opens a preview of its source on hover or focus.
  const previewMarkers = useMemo<SourceMarkers>(() => {
    const sources = message.sources ?? [];
    return {
      ...markers,
      wrap: (id, marker) => {
        const source = sources.find((candidate) => candidate.id === id);
        const number = markers.numberOf(id);
        if (!source || number === undefined) return marker;
        return (
          <SourceHoverCard source={source} number={number}>
            {marker}
          </SourceHoverCard>
        );
      },
    };
  }, [markers, message.sources]);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-subtle px-3 py-2 text-[14.5px] leading-[1.6] text-foreground">
          <MessageAttachments attachments={message.attachments} />
          <ChatRefTags text={message.content} />
        </div>
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

      {/* At the foot of a reply that is still running, where the reader's eye
          already is. The steps above can be scrolled away by a long answer,
          and a reply that paused after a paragraph used to look finished
          while the assistant went on searching or drafting. */}
      {live && message.content && progress && (
        <AgentStatusLine progress={progress} debounceMs={STEP_DEBOUNCE_MS} />
      )}

      {/* A server in auto-apply mode writes to the document during the turn.
          Without this line the only evidence was a highlight that faded. */}
      {message.applied > 0 && (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Applied {message.applied} {message.applied === 1 ? 'change' : 'changes'} to the document.
        </p>
      )}

      {message.content && message.sources && message.sources.length > 0 && (
        <AnswerSources messageId={message.id} text={message.content} sources={message.sources} />
      )}

      {!live && (message.content || openChangeIds.length > 0) && (
        <AnswerActions
          text={message.content}
          sources={message.sources ?? []}
          openChangeCount={openChangeIds.length}
          onReviewChanges={() => onFocusChange(openChangeIds[0])}
          onRetry={onRetry}
          usage={message.usage}
          pinned={latest}
        />
      )}
    </div>
  );
}
