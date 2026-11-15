import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDocumentActions, useDocumentSession, useEditorDoc, usePageReadOnly } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import type { ChatItem } from '@/data/chats';
import { useChatSessions } from '../../chat/chatSessionsState';
import { useChatHistory } from '@/components/panels/ChatsPanel';
import { PanelsContext, type PanelsContextValue } from '@/components/panels/panelsContextState';
import { PANEL_CONFIG } from '@/components/panels/panelConfig';
import type { ChatRefPickerHandle } from './ChatRefPicker';
import type { ChatTaggedInputHandle } from './ChatTaggedInput';
import { useAgentTurn } from './useAgentTurn';
import { useAutoMode } from './useAutoMode';
import { AgentToolsContext } from '@/components/preferences/agentToolsContextState';
import { useConversationLoader } from './useConversationLoader';
import { currentFocus, useEditorFocus, type EditorFocus } from '@/components/editor/References';
import { MessageRow } from './MessageRow';
import { LiveTaskBar } from './TaskList';
import { AssistantHome } from './AssistantHome';
import { useChatAttachments } from './useChatAttachments';
import { ChatComposer, MAX_MESSAGE_LENGTH } from './ChatComposer';
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
/** The newest assistant message in a transcript. */
function lastAssistantMessage<T extends { role: string }>(messages: readonly T[]): T | undefined {
  return [...messages].reverse().find((message) => message.role === 'assistant');
}

/**
 * Show something in the page from the chat. On a phone the AI sheet covers
 * the page, so it closes first; `reveal` runs once the sheet is gone and has
 * handed focus back, or that would pull focus away again. `host` is the
 * transcript, which leaves the page with the sheet.
 */
function showInPage(
  panels: PanelsContextValue | null | undefined,
  host: HTMLElement | null,
  reveal: () => void,
): void {
  if (!panels || panels.toolsDocked) {
    reveal();
    return;
  }
  const started = performance.now();
  panels.setAssistantOpen(false);
  const whenClosed = () => {
    if (host?.isConnected && performance.now() - started < 1000) {
      requestAnimationFrame(whenClosed);
      return;
    }
    setTimeout(reveal, 0);
  };
  requestAnimationFrame(whenClosed);
}

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
  const { documentSessionId } = useDocumentSession();
  return <DocumentChatAssistant key={documentSessionId} />;
}

