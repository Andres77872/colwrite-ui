import { CornerDownLeft, FileText, Sparkles } from 'lucide-react';
import { ChatRefTags } from './ChatRefTags';
import { ChatMarkdown } from './ChatMarkdown';
import { AgentActivity } from './AgentActivity';
import { CopyReply } from './CopyReply';
import type { ChatMessage } from './chatUtils';

/* ----------------------------------------
   One turn of the conversation
   ---------------------------------------- */

export function MessageRow({
  message,
  live,
  openChangeIds,
  onFocusChange,
}: {
  message: ChatMessage;
  live: boolean;
  openChangeIds: string[];
  onFocusChange: (changeId: string) => void;
}) {
  const isUser = message.role === 'user';
  const isStreamingTail = live && !isUser && !message.content && message.runs.length === 0;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="min-w-0 max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary-strong px-3 py-2 text-sm text-primary-foreground">
          <ChatRefTags text={message.content} surface="onfill" />
        </div>
      </div>
    );
  }

  return (
    <div className="group/message space-y-2">
      {message.runs.length > 0 && (
        <AgentActivity runs={message.runs} live={live} usage={message.usage} />
      )}

      {isStreamingTail ? (
        <span className="inline-flex gap-1 px-1 py-2" aria-label="Assistant is typing">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 animate-shimmer rounded-full bg-muted-foreground"
              style={{ animationDelay: `${dot * 160}ms` }}
            />
          ))}
        </span>
      ) : (
        message.content && (
          <div className="rounded-2xl rounded-bl-sm bg-muted/60 px-3 py-2 text-sm text-foreground">
            <ChatMarkdown text={message.content} />
          </div>
        )
      )}

      {openChangeIds.length > 0 && (
        <button
          type="button"
          onClick={() => onFocusChange(openChangeIds[0])}
          className="flex w-full items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-left text-xs transition-colors hover:bg-primary/15"
        >
          <Sparkles aria-hidden="true" className="h-3 w-3 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            Suggested {openChangeIds.length}{' '}
            {openChangeIds.length === 1 ? 'change' : 'changes'} — review in the document
          </span>
          <CornerDownLeft aria-hidden="true" className="h-3 w-3 shrink-0 text-primary" />
        </button>
      )}

      {/* A server in auto-apply mode writes to the document during the turn.
          The transcript said nothing at all about it, so the only evidence was
          a highlight that faded after four seconds. */}
      {message.applied > 0 && (
        <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
          <FileText aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1">
            Applied {message.applied} {message.applied === 1 ? 'change' : 'changes'} to the
            document.
          </span>
        </p>
      )}

      {message.content && !live && <CopyReply text={message.content} />}
    </div>
  );
}
