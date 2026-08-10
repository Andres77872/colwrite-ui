import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { usePersistentState, isBoolean } from '@/hooks/usePersistentState';
import { usePanels } from '@/components/panels/panelsContextState';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useEditor } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import { useChatSessions } from '../../chat/chatSessionsState';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';
import { CHAT_MARGIN, useChatWindow } from './useChatWindow';
import { useAgentTurn } from './useAgentTurn';
import { useConversationLoader } from './useConversationLoader';
import { ResizeHandles } from './ResizeHandles';
import { MessageRow } from './MessageRow';
import {
  AlertCircle,
  ArrowDown,
  FileClock,
  FileText,
  GripVertical,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';

/** How close to the bottom counts as "following along" for auto-scroll. */
const AUTOSCROLL_THRESHOLD_PX = 64;

/** The composer refuses more than this, and warns as it approaches. */
const MAX_MESSAGE_LENGTH = 2000;

const SUGGESTIONS = [
  'Summarise this document in three sentences',
  'Tighten the introduction',
  'Suggest a structure for the results section',
];

export function ChatAssistant() {
  // Keyed on the document *session*, not on its id. Opening another document
  // starts a new session and so a new transcript; saving the draft that is
  // already open only gives it an id, and must not throw away the conversation
  // that asked for it to be saved in the first place.
  const { documentSessionId } = useEditor();
  return <DocumentChatAssistant key={documentSessionId} />;
}

function DocumentChatAssistant() {
  const editor = useEditor();
  const {
    documentId,
    loadingDocumentId,
    ensureRemoteDocument,
    hasPendingEdits,
    saveRemote,
    restoreEpoch,
  } = editor;
  const proposals = useProposals();
  const { selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId } =
    useChatSessions();

  // Open/closed is shell state (see PanelsContext): the Mod+J shortcut toggles
  // it from outside this component. Maximized stays local — nothing else has a
  // reason to touch it.
  const { assistantOpen: expanded, setAssistantOpen: setExpanded } = usePanels();
  const [maximized, setMaximized] = usePersistentState<boolean>('chat.maximized', false, isBoolean);
  const [input, setInput] = useState('');
  const [atBottom, setAtBottom] = useState(true);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputHostRef = useRef<ChatTaggedInputHandle | null>(null);
  const refPickerRef = useRef<ChatRefPickerHandle | null>(null);
  const pinnedToBottom = useRef(true);
  /**
   * The claim on which conversation the transcript on screen is, shared by the
   * two hooks: the loader claims a key while it fetches, and a finished stream
   * pre-claims the conversation its `done` ids name so the loader does not
   * refetch it (see useConversationLoader and useAgentTurn).
   */
  const loadedConversationRef = useRef<string | null>(null);

  const unsavedNoticeId = useId();
  const composerHintId = useId();

  const {
    messages,
    isStreaming,
    error,
    agentStatus,
    activeMessageId,
    lastExchange,
    send,
    onStop,
    onRetry,
    resetChatUI,
    abortRef,
    setMessages,
    setIsStreaming,
    setAgentStatus,
  } = useAgentTurn({
    documentId,
    loadingDocumentId,
    restoreEpoch,
    ensureRemoteDocument,
    hasPendingEdits,
    saveRemote,
    selectedChatId,
    selectedThreadId,
    setSelectedChatId,
    setSelectedThreadId,
    proposals,
    setInput,
    setAtBottom,
    pinnedToBottom,
    refPickerRef,
    loadedConversationRef,
  });

  // Below `md` there is no room to place a window: it fills the canvas, and
  // dragging it anywhere would only push it off screen.
  const isDesktop = useIsDesktop();
  const floating = isDesktop && !maximized;
  const { rect, dragging, beginDrag, nudge, reset } = useChatWindow({
    enabled: floating,
  });

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== 'system'),
    [messages],
  );

  /**
   * What this session is attached to.
   *
   * A conversation belongs to one document: the agent reads and edits that
   * document, and the server stores the chat against it. The panel floats over
   * a workspace the author can navigate away from, and the assistant can create
   * documents other than the one on screen — so "nothing happened" is much
   * more often "that happened somewhere else". Naming the document here is
   * what makes the difference visible.
   *
   * A draft with no id is a genuinely different state, not a document with a
   * name: nothing is attached to it yet, and saying so is the point.
   */
  const attachment = useMemo(() => {
    const name = editor.doc.name?.trim() || 'Untitled document';
    return documentId
      ? {
          attached: true as const,
          name,
          label: name,
          hint: `This conversation is kept with “${name}”, and every edit in it is made to that document.`,
          regionLabel: `Writing assistant for ${name}`,
        }
      : {
          attached: false as const,
          name,
          label: 'Not saved yet',
          hint: 'Asking saves this document and keeps the conversation with it from then on.',
          regionLabel: 'Writing assistant for a document that has not been saved yet',
        };
  }, [documentId, editor.doc.name]);

  // The finished reply, announced once. Empty while streaming so the live
  // region stays silent until there is something whole to read out.
  const completedReply = useMemo(() => {
    if (isStreaming) return '';
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      if (visibleMessages[i].role === 'assistant') return visibleMessages[i].content;
    }
    return '';
  }, [isStreaming, visibleMessages]);

  // Follow new output only while the reader is already at the bottom, so
  // scrolling back through history is not yanked away mid-stream.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [visibleMessages, isStreaming, agentStatus]);

  useEffect(() => {
    if (selectedChatId) setExpanded(true);
  }, [selectedChatId, setExpanded]);

  // Opening the assistant puts the caret where the author is about to type.
  // Skipped on mount: a panel that was already open when the page loaded has
  // no claim on focus, and taking it would drag the view off the document.
  const wasExpanded = useRef(expanded);
  useEffect(() => {
    if (expanded && !wasExpanded.current) inputHostRef.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);

  const { conversationNotice, reloadConversation } = useConversationLoader({
    documentId,
    selectedChatId,
    selectedThreadId,
    setSelectedThreadId,
    abortRef,
    loadedConversationRef,
    setMessages,
    setIsStreaming,
    setAgentStatus,
  });

  const onNewChat = () => {
    resetChatUI(true);
    // Reopening the same conversation later has to fetch it again.
    loadedConversationRef.current = null;
    setSelectedChatId(null);
    setSelectedThreadId(null);
    requestAnimationFrame(() => inputHostRef.current?.focus());
  };

  const onSend = () => send(input.trim());

  const onSuggestion = (suggestion: string) => {
    inputHostRef.current?.focus();
    send(suggestion);
  };

  const scrollToLatest = () => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    pinnedToBottom.current = true;
    setAtBottom(true);
  };

  /**
   * Escape, in the order the author means it: dismiss the reference picker,
   * then stop a run in progress, then put the assistant away. Never while
   * there is unsent text — that would throw the message away.
   */
  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (refPickerRef.current?.isOpen()) return;
    if (isStreaming) {
      event.preventDefault();
      onStop();
      return;
    }
    if (input.trim()) return;
    event.preventDefault();
    setExpanded(false);
  };

  // Anchored inside the canvas (`main` is the positioned ancestor) rather than
  // to the viewport, so it no longer floats on top of the tools panel.
  if (!expanded) {
    return (
      <Button
        variant="outline"
        className="absolute bottom-4 right-4 shadow-lg z-[var(--z-floating)]"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        // Hover only. Overriding the accessible name to carry the document
        // would make it stop matching the word on the button, which is what
        // speech input types against.
        title={attachment.hint}
      >
        <Sparkles aria-hidden="true" className="h-4 w-4 text-primary" />
        Assistant
        {proposals.pendingCount > 0 && (
          <span className="ml-1 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
            {proposals.pendingCount}
          </span>
        )}
      </Button>
    );
  }

  const geometry: CSSProperties = floating
    ? { right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    : // Maximised on desktop fills the whole window (`fixed` against the
      // viewport); on mobile it fills the canvas (`absolute` inside `main`).
      { inset: CHAT_MARGIN };

  const overLimit = input.length > MAX_MESSAGE_LENGTH;
  const nearLimit = input.length > MAX_MESSAGE_LENGTH * 0.8;

  const panel = (
    <div
      role="complementary"
      // Naming the document in the region label is how this reaches a screen
      // reader: the line in the header is small, muted, and not focusable, so
      // it would otherwise only be discovered by reading the whole panel.
      aria-label={attachment.regionLabel}
      onKeyDown={onPanelKeyDown}
      style={geometry}
      className={cn(
        // Fixed on desktop: portaled to <body> below, so the window can travel
        // over the sidebar, tools panel and topbar. Inside `main` it stayed
        // `absolute`, and `main`'s rounded, overflow-hidden frame clipped it
        // at the canvas edge — the old "can't drag past the canvas" behaviour.
        isDesktop ? 'fixed' : 'absolute',
        'z-[var(--z-floating)] flex flex-col overflow-hidden rounded-xl',
        'border border-border bg-card shadow-xl',
        'animate-in fade-in-0 zoom-in-95',
        // A drag that selects the header text as it goes looks broken.
        dragging && 'select-none',
      )}
    >
      {floating && <ResizeHandles onBegin={beginDrag} onNudge={nudge} rect={rect} />}

      {/* ---- Title bar: the drag surface ---- */}
      <header
        onPointerDown={(event) => beginDrag(event, 'move')}
        onDoubleClick={() => setMaximized((value) => !value)}
        className={cn(
          'flex h-11 flex-shrink-0 items-center gap-1.5 border-b border-border/70 px-1.5',
          'bg-gradient-to-b from-card to-card/60',
          floating && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
        )}
      >
        {floating && (
          <button
            type="button"
            aria-label="Move assistant. Arrow keys move it; hold Shift for larger steps."
            title="Drag to move · double-click to reset position"
            onPointerDown={(event) => beginDrag(event, 'move')}
            onDoubleClick={(event) => {
              // The escape hatch for a window dragged somewhere unhelpful,
              // without spending header space on a button for it.
              event.stopPropagation();
              reset();
            }}
            onKeyDown={(event) => {
              if (nudge('move', event)) event.preventDefault();
            }}
            // `shrink-0`: the only unprotected item in the header row. Once the
            // title column started carrying a document name it asked for real
            // width, and the grip was what gave way — the drag handle narrowed
            // to a sliver on exactly the documents whose names are worth
            // reading.
            className="flex h-7 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GripVertical aria-hidden="true" className="h-4 w-4" />
          </button>
        )}

        <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
        {/* Sized to its content and allowed to shrink, so a long document name
            truncates rather than pushing the window controls off the header,
            and the run state below still sits beside the title. */}
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-sm font-semibold">Assistant</h2>
          {/* The one line in the panel that says which document this
              conversation acts on. `title` carries the full name, because the
              header is narrow and a truncated one is exactly the case where
              the author needs to be sure. */}
          <p
            title={attachment.hint}
            className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground"
          >
            {/* Deliberately the same muted treatment in both states. An
                unattached draft is not a problem to fix — the next message
                attaches it — so the difference is carried by the icon and the
                words rather than by a colour that reads as a warning. */}
            {attachment.attached ? (
              <FileText aria-hidden="true" className="h-3 w-3 shrink-0" />
            ) : (
              <FileClock aria-hidden="true" className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{attachment.label}</span>
          </p>
        </div>

        {/* Only the run state. The pending count has its own row below, which
            says the same thing and can be acted on — three copies of one fact
            is what made the old header feel busy. */}
        {isStreaming && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-2xs text-primary">
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-shimmer rounded-full bg-primary" />
            Working
          </span>
        )}

        <div className="ml-auto flex flex-shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onNewChat}
            aria-label="Start a new chat"
            title="New chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMaximized((value) => !value)}
            onDoubleClick={(event) => event.stopPropagation()}
            aria-label={maximized ? 'Restore assistant size' : 'Maximise assistant'}
            aria-pressed={maximized}
            title={maximized ? 'Restore' : 'Maximise'}
          >
            {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setExpanded(false)}
            aria-label="Hide assistant"
            title="Hide assistant · Esc"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {proposals.pendingCount > 0 && (
        <button
          type="button"
          onClick={() => {
            const first = proposals.pending[0];
            if (first) proposals.focusChange(first.id);
          }}
          className="flex flex-shrink-0 items-center gap-2 border-b border-border/70 bg-primary/10 px-3 py-2 text-left text-xs transition-colors hover:bg-primary/15"
        >
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            {proposals.pendingCount} {proposals.pendingCount === 1 ? 'change is' : 'changes are'}{' '}
            waiting in the document
          </span>
          <ArrowDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
        </button>
      )}

      {/* ---- Transcript ---- */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
          onScroll={(event) => {
            const el = event.currentTarget;
            const bottom =
              el.scrollHeight - el.scrollTop - el.clientHeight <= AUTOSCROLL_THRESHOLD_PX;
            pinnedToBottom.current = bottom;
            setAtBottom(bottom);
          }}
          // Deliberately not a live region. Markdown arrives token by token, so
          // `aria-live` here made a screen reader restart the whole growing reply
          // on every chunk. The typing indicator and `agentStatus` below already
          // announce progress, and `role="status"` announces the finished reply.
          aria-busy={isStreaming}
        >
          {/* Capped and centred: maximised, the window is as wide as the
              canvas, and a line of prose that long is unreadable. */}
          <div className="mx-auto w-full max-w-[44rem] space-y-3">
          {conversationNotice && (
            <div
              role={conversationNotice.preparing ? 'status' : 'alert'}
              className={cn(
                'rounded-lg border p-3 text-center',
                conversationNotice.preparing
                  ? 'border-border bg-muted/40'
                  : 'border-destructive/40 bg-destructive/10',
              )}
            >
              <p
                className={cn(
                  'text-sm font-medium',
                  conversationNotice.preparing ? 'text-foreground' : 'text-destructive',
                )}
              >
                {conversationNotice.preparing
                  ? 'Getting this conversation ready'
                  : 'Could not open this conversation'}
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {conversationNotice.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={reloadConversation}
              >
                Retry
              </Button>
            </div>
          )}
          {visibleMessages.length === 0 && (
            <div className="space-y-4 py-4">
              <div className="space-y-1.5 text-center">
                {/* The start of a session is where saying which document it is
                    about costs nothing and settles it for the rest of the
                    conversation. */}
                <p className="text-sm font-medium text-balance">
                  Ask about{' '}
                  <span className="text-primary">“{attachment.name}”</span>
                </p>
                <p className="text-xs text-muted-foreground text-balance">
                  Suggestions, rewrites, structure, summaries or references. Edits arrive as
                  changes you accept in the document — nothing is written behind your back.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onSuggestion(suggestion)}
                    aria-describedby={documentId ? undefined : unsavedNoticeId}
                    className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              {/* These used to be greyed out until the author saved. Sending now
                  saves the document itself and keeps the conversation with it,
                  so the only thing left worth saying is that it will. */}
              {!documentId && (
                <p id={unsavedNoticeId} className="text-center text-xs text-muted-foreground">
                  Asking saves this document first, so the assistant can work on it.
                </p>
              )}
            </div>
          )}

          {visibleMessages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              live={isStreaming && message.id === activeMessageId}
              // This reply's own changes, minus the ones already decided on.
              openChangeIds={message.proposedIds.filter((id) =>
                proposals.pending.some((change) => change.id === id),
              )}
              onFocusChange={(id) => proposals.focusChange(id)}
            />
          ))}

          <p role="status" aria-live="polite" className="sr-only">
            {completedReply}
          </p>

          {/* Not while a tool is running: the activity list is already saying
              the same thing one line above, in the same words. */}
          {isStreaming && agentStatus && agentStatus.status !== 'executing_tool' && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="h-1.5 w-1.5 animate-shimmer rounded-full bg-primary"
                aria-hidden="true"
              />
              {agentStatus.detail}
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5"
            >
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 break-words">{error.message}</span>
              </p>
              {error.detail && error.detail !== error.message && (
                <p className="pl-5 text-2xs text-muted-foreground break-words">
                  {error.detail}
                </p>
              )}
              {error.retryable && lastExchange && !isStreaming && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-1.5 text-xs"
                  onClick={onRetry}
                >
                  <RotateCcw className="h-3 w-3" />
                  Try again
                </Button>
              )}
            </div>
          )}
          </div>
        </div>

        {!atBottom && visibleMessages.length > 0 && (
          <button
            type="button"
            className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-popover px-2.5 py-1 text-2xs text-muted-foreground shadow-md transition-colors hover:text-foreground"
            onClick={scrollToLatest}
          >
            <ArrowDown aria-hidden="true" className="h-3 w-3" />
            Latest
          </button>
        )}
      </div>

      {/* ---- Composer ---- */}
      <div className="flex-shrink-0 border-t border-border/70 p-2">
        <div
          className={cn(
            'chat-textarea-wrap relative mx-auto w-full max-w-[44rem] rounded-lg border border-input bg-background/60 transition-colors',
            'focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring/30',
            overLimit && 'border-destructive focus-within:border-destructive focus-within:ring-destructive/30',
          )}
        >
          <ChatTaggedInput
            ref={inputHostRef}
            value={input}
            onChange={setInput}
            onSubmit={onSend}
            placeholder="Ask about this document…"
            aria-describedby={composerHintId}
            onTriggerPicker={(anchor) => refPickerRef.current?.openAt(anchor)}
            onEditRef={(start) => refPickerRef.current?.openAt(start, { editing: true })}
            onRemoveRef={() => refPickerRef.current?.close()}
            isPickerOpen={() => refPickerRef.current?.isOpen() ?? false}
            maxLength={MAX_MESSAGE_LENGTH}
          />

          <div className="flex items-center gap-2 px-2 pb-1.5 pt-0.5">
            <p id={composerHintId} className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
              <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line ·{' '}
              <Kbd>#</Kbd> to reference
            </p>

            {nearLimit && (
              <span
                className={cn('shrink-0 text-2xs tabular-nums', overLimit ? 'text-destructive' : 'text-muted-foreground')}
              >
                {input.length}/{MAX_MESSAGE_LENGTH}
              </span>
            )}

            {isStreaming ? (
              <Button
                variant="destructive"
                size="icon-sm"
                onClick={onStop}
                aria-label="Stop generating"
                title="Stop · Esc"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                onClick={onSend}
                disabled={!input.trim() || overLimit}
                aria-label="Send message"
                title="Send · Enter"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <ChatRefPicker
            ref={refPickerRef}
            getHost={() => inputHostRef.current?.getHost() ?? null}
            input={input}
            setInput={setInput}
            setCaretIndex={(index) => inputHostRef.current?.setSelectionRange(index, index)}
          />
        </div>
      </div>
    </div>
  );

  // Out of `main` and into <body>: the canvas frame clips its absolutely
  // positioned children, which is what used to keep the window inside the
  // canvas. Contexts survive the portal, so nothing below the shell notices.
  return isDesktop ? createPortal(panel, document.body) : panel;
}
