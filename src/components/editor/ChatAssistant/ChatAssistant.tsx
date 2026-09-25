import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEditor } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import type { ChatItem } from '@/services/chats';
import { useChatSessions } from '../../chat/chatSessionsState';
import { useChatHistory } from '@/components/panels/ChatsPanel';
import { PanelsContext } from '@/components/panels/panelsContextState';
import { PANEL_CONFIG } from '@/components/panels/panelConfig';
import type { ChatRefPickerHandle } from './ChatRefPicker';
import type { ChatTaggedInputHandle } from './ChatTaggedInput';
import { useAgentTurn } from './useAgentTurn';
import { useConversationLoader } from './useConversationLoader';
import { currentFocus, useEditorFocus, type EditorFocus } from '@/components/editor/References';
import { MessageRow } from './MessageRow';
import { AssistantHome } from './AssistantHome';
import { ChatComposer } from './ChatComposer';
import { ChatSwitcher } from './ChatSwitcher';
import { agentContext } from './chatUtils';
import { useChatContextHighlight } from './chatContextHighlight';
import { scrollBehavior } from '@/lib/motion';
import { AlertCircle, ArrowDown, Maximize2, Minimize2, RotateCcw, SquarePen } from 'lucide-react';

/**
 * A phone's on-screen keyboard covers the suggestions and the empty state, so
 * the composer takes focus there only when the author taps it.
 */
function focusComposer(host: ChatTaggedInputHandle | null) {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return;
  host?.focus();
}

/** How close to the bottom counts as "following along" for auto-scroll. */
const AUTOSCROLL_THRESHOLD_PX = 64;

