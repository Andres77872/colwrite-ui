import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { usePersistentState, isBoolean } from '@/hooks/usePersistentState';
import { usePanels } from '@/components/panels/panelsContextState';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useEditor } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import { streamAgentChat } from '@/services/agentChat';
import type { SSEEventHandlers } from '@/services/streamParser';
import type { ToolAction } from '@/editor/types';
import { useChatSessions } from '../../chat/chatSessionsState';
import { listMessages, listThreads } from '@/services/chats';
import { uid } from '@/lib/uid';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatRefTags } from './ChatRefTags';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';
import { ChatMarkdown } from './ChatMarkdown';
import { AgentActivity, toolRunningLabel, type ToolRun } from './AgentActivity';
import { CHAT_MARGIN, useChatWindow, type DragMode } from './useChatWindow';
import {
  AlertCircle,
  ArrowDown,
  Check,
  Copy,
  CornerDownLeft,
  GripVertical,
  Maximize2,
  FileClock,
  FileText,
  MessageSquarePlus,
  Minimize2,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  /** Tools the agent ran while producing this reply, in order. */
  runs: ToolRun[];
  /** How many changes this reply put up for review in the document. */
  proposed: number;
};

/** How close to the bottom counts as "following along" for auto-scroll. */
const AUTOSCROLL_THRESHOLD_PX = 64;

/** The composer refuses more than this, and warns as it approaches. */
const MAX_MESSAGE_LENGTH = 2000;

const SUGGESTIONS = [
  'Summarise this document in three sentences',
  'Tighten the introduction',
  'Suggest a structure for the results section',
];

function emptyMessage(role: string, content = ''): ChatMessage {
  return { id: uid(), role, content, runs: [], proposed: 0 };
}