function DocumentChatAssistant() {
  const { doc } = useEditorDoc();
  const { documentId, documentSessionId, loadingDocumentId, restoreEpoch } = useDocumentSession();
  const workspaceId = useWorkspaceId();
  const { ensureRemoteDocument, hasPendingEdits, saveRemote } = useDocumentActions();
  const proposals = useProposals();
  const { selectedChatId, selectedLeafId, setSelectedChatId, setSelectedLeafId } =
    useChatSessions();
  const history = useChatHistory();
  /** Bumped when the author starts or picks a chat: Auto belongs to one chat. */
  const [chatEpoch, setChatEpoch] = useState(0);
  const auto = useAutoMode({ workspace: workspaceId, page: documentSessionId, chat: selectedChatId, chatEpoch });
  // The workspace's policy can take Auto away, and web search or outside
  // research with it (D7): the switch says so before anything is sent, and
  // a policy changed while Auto is on turns it off.
  const policy = useContext(AgentToolsContext)?.policy ?? null;
  // A viewer never uses Auto (D18): the switch says so before anything is sent.
  const readOnly = usePageReadOnly();
  const autoUnavailable: 'policy' | 'role' | null = readOnly ? 'role' : policy?.auto === false ? 'policy' : null;
  const autoAllowed = autoUnavailable === null;
  const { on: autoOn, turnOff: turnAutoOff } = auto;
  useEffect(() => {
    if (!autoAllowed && autoOn) turnAutoOff();
  }, [autoAllowed, autoOn, turnAutoOff]);
  const policyOff = useMemo(
    () => (policy ? (['web_search', 'outside_research'] as const).filter((key) => !policy[key]) : []),
    [policy],
  );

  const [input, setInput] = useState('');
  const files = useChatAttachments(selectedChatId, ensureRemoteDocument);
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
    selectedLeafId,
    setSelectedChatId,
    setSelectedLeafId,
    proposals,
    setInput,
    setAtBottom,
    pinnedToBottom,
    refPickerRef,
    loadedConversationRef,
    // The API keeps no title of its own, so a new conversation is named by
    // the question that started it — in the list as well as in the header.
    onChatCreated: (chatId, prompt) => {
      // Still the chat the author turned Auto on in, now with an id.
      auto.adoptChat(chatId);
      const title = titleFromPrompt(prompt);
      if (title) void history.rename(chatId, title);
    },
    autoMode: auto,
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
    const name = doc.name?.trim() || 'Untitled page';
    return documentId
      ? {
          attached: true as const,
          name,
          label: name,
          hint: `This conversation is kept with “${name}”, and every edit in it is made to that page.`,
          regionLabel: `Writing assistant for ${name}`,
        }
      : {
          attached: false as const,
          name,
          label: 'Not saved yet',
          hint: 'Asking saves this page and keeps the conversation with it from then on.',
          regionLabel: 'Writing assistant for a page that has not been saved yet',
        };
  }, [documentId, doc.name]);

  const chatTitle = useMemo(() => {
    const stored = history.items.find((chat) => chat.id === selectedChatId)?.title?.trim();
    if (stored) return stored;
    const firstPrompt = visibleMessages.find((m) => m.role === 'user')?.content;
    if (firstPrompt) return titleFromPrompt(firstPrompt) || 'Untitled chat';
    return selectedChatId ? 'Untitled chat' : 'New chat';
  }, [history.items, selectedChatId, visibleMessages]);

  // The finished reply, announced once. Empty while streaming so the live
  // region stays silent until there is something whole to read out.
  const completedReply = useMemo(() => {
    if (isStreaming) return '';
    return lastAssistantMessage(visibleMessages)?.content ?? '';
  }, [isStreaming, visibleMessages]);

  const latestAnswerId = useMemo(() => {
    return lastAssistantMessage(visibleMessages)?.id ?? null;
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
    onChatGone: () => {
      resetChatUI(true);
      loadedConversationRef.current = null;
      setChatEpoch((epoch) => epoch + 1);
      setSelectedChatId(null);
      setSelectedLeafId(null);
    },
    workspaceId,
    documentId,
    selectedChatId,
    selectedLeafId,
    setSelectedLeafId,
    abortRef,
    loadedConversationRef,
    setMessages,
    setIsStreaming,
    setAgentStatus,
  });

  /** Clear the transcript; the next message starts a conversation. */
  const onNewChat = () => {
    files.clear();
    resetChatUI(true);
    // Reopening the same conversation later has to fetch it again.
    loadedConversationRef.current = null;
    setChatEpoch((epoch) => epoch + 1);
    setSelectedChatId(null);
    setSelectedLeafId(null);
    requestAnimationFrame(() => focusComposer(inputHostRef.current));
  };

  const onPickChat = (chat: ChatItem) => {
    if (chat.id === selectedChatId) return;
    files.clear();
    resetChatUI(true);
    loadedConversationRef.current = null;
    setChatEpoch((epoch) => epoch + 1);
    setSelectedChatId(chat.id);
    setSelectedLeafId(chat.last_message_id);
  };

  const onChatDeleted = (chat: ChatItem) => {
    if (chat.id === selectedChatId) onNewChat();
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
    if (files.blocked || isStreaming || loadingDocumentId || text.length > MAX_MESSAGE_LENGTH || (!text && !files.attachments.length)) return;
    const turnFocus = focus && focus === dismissedFocus ? null : currentFocus();
    // Sent once: the chip and the mark in the page go with the message.
    if (turnFocus?.selection) setDismissedFocus(focus);
    const attachments = files.attachments;
    files.clear();
    return send(text, agentContext(text, turnFocus), attachments);
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
    send(prompt.content, context, prompt.attachments);
  };

  /**
   * Show the first of a reply's changes in the page (see `showInPage`). The
   * suggestions pill brings the author back.
   */
  /** A reply's changes still open for review, from the change sets its edits went into. */
  const openChangeIdsOf = (changeSetIds: readonly string[]): string[] =>
    changeSetIds.length === 0
      ? []
      : proposals.sets
        .filter((set) => changeSetIds.includes(set.changeSetId))
        .flatMap((set) => set.changes.filter((change) => change.status === 'pending').map((change) => change.id));
  const reviewChange = (changeId: string) =>
    showInPage(panels, listRef.current, () => proposals.focusChange(changeId));
  /** Under an Auto turn's reply: Review shows its set in the page. */
  const reviewAutoApplied = (id: string) =>
    showInPage(panels, listRef.current, () => proposals.revealAutoApplied(id));
  const undoAutoApplied = (id: string) => {
    proposals.undoAutoApplied(id);
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
    // A dialog the panel opened (the Auto warning) is in a portal: its
    // Escape closes the dialog, not the run.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (refPickerRef.current?.isOpen()) return;
    if (isStreaming) {
      event.preventDefault();
      onStop();
    }
  };

  const progress = isStreaming ? agentStatus : null;
  // The running turn's task list, pinned where a growing reply cannot push it
  // out of view.
  const liveTasks = isStreaming
    ? visibleMessages.find((message) => message.id === activeMessageId)?.todos
    : undefined;

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
              readOnly={readOnly}
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
                openChangeIds={openChangeIdsOf(message.changeSetIds)}
                onFocusChange={reviewChange}
                onRetry={
                  message.id === latestAnswerId && !isStreaming && !error
                    ? () => regenerate(message.id)
                    : undefined
                }
                autoApplied={{
                  sets: proposals.autoApplied.filter((set) => message.changeSetIds.includes(set.changeSetId)),
                  onUndo: undoAutoApplied,
                  onReview: reviewAutoApplied,
                }}
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
          {liveTasks && liveTasks.length > 0 && <LiveTaskBar items={liveTasks} />}
          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={onSend}
            onStop={onStop}
            isStreaming={isStreaming}
            attachment={attachment}
            files={files}
            selection={attachedSelection}
            onDismissSelection={() => setDismissedFocus(focus)}
            inputRef={inputHostRef}
            pickerRef={refPickerRef}
            auto={{ on: auto.on, blocked: auto.blocked, onTurnOn: auto.turnOn, onTurnOff: auto.turnOff, unavailable: autoUnavailable }}
            switchedOff={policyOff}
            canUpload={!readOnly}
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