/** A chat with no stored title is named by what it first asked. */
function titleFromPrompt(prompt: string): string {
  const line = prompt.replace(/#(?:this|doc)\/[\w/-]+/g, '').replace(/\s+/g, ' ').trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

/**
 * The writing assistant, as the content of the right sidebar's AI tab.
 *
 * It fills whatever column it is given — a docked panel beside the page on a
 * desktop, a sheet on a phone — and owns no window of its own: where it sits,
 * how wide it is and whether it is open all belong to the sidebar that hosts
 * it (see PanelsContext's `assistantOpen`, which the Mod+J shortcut toggles).
 */
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
  const history = useChatHistory();

  const [input, setInput] = useState('');
  const [atBottom, setAtBottom] = useState(true);

  const listRef = useRef<HTMLDivElement | null>(null);
  const panels = useContext(PanelsContext);
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

  const {
    messages,
    isStreaming,
    resumeRun,
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
    // The API keeps no title of its own, so a new conversation is named by
    // the question that started it — in the list as well as in the header.
    onChatCreated: (chatId, prompt) => {
      const title = titleFromPrompt(prompt);
      if (title) void history.rename(chatId, title);
    },
  });

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== 'system'),
    [messages],
  );

  /**
   * What this session is attached to.
   *
   * A conversation belongs to one document: the agent reads and edits that
   * document, and the server stores the chat against it. The assistant can
   * create documents other than the one on screen, so "nothing happened" is
   * often "that happened somewhere else" — naming the document is what makes
   * the difference visible.
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

  const chatTitle = useMemo(() => {
    const stored = history.items.find((chat) => chat.chat_id === selectedChatId)?.title?.trim();
    if (stored) return stored;
    const firstPrompt = visibleMessages.find((m) => m.role === 'user')?.content;
    if (firstPrompt) return titleFromPrompt(firstPrompt) || 'Untitled chat';
    return selectedChatId ? 'Untitled chat' : 'New chat';
  }, [history.items, selectedChatId, visibleMessages]);

  // The finished reply, announced once. Empty while streaming so the live
  // region stays silent until there is something whole to read out.
  const completedReply = useMemo(() => {
    if (isStreaming) return '';
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      if (visibleMessages[i].role === 'assistant') return visibleMessages[i].content;
    }
    return '';
  }, [isStreaming, visibleMessages]);

  const latestAnswerId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      if (visibleMessages[i].role === 'assistant') return visibleMessages[i].id;
    }
    return null;
  }, [visibleMessages]);

  // Follow new output only while the reader is already at the bottom, so
  // scrolling back through history is not yanked away mid-stream.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [visibleMessages, isStreaming, agentStatus]);

  // Some growth comes from no state of this panel's own: the progress line
  // that appears under a reply once it pauses, a reasoning preview, a figure
  // finishing its layout. Follow those too while the reader is at the bottom.
  useEffect(() => {
    const list = listRef.current;
    const content = list?.firstElementChild;
    if (!list || !content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Opening the panel puts the caret where the author is about to type — when
  // the author opened it. A panel restored open by a reload has no claim on
  // focus, and taking it would drag the view off the document.
  useEffect(() => {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
      .userActivation;
    if (activation?.isActive) focusComposer(inputHostRef.current);
  }, []);

  const { conversationNotice, reloadConversation } = useConversationLoader({
    onResumeRun: resumeRun,
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

  /** Clear the transcript; the next message starts a conversation. */
  const onNewChat = () => {
    resetChatUI(true);
    // Reopening the same conversation later has to fetch it again.
    loadedConversationRef.current = null;
    setSelectedChatId(null);
    setSelectedThreadId(null);
    requestAnimationFrame(() => focusComposer(inputHostRef.current));
  };

  const onPickChat = (chat: ChatItem) => {
    if (chat.chat_id === selectedChatId) return;
    resetChatUI(true);
    loadedConversationRef.current = null;
    setSelectedChatId(chat.chat_id);
    setSelectedThreadId(typeof chat.last_thread_id === 'number' ? chat.last_thread_id : null);
  };

  const onChatDeleted = (chat: ChatItem) => {
    if (chat.chat_id === selectedChatId) onNewChat();
  };

  /**
   * Where the author was working goes along with the message, so "make this
   * more formal" is about the paragraph they had selected. The chip above
   * the composer shows a selection before it is sent and can leave it out.
   */
  const focus = useEditorFocus();
  const [dismissedFocus, setDismissedFocus] = useState<EditorFocus | null>(null);
  const attachedSelection = focus?.selection && focus !== dismissedFocus ? focus.selection : null;
  // The selection stays marked in the page for as long as it is attached.
  useChatContextHighlight(attachedSelection ? focus : null);
  const sendWithContext = (text: string) => {
    const turnFocus = focus && focus === dismissedFocus ? null : currentFocus();
    // Sent once: the chip and the mark in the page go with the message.
    if (turnFocus?.selection) setDismissedFocus(focus);
    return send(text, agentContext(text, turnFocus));
  };

  const onSend = () => sendWithContext(input.trim());

  const onSuggestion = (prompt: string) => {
    focusComposer(inputHostRef.current);
    sendWithContext(prompt);
  };

  /** Ask the question behind an answer again, as it was asked. */
  const regenerate = (answerId: string) => {
    const index = visibleMessages.findIndex((m) => m.id === answerId);
    const prompt = visibleMessages
      .slice(0, index)
      .reverse()
      .find((m) => m.role === 'user');
    if (!prompt) return;
    const context =
      lastExchange?.assistantMessageId === answerId ? lastExchange.context : undefined;
    send(prompt.content, context);
  };

  /**
   * Show the first of a reply's changes in the page. On a phone the AI
   * sheet covers the page, so it closes first; the change is revealed once
   * the sheet is gone and has handed focus back, or that would pull focus
   * away from the card again. The suggestions pill brings the author back.
   */
  const reviewChange = (changeId: string) => {
    if (!panels || panels.isDesktop) {
      proposals.focusChange(changeId);
      return;
    }
    const host = listRef.current;
    const started = performance.now();
    panels.setAssistantOpen(false);
    const whenClosed = () => {
      if (host?.isConnected && performance.now() - started < 1000) {
        requestAnimationFrame(whenClosed);
        return;
      }
      setTimeout(() => proposals.focusChange(changeId), 0);
    };
    requestAnimationFrame(whenClosed);
  };

  const scrollToLatest = () => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: scrollBehavior() });
    pinnedToBottom.current = true;
    setAtBottom(true);
  };

  /**
   * Escape, in the order the author means it: dismiss the reference picker,
   * then stop a run in progress. Closing the panel is the sidebar's.
   */
  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (refPickerRef.current?.isOpen()) return;
    if (isStreaming) {
      event.preventDefault();
      onStop();
    }
  };

  const progress = isStreaming ? agentStatus : null;

  return (
    <section
      // Naming the document in the region label is how this reaches a screen
      // reader: the chip that says so is small and not focusable.
      aria-label={attachment.regionLabel}
      onKeyDown={onPanelKeyDown}
      className="flex h-full min-h-0 w-full flex-col"
    >
      <header className="flex h-10 shrink-0 items-center gap-1 px-2">
        <ChatSwitcher
          title={chatTitle}
          history={history}
          onNewChat={onNewChat}
          onSelect={onPickChat}
          onDeleted={onChatDeleted}
        />
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="icon" size="icon-sm" onClick={onNewChat} aria-label="Start a new chat">
              <SquarePen />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
        <WidthToggle />
      </header>

      {/* ---- Transcript ---- */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(event) => {
          const el = event.currentTarget;
          const bottom =
            el.scrollHeight - el.scrollTop - el.clientHeight <= AUTOSCROLL_THRESHOLD_PX;
          pinnedToBottom.current = bottom;
          setAtBottom(bottom);
        }}
        // Deliberately not a live region. Markdown arrives token by token, so
        // `aria-live` here made a screen reader restart the whole growing reply
        // on every chunk. The status line announces progress, and
        // `role="status"` below announces the finished reply.
        aria-busy={isStreaming}
      >
        {/* Capped and centred: in a wide panel a line of prose that long is
            unreadable. */}
        <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-6 px-4 pb-6 pt-2">
          {conversationNotice && (
            <div
              role={conversationNotice.preparing ? 'status' : 'alert'}
              className="rounded-lg bg-subtle px-3 py-2.5 text-sm"
            >
              <p
                className={
                  conversationNotice.preparing ? 'font-medium text-foreground' : 'font-medium text-destructive'
                }
              >
                {conversationNotice.preparing
                  ? 'Getting this conversation ready'
                  : 'Could not open this conversation'}
              </p>
              <p className="mt-0.5 break-words text-[13px] text-muted-foreground">
                {conversationNotice.message}
              </p>
              <Button variant="outline" size="xs" className="mt-2" onClick={reloadConversation}>
                Retry
              </Button>
            </div>
          )}

          {visibleMessages.length === 0 && (
            <AssistantHome
              documentName={attachment.name}
              saved={Boolean(documentId)}
              unsavedNoticeId={unsavedNoticeId}
              onPick={onSuggestion}
            />
          )}

          {visibleMessages.map((message) => {
            const live = isStreaming && message.id === activeMessageId;
            return (
              <MessageRow
                key={message.id}
                message={message}
                live={live}
                progress={live ? progress : null}
                latest={message.id === latestAnswerId}
                // This reply's own changes, minus the ones already decided on.
                openChangeIds={message.proposedIds.filter((id) =>
                  proposals.pending.some((change) => change.id === id),
                )}
                onFocusChange={reviewChange}
                onRetry={
                  message.id === latestAnswerId && !isStreaming && !error
                    ? () => regenerate(message.id)
                    : undefined
                }
              />
            );
          })}

          <p role="status" aria-live="polite" className="sr-only">
            {completedReply}
          </p>

          {error && (
            <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2.5">
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">{error.message}</span>
              </p>
              {error.detail && error.detail !== error.message && (
                <p className="mt-1 pl-6 text-xs text-muted-foreground break-words">{error.detail}</p>
              )}
              {error.retryable && lastExchange && !isStreaming && (
                <Button variant="outline" size="xs" className="ml-6 mt-2" onClick={onRetry}>
                  <RotateCcw />
                  Try again
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Composer ---- */}
      <div className="relative shrink-0 px-3 pb-3">
        {!atBottom && visibleMessages.length > 0 && (
          <button
            type="button"
            aria-label="Jump to the latest message"
            className="absolute -top-10 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-popover text-muted-foreground shadow-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={scrollToLatest}
          >
            <ArrowDown aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        <div className="mx-auto w-full max-w-[44rem]">
          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={onSend}
            onStop={onStop}
            isStreaming={isStreaming}
            attachment={attachment}
            selection={attachedSelection}
            onDismissSelection={() => setDismissedFocus(focus)}
            inputRef={inputHostRef}
            pickerRef={refPickerRef}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Widens the docked sidebar for a long conversation, and back.
 *
 * Only where the sidebar docks beside the page: a sheet on a phone is already
 * as wide as it gets. The context is optional because the panel also renders
 * on its own (tests, the design previews).
 */
function WidthToggle() {
  const panels = useContext(PanelsContext);
  if (!panels?.isDesktop) return null;
  const { max, default: normal } = PANEL_CONFIG.right;
  const wide = panels.rightWidth >= max;
  const label = wide ? 'Narrow the panel' : 'Widen the panel';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="icon"
          size="icon-sm"
          onClick={() => panels.setRightWidth(wide ? normal : max)}
          aria-label={label}
        >
          {wide ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