function boundedArgument(value: unknown, limit = 120): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function toolRunDetail(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool === 'semantic_scholar_search') {
    const query = boundedArgument(args.query);
    return query ? `Query: “${query}”` : undefined;
  }
  if (tool === 'semantic_scholar_paper') {
    const paperId = boundedArgument(args.paper_id);
    return paperId ? `Paper: ${paperId}` : undefined;
  }
  if (tool === 'semantic_scholar_graph') {
    const paperId = boundedArgument(args.paper_id, 80);
    const direction = boundedArgument(args.direction, 20);
    return [direction && `Direction: ${direction}`, paperId && `paper ${paperId}`]
      .filter(Boolean)
      .join(' · ') || undefined;
  }
  if (tool === 'semantic_scholar_recommendations') {
    const paperId = boundedArgument(args.paper_id);
    return paperId ? `Seed paper: ${paperId}` : undefined;
  }
  if (tool === 'semantic_scholar_snippets') {
    const query = boundedArgument(args.query);
    return query ? `Evidence query: “${query}”` : undefined;
  }
  if (tool === 'validate_claim') {
    const claim = boundedArgument(args.claim);
    return claim ? `Claim: “${claim}”` : undefined;
  }
  if (tool === 'search_citations') {
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    return text ? `Checked a ${text.length.toLocaleString()}-character passage` : undefined;
  }
  return undefined;
}

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
  const { documentId, loadingDocumentId, ensureRemoteDocument, hasPendingEdits, saveRemote } =
    editor;
  const proposals = useProposals();
  const { selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId } =
    useChatSessions();

  // Open/closed is shell state (see PanelsContext): the Mod+J shortcut toggles
  // it from outside this component. Maximized stays local — nothing else has a
  // reason to touch it.
  const { assistantOpen: expanded, setAssistantOpen: setExpanded } = usePanels();
  const [maximized, setMaximized] = usePersistentState<boolean>('chat.maximized', false, isBoolean);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const [agentStatus, setAgentStatus] = useState<{ status: string; detail: string } | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  /**
   * The document this session is attached to, and the chat and thread it is
   * on, as of the last commit.
   *
   * A turn outlives several renders, and the first message on an unsaved draft
   * changes both mid-flight. The session setters in particular are rebuilt
   * whenever the owning document id changes and refuse writes from a callback
   * bound to the previous one — a turn that attached the document while it ran
   * would otherwise finish holding the setters from before the attach, drop the
   * chat id the server had just created, and start a new conversation with
   * every following message.
   *
   * Synced in a layout effect rather than during render: a render React
   * discards must not be the one that decides which document a reply belongs
   * to. Everything that reads these is a network callback or an event handler,
   * so committed values are current by the time they run.
   */
  const documentIdRef = useRef(documentId);
  const sessionRef = useRef({
    selectedChatId,
    selectedThreadId,
    setSelectedChatId,
    setSelectedThreadId,
  });
  useLayoutEffect(() => {
    documentIdRef.current = documentId;
    sessionRef.current = {
      selectedChatId,
      selectedThreadId,
      setSelectedChatId,
      setSelectedThreadId,
    };
  }, [documentId, selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId]);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputHostRef = useRef<ChatTaggedInputHandle | null>(null);
  const refPickerRef = useRef<ChatRefPickerHandle | null>(null);
  const pinnedToBottom = useRef(true);
  // tool_call_ids already handled, so a redelivered event cannot double-queue.
  const processedToolCallIds = useRef<Set<string>>(new Set());
  // The message currently being written into, so stream callbacks can find it
  // without scanning for "the last assistant message" on every token.
  const activeMessageIdRef = useRef<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  // What was sent last, so a failed turn can be retried without retyping.
  const [lastSent, setLastSent] = useState<string | null>(null);
  const unsavedNoticeId = useId();
  const composerHintId = useId();

  useEffect(() => {
    if (!loadingDocumentId) return;
    // A stream is scoped to the committed document. Stop it before a different
    // body can commit so late tool events cannot mutate or stage work against
    // the wrong document.
    abortRef.current?.abort();
    abortRef.current = null;
    refPickerRef.current?.close();
  }, [loadingDocumentId]);

  // The document-keyed assistant intentionally remounts on navigation so its
  // transcript is scoped to one document. Stop the old network stream as part
  // of that boundary; mocks and transports may still invoke retained
  // callbacks, so every callback below also checks that its controller is live.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // Below `md` there is no room to place a window: it fills the canvas, and
  // dragging it anywhere would only push it off screen.
  const isDesktop = useIsDesktop();
  const floating = isDesktop && !maximized;
  const { rect, dragging, beginDrag, nudge, reset } = useChatWindow(panelRef, {
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

  const patchActive = useCallback((update: (message: ChatMessage) => ChatMessage) => {
    const id = activeMessageIdRef.current;
    if (!id) return;
    setMessages((prev) => prev.map((m) => (m.id === id ? update(m) : m)));
  }, []);

  const resetChatUI = useCallback((clearMessages = true) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setAgentStatus(null);
    setError('');
    setInput('');
    activeMessageIdRef.current = null;
    setActiveMessageId(null);
    if (clearMessages) setMessages([]);
  }, []);

  /**
   * Hand a streamed document mutation to the review layer.
   *
   * Nothing is applied here. The agent's operations are staged server-side and
   * the author accepts or rejects each one on the block it affects — a rewrite
   * cannot be judged from a chat bubble, only against the paragraph it
   * replaces.
   */
  const onToolAction = useCallback(
    (action: ToolAction) => {
      if (!mountedRef.current) return;

      // Tool events name the document they were produced against. Never stage
      // one in a different active document, even if a transport delivers it
      // after the stream was aborted.
      //
      // Creating a document is the exception, and the reason this used to look
      // like the assistant doing nothing at all: `doc_create` names the
      // document it has just made, which is never the one on screen. Matching
      // ids here dropped the event before anything could offer it to the
      // author. The review layer scopes the two halves properly — operations
      // to this document, invitations to the one that was created.
      const announcesNewDocument = action.actions.some(
        (op) => op.op === 'create_document',
      );
      if (action.documentId !== documentIdRef.current && !announcesNewDocument) return;

      // Only a genuine redelivery is a duplicate. The id alone is not enough:
      // providers that number tool calls per request reuse `call_0`, and some
      // send none at all. The previous fallback keyed on the document version,
      // which a proposal deliberately leaves unchanged — so two staged batches
      // in one run collapsed into one and the second edit vanished.
      const dedupKey = `${action.toolCallId}:${action.status}:${JSON.stringify(action.actions)}`;
      if (processedToolCallIds.current.has(dedupKey)) return;
      processedToolCallIds.current.add(dedupKey);

      const { changes } = proposals.receive(action);

      if (action.status === 'error') {
        setError(action.message || 'The assistant could not complete that edit.');
      }

      if (changes > 0) {
        patchActive((message) => ({ ...message, proposed: message.proposed + changes }));
      }
    },
    [patchActive, proposals],
  );

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

  /**
   * Load a conversation the author switched to.
   *
   * Keyed, because the ids this effect watches are also the ids the panel sets
   * itself at the end of every turn. Without the key it refetched the
   * conversation it had just streamed and replaced it with the server's plain
   * transcript — which carries no tool activity and no record of what was
   * proposed, so both vanished from the reply a second after arriving.
   */
  const loadedConversation = useRef<string | null>(null);
  useEffect(() => {
    if (!documentId || !selectedChatId) return;

    const key = `${documentId}:${selectedChatId}:${selectedThreadId ?? 'latest'}`;
    if (loadedConversation.current === key) return;
    loadedConversation.current = key;

    let cancelled = false;

    (async () => {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsStreaming(false);
      setAgentStatus(null);

      try {
        let pivot = typeof selectedThreadId === 'number' ? selectedThreadId : undefined;
        if (pivot === undefined) {
          const threads = await listThreads(documentId, selectedChatId, 100, 0);
          const ids = (threads.threads ?? [])
            .map((t) => t.id)
            .filter((n): n is number => typeof n === 'number');
          if (ids.length) pivot = Math.max(...ids);
        }
        if (pivot === undefined || cancelled) return;

        const res = await listMessages(documentId, selectedChatId, pivot);
        if (cancelled) return;

        loadedConversation.current = `${documentId}:${selectedChatId}:${pivot}`;

        const history = (res.messages ?? []).map((m) =>
          emptyMessage(
            m.role,
            // Legacy rows can still carry EXTRAS_JSON envelopes.
            m.content?.replace(/<EXTRAS_JSON>[\s\S]*?<\/EXTRAS_JSON>/g, '') ?? '',
          ),
        );
        // A conversation the server has nothing for does not overwrite one the
        // author can see: that reads as the transcript being thrown away.
        setMessages((prev) => (history.length === 0 && prev.length > 0 ? prev : history));
        if (typeof res.pivotThreadId === 'number') setSelectedThreadId(res.pivotThreadId);
      } catch {
        if (!cancelled) setError('Could not load this conversation.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, selectedChatId, selectedThreadId, setSelectedThreadId]);

  const onNewChat = () => {
    resetChatUI(true);
    // Reopening the same conversation later has to fetch it again.
    loadedConversation.current = null;
    setSelectedChatId(null);
    setSelectedThreadId(null);
    requestAnimationFrame(() => inputHostRef.current?.focus());
  };

  const send = async (text: string) => {
    if (!text || isStreaming || loadingDocumentId) return;

    setError('');
    setInput('');
    setAgentStatus(null);
    pinnedToBottom.current = true;
    setAtBottom(true);
    setLastSent(text);
    // Tool-call ids are only unique within a run for some providers.
    processedToolCallIds.current = new Set();

    const assistantMessage = emptyMessage('assistant');
    activeMessageIdRef.current = assistantMessage.id;
    setActiveMessageId(assistantMessage.id);
    setMessages((prev) => [...prev, emptyMessage('user', text), assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    const streamIsLive = () => (
      mountedRef.current
      && abortRef.current === controller
      && !controller.signal.aborted
    );

    try {
      /**
       * Attach before anything else.
       *
       * Everything in a turn is addressed by document id — the agent reads and
       * edits `document_id`, and the chat session is stored against it — so a
       * draft that lives only in this browser has nothing for the assistant to
       * act on. Saving it here is the whole point: the author asked about *this*
       * document, and from this moment the session belongs to it.
       */
      let turnDocumentId = documentIdRef.current;
      if (!turnDocumentId) {
        setAgentStatus({
          status: 'attaching',
          detail: 'Saving this document so the assistant can work on it…',
        });
        turnDocumentId = await ensureRemoteDocument();
        if (!streamIsLive()) return;
        if (!turnDocumentId) {
          setError(
            'This document could not be saved, so there is nothing for the assistant to work on yet.',
          );
          return;
        }
        setAgentStatus(null);
      } else if (hasPendingEdits()) {
        // The agent reads the *stored* document. Edits sit in this browser for
        // five seconds before autosave takes them, which is long enough to ask
        // a question about a paragraph the server has never seen — and to get
        // back a rewrite of the version the author had already replaced.
        setAgentStatus({ status: 'saving', detail: 'Saving your latest edits…' });
        try {
          await saveRemote();
        } catch {
          // Reported by the editor's own save notice. Asking about a document
          // one revision behind still beats refusing to answer at all.
        }
        if (!streamIsLive()) return;
        setAgentStatus(null);
      }

      // Captured for the whole turn. A conversation belongs to the document it
      // was started on; nothing below may silently move it to another one.
      let turnChatId = sessionRef.current.selectedChatId;
      let turnThreadId = sessionRef.current.selectedThreadId;

      // A chat id can outlive the chat it names — deleted from the chats panel
      // in another tab, or left behind in this browser after the document it
      // belonged to was removed. The server answers `CHAT_NOT_FOUND` and the
      // session used to stay wedged on that dead id for good. Recover once, as
      // a new conversation on the document that is actually open.
      let recover: 'chat' | 'thread' | null = null;
      let alreadyRecovered = false;

      const handlers: SSEEventHandlers = {
        onToken: (content) => {
          if (!streamIsLive()) return;
          setAgentStatus(null);
          patchActive((message) => ({ ...message, content: message.content + content }));
        },
        onStatus: (status, detail) => {
          if (!streamIsLive()) return;
          setAgentStatus({ status, detail });
        },
        onToolCallStart: (tool, toolCallId, args) => {
          if (!streamIsLive()) return;
          // The activity list below spells this out step by step; the status
          // line is only there so something moves before the first token.
          setAgentStatus({ status: 'executing_tool', detail: `${toolRunningLabel(tool)}…` });
          patchActive((message) => ({
            ...message,
            runs: [
              ...message.runs,
              {
                id: toolCallId || `${tool}:${message.runs.length}`,
                tool,
                state: 'running',
                detail: toolRunDetail(tool, args),
              },
            ],
          }));
        },
        onToolCallEnd: (tool, toolCallId, durationMs, isError) => {
          if (!streamIsLive()) return;
          patchActive((message) => {
            const index = message.runs.findIndex(
              (run) =>
                run.state === 'running' && (toolCallId ? run.id === toolCallId : run.tool === tool),
            );
            if (index === -1) return message;
            const runs = message.runs.slice();
            runs[index] = {
              ...runs[index],
              state: isError ? 'error' : 'done',
              durationMs,
            };
            return { ...message, runs };
          });
        },
        onToolAction: (action) => {
          if (!streamIsLive()) return;
          onToolAction(action);
        },
        onError: (code, message) => {
          if (!streamIsLive()) return;
          if (!alreadyRecovered && (code === 'CHAT_NOT_FOUND' || code === 'THREAD_NOT_FOUND')) {
            // Reported by the retry below if that fails too, so the author is
            // never shown an error the app is about to resolve by itself.
            recover = code === 'CHAT_NOT_FOUND' ? 'chat' : 'thread';
            return;
          }
          patchActive((active) => ({
            ...active,
            runs: active.runs.map((run) =>
              run.state === 'running' ? { ...run, state: 'error' as const } : run,
            ),
          }));
          setError(message);
        },
        onDone: (chatId, threadId) => {
          if (!streamIsLive()) return;
          const id = chatId || turnChatId;
          // This transcript *is* the conversation these ids name, so mark it
          // loaded before the ids land and the loader chases them.
          if (id) {
            loadedConversation.current = `${turnDocumentId}:${id}:${
              typeof threadId === 'number' ? threadId : turnThreadId ?? 'latest'
            }`;
          }
          // Through the ref, because attaching the document mid-turn rebuilt
          // these setters around the id the session now has, and the ones this
          // closure captured refuse to write for a document that has moved on.
          if (chatId && chatId !== turnChatId) {
            turnChatId = chatId;
            sessionRef.current.setSelectedChatId(chatId);
          }
          if (typeof threadId === 'number' && threadId !== turnThreadId) {
            turnThreadId = threadId;
            sessionRef.current.setSelectedThreadId(threadId);
          }
        },
      };

      for (;;) {
        recover = null;
        await streamAgentChat(
          {
            message: text,
            document_id: turnDocumentId,
            chat_id: turnChatId,
            thread_id: turnThreadId,
            mode: 'assistant',
          },
          handlers,
          { signal: controller.signal },
        );

        if (!recover || !streamIsLive()) break;

        alreadyRecovered = true;
        if (recover === 'chat') {
          turnChatId = null;
          sessionRef.current.setSelectedChatId(null);
        }
        turnThreadId = null;
        sessionRef.current.setSelectedThreadId(null);
        loadedConversation.current = null;
        // The failed attempt reached no tools, but a redelivered id from it
        // must not block the retry's own staging.
        processedToolCallIds.current = new Set();
      }
    } catch (e) {
      // An aborted stream is a deliberate stop, not a failure to report.
      if (streamIsLive()) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
    } finally {
      // A newer send owns the UI now, or this document's assistant has
      // unmounted. The older completion must not clean up the new stream.
      if (
        mountedRef.current
        && (abortRef.current === null || abortRef.current === controller)
      ) {
        setIsStreaming(false);
        if (abortRef.current === controller) abortRef.current = null;
        setAgentStatus(null);
        // A tool that never reported completion would otherwise spin forever.
        patchActive((message) => ({
          ...message,
          runs: message.runs.map((run) =>
            run.state === 'running' ? { ...run, state: 'done' as const } : run,
          ),
        }));
        activeMessageIdRef.current = null;
        setActiveMessageId(null);
      }
    }
  };

  const onSend = () => send(input.trim());

  const onSuggestion = (suggestion: string) => {
    inputHostRef.current?.focus();
    send(suggestion);
  };

  const onRetry = () => {
    const text = lastSent;
    if (!text) return;
    // Drop the failed exchange so the transcript does not accumulate dead ends.
    setMessages((prev) => prev.slice(0, -2));
    setError('');
    send(text);
  };

  const onStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setAgentStatus(null);
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
    : { inset: CHAT_MARGIN };

  const overLimit = input.length > MAX_MESSAGE_LENGTH;
  const nearLimit = input.length > MAX_MESSAGE_LENGTH * 0.8;

  return (
    <div
      ref={panelRef}
      role="complementary"
      // Naming the document in the region label is how this reaches a screen
      // reader: the line in the header is small, muted, and not focusable, so
      // it would otherwise only be discovered by reading the whole panel.
      aria-label={attachment.regionLabel}
      onKeyDown={onPanelKeyDown}
      style={geometry}
      className={cn(
        'absolute z-[var(--z-floating)] flex flex-col overflow-hidden rounded-xl',
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
              onFocusChange={() => {
                const first = proposals.pending[0];
                if (first) proposals.focusChange(first.id);
              }}
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
                <span className="min-w-0 break-words">{error}</span>
              </p>
              {lastSent && !isStreaming && (
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
}

/* ----------------------------------------
   Window edges
   ---------------------------------------- */

const EDGE_CLASS: Record<Exclude<DragMode, 'move'>, string> = {
  n: 'inset-x-3 top-0 h-1.5 cursor-ns-resize',
  s: 'inset-x-3 bottom-0 h-1.5 cursor-ns-resize',
  w: 'inset-y-3 left-0 w-1.5 cursor-ew-resize',
  e: 'inset-y-3 right-0 w-1.5 cursor-ew-resize',
  nw: 'left-0 top-0 h-3 w-3 cursor-nwse-resize',
  ne: 'right-0 top-0 h-3 w-3 cursor-nesw-resize',
  sw: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize',
  se: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize',
};

/**
 * The eight grab zones around the window.
 *
 * Only the top-left corner takes focus. Eight tab stops for one operation
 * would bury the composer at the bottom of the panel's tab order, and one
 * handle that resizes in both axes covers everything the other seven do.
 */
function ResizeHandles({
  onBegin,
  onNudge,
  rect,
}: {
  onBegin: (event: React.PointerEvent, mode: DragMode) => void;
  onNudge: (mode: DragMode, event: React.KeyboardEvent) => boolean;
  rect: { width: number; height: number };
}) {
  return (
    <>
      {(Object.keys(EDGE_CLASS) as Array<Exclude<DragMode, 'move'>>).map((edge) => {
        const keyboard = edge === 'nw';
        return (
          <div
            key={edge}
            data-resize={edge}
            onPointerDown={(event) => onBegin(event, edge)}
            onKeyDown={
              keyboard
                ? (event) => {
                    if (onNudge(edge, event)) event.preventDefault();
                  }
                : undefined
            }
            {...(keyboard
              ? {
                  role: 'separator' as const,
                  tabIndex: 0,
                  'aria-label':
                    'Resize assistant. Left and up arrows enlarge it; right and down arrows shrink it.',
                  'aria-valuetext': `${Math.round(rect.width)} by ${Math.round(rect.height)} pixels`,
                }
              : { 'aria-hidden': true })}
            style={{ touchAction: 'none' }}
            className={cn(
              // Invisible until the pointer is on it, then a hairline in the
              // accent colour — the same reveal the shell's panel dividers
              // use. A permanently drawn frame around a floating window is
              // noise; the resize cursor is what actually announces it.
              'absolute z-10 rounded-full transition-colors hover:bg-primary/60',
              EDGE_CLASS[edge],
              keyboard &&
                'focus-visible:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          />
        );
      })}
    </>
  );
}

/* ----------------------------------------
   One turn of the conversation
   ---------------------------------------- */

function MessageRow({
  message,
  live,
  onFocusChange,
}: {
  message: ChatMessage;
  live: boolean;
  onFocusChange: () => void;
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
      {message.runs.length > 0 && <AgentActivity runs={message.runs} live={live} />}

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

      {message.proposed > 0 && (
        <button
          type="button"
          onClick={onFocusChange}
          className="flex w-full items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-left text-xs transition-colors hover:bg-primary/15"
        >
          <Sparkles aria-hidden="true" className="h-3 w-3 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            Suggested {message.proposed} {message.proposed === 1 ? 'change' : 'changes'} — review in
            the document
          </span>
          <CornerDownLeft aria-hidden="true" className="h-3 w-3 shrink-0 text-primary" />
        </button>
      )}

      {message.content && !live && <CopyReply text={message.content} />}
    </div>
  );
}

/** Copy a reply out of the panel — the transcript is not selectable mid-stream. */
function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* a clipboard the browser refuses is not worth an error banner */
        }
      }}
      className={cn(
        'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-opacity',
        'opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/message:opacity-100',
        copied && 'opacity-100',
      )}
    >
      {copied ? (
        <>
          <Check aria-hidden="true" className="h-3 w-3 text-diff-add-fg" />
          Copied
        </>
      ) : (
        <>
          <Copy aria-hidden="true" className="h-3 w-3" />
          Copy
        </>
      )}
    </button>
  );
}
